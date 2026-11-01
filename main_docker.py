"""
main_docker.py — versão Docker da API.
Igual ao main.py, mas serve os arquivos estáticos do Vite
na raiz em vez do HTML simples do Swagger.
"""
import os
import sys
import unicodedata
from typing import List, Set, Optional
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import pandas as pd

# Wallet sanctions pipeline — resolve path relative to this file
_WALLETS_REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "carteiras-sancao-governamental-internacional")
if os.path.isdir(_WALLETS_REPO) and _WALLETS_REPO not in sys.path:
    sys.path.insert(0, _WALLETS_REPO)
    print(f"Wallet repo found: {_WALLETS_REPO}")

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


WALLET_RULE = None

def _load_wallet_engine():
    """Load wallet sanctions engine with proper working directory."""
    global WALLET_RULE
    if not os.path.isdir(_WALLETS_REPO):
        print(f"Wallet repo not found at: {_WALLETS_REPO}")
        return
    orig = os.getcwd()
    try:
        os.chdir(_WALLETS_REPO)
        # Import after chdir so relative paths in the pipeline resolve correctly
        from src.sanctions.aggregator import UnifiedSanctionsEngine  # type: ignore[import]
        from src.analyzer.rules.sanctions_compliance import SanctionsComplianceRule  # type: ignore[import]
        engine = UnifiedSanctionsEngine()
        engine.load_all()
        WALLET_RULE = SanctionsComplianceRule(engine)
        stats = engine.get_stats()
        print(f"Wallet sanctions loaded: {stats['total_unique_sanctioned']} unique addresses indexed.")
    except Exception as e:
        print(f"Wallet sanctions engine not available: {e}")
    finally:
        os.chdir(orig)

@app.on_event("startup")
def startup_event():
    # Resolve parquet path relative to this file (works in both dev and Docker)
    _here = os.path.dirname(os.path.abspath(__file__))
    _parquet = os.path.join(_here, "sancoes-csnu-arc", "csnu_list.parquet")
    if not os.path.isfile(_parquet):
        # fallback: same directory as this file
        _parquet = os.path.join(_here, "csnu_list.parquet")
    load_csnu_dataset(_parquet)
    _load_wallet_engine()


# ── API ──────────────────────────────────────────────────

class CheckNamesRequest(BaseModel):
    raw_input: str

class NameResult(BaseModel):
    name: str
    is_contained: bool
    message: str

class CheckNamesResponse(BaseModel):
    results: List[NameResult]


@app.post("/api/check-names", response_model=CheckNamesResponse)
@app.post("/check-names", response_model=CheckNamesResponse)
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


# ── Wallet Sanctions Endpoint ─────────────────────────────

class CheckWalletsRequest(BaseModel):
    wallets: List[str]

class WalletResult(BaseModel):
    address: str
    chain: str
    is_sanctioned: bool
    verdict_status: str
    verdict_summary: str
    sources: List[str]

class CheckWalletsResponse(BaseModel):
    results: List[WalletResult]
    total: int
    sanctioned_count: int

@app.post("/check-wallets", response_model=CheckWalletsResponse)
@app.post("/api/check-wallets", response_model=CheckWalletsResponse)
def check_wallets(payload: CheckWalletsRequest):
    if WALLET_RULE is None:
        raise HTTPException(status_code=503, detail="Wallet sanctions engine not available.")
    if not payload.wallets:
        raise HTTPException(status_code=400, detail="Nenhuma carteira fornecida.")

    results = []
    orig = os.getcwd()
    try:
        if os.path.isdir(_WALLETS_REPO):
            os.chdir(_WALLETS_REPO)
        for addr in payload.wallets:
            addr = addr.strip()
            if not addr:
                continue
            report = WALLET_RULE.evaluate(addr)
            results.append(WalletResult(
                address=addr,
                chain=report.get("chain", "Não identificada"),
                is_sanctioned=report["is_sanctioned"],
                verdict_status=report["verdict_status"],
                verdict_summary=report["verdict_summary"],
                sources=report.get("sources", []),
            ))
    finally:
        os.chdir(orig)

    sanctioned = sum(1 for r in results if r.is_sanctioned)
    return CheckWalletsResponse(results=results, total=len(results), sanctioned_count=sanctioned)


# ── ERC-8183 complete-job ────────────────────────────────

class CompleteJobRequest(BaseModel):
    job_id: int

@app.post("/api/complete-job")
@app.post("/complete-job")
def complete_job(payload: CompleteJobRequest):
    """Called by the frontend after fund(). Backend calls submit() + complete() as treasury."""
    private_key_raw = os.environ.get("TREASURY_PRIVATE_KEY", "")
    if not private_key_raw:
        raise HTTPException(status_code=500, detail="TREASURY_PRIVATE_KEY not configured.")
    private_key = private_key_raw if private_key_raw.startswith("0x") else f"0x{private_key_raw}"

    try:
        from web3 import Web3
        RPC = "https://rpc.mainnet.arc.io"
        CONTRACT = "0x975a005E4107c12e585DB71059fe857449510c99"
        TREASURY = "0xd2f80f6cf27483392f70f21b3381109f9c33c390"
        w3 = Web3(Web3.HTTPProvider(RPC))
        acct = w3.eth.account.from_key(private_key)

        ABI = [
            {"type":"function","name":"submit","stateMutability":"nonpayable",
             "inputs":[{"name":"jobId","type":"uint256"},{"name":"deliverable","type":"bytes32"},{"name":"optParams","type":"bytes"}],"outputs":[]},
            {"type":"function","name":"complete","stateMutability":"nonpayable",
             "inputs":[{"name":"jobId","type":"uint256"},{"name":"reason","type":"bytes32"},{"name":"optParams","type":"bytes"}],"outputs":[]},
            {"type":"function","name":"getJob","stateMutability":"view",
             "inputs":[{"name":"jobId","type":"uint256"}],
             "outputs":[{"name":"","type":"tuple","components":[
                 {"name":"id","type":"uint256"},{"name":"client","type":"address"},
                 {"name":"provider","type":"address"},{"name":"evaluator","type":"address"},
                 {"name":"description","type":"string"},{"name":"budget","type":"uint256"},
                 {"name":"expiredAt","type":"uint256"},{"name":"status","type":"uint8"},
                 {"name":"hook","type":"address"}
             ]}]},
        ]

        contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT), abi=ABI)
        job = contract.functions.getJob(payload.job_id).call()
        status = job[7]  # JobStatus enum
        provider = job[2]
        evaluator = job[3]

        # Only proceed if job is Funded (1) or Submitted (2)
        if status == 1:  # Funded — need submit() first
            # submit() must be called by provider
            if acct.address.lower() == provider.lower():
                nonce = w3.eth.get_transaction_count(acct.address)
                tx = contract.functions.submit(
                    payload.job_id, b'\x00' * 32, b''
                ).build_transaction({'from': acct.address, 'nonce': nonce, 'gas': 200000, 'gasPrice': w3.eth.gas_price})
                signed = acct.sign_transaction(tx)
                w3.eth.send_raw_transaction(signed.raw_transaction)
                w3.eth.wait_for_transaction_receipt(signed.hash, timeout=120)
                status = 2  # now Submitted

        if status == 2:  # Submitted — evaluator calls complete()
            if acct.address.lower() == evaluator.lower():
                nonce = w3.eth.get_transaction_count(acct.address)
                tx = contract.functions.complete(
                    payload.job_id, b'\x00' * 32, b''
                ).build_transaction({'from': acct.address, 'nonce': nonce, 'gas': 200000, 'gasPrice': w3.eth.gas_price})
                signed = acct.sign_transaction(tx)
                txh = w3.eth.send_raw_transaction(signed.raw_transaction)
                receipt = w3.eth.wait_for_transaction_receipt(txh, timeout=120)
                return {"status": "completed", "tx": receipt.transactionHash.hex()}
            else:
                return {"status": "skipped", "reason": f"Treasury {acct.address} is not evaluator {evaluator} for this job."}

        return {"status": "skipped", "job_status": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Frontend estático ────────────────────────────────────

STATIC_DIR = "static"

if os.path.isdir(STATIC_DIR):
    # Serve arquivos JS/CSS/assets
    app.mount("/assets", StaticFiles(directory=f"{STATIC_DIR}/assets"), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str = ""):
        # Rotas da API já foram tratadas acima — aqui só chega o frontend
        index = os.path.join(STATIC_DIR, "index.html")
        return FileResponse(index)
