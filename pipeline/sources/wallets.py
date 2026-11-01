"""
pipeline/sources/wallets.py — ingestão das listas de carteiras sancionadas.
Lê os parquets de data/raw/carteiras/ e retorna um índice unificado.

Uma entrada por jurisdição. Para adicionar uma nova fonte:
1. Adicione o parquet em data/raw/carteiras/
2. Adicione a chave em pipeline/config.py → WALLET_PARQUETS
3. O loader em pipeline/loaders/wallets_loader.py carrega automaticamente.
"""

import logging
from pathlib import Path
from typing import Dict, Any, List
import pandas as pd

from pipeline.config import WALLET_PARQUETS
from pipeline.transforms.normalize import normalize_address

logger = logging.getLogger(__name__)

# Schema esperado em todos os parquets de carteiras
REQUIRED_COLUMNS = ["lookup_key", "source", "chain", "entity_name"]


def load_wallet_index() -> Dict[str, List[Dict[str, Any]]]:
    """
    Carrega todos os parquets de carteiras sancionadas e retorna um índice:
        { normalized_address: [ { source, chain, entity_name, sanctions_id }, ... ] }
    Endereços EVM são normalizados para lowercase.
    """
    index: Dict[str, List[Dict[str, Any]]] = {}
    total = 0

    for jurisdiction, parquet_path in WALLET_PARQUETS.items():
        if not Path(parquet_path).exists():
            logger.warning(f"{jurisdiction}: parquet não encontrado em {parquet_path}")
            continue
        try:
            df = pd.read_parquet(parquet_path)
        except Exception as e:
            logger.error(f"{jurisdiction}: erro ao ler parquet: {e}")
            continue

        count = 0
        for _, row in df.iterrows():
            raw = str(row.get("lookup_key", "")).strip()
            if not raw:
                continue
            addr = raw.lower() if raw.startswith("0x") else normalize_address(raw)
            entry = {
                "source":      row.get("source", jurisdiction),
                "chain":       row.get("chain", "Desconhecida"),
                "entity_name": row.get("entity_name", "Não especificada"),
                "sanctions_id":str(row.get("sanctions_id", "N/A")),
            }
            index.setdefault(addr, []).append(entry)
            count += 1

        logger.info(f"{jurisdiction}: {count} registros indexados.")
        total += count

    logger.info(f"Wallet index: {len(index)} endereços únicos ({total} registros totais).")
    return index
