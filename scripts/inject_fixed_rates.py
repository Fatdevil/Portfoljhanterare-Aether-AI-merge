"""
Direct extraction of Compricer historical data using requests + HTML parsing.
With retry logic and delays to avoid rate limiting.
"""
import json
import re
import time
import requests
from pathlib import Path
from html import unescape

BINDINGS = {
    "1year": "fixed_1y",
    "2years": "fixed_2y", 
    "3years": "fixed_3y",
    "5years": "fixed_5y",
}

# ⚠️ IMPORTANT: These provider IDs are for FIXED rate pages (bindtime=1year/2years/etc).
# inject_compricer.py uses DIFFERENT IDs for the variable rate page — this is correct,
# NOT a bug. Compricer assigns different IDs per page type.
# Verified 2026-04 by inspecting Compricer HTML data-graph attributes.
PROVIDER_MAP = {
    "average": "SCB_Marknad",
    "p1": "Swedbank",
    "p2": "Nordea", 
    "p3": "Handelsbanken",
    "p4": "SEB",
    "p5": "SBAB",
    "p7": "Skandiabanken",
    "p8": "Länsförsäkringar",
    "p9": "Danske Bank",
    "p10": "ICA Banken",
}

DB_FILE = Path("js/mortgage_historical_data.js")

def load_db():
    content = DB_FILE.read_text(encoding="utf-8")
    match = re.search(r"=\s*(\{.*\});?", content, re.DOTALL)
    return json.loads(match.group(1))

def save_db(db):
    js = "// AUTO-GENERATED FILE — Uppdateras månadsvis av update_rates.py\n"
    js += "// Innehåller historiska snitträntor per bank från 2015 framåt.\n"
    js += "window.MORTGAGE_HISTORY = " + json.dumps(db, indent=4, ensure_ascii=False) + ";\n"
    DB_FILE.write_text(js, encoding="utf-8")

def fetch_and_parse(bind_time, retries=3):
    """Fetch Compricer page and extract data-graph JSON"""
    url = f"https://www.compricer.se/verktyg-kalkyler/historik-bolanerantor/"
    params = {
        "bindtime1": bind_time,
        "bindtime2": "-1",
        "providerid": "average,p1,p2,p3,p4,p5,p7,p8,p9,p10",
        "ratetype": "averagerate",
        "datefrom": "2015",
        "dateto": "2026",
    }
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    
    for attempt in range(retries):
        try:
            if attempt > 0:
                wait = 5 * (attempt + 1)
                print(f"  Retry {attempt + 1}/{retries} after {wait}s delay...")
                time.sleep(wait)
            
            session = requests.Session()
            resp = session.get(url, params=params, headers=headers, timeout=30)
            resp.raise_for_status()
            
            html = resp.text
            match = re.search(r'data-graph="([^"]+)"', html)
            if not match:
                match = re.search(r"data-graph='([^']+)'", html)
            
            if not match:
                print(f"  ✗ No data-graph found (attempt {attempt + 1})")
                continue
            
            raw = unescape(match.group(1))
            data = json.loads(raw)
            return data
            
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            print(f"  ✗ Connection error (attempt {attempt + 1}): {type(e).__name__}")
            continue
        except json.JSONDecodeError as e:
            print(f"  ✗ JSON parse error: {e}")
            return None
    
    return None

def process_data(data, db, our_binding):
    """Process Compricer JSON data and inject into our DB"""
    months = db["months"]
    
    if our_binding not in db["data"]:
        db["data"][our_binding] = {}
    
    target = db["data"][our_binding]
    count = 0
    
    for series in data:
        rate_type = series.get("rateType", "")
        if rate_type != "averagerate":
            continue
        
        provider_id = series.get("providerId", "")
        bank_name = PROVIDER_MAP.get(provider_id)
        if not bank_name:
            continue
        
        monthly = {}
        for point in series.get("rates", []):
            date = point["date"][:7]
            rate = point.get("rate")
            if rate is not None:
                monthly[date] = round(rate, 4)
        
        rates = [monthly.get(m, None) for m in months]
        non_null = [r for r in rates if r is not None]
        
        if non_null:
            target[bank_name] = rates
            print(f"  ✓ {bank_name}: {len(non_null)} months (avg {sum(non_null)/len(non_null):.3f}%)")
            count += 1
    
    return count

# ── MAIN ──
if __name__ == "__main__":
    db = load_db()
    print(f"Loaded DB: {len(db['months'])} months, {len(db['data'])} bindings\n")
    
    total_success = 0
    
    for comp_bind, our_bind in BINDINGS.items():
        print(f"{'='*60}")
        print(f"Fetching {our_bind} ({comp_bind})...")
        
        data = fetch_and_parse(comp_bind)
        if data:
            print(f"  Found {len(data)} data series")
            n = process_data(data, db, our_bind)
            total_success += n
            # Save after EACH successful binding (so we don't lose data on crash)
            save_db(db)
            print(f"  ✅ Saved! ({n} banks)")
        else:
            print(f"  ❌ FAILED — skipping {our_bind}")
        
        # Polite delay between requests
        print(f"  Waiting 4s before next request...")
        time.sleep(4)
    
    print(f"\n{'='*60}")
    print(f"✅ Done! Injected data for {total_success} bank-binding combinations")
    
    for binding, banks in db["data"].items():
        non_empty = {k: v for k, v in banks.items() if any(r is not None for r in v)}
        total_dp = sum(len([r for r in v if r is not None]) for v in non_empty.values())
        print(f"  {binding}: {len(non_empty)} banks, {total_dp} total data points")
