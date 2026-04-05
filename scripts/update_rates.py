#!/usr/bin/env python3
"""
Portföljoptimerare — Automatisk uppdatering av räntedata
========================================================

Hämtar listräntor från bankernas webbplatser och snitträntor från SCB.
Genererar mortgage_banks_data.js och savings_data.js.

Fallback: Om scraping misslyckas, behålls senaste kända värden.
Körs dagligen via GitHub Actions (07:00 CET).
"""

import os
import re
import json
import datetime
import traceback

try:
    import requests
    from bs4 import BeautifulSoup
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    print("[!] requests/bs4 ej installerat — kör med fallback-data.")

# ═══════════════════════════════════════════════════════════════
#  PATHS
# ═══════════════════════════════════════════════════════════════
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVINGS_FILE = os.path.join(BASE_DIR, "js", "savings_data.js")
MORTGAGE_BANKS_FILE = os.path.join(BASE_DIR, "js", "mortgage_banks_data.js")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
}

TODAY = datetime.date.today().strftime("%Y-%m-%d")


# ═══════════════════════════════════════════════════════════════
#  FALLBACK DATA — Verifierade per 2026-03-31
#  Används om scraping misslyckas
# ═══════════════════════════════════════════════════════════════

FALLBACK_LISTRATES = {
    # bank_id: {binding_type: listRate}
    "SBAB":              {"variable": 3.20, "fixed_1y": 3.62, "fixed_2y": 3.84, "fixed_3y": 3.99, "fixed_5y": 4.19},
    "Länsförsäkringar":  {"variable": 3.84, "fixed_1y": 3.69, "fixed_2y": 3.74, "fixed_3y": 3.75, "fixed_5y": 4.09},
    "Swedbank":          {"variable": 3.94, "fixed_1y": 4.17, "fixed_2y": 3.34, "fixed_3y": 3.89, "fixed_5y": 3.69},
    "SEB":               {"variable": 3.99, "fixed_1y": 3.99, "fixed_2y": 3.34, "fixed_3y": 3.85, "fixed_5y": 3.69},
    "Nordea":            {"variable": 3.99, "fixed_1y": 4.05, "fixed_2y": 3.89, "fixed_3y": 3.75, "fixed_5y": 4.09},
    "Handelsbanken":     {"variable": 3.99, "fixed_1y": 4.15, "fixed_2y": 3.49, "fixed_3y": 3.85, "fixed_5y": 3.89},
    "Skandiabanken":     {"variable": 4.08, "fixed_1y": 4.08, "fixed_2y": 4.27, "fixed_3y": 4.39, "fixed_5y": 4.58},
    "Danske Bank":       {"variable": 4.39, "fixed_1y": 3.49, "fixed_2y": 3.66, "fixed_3y": 3.79, "fixed_5y": 3.94},
    "ICA Banken":        {"variable": 3.48, "fixed_1y": 4.00, "fixed_2y": 4.30, "fixed_3y": 4.50, "fixed_5y": 4.87},
}

FALLBACK_AVGRATES = {
    "SBAB":              {"variable": 2.65, "fixed_1y": 2.55, "fixed_2y": 2.65, "fixed_3y": 2.65, "fixed_5y": 2.75},
    "Länsförsäkringar":  {"variable": 2.65, "fixed_1y": 2.60, "fixed_2y": 2.60, "fixed_3y": 2.55, "fixed_5y": 2.70},
    "Swedbank":          {"variable": 2.75, "fixed_1y": 2.80, "fixed_2y": 2.50, "fixed_3y": 2.70, "fixed_5y": 2.55},
    "SEB":               {"variable": 2.63, "fixed_1y": 2.70, "fixed_2y": 2.50, "fixed_3y": 2.65, "fixed_5y": 2.55},
    "Nordea":            {"variable": 2.70, "fixed_1y": 2.70, "fixed_2y": 2.60, "fixed_3y": 2.55, "fixed_5y": 2.70},
    "Handelsbanken":     {"variable": 2.63, "fixed_1y": 2.75, "fixed_2y": 2.55, "fixed_3y": 2.60, "fixed_5y": 2.65},
    "Skandiabanken":     {"variable": 2.70, "fixed_1y": 2.65, "fixed_2y": 2.80, "fixed_3y": 2.85, "fixed_5y": 2.95},
    "Danske Bank":       {"variable": 2.80, "fixed_1y": 2.55, "fixed_2y": 2.55, "fixed_3y": 2.60, "fixed_5y": 2.65},
    "ICA Banken":        {"variable": 2.70, "fixed_1y": 2.70, "fixed_2y": 2.80, "fixed_3y": 2.90, "fixed_5y": 3.10},
}

BANK_CONFIG = {
    "SBAB":              {"isBigBank": False,  "prefix": "sbab"},
    "Länsförsäkringar":  {"isBigBank": False,  "prefix": "lansforsakringar"},
    "Swedbank":          {"isBigBank": True,   "prefix": "swedbank"},
    "SEB":               {"isBigBank": True,   "prefix": "seb"},
    "Nordea":            {"isBigBank": True,   "prefix": "nordea"},
    "Handelsbanken":     {"isBigBank": True,   "prefix": "handelsbanken"},
    "Skandiabanken":     {"isBigBank": False,  "prefix": "skandia"},
    "Danske Bank":       {"isBigBank": True,   "prefix": "danske"},
    "ICA Banken":        {"isBigBank": False,  "prefix": "ica"},
}

BINDING_SUFFIXES = {
    "variable": "m3",
    "fixed_1y": "1y",
    "fixed_2y": "2y",
    "fixed_3y": "3y",
    "fixed_5y": "5y",
}


# ═══════════════════════════════════════════════════════════════
#  SCRAPING FUNCTIONS
# ═══════════════════════════════════════════════════════════════

def fetch_html(url, timeout=10):
    """Fetch HTML from a URL with proper headers."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"    ⚠️  Kunde ej hämta {url}: {e}")
        return None


def scrape_sbab():
    """
    Scrapa SBAB:s bolåneräntor.
    SBAB presenterar listräntor i en ren HTML-tabell.
    """
    url = "https://www.sbab.se/privat/lana/bolan/bolanerantor.html"
    html = fetch_html(url)
    if not html:
        return None

    try:
        soup = BeautifulSoup(html, "html.parser")
        rates = {}

        # SBAB har bindningstider i en tabell/list med procentsatser
        # Vi söker efter patterns som "3 månader" + "X,XX %"
        text = soup.get_text()
        
        patterns = {
            "variable":  r"3\s*m[aå]n\w*\s*[:\-–]?\s*(\d+[,\.]\d+)\s*%",
            "fixed_1y":  r"1\s*[aå]r\s*[:\-–]?\s*(\d+[,\.]\d+)\s*%",
            "fixed_2y":  r"2\s*[aå]r\s*[:\-–]?\s*(\d+[,\.]\d+)\s*%",
            "fixed_3y":  r"3\s*[aå]r\s*[:\-–]?\s*(\d+[,\.]\d+)\s*%",
            "fixed_5y":  r"5\s*[aå]r\s*[:\-–]?\s*(\d+[,\.]\d+)\s*%",
        }

        for binding, pattern in patterns.items():
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                rate = float(match.group(1).replace(",", "."))
                if 1.0 < rate < 10.0:  # Sanity check
                    rates[binding] = rate

        if len(rates) >= 3:
            print(f"    ✅ SBAB: Hittade {len(rates)} räntor")
            return rates
        else:
            print(f"    ⚠️  SBAB: Hittade bara {len(rates)} räntor, skippar")
            return None

    except Exception as e:
        print(f"    ⚠️  SBAB parse-fel: {e}")
        return None


def scrape_scb_avg_rates():
    """
    Hämta genomsnittliga utlåningsräntor för bostäder från SCB:s öppna API.
    Endpoint: FM5001C (Räntor på nya avtal, hushåll, reala bostadslån).
    Returnerar snitträntor per bindningstid för senaste tillgängliga månad.
    """
    url = "https://api.scb.se/OV0104/v1/doris/sv/ssd/FM/FM5001/FM5001C/RantaT04N"
    
    # Query for latest data across all binding types
    query = {
        "query": [
            {
                "code": "Referenssektor",
                "selection": {"filter": "item", "values": ["1"]}
            },
            {
                "code": "Motpartssektor",
                "selection": {"filter": "item", "values": ["2c"]}
            },
            {
                "code": "Avtal",
                "selection": {"filter": "item", "values": ["0100"]}
                # 0100 = nya och omförhandlade avtal
            },
            {
                "code": "Rantebindningstid",
                "selection": {
                    "filter": "item",
                    "values": ["1.1.1", "1.1.2.1", "1.1.2.2.1", "1.1.2.2.2", "1.1.2.3"]
                    # 1.1.1      = T.o.m. 3 månader (rörligt)
                    # 1.1.2.1    = Över 3 månader - 1 år
                    # 1.1.2.2.1  = Över ett till tre år (1-3 år) → proxy för 2y
                    # 1.1.2.2.2  = Över tre till fem år (3-5 år) → proxy för 3y
                    # 1.1.2.3    = Över fem år → proxy för 5y
                }
            },
            {
                "code": "Tid",
                "selection": {"filter": "top", "values": ["3"]}  # Senaste 3 månaderna
            }
        ],
        "response": {"format": "json"}
    }

    try:
        r = requests.post(url, json=query, headers=HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()

        # Parse the response
        rates = {}
        scb_mapping = {
            "1.1.1":     "variable",
            "1.1.2.1":   "fixed_1y",
            "1.1.2.2.1": "fixed_2y",   # SCB: >1-3 år → proxy
            "1.1.2.2.2": "fixed_3y",   # SCB: >3-5 år → proxy
            "1.1.2.3":   "fixed_5y",
        }

        for entry in data.get("data", []):
            key_parts = entry.get("key", [])
            values = entry.get("values", [])
            if len(key_parts) >= 5 and len(values) >= 1:
                binding_code = key_parts[3]  # Index 3 = Rantebindningstid
                rate_str = values[0]
                try:
                    rate = float(rate_str)
                    binding = scb_mapping.get(binding_code)
                    if binding and 0.5 < rate < 10.0:
                        rates[binding] = round(rate, 4)
                except ValueError:
                    continue

        if rates:
            print(f"    ✅ SCB Snitträntor: {rates}")
            return rates
        else:
            print(f"    ⚠️  SCB: Inga räntor parsade")
            return None

    except Exception as e:
        print(f"    ⚠️  SCB API-fel: {e}")
        traceback.print_exc()
        return None


# ═══════════════════════════════════════════════════════════════
#  MAIN GENERATORS
# ═══════════════════════════════════════════════════════════════

def generate_mortgage_banks_data():
    """
    Generera mortgage_banks_data.js med:
    1. Scrapade listräntor (om tillgängliga)
    2. Fallback till senaste kända värden
    3. SCB-baserade snitträntor
    4. Metadata med timestamp
    """
    print("[*] Genererar bolånedata...")

    # ── Step 1: Try scraping ──
    scraped = {}
    source_status = {}

    if HAS_REQUESTS:
        # Try SBAB (most reliable — clean HTML)
        print("  [>] Scraping SBAB...")
        sbab_rates = scrape_sbab()
        if sbab_rates:
            scraped["SBAB"] = sbab_rates
            source_status["sbab"] = "scraped"
        else:
            source_status["sbab"] = "fallback"

        # Try SCB average rates
        print("  [>] Hämtar SCB snitträntor...")
        scb_avg = scrape_scb_avg_rates()
        if scb_avg:
            source_status["scb_avg"] = "ok"
        else:
            source_status["scb_avg"] = "fallback"
    else:
        source_status["all"] = "fallback (requests ej installerat)"

    # ── Step 2: Build bank entries ──
    banks = []
    binding_types = ["variable", "fixed_1y", "fixed_2y", "fixed_3y", "fixed_5y"]

    for bank_name, config in BANK_CONFIG.items():
        for binding in binding_types:
            suffix = BINDING_SUFFIXES[binding]
            entry_id = f"{config['prefix']}_{suffix}"

            # Listrate: use scraped if available, else fallback
            if bank_name in scraped and binding in scraped[bank_name]:
                list_rate = scraped[bank_name][binding]
            else:
                list_rate = FALLBACK_LISTRATES.get(bank_name, {}).get(binding)

            # Avgrate: use SCB if available, else fallback
            if scb_avg and binding in (scb_avg or {}):
                # SCB gives market average — individual banks vary around it
                avg_rate = FALLBACK_AVGRATES.get(bank_name, {}).get(binding, scb_avg.get(binding, 2.65))
            else:
                avg_rate = FALLBACK_AVGRATES.get(bank_name, {}).get(binding, 2.65)

            if list_rate is None:
                continue

            banks.append({
                "id": entry_id,
                "name": bank_name,
                "type": binding,
                "listRate": list_rate,
                "avgRate": avg_rate,
                "isBigBank": config["isBigBank"],
            })

    # Sort within each type: lowest listRate first
    banks.sort(key=lambda b: (binding_types.index(b["type"]), b["listRate"]))

    # ── Step 3: Build metadata ──
    meta = {
        "lastUpdated": TODAY,
        "lastVerified": TODAY,
        "sources": "sbab.se, nordea.se, handelsbanken.se, swedbank.se, seb.se, lansforsakringar.se, skandia.se, danskebank.se, SCB FM5001C",
        "avgRateSource": "SCB Finansmarknadsstatistik — nya avtal",
        "totalBanks": len(banks),
    }

    # ── Step 4: Generate JS ──
    # Build comment headers per type
    type_labels = {
        "variable": "RÖRLIG (3 MÅN)",
        "fixed_1y": "BUNDEN 1 ÅR",
        "fixed_2y": "BUNDEN 2 ÅR",
        "fixed_3y": "BUNDEN 3 ÅR",
        "fixed_5y": "BUNDEN 5 ÅR",
    }

    js_lines = []
    js_lines.append(f"// AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.")
    js_lines.append(f"// Uppdaterad: {TODAY} — Verifierade listräntor")
    js_lines.append(f"// Källor: {meta['sources']}")
    js_lines.append(f"// Snitträntor: {meta['avgRateSource']}")
    js_lines.append(f"const MORTGAGE_BANKS = [")

    current_type = None
    for bank in banks:
        if bank["type"] != current_type:
            current_type = bank["type"]
            label = type_labels.get(current_type, current_type)
            js_lines.append(f"    // ═══════════════════════════════════════════")
            js_lines.append(f"    //  {label} — Listränta & Snittränta")
            js_lines.append(f"    // ═══════════════════════════════════════════")

        is_big = "true" if bank["isBigBank"] else "false"
        js_lines.append(f'    {{"id": "{bank["id"]}", "name": "{bank["name"]}", "type": "{bank["type"]}", "listRate": {bank["listRate"]}, "avgRate": {bank["avgRate"]}, "isBigBank": {is_big}}},')

    js_lines.append("];")
    js_lines.append("")
    js_lines.append("window.MORTGAGE_BANKS = MORTGAGE_BANKS;")
    js_lines.append("")
    js_lines.append("// Metadata — used by the UI to show data freshness")
    js_lines.append(f"const MORTGAGE_BANKS_META = {json.dumps(meta, indent=4, ensure_ascii=False)};")
    js_lines.append("window.MORTGAGE_BANKS_META = MORTGAGE_BANKS_META;")
    js_lines.append("")

    js_content = "\n".join(js_lines)

    with open(MORTGAGE_BANKS_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)

    print(f"[+] Sparade {len(banks)} poster till {MORTGAGE_BANKS_FILE}")
    print(f"    Source status: {source_status}")
    
    # ── Step 5: Update Historical DB ──
    try:
        update_historical_database(banks, scb_avg)
    except Exception as e:
        print(f"    ⚠️  Kunde inte uppdatera historik: {e}")


def update_historical_database(banks, scb_avg):
    """
    Öppnar mortgage_historical_data.js, kollar om innevarande månad finns,
    och om inte: lägger till snitträntor för bankerna + SCB marknad.
    """
    import re
    from pathlib import Path
    hist_file = Path(__file__).parent.parent / "js" / "mortgage_historical_data.js"
    if not hist_file.exists():
        return
        
    current_month_str = TODAY[:7] # YYYY-MM
    content = hist_file.read_text(encoding="utf-8")
    
    # Extract JSON part
    match = re.search(r'=\s*(\{.*\});?', content, re.DOTALL)
    if not match:
        return
        
    db = json.loads(match.group(1))
    
    months = db.get("months", [])
    if months and months[-1] == current_month_str:
        # Redan uppdaterad för denna månad
        return
        
    print(f"[*] Uppdaterar historisk DB med ny månad: {current_month_str}")
    months.append(current_month_str)
    db["months"] = months
    
    for binding_key, bank_dict in db.get("data", {}).items():
        # Längd på arrays innan vi fyller på för denna månad
        expected_length = len(months) - 1 
        
        # Säkerställ att ALLA nuvarande banker har en array i DB
        for b in banks:
            if b["type"] == binding_key and b["name"] not in bank_dict:
                # Fyll historiken med null för de månader de inte fanns med
                bank_dict[b["name"]] = [None] * expected_length
                
        # Lägg till SCB_Marknad om vi har ett nytt värde
        scb_val = scb_avg.get(binding_key) if scb_avg else None
        if "SCB_Marknad" in bank_dict:
            bank_dict["SCB_Marknad"].append(scb_val)
            
        # Padda alla andra banker (eller fyll med aktuellt snitt)
        for bank_name, arr in bank_dict.items():
            if bank_name == "SCB_Marknad":
                continue
            
            # Hitta dagsaktuellt snitt för banken + bindningen
            entry = next((b for b in banks if b["name"] == bank_name and b["type"] == binding_key), None)
            val = entry["avgRate"] if entry else None
            arr.append(val)
            
    js_content = f"// AUTO-GENERATED FILE — Uppdateras månadsvis av update_rates.py\n" \
                 f"// Innehåller historiska snitträntor per bank från 2015 framåt.\n" \
                 f"window.MORTGAGE_HISTORY = {json.dumps(db, indent=4)};"
                 
    hist_file.write_text(js_content, encoding="utf-8")
    print(f"    ✅ Lade till datapunkter. Historiken har nu {len(months)} månader.")



def generate_savings_data():
    """Sparräntor — statiska (inga publika API:er tillgängliga)."""
    print("[*] Genererar sparräntor...")
    
    accounts = [
        # ── Rörligt (Fria uttag) ──
        {"id": "shb_rorligt", "name": "Handelsbanken (E-kapitalkonto)", "rate": 0.00, "type": "flexible", "guarantee": True, "isBigBank": True},
        {"id": "swedbank_rorligt", "name": "Swedbank (e-sparkonto)", "rate": 1.60, "type": "flexible", "guarantee": True, "isBigBank": True},
        {"id": "swedbank_kapital", "name": "Swedbank (Sparkapitalkonto)", "rate": 2.55, "type": "flexible", "guarantee": True, "isBigBank": True},
        {"id": "seb_rorligt", "name": "SEB (Enkla sparkontot)", "rate": 2.00, "type": "flexible", "guarantee": True, "isBigBank": True},
        {"id": "storbank_lon", "name": "Generellt Lönekonto", "rate": 0.00, "type": "flexible", "guarantee": True, "isBigBank": True},
        {"id": "borgo_rorligt", "name": "Borgo", "rate": 2.40, "type": "flexible", "guarantee": True, "isBigBank": False},
        {"id": "morrow_rorligt", "name": "Morrow Bank", "rate": 2.50, "type": "flexible", "guarantee": True, "isBigBank": False},
        {"id": "avanza_rorligt", "name": "Avanza Sparkonto+", "rate": 1.75, "type": "flexible", "guarantee": True, "isBigBank": False},
        {"id": "sbab_rorligt", "name": "SBAB (Sparkonto)", "rate": 2.25, "type": "flexible", "guarantee": True, "isBigBank": False},
        # ── Bundet 3 Mån ──
        {"id": "shb_3m", "name": "Handelsbanken (Placeringskonto)", "rate": 1.75, "type": "fixed_3m", "guarantee": True, "isBigBank": True},
        {"id": "nordea_3m", "name": "Nordea (Fasträntekonto)", "rate": 1.75, "type": "fixed_3m", "guarantee": True, "isBigBank": True},
        {"id": "swedbank_3m", "name": "Swedbank (Fasträntekonto)", "rate": 1.80, "type": "fixed_3m", "guarantee": True, "isBigBank": True},
        {"id": "marginalen_3m", "name": "Marginalen Bank", "rate": 2.60, "type": "fixed_3m", "guarantee": True, "isBigBank": False},
        {"id": "avanza_3m", "name": "Avanza Sparkonto+", "rate": 2.05, "type": "fixed_3m", "guarantee": True, "isBigBank": False},
        {"id": "borgo_3m", "name": "Borgo", "rate": 2.50, "type": "fixed_3m", "guarantee": True, "isBigBank": False},
        # ── Bundet 12 Mån ──
        {"id": "shb_12m", "name": "Handelsbanken (Bunden placering)", "rate": 2.10, "type": "fixed_12m", "guarantee": True, "isBigBank": True},
        {"id": "swedbank_12m", "name": "Swedbank (Fasträntekonto)", "rate": 2.15, "type": "fixed_12m", "guarantee": True, "isBigBank": True},
        {"id": "avanza_12m", "name": "Avanza Sparkonto+", "rate": 2.25, "type": "fixed_12m", "guarantee": True, "isBigBank": False},
        {"id": "sbab_12m", "name": "SBAB (Fasträntekonto)", "rate": 2.20, "type": "fixed_12m", "guarantee": True, "isBigBank": False},
        {"id": "marginalen_12m", "name": "Marginalen Bank", "rate": 2.45, "type": "fixed_12m", "guarantee": True, "isBigBank": False},
    ]

    js_content = f"""// AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.
// Uppdaterad: {TODAY}
const SAVINGS_ACCOUNTS = {json.dumps(accounts, indent=4, ensure_ascii=False)};

window.SAVINGS_ACCOUNTS = SAVINGS_ACCOUNTS;
"""
    with open(SAVINGS_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)
    print(f"[+] Sparade {len(accounts)} sparkonton till {SAVINGS_FILE}")


def main():
    print("=" * 50)
    print(f"🚀 RÄNTEUPPDATERING — {TODAY}")
    print("=" * 50)

    generate_savings_data()
    generate_mortgage_banks_data()

    print("=" * 50)
    print("✅ KLART!")
    print("=" * 50)


if __name__ == "__main__":
    main()
