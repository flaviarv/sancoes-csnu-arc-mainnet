"""
pipeline/loaders/csnu_loader.py — expõe o set de nomes CSNU para a API.

Uso em main_docker.py:
    from pipeline.loaders.csnu_loader import CsnuLoader
    loader = CsnuLoader()
    loader.load()
    is_sanctioned = loader.contains("Noor Wali Mehsud")
"""

from typing import Set
from pipeline.sources.csnu import load_csnu_names
from pipeline.transforms.normalize import normalize_name


class CsnuLoader:
    def __init__(self) -> None:
        self._names: Set[str] = set()

    def load(self) -> int:
        """Carrega os dados do parquet. Retorna o número de nomes indexados."""
        self._names = load_csnu_names()
        return len(self._names)

    def contains(self, name: str) -> bool:
        """Retorna True se o nome (normalizado) está na lista CSNU."""
        return normalize_name(name) in self._names

    @property
    def count(self) -> int:
        return len(self._names)
