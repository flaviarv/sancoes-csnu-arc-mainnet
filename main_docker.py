"""
main_docker.py — versão Docker da API.
Serve a API CSNU, validação ERC-8183 complete-job e arquivos estáticos do Vite.
"""
import os
import unicodedata
from typing import List, Set
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import pandas as pd
from web3 import Web3

app = FastAPI(title="Verificador de Sanções CSNU")

SANCTIONED_NAMES: Set[str] = set()


def normalize_text(text: str) -> str:
    if not isinstance(text, str):
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.strip().lower().split())


def load_csnu_dataset(parquet_path: str = "csnu_list.parquet"):
    global SANCTIONED_NAMES
    try:
        df = pd.read_parquet(parquet_path)
    except Exception as e:
        print(f"Erro ao carregar arquivo Parquet: {e}")
        return

    extracted_names: Set[str] = set()

    for _, row in df.iterrows():
        parts = [
            str(row[col])
            for col in ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"]
            if col in row and pd.notna(row[col]) and str(row[col]).strip()
        ]
        if parts:
            extracted_names.add(normalize_text(" ".join(parts)))

        for col in ["NAME_ORIGINAL_SCRIPT"]:
            if col in row and pd.notna(row[col]):
                extracted_names.add(normalize_text(str(row[col])))

        if "INDIVIDUAL_ALIAS" in row and isinstance(row["INDIVIDUAL_ALIAS"], list):
            for alias in row["INDIVIDUAL_ALIAS"]:
                if isinstance(alias, dict) and alias.get("ALIAS_NAME"):
                    extracted_names.add(normalize_text(str(alias["ALIAS_NAME"])))

        if "ENTITY_ALIAS" in row and isinstance(row["ENTITY_ALIAS"], list):
            for alias in row["ENTITY_ALIAS"]:
                if isinstance(alias, dict) and alias.get("ALIAS_NAME"):
                    extracted_names.add(normalize_text(str(alias["ALIAS_NAME"])))

    SANCTIONED_NAMES = {name for name in extracted_names if name}
    print(f"Dataset carregado: {len(SANCTIONED_NAMES)} nomes únicos indexados.")


@app.on_event("startup")
def startup_event():
    load_csnu_dataset("csnu_list.parquet")


# ── Modelos ──────────────────────────────────────────────

class CheckNamesRequest(BaseModel):
    raw_input: str

class NameResult(BaseModel):
    name: str
    is_contained: bool
    message: str

class CheckNamesResponse(BaseModel):
    results: List[NameResult]

class CompleteJobRequest(BaseModel):
    job_id: int


# ── ERC-8183 Complete Job ────────────────────────────────

COMPLETE_JOB_ABI = [
    {"name": "submit",   "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "jobId", "type": "uint256"}, {"name": "deliverable", "type": "bytes32"}, {"name": "optParams", "type": "bytes"}], "outputs": []},
    {"name": "complete", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "jobId", "type": "uint256"}, {"name": "reason", "type": "bytes32"}, {"name": "optParams", "type": "bytes"}], "outputs": []},
    {"name": "getJob",   "type": "function", "stateMutability": "view",
     "inputs": [{"name": "jobId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "tuple", "components": [
         {"name": "id", "type": "uint256"}, {"name": "client", "type": "address"},
         {"name": "provider", "type": "address"}, {"name": "evaluator", "type": "address"},
         {"name": "description", "type": "string"}, {"name": "budget", "type": "uint256"},
         {"name": "expiredAt", "type": "uint256"}, {"name": "status", "type": "uint8"},
         {"name": "hook", "type": "address"}]}]},
]

ARC_RPC       = "https://rpc.mainnet.arc.io"
CONTRACT_ADDR = Web3.to_checksum_address("0x975a005E4107c12e585DB71059fe857449510c99")
TREASURY_ADDR = Web3.to_checksum_address("0xd2f80f6cf27483392f70f21b3381109f9c33c390")


@app.post("/complete-job")
@app.post("/api/complete-job")
def complete_job(payload: CompleteJobRequest):
    pk = os.environ.get("TREASURY_PRIVATE_KEY", "")
    if not pk:
        raise HTTPException(status_code=503, detail="TREASURY_PRIVATE_KEY not configured — auto-complete unavailable.")
    if not pk.startswith("0x"):
        pk = "0x" + pk

    w3 = Web3(Web3.HTTPProvider(ARC_RPC))
    contract = w3.eth.contract(address=CONTRACT_ADDR, abi=COMPLETE_JOB_ABI)
    job = contract.functions.getJob(payload.job_id).call()
    status = job[7]

    if status == 3:
        return {"status": "already_completed"}

    if status == 1:
        tx_submit = contract.functions.submit(
            payload.job_id, b'\x00' * 32, b''
        ).build_transaction({
            "from": TREASURY_ADDR,
            "nonce": w3.eth.get_transaction_count(TREASURY_ADDR),
            "gas": 200_000,
        })
        signed = w3.eth.account.sign_transaction(tx_submit, pk)
        submit_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        w3.eth.wait_for_transaction_receipt(submit_hash, timeout=60)
        status = 2

    if status == 2:
        tx_complete = contract.functions.complete(
            payload.job_id, b'\x00' * 32, b''
        ).build_transaction({
            "from": TREASURY_ADDR,
            "nonce": w3.eth.get_transaction_count(TREASURY_ADDR),
            "gas": 200_000,
        })
        signed = w3.eth.account.sign_transaction(tx_complete, pk)
        complete_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        return {"status": "completed", "tx_hash": complete_hash.hex()}

    return {"status": "not_ready", "job_status": status}


# ── Consulta de Nomes ─────────────────────────────────────

@app.post("/check-names", response_model=CheckNamesResponse)
@app.post("/api/check-names", response_model=CheckNamesResponse)
def check_names(payload: CheckNamesRequest):
    if not payload.raw_input.strip():
        raise HTTPException(status_code=400, detail="Nenhum nome fornecido.")

    results = []
    for line in payload.raw_input.splitlines():
        line_clean = line.strip()
        if not line_clean:
            continue
        is_in_csnu = normalize_text(line_clean) in SANCTIONED_NAMES
        results.append(NameResult(
            name=line_clean,
            is_contained=is_in_csnu,
            message=(
                f"O nome '{line_clean}' está contido na lista CSNU."
                if is_in_csnu else
                f"O nome '{line_clean}' não está contido na lista do CSNU."
            ),
        ))
    return CheckNamesResponse(results=results)


# ── Frontend estático ────────────────────────────────────

STATIC_DIR = "static"

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=f"{STATIC_DIR}/assets"), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str = ""):
        index = os.path.join(STATIC_DIR, "index.html")
        return FileResponse(index)
