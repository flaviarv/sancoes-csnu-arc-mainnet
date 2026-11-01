"""
pipeline/config.py — caminhos e parâmetros técnicos do pipeline.

ATENÇÃO: Este arquivo contém apenas configuração de infraestrutura (paths,
encoding, colunas). Regras de negócio (preço, treasury, contrato) ficam em
frontend/src/config/business-rules.ts e NÃO devem ser adicionadas aqui.
"""

from pathlib import Path

# Raiz do repositório (dois níveis acima deste arquivo)
REPO_ROOT = Path(__file__).resolve().parent.parent

# Diretório de dados brutos — atualizado externamente via AWS/GitHub Actions
DATA_RAW = REPO_ROOT / "data" / "raw"

# Parquet do CSNU (nomes de pessoas e entidades sancionadas pela ONU)
CSNU_PARQUET = DATA_RAW / "csnu_list.parquet"

# Parquets de carteiras sancionadas — um por jurisdição
WALLET_PARQUETS = {
    "OFAC":         DATA_RAW / "carteiras" / "sdn_advanced.parquet",
    "Israel_NBCTF": DATA_RAW / "carteiras" / "israel_nbctf.parquet",
    "UK_OFSI":      DATA_RAW / "carteiras" / "uk_sanctions.parquet",
    "EU_EEAS":      DATA_RAW / "carteiras" / "eu_sanctions.parquet",
    "UN_CSNU":      DATA_RAW / "carteiras" / "un_sanctions.parquet",
    "CH_SECO":      DATA_RAW / "carteiras" / "seco_sanctions.parquet",
}
