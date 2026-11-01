"""
update_sanctions_lists.py
=========================
Downloads official sanctions lists from public APIs, converts to Parquet,
and saves to data/raw/. Triggered by AWS EventBridge via Lambda or locally.

Sources:
  OFAC SDN     — https://www.treasury.gov/ofac/downloads/sdn_advanced.xml
  UN CSNU      — https://scsanctions.un.org/resources/xml/en/consolidated.xml
  UK OFSI      — https://assets.publishing.service.gov.uk/...
  EU           — https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content
  Israel NBCTF — https://nbctf.mod.gov.il/he/Announcements/Documents/NBCTFIsrael.xlsx
  SECO         — https://www.seco.admin.ch/dam/seco/de/dokumente/Aussenwirtschaft/...

Usage:
  python scripts/update_sanctions_lists.py           # update all lists
  python scripts/update_sanctions_lists.py --list ofac  # update only OFAC

DO NOT MODIFY: data source URLs and output paths are defined here only.
Business rules (price, treasury, contract) live in frontend/src/config/business-rules.ts.
"""

import os
import sys
import argparse
import logging
import hashlib
import requests
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_CARTEIRAS = DATA_RAW / "carteiras"
DATA_CARTEIRAS.mkdir(parents=True, exist_ok=True)

# ── Source definitions ────────────────────────────────────────────────────────
# Each entry: id, url, parser function name, output parquet path
SOURCES = {
    "ofac": {
        "url": "https://www.treasury.gov/ofac/downloads/sdn_advanced.xml",
        "output": DATA_CARTEIRAS / "sdn_advanced.parquet",
        "format": "xml",
        "description": "OFAC SDN Advanced XML",
    },
    "un": {
        "url": "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
        "output": DATA_CARTEIRAS / "un_sanctions.parquet",
        "format": "xml",
        "description": "UN Security Council Consolidated List",
    },
    "uk": {
        "url": (
            "https://assets.publishing.service.gov.uk/government/uploads/system/uploads/"
            "attachment_data/file/UK_Sanctions_List.ods"
        ),
        "output": DATA_CARTEIRAS / "uk_sanctions.parquet",
        "format": "ods",
        "description": "UK OFSI Consolidated List",
    },
    "eu": {
        "url": (
            "https://webgate.ec.europa.eu/fsd/fsf/public/files/"
            "xmlFullSanctionsList_1_1/content"
        ),
        "output": DATA_CARTEIRAS / "eu_sanctions.parquet",
        "format": "xml",
        "description": "EU Financial Sanctions Files",
    },
    "israel": {
        "url": "https://nbctf.mod.gov.il/he/Announcements/Documents/NBCTFIsrael.xlsx",
        "output": DATA_CARTEIRAS / "israel_nbctf.parquet",
        "format": "xlsx",
        "description": "Israel NBCTF Sanctions List",
    },
    "seco": {
        "url": (
            "https://www.seco.admin.ch/dam/seco/de/dokumente/Aussenwirtschaft/"
            "Wirtschaftliche_Landesversorgung/Embargomassnahmen/sanktionen_aktuell.xlsx.download.xlsx/"
            "Liste_consolidee_SECO.xlsx"
        ),
        "output": DATA_CARTEIRAS / "seco_sanctions.parquet",
        "format": "xlsx",
        "description": "SECO Switzerland Sanctions",
    },
    "csnu": {
        "url": "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
        "output": DATA_RAW / "csnu_list.parquet",
        "format": "xml_csnu_names",
        "description": "UN CSNU — name index for text search",
    },
}

# ── Download helper ───────────────────────────────────────────────────────────

def download(url: str, timeout: int = 60) -> bytes:
    """Download a URL and return raw bytes. Raises on HTTP error."""
    log.info(f"Downloading: {url}")
    resp = requests.get(url, timeout=timeout, headers={"User-Agent": "criptokyc.tech/sanctions-updater"})
    resp.raise_for_status()
    log.info(f"Downloaded {len(resp.content):,} bytes")
    return resp.content


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_parquet(df: pd.DataFrame, path: Path) -> None:
    """Save DataFrame as Parquet, log row count."""
    df.to_parquet(path, index=False, engine="pyarrow")
    log.info(f"Saved {len(df):,} rows → {path.relative_to(ROOT)}")


# ── Parsers ───────────────────────────────────────────────────────────────────
# Each parser receives raw bytes and returns a DataFrame.
# Add a new parser here when adding a new sanctions source.

def parse_ofac_xml(data: bytes) -> pd.DataFrame:
    """Parse OFAC SDN Advanced XML → DataFrame with address/wallet columns."""
    import xml.etree.ElementTree as ET
    root = ET.fromstring(data)
    ns = {"sdn": "https://sanctionslistservice.ofac.treas.gov/api/PublicationsService/sdn/1.0"}
    rows = []
    for entry in root.findall(".//sdn:sdnEntry", ns):
        uid = (entry.findtext("sdn:uid", namespaces=ns) or "").strip()
        sdn_type = (entry.findtext("sdn:sdnType", namespaces=ns) or "").strip()
        for id_elem in entry.findall(".//sdn:id", ns):
            id_type = (id_elem.findtext("sdn:idType", namespaces=ns) or "").strip()
            id_number = (id_elem.findtext("sdn:idNumber", namespaces=ns) or "").strip()
            if id_type in ("Digital Currency Address - XBT", "Digital Currency Address - ETH",
                           "Digital Currency Address - XMR", "Digital Currency Address - USDT",
                           "Digital Currency Address - TRX", "Digital Currency Address - SOL",
                           "Digital Currency Address - LTC", "Digital Currency Address - ZEC",
                           "Digital Currency Address - BSC", "Digital Currency Address - ARB",
                           "Digital Currency Address - MATIC"):
                chain = id_type.replace("Digital Currency Address - ", "")
                rows.append({"uid": uid, "sdn_type": sdn_type, "chain": chain, "address": id_number.strip()})
    df = pd.DataFrame(rows, columns=["uid", "sdn_type", "chain", "address"])
    return df


def parse_un_xml(data: bytes) -> pd.DataFrame:
    """Parse UN consolidated XML → DataFrame with address columns."""
    import xml.etree.ElementTree as ET
    root = ET.fromstring(data)
    rows = []
    for individual in root.findall(".//INDIVIDUAL"):
        ref = (individual.findtext("DATAID") or "").strip()
        for doc in individual.findall(".//INDIVIDUAL_DOCUMENT"):
            doc_type = (doc.findtext("TYPE_OF_DOCUMENT") or "").strip()
            doc_number = (doc.findtext("NUMBER") or "").strip()
            if "crypto" in doc_type.lower() or "wallet" in doc_type.lower() or "bitcoin" in doc_type.lower():
                rows.append({"ref": ref, "doc_type": doc_type, "address": doc_number})
    for entity in root.findall(".//ENTITY"):
        ref = (entity.findtext("DATAID") or "").strip()
        for doc in entity.findall(".//ENTITY_DOCUMENT"):
            doc_type = (doc.findtext("TYPE_OF_DOCUMENT") or "").strip()
            doc_number = (doc.findtext("NUMBER") or "").strip()
            if "crypto" in doc_type.lower() or "wallet" in doc_type.lower():
                rows.append({"ref": ref, "doc_type": doc_type, "address": doc_number})
    df = pd.DataFrame(rows, columns=["ref", "doc_type", "address"]) if rows else pd.DataFrame(columns=["ref", "doc_type", "address"])
    return df


def parse_csnu_names_xml(data: bytes) -> pd.DataFrame:
    """Parse UN consolidated XML → name index DataFrame (for CSNU text search)."""
    import xml.etree.ElementTree as ET
    root = ET.fromstring(data)
    rows = []
    for individual in root.findall(".//INDIVIDUAL"):
        ref = (individual.findtext("DATAID") or "").strip()
        first = (individual.findtext("FIRST_NAME") or "").strip()
        second = (individual.findtext("SECOND_NAME") or "").strip()
        third = (individual.findtext("THIRD_NAME") or "").strip()
        fourth = (individual.findtext("FOURTH_NAME") or "").strip()
        original = (individual.findtext("NAME_ORIGINAL_SCRIPT") or "").strip()
        rows.append({
            "DATAID": ref, "FIRST_NAME": first, "SECOND_NAME": second,
            "THIRD_NAME": third, "FOURTH_NAME": fourth, "NAME_ORIGINAL_SCRIPT": original,
        })
        for alias in individual.findall(".//INDIVIDUAL_ALIAS"):
            alias_name = (alias.findtext("ALIAS_NAME") or "").strip()
            if alias_name:
                rows.append({
                    "DATAID": ref, "FIRST_NAME": alias_name, "SECOND_NAME": "",
                    "THIRD_NAME": "", "FOURTH_NAME": "", "NAME_ORIGINAL_SCRIPT": "",
                })
    df = pd.DataFrame(rows)
    return df


def parse_xlsx(data: bytes, sheet: Optional[int] = 0) -> pd.DataFrame:
    """Generic XLSX parser — returns raw DataFrame."""
    import io
    return pd.read_excel(io.BytesIO(data), sheet_name=sheet, dtype=str).fillna("")


def parse_ods(data: bytes) -> pd.DataFrame:
    """Generic ODS parser — returns raw DataFrame."""
    import io
    return pd.read_excel(io.BytesIO(data), sheet_name=0, engine="odf", dtype=str).fillna("")


def parse_eu_xml(data: bytes) -> pd.DataFrame:
    """Parse EU Financial Sanctions XML → DataFrame with address columns."""
    import xml.etree.ElementTree as ET
    root = ET.fromstring(data)
    rows = []
    for entity in root.findall(".//{http://eu.europa.eu/fsd/export}entity"):
        ref = entity.get("euReferenceNumber", "")
        for id_doc in entity.findall(".//{http://eu.europa.eu/fsd/export}identification"):
            id_type = id_doc.get("identificationTypeCode", "")
            number = (id_doc.findtext("{http://eu.europa.eu/fsd/export}number") or "").strip()
            if "crypto" in id_type.lower() or "virtual" in id_type.lower() or "wallet" in id_type.lower():
                rows.append({"ref": ref, "id_type": id_type, "address": number})
    df = pd.DataFrame(rows, columns=["ref", "id_type", "address"]) if rows else pd.DataFrame(columns=["ref", "id_type", "address"])
    return df


# ── Dispatcher ────────────────────────────────────────────────────────────────

PARSERS = {
    "xml": parse_ofac_xml,        # default XML parser (OFAC)
    "xml_un": parse_un_xml,
    "xml_csnu_names": parse_csnu_names_xml,
    "xml_eu": parse_eu_xml,
    "xlsx": parse_xlsx,
    "ods": parse_ods,
}

FORMAT_OVERRIDE = {
    "un": "xml_un",
    "eu": "xml_eu",
}


def update_source(source_id: str) -> bool:
    """Download and convert one source. Returns True on success."""
    cfg = SOURCES[source_id]
    fmt = FORMAT_OVERRIDE.get(source_id, cfg["format"])
    parser = PARSERS.get(fmt)
    if parser is None:
        log.error(f"No parser for format '{fmt}' (source: {source_id})")
        return False
    try:
        data = download(cfg["url"])
        checksum = sha256(data)
        df = parser(data)
        save_parquet(df, cfg["output"])
        log.info(f"[{source_id}] OK — {len(df):,} rows, sha256={checksum[:12]}…")
        return True
    except Exception as exc:
        log.error(f"[{source_id}] FAILED: {exc}")
        return False


# ── Lambda entrypoint ─────────────────────────────────────────────────────────

def lambda_handler(event: dict, context) -> dict:  # type: ignore[type-arg]
    """AWS Lambda entrypoint — called by EventBridge."""
    target = event.get("list", "all")
    return run(target)


# ── CLI entrypoint ────────────────────────────────────────────────────────────

def run(target: str = "all") -> dict:
    started = datetime.now(timezone.utc).isoformat()
    results = {}
    sources_to_run = list(SOURCES.keys()) if target == "all" else [target]
    for source_id in sources_to_run:
        if source_id not in SOURCES:
            log.error(f"Unknown source: {source_id}. Available: {list(SOURCES.keys())}")
            results[source_id] = "error: unknown source"
            continue
        ok = update_source(source_id)
        results[source_id] = "ok" if ok else "error"
    finished = datetime.now(timezone.utc).isoformat()
    summary = {"started": started, "finished": finished, "results": results}
    log.info(f"Summary: {summary}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Update sanctions lists from official sources.")
    parser.add_argument("--list", default="all", choices=list(SOURCES.keys()) + ["all"],
                        help="Which list to update (default: all)")
    args = parser.parse_args()
    result = run(args.list)
    failed = [k for k, v in result["results"].items() if v != "ok"]
    sys.exit(1 if failed else 0)
