"""
pipeline/sources/csnu.py — ingestão da lista CSNU (ONU Security Council).
Lê data/raw/csnu_list.parquet e retorna um Set de nomes normalizados.
"""

import logging
from pathlib import Path
from typing import Set
import pandas as pd

from pipeline.config import CSNU_PARQUET
from pipeline.transforms.normalize import normalize_name

logger = logging.getLogger(__name__)


def load_csnu_names(parquet_path: Path = CSNU_PARQUET) -> Set[str]:
    """
    Carrega o parquet CSNU e retorna um set de nomes normalizados.
    Indexa: nome completo (FIRST+SECOND+THIRD+FOURTH NAME),
            NAME_ORIGINAL_SCRIPT e aliases.
    """
    try:
        df = pd.read_parquet(parquet_path)
    except Exception as e:
        logger.error(f"Erro ao carregar CSNU parquet ({parquet_path}): {e}")
        return set()

    names: Set[str] = set()

    for _, row in df.iterrows():
        # Nome completo
        parts = [
            str(row[col])
            for col in ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"]
            if col in row and pd.notna(row[col]) and str(row[col]).strip()
        ]
        if parts:
            names.add(normalize_name(" ".join(parts)))

        # Nome em escrita original
        if "NAME_ORIGINAL_SCRIPT" in row and pd.notna(row["NAME_ORIGINAL_SCRIPT"]):
            names.add(normalize_name(str(row["NAME_ORIGINAL_SCRIPT"])))

        # Aliases
        for alias_col in ["INDIVIDUAL_ALIAS", "ENTITY_ALIAS"]:
            if alias_col in row and isinstance(row[alias_col], list):
                for alias in row[alias_col]:
                    if isinstance(alias, dict) and alias.get("ALIAS_NAME"):
                        names.add(normalize_name(str(alias["ALIAS_NAME"])))

    names.discard("")
    logger.info(f"CSNU: {len(names)} nomes únicos indexados.")
    return names
