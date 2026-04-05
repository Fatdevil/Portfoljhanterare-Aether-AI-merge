import json, re

with open('js/mortgage_historical_data.js', encoding='utf-8') as f:
    content = f.read()
match = re.search(r'=\s*(\{.*\});?', content, re.DOTALL)
db = json.loads(match.group(1))

months = db['months']
print(f"Months count: {len(months)}")
print(f"First month: {months[0]}")
print(f"Last month: {months[-1]}")

for binding, banks in db['data'].items():
    print(f"\nBinding: {binding}")
    for bank, rates in banks.items():
        non_null = [r for r in rates if r is not None]
        first_idx = next((i for i, r in enumerate(rates) if r is not None), -1)
        last_idx = next((i for i in range(len(rates)-1, -1, -1) if rates[i] is not None), -1)
        if non_null:
            avg = sum(non_null) / len(non_null)
            first_m = months[first_idx]
            last_m = months[last_idx]
            current = non_null[-1]
            print(f"  {bank}: {len(non_null)} months, {first_m} to {last_m}, avg={avg:.3f}%, current={current}%")
        else:
            print(f"  {bank}: NO DATA")
