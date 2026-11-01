# ── PROTECTED ─────────────────────────────────────────────────
# Backend principal do criptokyc.tech.
# NÃO modifique sem aprovação explícita da proprietária.
# Contém endereço do contrato, RPC e preço de verificação onchain.
# ──────────────────────────────────────────────────────────────

"""
main_docker.py — API backend para criptokyc.tech.

Dados: pipeline/loaders/ (CSNU nomes + carteiras sancionadas)
Pagamentos: ERC-8183 escrow na Arc Mainnet (verificação onchain antes de retornar dados)
Frontend: arquivos estáticos compilados em static/
"""

import os
import sys
import time
from typing import List
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from web3 import Web3

# ── Pipeline imports ─────────────────────────────────────────────────────────
# Garante que o diretório raiz do repo está no sys.path para imports do pipeline
_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from pipeline.loaders.csnu_loader import CsnuLoader
from pipeline.loaders.wallets_loader import WalletsLoader

# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="criptokyc.tech API")

# Instâncias dos loaders (carregadas no startup)
_csnu = CsnuLoader()
_wallets = WalletsLoader()

# ── Onchain payment verification ─────────────────────────────────────────────
_ARC_RPC  = "https://rpc.mainnet.arc.io"
_CONTRACT = "0x975a005E4107c12e585DB71059fe857449510c99"
_SEARCH_PRICE = 1_000_000  # 1 USDC (6 decimals) — must match AgenticCommerce contract

_GET_JOB_ABI = [{"type": "function", "name": "getJob", "stateMutability": "view",
    "inputs": [{"name": "jobId", "type": "uint256"}],
    "outputs": [{"name": "", "type": "tuple", "components": [
        {"name": "id",         "type": "uint256"},
        {"name": "client",     "type": "address"},
        {"name": "provider",   "type": "address"},
        {"name": "evaluator",  "type": "address"},
        {"name": "description","type": "string"},
        {"name": "budget",     "type": "uint256"},
        {"name": "expiredAt",  "type": "uint256"},
        {"name": "status",     "type": "uint8"},
        {"name": "hook",       "type": "address"},
    ]}]
}]

# ── Rate limiting (in-memory, resets on restart) ──────────────────────────────
_rate_limit: dict = {}
_RATE_WINDOW  = 60   # seconds
_RATE_MAX_REQ = 10   # max requests per IP per window

def _check_rate_limit(ip: str) -> None:
    now = time.time()
    hits = [t for t in _rate_limit.get(ip, []) if now - t < _RATE_WINDOW]
    if len(hits) >= _RATE_MAX_REQ:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again in a minute.")
    hits.append(now)
    _rate_limit[ip] = hits

def _verify_job_paid(job_id: int) -> None:
    """Calls getJob() on Arc Mainnet and verifies the job is funded with 1 USDC."""
    if job_id <= 0:
        raise HTTPException(status_code=402, detail="Payment required: no valid job_id provided.")
    try:
        w3 = Web3(Web3.HTTPProvider(_ARC_RPC))
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(_CONTRACT),
            abi=_GET_JOB_ABI,
        )
        job    = contract.functions.getJob(job_id).call()
        status = job[7]   # 0=Open 1=Funded 2=Submitted 3=Completed 4=Rejected 5=Expired
        budget = job[5]
        expired_at = job[6]
        now    = int(time.time())

        if status not in (1, 2, 3):
            raise HTTPException(status_code=402, detail=f"Payment required: job {job_id} status={status}.")
        if budget < _SEARCH_PRICE:
            raise HTTPException(status_code=402, detail=f"Payment required: job {job_id} budget {budget} below required {_SEARCH_PRICE}.")
        if status in (1, 2) and expired_at < now:
            raise HTTPException(status_code=402, detail=f"Payment expired: job {job_id} expired at {expired_at}.")
    except HTTPException:
        raise
    except Exception as e:
        # RPC failure — fail open with a warning (do not block users on infra issues)
        print(f"[WARN] onchain payment check failed for job {job_id}: {e}")

# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
def startup_event():
    csnu_count    = _csnu.load()
    wallets_count = _wallets.load()
    print(f"CSNU loaded: {csnu_count} names.")
    print(f"Wallet sanctions loaded: {wallets_count} unique addresses.")

# ── CSNU endpoint ─────────────────────────────────────────────────────────────
class CheckNamesRequest(BaseModel):
    raw_input: str
    job_id: int

class NameResult(BaseModel):
    name: str
    is_contained: bool
    message: str

class CheckNamesResponse(BaseModel):
    results: List[NameResult]

@app.post("/api/check-names", response_model=CheckNamesResponse)
@app.post("/check-names",     response_model=CheckNamesResponse)
def check_names(payload: CheckNamesRequest, request: Request):
    _check_rate_limit(request.client.host if request.client else "unknown")
    _verify_job_paid(payload.job_id)
    if not payload.raw_input.strip():
        raise HTTPException(status_code=400, detail="Nenhum nome fornecido.")

    results = []
    for line in payload.raw_input.splitlines():
        name = line.strip()
        if not name:
            continue
        found = _csnu.contains(name)
        results.append(NameResult(
            name=name,
            is_contained=found,
            message=(
                f"O nome '{name}' está contido na lista CSNU."
                if found else
                f"O nome '{name}' não está contido na lista do CSNU."
            ),
        ))
    return CheckNamesResponse(results=results)

# ── Wallet Sanctions endpoint ─────────────────────────────────────────────────
class CheckWalletsRequest(BaseModel):
    wallets: List[str]
    job_id: int

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

@app.post("/api/check-wallets", response_model=CheckWalletsResponse)
@app.post("/check-wallets",     response_model=CheckWalletsResponse)
def check_wallets(payload: CheckWalletsRequest, request: Request):
    _check_rate_limit(request.client.host if request.client else "unknown")
    _verify_job_paid(payload.job_id)
    if not payload.wallets:
        raise HTTPException(status_code=400, detail="Nenhuma carteira fornecida.")
    if _wallets.count == 0:
        raise HTTPException(status_code=503, detail="Wallet sanctions engine not available.")

    results = []
    for addr in payload.wallets:
        addr = addr.strip()
        if not addr:
            continue
        report = _wallets.check(addr)
        results.append(WalletResult(
            address=report["address"],
            chain=report["chain"] or "Não identificada",
            is_sanctioned=report["is_sanctioned"],
            verdict_status=report["verdict_status"],
            verdict_summary=report["verdict_summary"],
            sources=report["sources"],
        ))

    sanctioned = sum(1 for r in results if r.is_sanctioned)
    return CheckWalletsResponse(results=results, total=len(results), sanctioned_count=sanctioned)

# ── ERC-8183 complete-job ─────────────────────────────────────────────────────
class CompleteJobRequest(BaseModel):
    job_id: int

@app.post("/api/complete-job")
@app.post("/complete-job")
def complete_job(payload: CompleteJobRequest):
    """Called by frontend after fund(). Backend calls submit() + complete() as treasury."""
    private_key_raw = os.environ.get("TREASURY_PRIVATE_KEY", "")
    if not private_key_raw:
        raise HTTPException(status_code=500, detail="TREASURY_PRIVATE_KEY not configured.")
    private_key = private_key_raw if private_key_raw.startswith("0x") else f"0x{private_key_raw}"

    try:
        w3   = Web3(Web3.HTTPProvider(_ARC_RPC))
        acct = w3.eth.account.from_key(private_key)

        ABI = [
            {"type": "function", "name": "submit",   "stateMutability": "nonpayable",
             "inputs": [{"name": "jobId", "type": "uint256"}, {"name": "deliverable", "type": "bytes32"}, {"name": "optParams", "type": "bytes"}], "outputs": []},
            {"type": "function", "name": "complete",  "stateMutability": "nonpayable",
             "inputs": [{"name": "jobId", "type": "uint256"}, {"name": "reason",      "type": "bytes32"}, {"name": "optParams", "type": "bytes"}], "outputs": []},
            {"type": "function", "name": "getJob",    "stateMutability": "view",
             "inputs": [{"name": "jobId", "type": "uint256"}],
             "outputs": [{"name": "", "type": "tuple", "components": [
                 {"name": "id", "type": "uint256"}, {"name": "client", "type": "address"},
                 {"name": "provider", "type": "address"}, {"name": "evaluator", "type": "address"},
                 {"name": "description", "type": "string"}, {"name": "budget", "type": "uint256"},
                 {"name": "expiredAt", "type": "uint256"}, {"name": "status", "type": "uint8"},
                 {"name": "hook", "type": "address"},
             ]}]},
        ]

        contract = w3.eth.contract(address=Web3.to_checksum_address(_CONTRACT), abi=ABI)
        job      = contract.functions.getJob(payload.job_id).call()
        status, provider, evaluator = job[7], job[2], job[3]

        if status == 1 and acct.address.lower() == provider.lower():
            nonce = w3.eth.get_transaction_count(acct.address)
            tx    = contract.functions.submit(payload.job_id, b"\x00" * 32, b"").build_transaction(
                {"from": acct.address, "nonce": nonce, "gas": 200000, "gasPrice": w3.eth.gas_price})
            signed = acct.sign_transaction(tx)
            w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(signed.hash, timeout=120)
            status = 2

        if status == 2 and acct.address.lower() == evaluator.lower():
            nonce  = w3.eth.get_transaction_count(acct.address)
            tx     = contract.functions.complete(payload.job_id, b"\x00" * 32, b"").build_transaction(
                {"from": acct.address, "nonce": nonce, "gas": 200000, "gasPrice": w3.eth.gas_price})
            signed = acct.sign_transaction(tx)
            txh    = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(txh, timeout=120)
            return {"status": "completed", "tx": receipt.transactionHash.hex()}

        return {"status": "skipped", "job_status": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Reload data ───────────────────────────────────────────────────────────────
# Called by deploy_to_hostinger.sh after new parquets are synced.
# Protected by RELOAD_SECRET env var — set a strong random value in .env.

class ReloadResponse(BaseModel):
    status: str
    csnu_count: int
    wallets_count: int

@app.post("/reload-data", response_model=ReloadResponse)
def reload_data(request: Request):
    secret = os.environ.get("RELOAD_SECRET", "")
    if not secret:
        raise HTTPException(status_code=503, detail="RELOAD_SECRET not configured on server.")
    provided = request.headers.get("X-Reload-Secret", "")
    if provided != secret:
        raise HTTPException(status_code=401, detail="Invalid reload secret.")
    csnu_count    = _csnu.load()
    wallets_count = _wallets.load()
    print(f"[reload-data] CSNU reloaded: {csnu_count} names.")
    print(f"[reload-data] Wallets reloaded: {wallets_count} addresses.")
    return ReloadResponse(status="ok", csnu_count=csnu_count, wallets_count=wallets_count)


# ── Frontend estático ─────────────────────────────────────────────────────────
STATIC_DIR = "static"

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=f"{STATIC_DIR}/assets"), name="assets")

    @app.get("/",                    include_in_schema=False)
    @app.get("/{full_path:path}",    include_in_schema=False)
    def serve_spa(full_path: str = ""):
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
