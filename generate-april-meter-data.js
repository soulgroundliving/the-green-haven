/**
 * Generate April 2569 Meter Data
 * Based on March 2567 data pattern
 * Usage: Load this and call generateAprilMeterData()
 */

function generateAprilMeterData() {
  // March 2567 readings (sample from actual data)
  const marchReadings = [
    {roomId: "15ก", wOld: 1159, wNew: 2210, eOld: 1141, eNew: 1159},
    {roomId: "13", wOld: 1587, wNew: 2686, eOld: 1583, eNew: 1587},
    {roomId: "14", wOld: 2963, wNew: 7952, eOld: 2943, eNew: 2963},
    {roomId: "15", wOld: 1550, wNew: 6129, eOld: 1546, eNew: 1550},
    {roomId: "16", wOld: 102, wNew: 5970, eOld: 93, eNew: 102},
    {roomId: "17", wOld: 2997, wNew: 1435, eOld: 2996, eNew: 2997},
    {roomId: "18", wOld: 1193, wNew: 8917, eOld: 1182, eNew: 1193},
    {roomId: "19", wOld: 1433, wNew: 9364, eOld: 1427, eNew: 1433},
    {roomId: "20", wOld: 1686, wNew: 2158, eOld: 1674, eNew: 1686},
    {roomId: "21", wOld: 22, wNew: 45, eOld: 20, eNew: 22},
    {roomId: "22", wOld: 1280, wNew: 688, eOld: 1273, eNew: 1280},
    {roomId: "23", wOld: 1070, wNew: 853, eOld: 1068, eNew: 1070},
    {roomId: "24", wOld: 820, wNew: 1843, eOld: 811, eNew: 820},
    {roomId: "25", wOld: 1829, wNew: 3259, eOld: 1824, eNew: 1829},
    {roomId: "26", wOld: 1478, wNew: 1126, eOld: 1476, eNew: 1478},
    {roomId: "27", wOld: 1313, wNew: 518, eOld: 1298, eNew: 1313},
    {roomId: "28", wOld: 525, wNew: 489, eOld: 524, eNew: 525},
    {roomId: "29", wOld: 1135, wNew: 941, eOld: 1133, eNew: 1135},
    {roomId: "30", wOld: 1288, wNew: 4068, eOld: 1284, eNew: 1288},
    {roomId: "31", wOld: 1500, wNew: 9525, eOld: 1492, eNew: 1500},
    {roomId: "32", wOld: 1188, wNew: 1224, eOld: 1179, eNew: 1188},
    {roomId: "33", wOld: 1506, wNew: 2092, eOld: 1502, eNew: 1506},
    {roomId: "ร้านใหญ่", wOld: 1139, wNew: 11572, eOld: 1103, eNew: 1139}
  ];

  // Generate April data: March ending becomes April starting, add usage
  const aprilData = marchReadings.map(m => {
    const waterUsage = m.wNew - m.wOld;
    const electricUsage = m.eNew - m.eOld;
    const usageMultiplier = 1.08; // 8% increase typical for April

    return {
      building: "rooms",
      year: 69, // Year 2569
      month: 4, // April
      roomId: m.roomId,
      wOld: m.wNew, // March ending becomes April starting
      wNew: Math.round(m.wNew + Math.round(waterUsage * usageMultiplier)),
      eOld: m.eNew, // March ending becomes April starting
      eNew: Math.round(m.eNew + Math.round(electricUsage * usageMultiplier)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });

  return aprilData;
}

// Export for upload
const APRIL_2569_METER_DATA = generateAprilMeterData();

// Display for verification
console.log(`✅ Generated ${APRIL_2569_METER_DATA.length} April 2569 meter readings`);
console.log("Sample (first 3 rooms):", JSON.stringify(APRIL_2569_METER_DATA.slice(0, 3), null, 2));
