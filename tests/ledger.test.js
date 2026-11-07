const assert = require('assert');
const { computeLedger, findWarnings } = require('../src/main/ledger');

// Mua 100kg x 100k, mua 100kg x 120k => bình quân 110k. Bán 50kg x 150k.
const purchases = [
  { id: 'TM01', date: '2026-01-01', item: 'Tiêu đen', qty: 100, price: 100000, name: 'A', pay: 'CK', cccd: '' },
  { id: 'TM02', date: '2026-01-02', item: 'Tiêu đen', qty: 100, price: 120000, name: 'B', pay: 'CK', cccd: '' },
];
const sales = [{ id: 'BH01', date: '2026-01-03', item: 'Tiêu đen', qty: 50, price: 150000 }];
const z = computeLedger(purchases, sales, [{ item: 'Tiêu đen', amount: 500000 }])['Tiêu đen'];

assert.strictEqual(z.qty, 150);
assert.strictEqual(Math.round(z.avgCost), 110000);
assert.strictEqual(z.profit, 50 * 150000 - 50 * 110000);   // lãi gộp 2.000.000
assert.strictEqual(z.net, 2000000 - 500000);                 // sau chi phí
assert.ok(computeLedger(purchases, [{ ...sales[0], qty: 999 }], [])['Tiêu đen'].oversold);

const w = findWarnings([{ id: 'X', date: '2026-01-01', item: 'Hạt điều', qty: 100, price: 60000, name: 'C', pay: 'TM', cccd: '' }]);
assert.deepStrictEqual(w.X, ['Trên 5 triệu chưa ghi CK']);
console.log('OK - ledger tests passed');
