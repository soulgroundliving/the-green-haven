/**
 * Billing Data Importer
 * Import historical billing data from Excel files (ปี 67-69)
 * นำเข้าข้อมูลบิลจากไฟล์ Excel ปี 67-69
 */

class BillingDataImporter {
  /**
   * Import bills data from parsed Excel
   * @param {array} billsData - Array of bill objects from Excel
   * @param {number} year - Year (2567, 2568, 2569)
   */
  static importBills(billsData, year) {
    if (!Array.isArray(billsData) || billsData.length === 0) {
      console.warn('⚠️ No bills data to import');
      return [];
    }

    const bills = billsData
      .filter((bill) => bill && bill.roomId && bill.month && bill.totalCharge)
      .map((bill) => ({
        billId: `BILL-${year}-${String(bill.month).padStart(2, '0')}-${bill.building || 'rooms'}-${bill.roomId}`,
        building: bill.building || 'rooms',
        roomId: bill.roomId,
        month: bill.month,
        year: year,
        charges: {
          rent: parseFloat(bill.rent) || 0,
          water: {
            usage: parseFloat(bill.waterUsage) || 0,
            rate: parseFloat(bill.waterRate) || 20,
            cost: parseFloat(bill.waterCost) || 0
          },
          electric: {
            usage: parseFloat(bill.electricUsage) || 0,
            rate: parseFloat(bill.electricRate) || 8,
            cost: parseFloat(bill.electricCost) || 0
          },
          common: parseFloat(bill.common) || 0,
          trash: parseFloat(bill.trash) || 40
        },
        totalCharge: parseFloat(bill.totalCharge) || 0,
        status: bill.status || 'pending',
        meterReadings: {
          water: {
            previous: parseFloat(bill.waterPrevious) || 0,
            current: parseFloat(bill.waterCurrent) || 0,
            usage: parseFloat(bill.waterUsage) || 0
          },
          electric: {
            previous: parseFloat(bill.electricPrevious) || 0,
            current: parseFloat(bill.electricCurrent) || 0,
            usage: parseFloat(bill.electricUsage) || 0
          }
        },
        billDate: bill.billDate || new Date().toISOString(),
        notes: bill.notes || ''
      }));

    BillingCalculator.saveBillsToLocalStorage(bills, year);
    console.log(`✅ Imported ${bills.length} bills for year ${year}`);

    return bills;
  }

  /**
   * Import meter data from parsed Excel
   * @param {object} meterData - Meter readings keyed by monthKey
   * @param {number} year - Year
   */
  static importMeterData(meterData, year) {
    if (!meterData || Object.keys(meterData).length === 0) {
      console.warn('⚠️ No meter data to import');
      return 0;
    }

    const dataKey = `meter_data_${year}`;
    const existingData = JSON.parse(localStorage.getItem(dataKey) || '{}');

    // Merge with existing data
    Object.keys(meterData).forEach((monthKey) => {
      if (!existingData[monthKey]) {
        existingData[monthKey] = {};
      }

      Object.keys(meterData[monthKey]).forEach((roomId) => {
        existingData[monthKey][roomId] = {
          ...meterData[monthKey][roomId],
          recordedDate: new Date().toISOString()
        };
      });
    });

    localStorage.setItem(dataKey, JSON.stringify(existingData));

    const totalReadings = Object.values(meterData).reduce(
      (sum, month) => sum + Object.keys(month).length,
      0
    );

    console.log(`✅ Imported ${totalReadings} meter readings for year ${year}`);
    return totalReadings;
  }

  /**
   * Parse Excel row data to bill object
   * @param {array} row - Excel row
   * @param {number} month - Month number
   * @param {number} year - Year
   * @returns {object} - Bill object
   */
  static parseExcelRow(row, month, year) {
    // Flexible parsing - handles different column orders
    const bill = {
      roomId: row[0],
      month: month,
      year: year,
      rent: this.parseNumber(row[3]),
      waterUsage: this.parseNumber(row[5]),
      waterCost: this.parseNumber(row[6]),
      electricUsage: this.parseNumber(row[7]),
      electricCost: this.parseNumber(row[8]),
      trash: this.parseNumber(row[9]),
      common: this.parseNumber(row[10]),
      totalCharge: this.parseNumber(row[11])
    };

    return bill;
  }

  /**
   * Parse number from various formats
   * @param {any} value - Value to parse
   * @returns {number} - Parsed number or 0
   */
  static parseNumber(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/,/g, ''));
      return isNaN(num) ? 0 : num;
    }
    return 0;
  }

  /**
   * Generate sample import for testing
   */
  static generateSampleImport() {
    const sample = {
      year67Bills: [
        {
          roomId: '13',
          month: 1,
          rent: 1500,
          waterUsage: 15,
          waterCost: 300,
          electricUsage: 35,
          electricCost: 280,
          trash: 40,
          common: 0,
          totalCharge: 2120
        },
        {
          roomId: '14',
          month: 1,
          rent: 1200,
          waterUsage: 12,
          waterCost: 240,
          electricUsage: 28,
          electricCost: 224,
          trash: 40,
          common: 0,
          totalCharge: 1704
        }
      ],
      year67Meters: {
        '2567-01': {
          '13': {
            currentWater: 100,
            waterStart: 85,
            currentElectric: 250,
            electricStart: 215
          },
          '14': {
            currentWater: 200,
            waterStart: 188,
            currentElectric: 400,
            electricStart: 372
          }
        }
      }
    };

    return sample;
  }
}

// Export
window.BillingDataImporter = BillingDataImporter;

console.log('✅ BillingDataImporter loaded');
