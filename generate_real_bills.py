#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate Real Bills from meter_data_export.json
Converts Excel meter data (621 records) into 36 months of bills
"""

import json
import sys
import os
from pathlib import Path
from datetime import datetime

# Force UTF-8 output
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Room rates
ROOM_RATES = {
    'rooms': {
        '13': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '14': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '15': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '15ก': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '16': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '17': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '18': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '19': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '20': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '21': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '22': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '23': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '24': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '25': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '26': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '27': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '28': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '29': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '30': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '31': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '32': {'rent': 1200, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        '33': {'rent': 1500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'AMAZON': {'rent': 15000, 'water': 20, 'electric': 6, 'common': 0, 'trash': 0}
    },
    'nest': {
        'N101': {'rent': 4500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N102': {'rent': 4500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N103': {'rent': 4500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N104': {'rent': 4500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N105': {'rent': 5000, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N201': {'rent': 4500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N202': {'rent': 4500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N203': {'rent': 4500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N204': {'rent': 4500, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N205': {'rent': 5000, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N301': {'rent': 5000, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N302': {'rent': 5900, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N303': {'rent': 5000, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N304': {'rent': 5900, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N305': {'rent': 5900, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N401': {'rent': 5600, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N402': {'rent': 5900, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N403': {'rent': 5900, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N404': {'rent': 5900, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40},
        'N405': {'rent': 5600, 'water': 20, 'electric': 8, 'common': 0, 'trash': 40}
    }
}

# Load meter data
meter_data_path = Path('meter_data_export.json')
with open(meter_data_path, encoding='utf-8') as f:
    meter_data_raw = json.load(f)

meter_data = meter_data_raw['data']
print(f"📊 Loaded {len(meter_data)} meter records")

# Group meter data by building, year, month
grouped_data = {}
for record in meter_data:
    key = f"{record['building']}_{record['year']}_{record['month']}"
    if key not in grouped_data:
        grouped_data[key] = {}
    grouped_data[key][record['roomId']] = record

print(f"📦 Grouped into {len(grouped_data)} month groups")

# Generate bills
bills = []
bill_count = 0

for key, room_data in grouped_data.items():
    building, year, month = key.split('_')
    year, month = int(year), int(month)

    for room_id, meter in room_data.items():
        rates = ROOM_RATES.get(building, {}).get(room_id)
        if not rates:
            print(f"⚠️  No rates found for {building}/{room_id}")
            continue

        # Calculate usage
        water_usage = max(0, meter['wNew'] - meter['wOld'])
        electric_usage = max(0, meter['eNew'] - meter['eOld'])

        # Calculate costs
        water_cost = water_usage * rates['water']
        electric_cost = electric_usage * rates['electric']
        common_cost = rates['common']
        trash_cost = rates['trash']
        rent_cost = rates['rent']

        total_charge = rent_cost + water_cost + electric_cost + common_cost + trash_cost

        # Create bill
        bill = {
            'billId': f"BILL-{year}-{str(month).zfill(2)}-{building}-{room_id}",
            'building': building,
            'roomId': room_id,
            'month': month,
            'year': year,
            'charges': {
                'rent': rent_cost,
                'water': {
                    'usage': water_usage,
                    'rate': rates['water'],
                    'cost': water_cost
                },
                'electric': {
                    'usage': electric_usage,
                    'rate': rates['electric'],
                    'cost': electric_cost
                },
                'common': common_cost,
                'trash': trash_cost
            },
            'totalCharge': total_charge,
            'status': 'pending',
            'meterReadings': {
                'water': {
                    'previous': meter['wOld'],
                    'current': meter['wNew'],
                    'usage': water_usage
                },
                'electric': {
                    'previous': meter['eOld'],
                    'current': meter['eNew'],
                    'usage': electric_usage
                }
            },
            'billDate': f"{year:04d}-{month:02d}-01T00:00:00Z",
            'notes': ''
        }

        bills.append(bill)
        bill_count += 1

print(f"✅ Generated {bill_count} bills")

# Group by year
bills_by_year = {}
for bill in bills:
    year = bill['year']
    if year not in bills_by_year:
        bills_by_year[year] = []
    bills_by_year[year].append(bill)

# Save output
output = {
    'timestamp': datetime.now().isoformat(),
    'totalBills': len(bills),
    'billsByYear': {year: len(bills_by_year.get(year, [])) for year in [67, 68, 69]},
    'bills': bills
}

output_path = Path('real-bills-generated.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"\n📁 Saved to: real-bills-generated.json")
print(f"\n📊 Summary:")
print(f"   Year 67: {len(bills_by_year.get(67, []))} bills")
print(f"   Year 68: {len(bills_by_year.get(68, []))} bills")
print(f"   Year 69: {len(bills_by_year.get(69, []))} bills")
print(f"   Total: {bill_count} bills")

# Sample
sample = next((b for b in bills if b['roomId'] == '13' and b['month'] == 6 and b['year'] == 69), None)
if sample:
    print(f"\n📋 Sample Bill (Room 13, June 2569):")
    print(json.dumps(sample, indent=2, ensure_ascii=False))
