/**
 * fert.js - Phân bón: nhập kho, bán cho khách hàng, chi phí, tồn kho & lợi nhuận (đơn vị: bao).
 * Độc lập với thu mua nông sản: dùng bảng riêng fert_in / fert_sales / fert_costs.
 * Tái dùng computeLedger (giá vốn bình quân di động); khách hàng lấy từ bảng customers.
 */
const { getDb, tx } = require('./db');
const { total, computeLedger } = require('./ledger');
const S = require('./services');

const q = (sql, ...p) => getDb().prepare(sql).all(...p);
const one = (sql, ...p) => getDb().prepare(sql).get(...p);
const run = (sql, ...p) => getDb().prepare(sql).run(...p);
const all = (t) => q(`SELECT * FROM ${t} ORDER BY date, id`);

const PREFIX = { fert_in: 'NP', fert_sales: 'BP', fert_costs: 'CF' };
const KIND = { in: 'fert_in', sale: 'fert_sales', cost: 'fert_costs' };

/** Mã tự sinh theo ngày: NP01-061126 */
function nextCode(table, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
  const [y, m, d] = date.split('-');
  const suffix = d + m + y.slice(2);
  const re = new RegExp(`^${PREFIX[table]}(\\d+)-${suffix}$`);
  let max = 0;
  for (const { id } of q(`SELECT id FROM ${table} WHERE id LIKE ?`, `${PREFIX[table]}%-${suffix}`)) {
    const x = re.exec(id);
    if (x) max = Math.max(max, parseInt(x[1], 10));
  }
  return `${PREFIX[table]}${String(max + 1).padStart(2, '0')}-${suffix}`;
}

/** Danh sách tên loại phân bón đã dùng. */
const itemNames = () =>
  q('SELECT item FROM fert_in UNION SELECT item FROM fert_sales UNION SELECT item FROM fert_costs ORDER BY item').map((r) => r.item);

/** Chuẩn hóa tên loại phân: bỏ khoảng trắng thừa; trùng tên (không phân biệt hoa/thường) thì dùng cách viết đã có. */
function normItem(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return itemNames().find((x) => x.toLowerCase() === s.toLowerCase()) || s;
}

/** Bán vượt tồn -> ném lỗi để transaction tự rollback. */
function assertNotOversold(item) {
  const z = computeLedger(all('fert_in'), all('fert_sales'), [])[item];
  if (z && z.oversold) throw new Error(`Số bao bán (${item}) vượt lượng tồn kho. Hãy kiểm tra ngày bán, số bao hoặc phiếu nhập.`);
}

/** Thêm mới (không có id) hoặc sửa (có id). Đổi ngày thì đổi mã theo ngày mới. */
function upsert(table, fields, d, { check, addLog, editLog, text }) {
  return tx(() => {
    let id, old = null;
    if (!d.id) {
      id = nextCode(table, d.date);
      run(`INSERT INTO ${table} (id, ${fields.join(',')}) VALUES (?, ${fields.map(() => '?').join(',')})`,
        id, ...fields.map((k) => d[k]));
    } else {
      old = one(`SELECT * FROM ${table} WHERE id = ?`, d.id);
      if (!old) throw new Error('Không tìm thấy ' + d.id);
      id = d.date !== old.date ? nextCode(table, d.date) : old.id;
      run(`UPDATE ${table} SET id = ?, ${fields.map((k) => k + ' = ?').join(',')} WHERE id = ?`,
        id, ...fields.map((k) => d[k]), old.id);
    }
    if (check) check(old);
    S.log(id, old ? editLog : addLog, text);
    return id;
  });
}

const inRange = (r, f) => (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) && (!f.item || r.item === f.item);
const match = (kw, parts) => S.matchKw(kw, parts);   // không phân biệt dấu, nhiều từ = phải có đủ các từ

/* ---------- NHẬP KHO ---------- */
function saveFertIn(p) {
  p = { id: p.id || '', date: p.date, item: normItem(p.item), supplier: String(p.supplier || '').trim(),
        qty: Number(p.qty), price: Number(p.price), note: String(p.note || '').trim() };
  if (!p.date || !p.item) throw new Error('Chọn ngày nhập và nhập tên loại phân bón.');
  if (!(p.qty > 0)) throw new Error('Số bao nhập phải lớn hơn 0.');
  if (!(p.price >= 0)) throw new Error('Nhập đơn giá nhập hợp lệ (đồng/bao).');
  return upsert('fert_in', ['date', 'item', 'supplier', 'qty', 'price', 'note'], p, {
    check: (old) => { assertNotOversold(p.item); if (old && old.item !== p.item) assertNotOversold(old.item); },
    addLog: 'THÊM NHẬP PHÂN', editLog: 'SỬA NHẬP PHÂN',
    text: `${p.item} – ${S.fmt(p.qty)} bao – ${S.fmt(total(p))} đ`,
  });
}
const getFertIn = (id) => one('SELECT * FROM fert_in WHERE id = ?', id);
function listFertIn(f = {}) {
  const kw = (f.q || '').trim().toLowerCase();
  return all('fert_in')
    .filter((r) => inRange(r, f) && match(kw, [r.date, r.id, r.item, r.supplier, r.note]))
    .reverse().map((r) => ({ ...r, total: total(r) }));
}

/* ---------- BÁN CHO KHÁCH ---------- */
function saveFertSale(s) {
  s = { id: s.id || '', date: s.date, cust_id: String(s.cust_id || ''), cust_name: '', item: normItem(s.item),
        qty: Number(s.qty), price: Number(s.price), note: String(s.note || '').trim() };
  if (!s.date || !s.item) throw new Error('Chọn ngày bán và nhập tên loại phân bón.');
  const cust = one('SELECT id, name FROM customers WHERE id = ? AND deleted = 0', s.cust_id);
  if (!cust) throw new Error('Hãy chọn khách hàng từ danh sách gợi ý (chưa có thì thêm ở tab Khách hàng trước).');
  s.cust_name = cust.name;
  if (!(s.qty > 0)) throw new Error('Số bao bán phải lớn hơn 0.');
  if (!(s.price >= 0)) throw new Error('Nhập giá bán hợp lệ (đồng/bao).');
  return upsert('fert_sales', ['date', 'cust_id', 'cust_name', 'item', 'qty', 'price', 'note'], s, {
    check: (old) => { assertNotOversold(s.item); if (old && old.item !== s.item) assertNotOversold(old.item); },
    addLog: 'THÊM BÁN PHÂN', editLog: 'SỬA BÁN PHÂN',
    text: `${cust.name} – ${s.item} – ${S.fmt(s.qty)} bao – ${S.fmt(total(s))} đ`,
  });
}
const getFertSale = (id) => one('SELECT * FROM fert_sales WHERE id = ?', id);
function listFertSales(f = {}) {
  const kw = (f.q || '').trim().toLowerCase();
  const names = Object.fromEntries(q('SELECT id, name FROM customers').map((c) => [c.id, c.name]));
  return all('fert_sales')
    .map((r) => ({ ...r, cust_name: names[r.cust_id] || r.cust_name, revenue: total(r) }))
    .filter((r) => inRange(r, f) && match(kw, [r.date, r.id, r.cust_id, r.cust_name, r.item, r.note]))
    .reverse();
}

/* ---------- CHI PHÍ ---------- */
function saveFertCost(c) {
  c = { id: c.id || '', date: c.date, item: normItem(c.item), type: String(c.type || 'Khác'),
        amount: Number(c.amount), note: String(c.note || '').trim() };
  if (!c.date || !c.item) throw new Error('Chọn ngày chi và nhập loại phân bón.');
  if (!(c.amount > 0)) throw new Error('Nhập số tiền chi phí lớn hơn 0.');
  return upsert('fert_costs', ['date', 'item', 'type', 'amount', 'note'], c, {
    addLog: 'THÊM CHI PHÍ PHÂN', editLog: 'SỬA CHI PHÍ PHÂN',
    text: `${c.item} – ${c.type} – ${S.fmt(c.amount)} đ`,
  });
}
const getFertCost = (id) => one('SELECT * FROM fert_costs WHERE id = ?', id);
function listFertCosts(f = {}) {
  const kw = (f.q || '').trim().toLowerCase();
  return all('fert_costs').filter((r) => inRange(r, f) && match(kw, [r.date, r.id, r.item, r.type, r.note])).reverse();
}

/* ---------- XÓA / BÁO CÁO ---------- */
/** Xóa hẳn 1 dòng. Xóa phiếu nhập làm âm kho -> báo lỗi, không xóa. */
function deleteFert(kind, id) {
  const table = KIND[kind];
  if (!table) throw new Error('Loại dữ liệu không hợp lệ.');
  tx(() => {
    const row = one(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!row) throw new Error('Không tìm thấy ' + id);
    run(`DELETE FROM ${table} WHERE id = ?`, id);
    if (kind === 'in') assertNotOversold(row.item);
    S.log(id, 'XÓA PHÂN BÓN', `${row.item} (${table})`);
  });
}

function fertStock() {
  const st = computeLedger(all('fert_in'), all('fert_sales'), all('fert_costs'));
  return Object.entries(st).sort(([a], [b]) => a.localeCompare(b)).map(([item, z]) => ({ item, ...z }));
}

/** Xem trước mã sẽ sinh: kind = 'in' | 'sale' | 'cost'. Đang sửa mà không đổi ngày thì giữ mã cũ. */
function previewFertCode(kind, date, curId) {
  const table = KIND[kind];
  if (curId) {
    const row = one(`SELECT date FROM ${table} WHERE id = ?`, curId);
    if (row && row.date === date) return curId;
  }
  return nextCode(table, date);
}

module.exports = {
  api: {
    fertItems: itemNames, fertStock, previewFertCode, deleteFert,
    saveFertIn, getFertIn, listFertIn,
    saveFertSale, getFertSale, listFertSales,
    saveFertCost, getFertCost, listFertCosts,
  },
};