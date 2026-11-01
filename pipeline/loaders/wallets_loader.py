"""
pipeline/loaders/wallets_loader.py — expõe o índice de carteiras sancionadas para a API.

Uso em main_docker.py:
    from pipeline.loaders.wallets_loader import WalletsLoader
    loader = WalletsLoader()
    loader.load()
    result = loader.check("0x1234...")
"""

from typing import Dict, Any, List
from pipeline.sources.wallets import load_wallet_index
from pipeline.transforms.normalize import normalize_address, detect_chain, is_valid_address


class WalletsLoader:
    def __init__(self) -> None:
        self._index: Dict[str, List[Dict[str, Any]]] = {}

    def load(self) -> int:
        """Carrega os dados dos parquets. Retorna o número de endereços únicos indexados."""
        self._index = load_wallet_index()
        return len(self._index)

    def check(self, address: str) -> Dict[str, Any]:
        """
        Verifica se um endereço está sancionado.
        Retorna um dicionário com is_sanctioned, chain, sources, matches e verdict.
        """
        raw = normalize_address(address)
        key = raw.lower() if raw.startswith("0x") else raw

        matches: List[Dict[str, Any]] = self._index.get(key, [])
        is_sanctioned = len(matches) > 0
        sources = list(dict.fromkeys(m["source"] for m in matches))
        entities = list(dict.fromkeys(m["entity_name"] for m in matches))

        chain = None
        for m in matches:
            if m.get("chain") and m["chain"] not in ("Desconhecida", "Unknown", "Desconhecido"):
                chain = m["chain"]
                break
        if not chain:
            chain = detect_chain(raw)

        if is_sanctioned:
            verdict_status = "ALERTA_SANCOES"
            sources_str = ", ".join(sources)
            verdict_summary = (
                f"ALERTA CRÍTICO: Carteira expressamente sancionada em lista(s) oficial(is): {sources_str}. "
                f"Exige bloqueio cautelar imediato conforme diretrizes internacionais de PLD/CFT."
            )
        elif not is_valid_address(raw):
            verdict_status = "FORMATO_INVALIDO"
            verdict_summary = (
                f"FORMATO INVÁLIDO: O texto '{raw}' não corresponde a um endereço de "
                f"criptomoeda suportado (EVM, Bitcoin, Tron, Solana, etc.)."
            )
        else:
            verdict_status = "REGULAR"
            verdict_summary = (
                "REGULAR: O endereço consultado NÃO consta em nenhuma lista de sanções "
                "governamentais internacionais ativas (OFAC, Israel NBCTF, UK, EU, ONU, SECO)."
            )

        return {
            "address": raw,
            "is_sanctioned": is_sanctioned,
            "chain": chain,
            "sources": sources,
            "entities": entities,
            "matches": matches,
            "verdict_status": verdict_status,
            "verdict_summary": verdict_summary,
        }

    @property
    def count(self) -> int:
        return len(self._index)
