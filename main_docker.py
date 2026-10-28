"""
main_docker.py — versão Docker da API.
Igual ao main.py, mas serve os arquivos estáticos do Vite
na raiz em vez do HTML simples do Swagger.
"""
import os
import unicodedata
from typing import List, Set
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import pandas as pd

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


# ── API ──────────────────────────────────────────────────

class CheckNamesRequest(BaseModel):
    raw_input: str

class NameResult(BaseModel):
    name: str
    is_contained: bool
    message: str

class CheckNamesResponse(BaseModel):
    results: List[NameResult]


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
