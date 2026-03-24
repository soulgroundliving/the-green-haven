#!/usr/bin/env python3
import json

# Load the generated bills
with open('real-bills-generated.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Group by year for localStorage format
bills_by_year = {}
for bill in data['bills']:
    year = bill['year']
    full_year = year + 2500 if year < 100 else year
    key = f'bills_{full_year}'
    
    if key not in bills_by_year:
        bills_by_year[key] = []
    bills_by_year[key].append(bill)

# Verify structure
for year, bills in bills_by_year.items():
    print(f"✅ {year}: {len(bills)} bills")

# Sample bill verification
print("\n📋 Sample Bill (Room 13, January 2567):")
sample = next((b for b in data['bills'] if b['roomId'] == '13' and b['month'] == 1 and b['year'] == 67), None)
if sample:
    print(json.dumps(sample, indent=2, ensure_ascii=False))
    print(f"\n✓ Water: {sample['meterReadings']['water']['usage']} units × {sample['charges']['water']['rate']} = {sample['charges']['water']['cost']} บาท")
    print(f"✓ Electric: {sample['meterReadings']['electric']['usage']} units × {sample['charges']['electric']['rate']} = {sample['charges']['electric']['cost']} บาท")
    print(f"✓ Rent: {sample['charges']['rent']} บาท")
    print(f"✓ Trash: {sample['charges']['trash']} บาท")
    total = sample['charges']['rent'] + sample['charges']['water']['cost'] + sample['charges']['electric']['cost'] + sample['charges']['common'] + sample['charges']['trash']
    print(f"✓ TOTAL: {total} บาท")
