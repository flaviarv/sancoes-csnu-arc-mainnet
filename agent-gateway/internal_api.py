"""
internal_api.py - API interna do agent-gateway (NAO exposta ao publico).

Roda em 127.0.0.1 e so recebe chamadas do proxy x402 (server.ts), que ja
verificou o pagamento. Reaproveita os loaders de pipeline/, sem alterar
main_docker.py (o site de producao continua intocado).

Uso:  uvicorn agent-gateway.internal_api:app  (veja README.md)
"""

import hmac
import os
import sys
from typing import Annotated, List

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, StringConstraints

# Raiz do repositorio no sys.path para importar pipeline/
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from pipeline.loaders.csnu_loader import CsnuLoader  # noqa: E402
from pipeline.loaders.wallets_loader import WalletsLoader  # noqa: E402

MAX_ITEMS = 50  # limite por chamada paga (o proxy valida o mesmo limite)
MAX_ITEM_LENGTH = 200  # igual ao do proxy; protege também contra chamadas diretas
Item = Annotated[str, StringConstraints(max_length=MAX_ITEM_LENGTH)]

# Defesa em profundidade: se INTERNAL_TOKEN estiver definido, só o proxy (que o conhece) consulta.
# Mesmo que esta API seja publicada por engano, ninguém lê os dados sem pagar.
_INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN", "")


def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    if _INTERNAL_TOKEN and not hmac.compare_digest(x_internal_token, _INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized.")


app = FastAPI(title="criptokyc agent-gateway internal API", docs_url=None, redoc_url=None)
_csnu = CsnuLoader()
_wallets = WalletsLoader()


@app.on_event("startup")
def _startup() -> None:
    print(f"CSNU loaded: {_csnu.load()} names.")
    print(f"Wallet sanctions loaded: {_wallets.load()} unique addresses.")


class NamesRequest(BaseModel):
    names: List[Item] = Field(min_length=1, max_length=MAX_ITEMS)


class WalletsRequest(BaseModel):
    wallets: List[Item] = Field(min_length=1, max_length=MAX_ITEMS)


@app.get("/internal/health")
def health() -> dict:
    return {"status": "ok", "csnu_names": _csnu.count, "wallet_addresses": _wallets.count}


@app.post("/internal/check-names", dependencies=[Depends(require_internal_token)])
def check_names(payload: NamesRequest) -> dict:
    results = []
    for raw in payload.names:
        name = raw.strip()
        if not name:
            continue
        results.append({"name": name, "is_sanctioned": _csnu.contains(name)})
    if not results:
        raise HTTPException(status_code=400, detail="No valid names provided.")
    return {
        "source": "UN Security Council Consolidated Sanctions List (CSNU)",
        "results": results,
        "total": len(results),
        "sanctioned_count": sum(1 for r in results if r["is_sanctioned"]),
    }


@app.post("/internal/check-wallets", dependencies=[Depends(require_internal_token)])
def check_wallets(payload: WalletsRequest) -> dict:
    if _wallets.count == 0:
        raise HTTPException(status_code=503, detail="Wallet sanctions data not loaded.")
    results = []
    for raw in payload.wallets:
        addr = raw.strip()
        if not addr:
            continue
        report = _wallets.check(addr)
        results.append({
            "address": report["address"],
            "chain": report["chain"] or "unknown",
            "is_sanctioned": report["is_sanctioned"],
            "verdict_status": report["verdict_status"],
            "verdict_summary": report["verdict_summary"],
            "sources": report["sources"],
        })
    if not results:
        raise HTTPException(status_code=400, detail="No valid wallet addresses provided.")
    return {
        "results": results,
        "total": len(results),
        "sanctioned_count": sum(1 for r in results if r["is_sanctioned"]),
    }
