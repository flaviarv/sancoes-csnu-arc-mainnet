"""
pipeline/transforms/normalize.py — funções de normalização de texto e endereços.
Sem dependências de regras de negócio.
"""

import re
import unicodedata


def normalize_name(text: str) -> str:
    """Remove acentos, normaliza espaços e converte para minúsculas."""
    if not isinstance(text, str):
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.strip().lower().split())


def normalize_address(address: str) -> str:
    """Remove espaços e caracteres invisíveis (BOM, zero-width) de endereços cripto."""
    return str(address).strip().strip("\ufeff\u200b\u200e\u200f")


# Padrões de endereço por rede — usados por detect_chain()
_CHAIN_PATTERNS = {
    "EVM":     re.compile(r"^0x[a-fA-F0-9]{40}$"),
    "Tron":    re.compile(r"^T[a-km-zA-HJ-NP-Z1-9]{33}$"),
    "Bitcoin": re.compile(r"^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{38,87}$", re.IGNORECASE),
    "Litecoin":re.compile(r"^(L|M)[a-km-zA-HJ-NP-Z1-9]{26,34}$|^ltc1[a-z0-9]{39,59}$", re.IGNORECASE),
    "Ripple":  re.compile(r"^r[0-9a-zA-Z]{24,34}$"),
    "Monero":  re.compile(r"^[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93}$|^[48][0-9AB][1-9A-HJ-NP-Za-km-z]{104}$"),
    "Zcash":   re.compile(r"^t[13][a-km-zA-HJ-NP-Z1-9]{33}$|^zs1[a-z0-9]{75}$|^u1[a-z0-9]{50,200}$"),
    "Solana":  re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$"),
}


def detect_chain(address: str) -> str:
    """Identifica a rede pelo formato do endereço. Retorna 'Não identificada' se desconhecido."""
    raw = normalize_address(address)
    # Caso especial: System Program da Solana (32 × '1')
    if re.fullmatch(r"1{32}", raw):
        return "Solana"
    for name, pattern in _CHAIN_PATTERNS.items():
        if pattern.match(raw):
            return name
    return "Não identificada"


def is_valid_address(address: str) -> bool:
    """Retorna True se o texto tem formato de endereço cripto reconhecido."""
    return detect_chain(address) != "Não identificada"
