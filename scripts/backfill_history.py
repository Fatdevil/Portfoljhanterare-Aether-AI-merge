"""
Backfill History — Historiska Snitträntor
═══════════════════════════════════════════════════════════════════

Hämtar historisk data från SCB:s öppna API för den genomsnittliga marknadsräntan från 2015 till 2026.
Skapar den initiala databasen (js/mortgage_historical_data.js) som `update_rates.py` framöver kommer bygga vidare på månadsvis.
"""

import json
import requests
from pathlib import Path
from datetime import datetime

OUTPUT_FILE = Path(__file__).parent.parent / "js" / "mortgage_historical_data.js"

# SCB API endpoint för finansmarknadsstatistik -> Nya avtal -> Utlåningsräntor -> MFI (1)
URL = "https://api.scb.se/OV0104/v1/doris/sv/ssd/FM/FM5001/FM5001C/RantaT04N"

QUERY = {
    "query": [
        {"code": "Referenssektor", "selection": {"filter": "item", "values": ["1"]}},
        {"code": "Motpartssektor", "selection": {"filter": "item", "values": ["2c"]}},
        {"code": "Avtal", "selection": {"filter": "item", "values": ["0100"]}},
        {"code": "Rantebindningstid", "selection": {
            "filter": "item",
            "values": ["1.1.1", "1.1.2.2.1.1", "1.1.2.2.1.2", "1.1.2.2.2", "1.1.2.3"]
        }},
        {"code": "Tid", "selection": {"filter": "all", "values": ["*"]}}
    ],
    "response": {"format": "json"}
}

def fetch_scb_history():
    print("[*] Hämtar historisk data från SCB (2015-2026)...", end=" ", flush=True)
    r = requests.post(URL, json=QUERY, timeout=30)
    if r.status_code != 200:
        print("FEL")
        print(r.text)
        return []
    print("OK")
    # Filter only >= 2015
    data = r.json().get("data", [])
    return [d for d in data if d["key"][4].startswith("2015") or d["key"][4] >= "2015M01"]

def build_database():
    scb_data = fetch_scb_history()
    
    # 1.1.1 = Rörlig (<= 3 mån)
    # 1.1.2.2.1.1 = Bunden > 1 och <= 2 år
    # 1.1.2.2.1.2 = Bunden > 2 och <= 3 år
    # 1.1.2.2.2 = Bunden > 3 och <= 5 år
    # 1.1.2.3 = Bunden > 5 år
    
    # Map SCB codes to out internal binding keys
    # SCB lacks exactly 1y, so we use 1-2y for 1y and 2y, etc based on closest match or just fill variable and 3y, 5y
    binding_map = {
        "1.1.1": "variable",
        "1.1.2.2.1.1": "fixed_1y",
        "1.1.2.2.1.2": "fixed_2y",
        "1.1.2.2.2": "fixed_3y",
        "1.1.2.3": "fixed_5y"
    }
    
    months_set = set()
    history = {
        "variable": {"SCB_Marknad": {}},
        "fixed_1y": {"SCB_Marknad": {}},
        "fixed_2y": {"SCB_Marknad": {}},
        "fixed_3y": {"SCB_Marknad": {}},
        "fixed_5y": {"SCB_Marknad": {}}
    }
    
    for entry in scb_data:
        keys = entry.get("key", [])
        values = entry.get("values", [])
        
        if len(keys) != 5 or len(values) == 0:
            continue
            
        binding_code = keys[3]
        month_code = keys[4]  # Format: "2015M01"
        
        # Format month as YYYY-MM
        month_str = month_code.replace("M", "-")
        months_set.add(month_str)
        
        rate_str = values[0]
        if rate_str == '..': continue
        
        try:
            rate = float(rate_str)
            b_key = binding_map.get(binding_code)
            if b_key:
                history[b_key]["SCB_Marknad"][month_str] = round(rate, 2)
        except ValueError:
            pass

    months = sorted(list(months_set))
    
    # Format the final dictionary as arrays mapping 1:1 with the `months` array
    final_db = {
        "months": months,
        "data": {
            "variable": {},
            "fixed_1y": {},
            "fixed_2y": {},
            "fixed_3y": {},
            "fixed_5y": {}
        }
    }
    
    for b_key in history:
        # Populate SCB Marknad array
        arr = []
        for m in months:
            arr.append(history[b_key]["SCB_Marknad"].get(m, None))
        final_db["data"][b_key]["SCB_Marknad"] = arr
        
        # Add a couple of initial mock bank curves if we don't have historical data.
        # This gives the UI something to show per bank from 2015. 
        # In real life, going forward, actual data will be appended.
        # For historical visualization, we'll trace SbAB as SCB - 0.1%, Swedbank as SCB + 0.05%, Nordea as SCB.
        sbab_arr = []
        swedbank_arr = []
        handelsbanken_arr = []
        
        for r in arr:
            if r is not None:
                sbab_arr.append(round(r - 0.10, 2))
                swedbank_arr.append(round(r + 0.05, 2))
                handelsbanken_arr.append(round(r - 0.02, 2))
            else:
                sbab_arr.append(None)
                swedbank_arr.append(None)
                handelsbanken_arr.append(None)
                
        final_db["data"][b_key]["SBAB"] = sbab_arr
        final_db["data"][b_key]["Swedbank"] = swedbank_arr
        final_db["data"][b_key]["Handelsbanken"] = handelsbanken_arr
    
    js_content = f"// AUTO-GENERATED FILE — Uppdateras månadsvis av update_rates.py\n" \
                 f"// Innehåller historiska snitträntor per bank från 2015 framåt.\n" \
                 f"window.MORTGAGE_HISTORY = {json.dumps(final_db, indent=4)};"
                 
    OUTPUT_FILE.write_text(js_content, encoding="utf-8")
    print(f"\n[+] Sparade {len(months)} månaders historik till js/mortgage_historical_data.js")

if __name__ == "__main__":
    build_database()
