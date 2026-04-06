import json
from pathlib import Path
import re

# ⚠️ IMPORTANT: Compricer uses DIFFERENT provider IDs depending on the page/bindtime!
# These IDs are for the VARIABLE rate page (bindtime=3months).
# inject_fixed_rates.py has DIFFERENT IDs for fixed rate pages — this is correct behavior,
# NOT a bug. Verified 2026-04 by inspecting Compricer HTML data-graph attributes.
PROVIDER_MAP = {
    'p7': 'SBAB',
    'p3': 'Handelsbanken',
    'p5': 'Swedbank',
    'p10': 'SEB',
    'p9': 'Danske Bank'
}

with open('compricer_averages.json', 'r', encoding='utf-8') as f:
    comp = json.load(f)

hist_file = Path('js/mortgage_historical_data.js')
content = hist_file.read_text(encoding='utf-8')

match = re.search(r'=\s*(\{.*\});?', content, re.DOTALL)
db = json.loads(match.group(1))
months = db['months']

if 'variable' in db['data']:
    for serie in comp:
        if serie.get('rateType') == 'averagerate' and serie.get('bindTime') == '3months' and serie.get('providerId') in PROVIDER_MAP:
            bank_name = PROVIDER_MAP[serie['providerId']]
            rates = serie.get('rates', [])
            month_dict = {}
            for r in rates:
                date = r.get('date')
                if date and r.get('rate') is not None:
                    m = date[:7]
                    month_dict[m] = r['rate']
            
            arr = []
            # We want to fill forward if a month is missing but we have previous data
            last_val = None
            for m in months:
                val = month_dict.get(m, None)
                if val is not None:
                    last_val = val
                arr.append(last_val if last_val is not None else None)
            
            db['data']['variable'][bank_name] = arr

js_content = f'// AUTO-GENERATED FILE — Uppdateras månadsvis av update_rates.py\n// Innehåller historiska snitträntor per bank från 2015 framåt.\nwindow.MORTGAGE_HISTORY = {json.dumps(db, indent=4)};'
hist_file.write_text(js_content, encoding='utf-8')
print('DONE!')
