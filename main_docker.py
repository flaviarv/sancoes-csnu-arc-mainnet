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

import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import threading
import time
from typing import List
from eth_account import Account
from eth_account.messages import encode_defunct
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

def _client_ip(request: Request) -> str:
    """IP real do visitante. Atrás do proxy (Caddy), uvicorn --proxy-headers
    resolve X-Forwarded-For em request.client.host."""
    return request.client.host if request.client else "unknown"


# ── Onchain job lookup ────────────────────────────────────────────────────────
def _load_paid_job(job_id: int):
    """Lê o job na Arc Mainnet. Só aceita job COMPLETED com orçamento >= preço.
    Completed = o USDC já foi liberado para a treasury (irreversível, sem refund).
    Falha do RPC => 503 (fail-closed): nunca libera acesso sem confirmar o pagamento."""
    if job_id <= 0:
        raise HTTPException(status_code=402, detail="Payment required: no valid job.")
    try:
        w3 = Web3(Web3.HTTPProvider(_ARC_RPC, request_kwargs={"timeout": 15}))
        contract = w3.eth.contract(address=Web3.to_checksum_address(_CONTRACT), abi=_GET_JOB_ABI)
        job = contract.functions.getJob(job_id).call()
    except Exception as e:
        print(f"[WARN] onchain lookup failed for job {job_id}: {e}")
        raise HTTPException(status_code=503, detail="Could not verify payment onchain. Try again shortly.")
    status, budget = job[7], job[5]   # 0=Open 1=Funded 2=Submitted 3=Completed 4=Rejected 5=Expired
    if status != 3:
        raise HTTPException(status_code=402, detail=f"Payment not completed: job {job_id} status={status}.")
    if budget < _SEARCH_PRICE:
        raise HTTPException(status_code=402, detail=f"Payment too low: job {job_id}.")
    return job


# ── Sessions: 1 job pago = 1 sessão, só para a carteira que pagou ─────────────
_SCOPES = {"csnu", "wallets"}
_SESSION_TTL = int(os.environ.get("SESSION_TTL_SECONDS", "1800"))      # 30 min
_SIGNATURE_MAX_AGE = 300                                               # 5 min
# Defina SESSION_SECRET no .env para sessões sobreviverem a reinícios do container.
_SESSION_SECRET = (os.environ.get("SESSION_SECRET") or secrets.token_hex(32)).encode()

_USED_JOBS_FILE = os.environ.get("USED_JOBS_FILE", os.path.join(_REPO_ROOT, "state", "used_jobs.json"))
_used_jobs: set = set()
_used_lock = threading.Lock()


def _load_used_jobs() -> None:
    try:
        with open(_USED_JOBS_FILE, encoding="utf-8") as f:
            _used_jobs.update(int(x) for x in json.load(f))
    except FileNotFoundError:
        pass
    except Exception as e:
        # Arquivo corrompido: não ignorar em silêncio (permitiria reuso de jobs).
        raise RuntimeError(f"Could not read {_USED_JOBS_FILE}: {e}")


def _persist_used_jobs() -> None:
    os.makedirs(os.path.dirname(_USED_JOBS_FILE), exist_ok=True)
    tmp = _USED_JOBS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sorted(_used_jobs), f)
    os.replace(tmp, _USED_JOBS_FILE)


def _session_message(job_id: int, scope: str, issued_at: int) -> str:
    # O frontend monta exatamente este texto para a carteira assinar.
    return (
        "criptokyc.tech - acesso a consulta\n"
        f"Produto: {scope}\n"
        f"Job: {job_id}\n"
        "Rede: Arc Mainnet (5042)\n"
        f"Emitido em: {issued_at}"
    )


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _sign_token(payload: dict) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(_SESSION_SECRET, body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _require_session(token: str, scope: str) -> dict:
    """Valida o token de sessão (assinatura HMAC, validade e produto)."""
    invalid = HTTPException(status_code=401, detail="Session invalid or expired. Please pay again.")
    try:
        body, sig = token.split(".", 1)
        expected = hmac.new(_SESSION_SECRET, body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise invalid
        padded = body + "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except HTTPException:
        raise
    except Exception:
        raise invalid
    if payload.get("s") != scope or int(payload.get("e", 0)) < int(time.time()):
        raise invalid
    return payload


class SessionRequest(BaseModel):
    job_id: int
    scope: str
    issued_at: int
    signature: str


class SessionResponse(BaseModel):
    session_token: str
    expires_at: int


@app.post("/api/session", response_model=SessionResponse)
@app.post("/session",     response_model=SessionResponse)
def create_session(payload: SessionRequest, request: Request):
    """Troca um job pago por uma sessão. Exige assinatura da carteira que pagou
    (client do job) e cada job só pode gerar UMA sessão."""
    _check_rate_limit(_client_ip(request))
    if payload.scope not in _SCOPES:
        raise HTTPException(status_code=400, detail="Unknown product.")
    now = int(time.time())
    if abs(now - payload.issued_at) > _SIGNATURE_MAX_AGE:
        raise HTTPException(status_code=401, detail="Signature expired. Sign again.")

    try:
        message = encode_defunct(text=_session_message(payload.job_id, payload.scope, payload.issued_at))
        signer = Account.recover_message(message, signature=payload.signature)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid signature.")

    job = _load_paid_job(payload.job_id)
    if signer.lower() != str(job[1]).lower():
        raise HTTPException(status_code=403, detail="Only the wallet that paid this job can unlock it.")

    with _used_lock:
        if payload.job_id in _used_jobs:
            raise HTTPException(status_code=409, detail="This payment was already used. Please pay again.")
        _used_jobs.add(payload.job_id)
        try:
            _persist_used_jobs()
        except Exception as e:
            _used_jobs.discard(payload.job_id)
            print(f"[ERROR] could not persist used job {payload.job_id}: {e}")
            raise HTTPException(status_code=503, detail="Could not record the payment. Try again.")

    expires_at = now + _SESSION_TTL
    token = _sign_token({"j": payload.job_id, "s": payload.scope, "e": expires_at})
    return SessionResponse(session_token=token, expires_at=expires_at)


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
def startup_event():
    _load_used_jobs()
    csnu_count    = _csnu.load()
    wallets_count = _wallets.load()
    print(f"CSNU loaded: {csnu_count} names.")
    print(f"Wallet sanctions loaded: {wallets_count} unique addresses.")

# ── CSNU endpoint ─────────────────────────────────────────────────────────────
class CheckNamesRequest(BaseModel):
    raw_input: str
    session_token: str

class NameResult(BaseModel):
    name: str
    is_contained: bool
    message: str

class CheckNamesResponse(BaseModel):
    results: List[NameResult]

@app.post("/api/check-names", response_model=CheckNamesResponse)
@app.post("/check-names",     response_model=CheckNamesResponse)
def check_names(payload: CheckNamesRequest, request: Request):
    _check_rate_limit(_client_ip(request))
    _require_session(payload.session_token, "csnu")
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
    session_token: str

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
    _check_rate_limit(_client_ip(request))
    _require_session(payload.session_token, "wallets")
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
def complete_job(payload: CompleteJobRequest, request: Request):
    _check_rate_limit(_client_ip(request))
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
