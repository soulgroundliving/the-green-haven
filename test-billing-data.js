// Test script to add sample billing data to localStorage
// Run this in browser console to test the Usage tab

// Add sample bills for testing
const testBills = [
    {
        month: 12, year: 66, dueDate: '2024-01-15', status: 'paid',
        charges: { electric: { usage: 145 }, water: { usage: 22 } },
        rent: 5000, electric: 490, water: 180, trash: 100, total: 5770
    },
    {
        month: 1, year: 67, dueDate: '2024-02-15', status: 'paid',
        charges: { electric: { usage: 152 }, water: { usage: 24 } },
        rent: 5000, electric: 520, water: 200, trash: 100, total: 5820
    },
    {
        month: 2, year: 67, dueDate: '2024-03-15', status: 'paid',
        charges: { electric: { usage: 148 }, water: { usage: 23 } },
        rent: 5000, electric: 510, water: 190, trash: 100, total: 5800
    },
    {
        month: 3, year: 67, dueDate: '2024-04-15', status: 'paid',
        charges: { electric: { usage: 160 }, water: { usage: 26 } },
        rent: 5000, electric: 550, water: 210, trash: 100, total: 5860
    },
    {
        month: 4, year: 67, dueDate: '2024-05-15', status: 'paid',
        charges: { electric: { usage: 155 }, water: { usage: 25 } },
        rent: 5000, electric: 540, water: 205, trash: 100, total: 5845
    },
    {
        month: 5, year: 67, dueDate: '2024-06-15', status: 'pending',
        charges: { electric: { usage: 165 }, water: { usage: 28 } },
        rent: 5000, electric: 570, water: 225, trash: 100, total: 5895
    }
];

// Store in localStorage
localStorage.setItem('bills_2567', JSON.stringify(testBills));
console.log('✓ Test data added. Bills:', testBills.length);
console.log('✓ Go to Payment page and click Usage tab to see the data');

// Also add sample meter data
const meterData = {
    eOld: 1000,
    eNew: 1148,
    wOld: 500,
    wNew: 526
};
localStorage.setItem('meter_data_latest', JSON.stringify(meterData));

// Add tenant profile
const profileData = {
    firstName: 'สมชาย',
    lastName: 'ทดสอบ',
    room: '402',
    building: 'Nature Haven',
    lease: {
        moveInDate: '2023-01-15',
        moveOutDatePlanned: '2025-12-31'
    }
};
localStorage.setItem('tenant_profile', JSON.stringify(profileData));

console.log('✓ All test data added successfully!');
console.log('✓ Refresh the page to see the updates');
