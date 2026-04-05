const XLSX = require('xlsx');
const fs = require('fs');

try {
  const file = fs.readFileSync('./bill69-temp.xlsx');
  const wb = XLSX.read(file, { type: 'buffer' });

  console.log('📊 File sheets:', wb.SheetNames.join(' | '));

  // Get 2nd sheet (January)
  const jan = wb.Sheets[wb.SheetNames[1]];
  console.log(`\n📋 ${wb.SheetNames[1]} (January):\n`);

  const cells = ['D24', 'J24', 'P24', 'D26', 'J26', 'P26', 'S29', 'S24', 'S26'];
  cells.forEach(c => {
    const v = jan[c]?.v;
    const status = (v !== undefined && v !== null && v !== '' && v !== 0) ? '✅' : v === 0 ? '⚠️ ZERO' : '❌ EMPTY';
    console.log(`${status} ${c}: ${v ?? 'undefined'}`);
  });

} catch (err) {
  console.error('Error:', err.message);
}
