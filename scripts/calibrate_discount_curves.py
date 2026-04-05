"""
Calibrate Discount Curves — Playwright-baserad veckovis kalibrering
═══════════════════════════════════════════════════════════════════

Testar bankernas online-kalkylatorer vid olika belåningsgrader (LTV)
och beräknar avdragskurvor som appen använder för personliga räntor.

Banker som stöds:
  - SBAB (sbab.se/sa_blir_din_ranta)
  - Skandiabanken (skandia.se/bolan)
  - ICA Banken (icabanken.se/bolan)

Körs veckovis via GitHub Actions (varje måndag 06:00 CET).
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Installera Playwright om det saknas (för GitHub Actions)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("[!] Installerar playwright...")
    os.system(f"{sys.executable} -m pip install playwright")
    os.system(f"{sys.executable} -m playwright install chromium")
    from playwright.sync_api import sync_playwright


# ═══════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════

PROPERTY_VALUE = 5_000_000  # Bostadsvärde (fast)
LTV_LEVELS = [25, 30, 40, 50, 60, 70, 75, 80, 85]  # Belåningsgrader att testa

BINDING_TYPES = {
    "variable": "3 mån",
    "fixed_1y": "1 år",
    "fixed_2y": "2 år",
    "fixed_3y": "3 år",
    "fixed_5y": "5 år",
}

# Banker och deras listräntor (uppdateras av update_rates.py)
LISTRATES = {
    "SBAB":           {"variable": 3.20, "fixed_1y": 3.62, "fixed_2y": 3.84, "fixed_3y": 3.99, "fixed_5y": 4.19},
    "Skandiabanken":  {"variable": 4.08, "fixed_1y": 4.08, "fixed_2y": 4.27, "fixed_3y": 4.39, "fixed_5y": 4.58},
    "ICA Banken":     {"variable": 3.48, "fixed_1y": 4.00, "fixed_2y": 4.30, "fixed_3y": 4.50, "fixed_5y": 4.87},
}

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
OUTPUT_FILE = PROJECT_DIR / "js" / "discount_curves.js"


# ═══════════════════════════════════════════════════════════════
#  SBAB SCRAPER
# ═══════════════════════════════════════════════════════════════

def scrape_sbab(page, ltv_levels=LTV_LEVELS):
    """Scrape SBAB's rate calculator at multiple LTV levels."""
    url = "https://www.sbab.se/1/privat/lana/bolan/sa_blir_din_ranta.html"
    curves = {}
    
    for binding_key, binding_label in BINDING_TYPES.items():
        curve = {}
        for ltv in ltv_levels:
            loan = int(PROPERTY_VALUE * ltv / 100)
            down_payment = PROPERTY_VALUE - loan
            
            try:
                page.goto(url, wait_until="networkidle", timeout=20000)
                page.wait_for_timeout(2000)
                
                # Fill in property value
                prop_field = page.locator('input[name*="bostadsvarde"], input[name*="bostadens"], input[placeholder*="bostadsvärde"], input[aria-label*="bostadsvärde"]').first
                if prop_field.count() > 0:
                    prop_field.fill("")
                    prop_field.type(str(PROPERTY_VALUE))
                
                # Fill in down payment / kontantinsats
                down_field = page.locator('input[name*="kontantinsats"], input[name*="insats"], input[placeholder*="kontantinsats"], input[aria-label*="kontantinsats"]').first
                if down_field.count() > 0:
                    down_field.fill("")
                    down_field.type(str(down_payment))
                
                # Select binding period if dropdown
                binding_select = page.locator('select[name*="bindningstid"], select[aria-label*="bindningstid"]').first
                if binding_select.count() > 0:
                    # Try to match dropdown option
                    options = binding_select.locator('option').all()
                    for opt in options:
                        text = opt.text_content().lower()
                        if binding_label.lower() in text:
                            binding_select.select_option(value=opt.get_attribute('value'))
                            break
                
                page.wait_for_timeout(1500)  # Vänta på uträkning
                
                # Read the result
                rate_el = page.locator('text=/\\d+[,.]\\d+\\s*%/').first
                if rate_el.count() > 0:
                    rate_text = rate_el.text_content().strip()
                    # Parse "2,67 %" -> 2.67
                    rate = float(rate_text.replace(',', '.').replace('%', '').strip())
                    if 0.5 < rate < 10.0:
                        list_rate = LISTRATES.get("SBAB", {}).get(binding_key, 0)
                        discount = round(list_rate - rate, 4) if list_rate else 0
                        if discount > 0:
                            curve[str(ltv)] = round(discount, 2)
                            print(f"    SBAB {binding_key} LTV={ltv}%: {rate}% (avdrag {discount:.2f}%)")
                            continue
                
                print(f"    ⚠️  SBAB {binding_key} LTV={ltv}%: kunde ej läsa")
                
            except Exception as e:
                print(f"    ❌ SBAB {binding_key} LTV={ltv}%: {e}")
        
        if curve:
            curves[binding_key] = curve
    
    return curves


def scrape_skandia(page, ltv_levels=LTV_LEVELS):
    """Scrape Skandia's rate calculator at multiple LTV levels."""
    url = "https://www.skandia.se/bolan/"
    curves = {}
    
    for binding_key, binding_label in BINDING_TYPES.items():
        curve = {}
        for ltv in ltv_levels:
            loan = int(PROPERTY_VALUE * ltv / 100)
            
            try:
                page.goto(url, wait_until="networkidle", timeout=20000)
                page.wait_for_timeout(2000)
                
                # Look for calculator fields
                price_field = page.locator('input[name*="kopesumma"], input[name*="pris"], input[placeholder*="köpesumma"],input[aria-label*="köpesumma"]').first
                if price_field.count() > 0:
                    price_field.fill("")
                    price_field.type(str(PROPERTY_VALUE))
                
                loan_field = page.locator('input[name*="lan"], input[name*="belopp"], input[placeholder*="låne"], input[aria-label*="låne"]').first
                if loan_field.count() > 0:
                    loan_field.fill("")
                    loan_field.type(str(loan))
                
                page.wait_for_timeout(1500)
                
                rate_el = page.locator('text=/\\d+[,.]\\d+\\s*%/').first
                if rate_el.count() > 0:
                    rate_text = rate_el.text_content().strip()
                    rate = float(rate_text.replace(',', '.').replace('%', '').strip())
                    if 0.5 < rate < 10.0:
                        list_rate = LISTRATES.get("Skandiabanken", {}).get(binding_key, 0)
                        discount = round(list_rate - rate, 4) if list_rate else 0
                        if discount > 0:
                            curve[str(ltv)] = round(discount, 2)
                            print(f"    Skandia {binding_key} LTV={ltv}%: {rate}% (avdrag {discount:.2f}%)")
                            continue
                
                print(f"    ⚠️  Skandia {binding_key} LTV={ltv}%: kunde ej läsa")
                
            except Exception as e:
                print(f"    ❌ Skandia {binding_key} LTV={ltv}%: {e}")
        
        if curve:
            curves[binding_key] = curve
    
    return curves


def scrape_ica(page, ltv_levels=LTV_LEVELS):
    """Scrape ICA Banken's rate calculator at multiple LTV levels."""
    url = "https://www.icabanken.se/bolan/"
    curves = {}
    
    for binding_key, binding_label in BINDING_TYPES.items():
        curve = {}
        for ltv in ltv_levels:
            loan = int(PROPERTY_VALUE * ltv / 100)
            
            try:
                page.goto(url, wait_until="networkidle", timeout=20000)
                page.wait_for_timeout(2000)
                
                # Look for calculator fields
                price_field = page.locator('input[name*="pris"], input[name*="varde"], input[placeholder*="bostadens"], input[aria-label*="bostadens"]').first
                if price_field.count() > 0:
                    price_field.fill("")
                    price_field.type(str(PROPERTY_VALUE))
                
                loan_field = page.locator('input[name*="lan"], input[name*="belopp"], input[placeholder*="låne"], input[aria-label*="låne"]').first
                if loan_field.count() > 0:
                    loan_field.fill("")
                    loan_field.type(str(loan))
                
                page.wait_for_timeout(1500)
                
                rate_el = page.locator('text=/\\d+[,.]\\d+\\s*%/').first
                if rate_el.count() > 0:
                    rate_text = rate_el.text_content().strip()
                    rate = float(rate_text.replace(',', '.').replace('%', '').strip())
                    if 0.5 < rate < 10.0:
                        list_rate = LISTRATES.get("ICA Banken", {}).get(binding_key, 0)
                        discount = round(list_rate - rate, 4) if list_rate else 0
                        if discount > 0:
                            curve[str(ltv)] = round(discount, 2)
                            print(f"    ICA {binding_key} LTV={ltv}%: {rate}% (avdrag {discount:.2f}%)")
                            continue
                
                print(f"    ⚠️  ICA {binding_key} LTV={ltv}%: kunde ej läsa")
                
            except Exception as e:
                print(f"    ❌ ICA {binding_key} LTV={ltv}%: {e}")
        
        if curve:
            curves[binding_key] = curve
    
    return curves


# ═══════════════════════════════════════════════════════════════
#  FALLBACK CURVES
# ═══════════════════════════════════════════════════════════════

FALLBACK_CURVES = {
    "SBAB": {
        "variable":  { "25": 0.72, "30": 0.68, "40": 0.60, "50": 0.53, "60": 0.44, "70": 0.35, "75": 0.28, "80": 0.20, "85": 0.12 },
        "fixed_1y":  { "25": 0.78, "30": 0.73, "40": 0.65, "50": 0.57, "60": 0.48, "70": 0.38, "75": 0.30, "80": 0.22, "85": 0.13 },
        "fixed_2y":  { "25": 0.80, "30": 0.75, "40": 0.67, "50": 0.59, "60": 0.49, "70": 0.39, "75": 0.31, "80": 0.23, "85": 0.14 },
        "fixed_3y":  { "25": 0.82, "30": 0.77, "40": 0.69, "50": 0.60, "60": 0.50, "70": 0.40, "75": 0.32, "80": 0.24, "85": 0.14 },
        "fixed_5y":  { "25": 0.84, "30": 0.79, "40": 0.71, "50": 0.62, "60": 0.52, "70": 0.42, "75": 0.34, "80": 0.25, "85": 0.15 },
    },
    "Skandiabanken": {
        "variable":  { "25": 1.55, "30": 1.48, "40": 1.35, "50": 1.20, "60": 1.00, "70": 0.80, "75": 0.68, "80": 0.50, "85": 0.30 },
        "fixed_1y":  { "25": 1.55, "30": 1.48, "40": 1.35, "50": 1.20, "60": 1.00, "70": 0.80, "75": 0.68, "80": 0.50, "85": 0.30 },
        "fixed_2y":  { "25": 1.60, "30": 1.53, "40": 1.39, "50": 1.24, "60": 1.04, "70": 0.83, "75": 0.70, "80": 0.52, "85": 0.32 },
        "fixed_3y":  { "25": 1.65, "30": 1.58, "40": 1.43, "50": 1.27, "60": 1.07, "70": 0.85, "75": 0.72, "80": 0.54, "85": 0.33 },
        "fixed_5y":  { "25": 1.70, "30": 1.63, "40": 1.48, "50": 1.32, "60": 1.10, "70": 0.88, "75": 0.75, "80": 0.56, "85": 0.35 },
    },
    "ICA Banken": {
        "variable":  { "25": 0.95, "30": 0.90, "40": 0.80, "50": 0.68, "60": 0.56, "70": 0.42, "75": 0.34, "80": 0.24, "85": 0.14 },
        "fixed_1y":  { "25": 1.20, "30": 1.14, "40": 1.02, "50": 0.88, "60": 0.74, "70": 0.56, "75": 0.46, "80": 0.34, "85": 0.20 },
        "fixed_2y":  { "25": 1.35, "30": 1.28, "40": 1.15, "50": 1.00, "60": 0.84, "70": 0.64, "75": 0.52, "80": 0.39, "85": 0.23 },
        "fixed_3y":  { "25": 1.45, "30": 1.38, "40": 1.24, "50": 1.08, "60": 0.90, "70": 0.70, "75": 0.57, "80": 0.42, "85": 0.25 },
        "fixed_5y":  { "25": 1.65, "30": 1.57, "40": 1.42, "50": 1.24, "60": 1.04, "70": 0.80, "75": 0.66, "80": 0.49, "85": 0.29 },
    },
}


# ═══════════════════════════════════════════════════════════════
#  OUTPUT GENERATOR
# ═══════════════════════════════════════════════════════════════

def generate_discount_curves_js(curves, method="playwright_auto"):
    """Generate the JS file from calibrated curves."""
    today = datetime.now().strftime("%Y-%m-%d")
    
    lines = [
        f'// AUTO-GENERATED FILE — Uppdateras veckovis av calibrate_discount_curves.py',
        f'// Senast kalibrerad: {today}',
        f'//',
        f'// Avdragskurvor per bank, bindningstid och belåningsgrad (LTV).',
        f'// Avdrag = Listränta − Personlig ränta',
        f'// Personlig ränta = Listränta − interpolate(discount_curve, LTV)',
        f'',
        f'const DISCOUNT_CURVES = {json.dumps(curves, indent=4, ensure_ascii=False)};',
        f'',
        f'// Metadata',
        f'const DISCOUNT_CURVES_META = {{',
        f'    lastCalibrated: "{today}",',
        f'    method: "{method}",',
        f'    ltvLevels: {json.dumps(sorted(set(int(k) for c in curves.values() for bt in c.values() for k in bt.keys())))},',
        f'    banks: {json.dumps(list(curves.keys()))},',
        f'    note: "Avdrag i procentenheter. Personlig ränta = listränta − avdrag. Interpolera för mellanliggande LTV."',
        f'}};',
        f'',
        f'window.DISCOUNT_CURVES = DISCOUNT_CURVES;',
        f'window.DISCOUNT_CURVES_META = DISCOUNT_CURVES_META;',
        f'',
    ]
    
    OUTPUT_FILE.write_text('\n'.join(lines), encoding='utf-8')
    print(f"[+] Sparade avdragskurvor till {OUTPUT_FILE}")


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    print("=" * 50)
    print("🎯 KALIBRERING AV AVDRAGSKURVOR")
    print(f"   Datum: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"   LTV-nivåer: {LTV_LEVELS}")
    print("=" * 50)
    
    final_curves = {}
    method = "playwright_auto"
    
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 900},
                locale="sv-SE"
            )
            page = context.new_page()
            
            # ── SBAB ──
            print("\n[*] Kalibrerar SBAB...")
            sbab_curves = scrape_sbab(page)
            if sbab_curves and len(sbab_curves) >= 3:
                final_curves["SBAB"] = sbab_curves
                print(f"    ✅ SBAB: {len(sbab_curves)} bindningstider kalibrerade")
            else:
                print(f"    ⚠️  SBAB: Otillräcklig data ({len(sbab_curves)} typer) — använder fallback")
                final_curves["SBAB"] = FALLBACK_CURVES["SBAB"]
            
            # ── Skandia ──
            print("\n[*] Kalibrerar Skandiabanken...")
            skandia_curves = scrape_skandia(page)
            if skandia_curves and len(skandia_curves) >= 3:
                final_curves["Skandiabanken"] = skandia_curves
                print(f"    ✅ Skandia: {len(skandia_curves)} bindningstider kalibrerade")
            else:
                print(f"    ⚠️  Skandia: Otillräcklig data — använder fallback")
                final_curves["Skandiabanken"] = FALLBACK_CURVES["Skandiabanken"]
            
            # ── ICA Banken ──
            print("\n[*] Kalibrerar ICA Banken...")
            ica_curves = scrape_ica(page)
            if ica_curves and len(ica_curves) >= 3:
                final_curves["ICA Banken"] = ica_curves
                print(f"    ✅ ICA: {len(ica_curves)} bindningstider kalibrerade")
            else:
                print(f"    ⚠️  ICA: Otillräcklig data — använder fallback")
                final_curves["ICA Banken"] = FALLBACK_CURVES["ICA Banken"]
            
            browser.close()
            
    except Exception as e:
        print(f"\n❌ Playwright-fel: {e}")
        print("[*] Använder fallback-kurvor för alla banker")
        final_curves = FALLBACK_CURVES.copy()
        method = "fallback"
    
    # Generate output
    generate_discount_curves_js(final_curves, method)
    
    print("\n" + "=" * 50)
    print("✅ KALIBRERING KLAR!")
    print(f"   Banker: {', '.join(final_curves.keys())}")
    print(f"   Metod: {method}")
    print("=" * 50)


if __name__ == "__main__":
    main()
