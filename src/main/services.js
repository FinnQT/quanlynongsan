/**
 * services.js - Toàn bộ thao tác dữ liệu mà giao diện được phép gọi (qua IPC).
 * Mỗi hàm export ra là một "API" cho renderer: api('tenHam', ...thamSo).
 */
const { getDb, tx } = require('./db');
const { total, computeLedger, findWarnings } = require('./ledger');

// kind (dùng ở UI) -> tên bảng
const TABLES = { purchase: 'purchases', sale: 'sales', cost: 'costs', customer: 'customers' };
const PREFIX = { purchases: 'TM', sales: 'BH', costs: 'CP', customers: 'KH' };

const q = (sql, ...p) => getDb().prepare(sql).all(...p);
const one = (sql, ...p) => getDb().prepare(sql).get(...p);
const run = (sql, ...p) => getDb().prepare(sql).run(...p);

/* ---------- tiện ích ---------- */
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const titleCase = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());

function log(refId, action, detail = '') {
  run('INSERT INTO history (time, ref_id, action, detail) VALUES (?,?,?,?)',
    new Date().toLocaleString('vi-VN'), refId, action, detail);
}

/** Mã tự sinh theo ngày: TM01-061126 (số thứ tự trong ngày + ddmmyy). */
function nextCode(table, date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
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

/** Mã khách hàng tự sinh: KH001, KH002... */
function nextCustomerCode() {
  let max = 0;
  for (const { id } of q('SELECT id FROM customers')) {
    const m = /^KH(\d+)$/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `KH${String(max + 1).padStart(3, '0')}`;
}

/** Xem trước mã giao dịch sẽ sinh cho kind ('purchase' | 'sale' | 'cost' | 'customer') vào ngày `date`. */
function previewCode(kind, date, currentId = null) {
  if (kind === 'customer') return currentId || nextCustomerCode();
  const table = TABLES[kind];
  if (!table || !date) return '';
  if (currentId) {
    const row = one(`SELECT date FROM ${table} WHERE id = ?`, currentId);
    if (row && row.date === date) return currentId;
  }
  return nextCode(table, date);
}

const active = (table) => q(`SELECT * FROM ${table} WHERE deleted = 0 ORDER BY date, id`);

/** Kiểm tra bán vượt tồn: ném lỗi để transaction tự rollback. */
function assertNotOversold(item) {
  const z = computeLedger(active('purchases'), active('sales'), [])[item];
  if (z && z.oversold) throw new Error(`Số bán (${item}) vượt lượng hàng có trong kho. Hãy kiểm tra ngày bán hoặc số kg.`);
}

/* ---------- THU MUA ---------- */
function validatePurchase(p) {
  if (!p.date) return 'Chưa chọn ngày mua hợp lệ.';
  if (!p.name) return 'Chưa nhập họ tên người bán.';
  if (!p.item) return 'Chưa chọn tên hàng hóa.';
  if (!(p.qty > 0)) return 'Số lượng phải lớn hơn 0.';
  if (!(p.price >= 0)) return 'Chưa nhập đơn giá.';
  if (p.cccd && !/^\d{12}$/.test(p.cccd)) return 'CCCD phải đủ 12 chữ số (hoặc để trống).';
  if (p.cccd) {
    const dupCust = one('SELECT id, name FROM customers WHERE deleted = 0 AND cccd = ? AND LOWER(name) != LOWER(?)', p.cccd, p.name);
    if (dupCust) return `Số CCCD "${p.cccd}" đang thuộc về khách hàng "${dupCust.name}" (${dupCust.id}). Vui lòng kiểm tra lại!`;
  }
  return '';
}

const PURCHASE_FIELDS = ['date', 'name', 'addr', 'cccd', 'phone', 'item', 'qty', 'price', 'pay', 'note'];

/** Thêm mới (không có p.id) hoặc sửa (có p.id). Trả về mã giao dịch. */
function savePurchase(p) {
  p = { ...p, name: titleCase(p.name || ''), qty: Number(p.qty), price: Number(p.price) };
  const err = validatePurchase(p);
  if (err) throw new Error(err);

  return tx(() => {
    if (!p.id) {
      const id = nextCode('purchases', p.date);
      run(`INSERT INTO purchases (id, ${PURCHASE_FIELDS.join(',')}) VALUES (?, ${PURCHASE_FIELDS.map(() => '?').join(',')})`,
        id, ...PURCHASE_FIELDS.map((k) => p[k] ?? ''));
      log(id, 'THÊM', `${p.name} – ${fmt(p.qty)} kg`);
      return id;
    }
    const old = one('SELECT * FROM purchases WHERE id = ?', p.id);
    if (!old) throw new Error('Không tìm thấy giao dịch ' + p.id);
    const changes = PURCHASE_FIELDS.filter((k) => String(old[k]) !== String(p[k] ?? '')).map((k) => `${k}: ${old[k] || '—'} → ${p[k] || '—'}`);
    if (!changes.length) throw new Error('Chưa có thay đổi nào.');
    let id = old.id;
    if (p.date !== old.date) { id = nextCode('purchases', p.date); changes.push(`Mã: ${old.id} → ${id}`); }
    run(`UPDATE purchases SET id = ?, ${PURCHASE_FIELDS.map((k) => k + ' = ?').join(',')} WHERE id = ?`,
      id, ...PURCHASE_FIELDS.map((k) => p[k] ?? ''), old.id);
    assertNotOversold(old.item);
    if (p.item !== old.item) assertNotOversold(p.item);
    log(id, 'SỬA', changes.join('; '));
    return id;
  });
}

/** Danh sách có lọc + cảnh báo đối soát. filter: {q, from, to, pay, item, bad} */
function listPurchases(f = {}) {
  const all = active('purchases');
  const custs = q("SELECT id, name, cccd, (cccd_front != '' OR cccd_back != '') AS hasCccdImg FROM customers WHERE deleted = 0");
  const warnings = findWarnings(all);
  const kw = (f.q || '').trim().toLowerCase();
  const rows = all
    .filter((r) => (!kw || [r.id, r.name, r.cccd, r.addr, r.phone].join(' ').toLowerCase().includes(kw))
      && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
      && (!f.pay || (f.pay === 'NONE' ? !r.pay : r.pay === f.pay))
      && (!f.item || r.item === f.item)
      && (!f.bad || warnings[r.id]))
    .reverse()
    .map((r) => {
      const mc = custs.find((c) => (r.cccd && c.cccd === r.cccd) || c.name.toLowerCase() === r.name.toLowerCase());
      return {
        ...r,
        total: total(r),
        warnings: warnings[r.id] || [],
        custId: mc ? mc.id : '',
        hasCccdImg: Boolean(mc && mc.hasCccdImg),
      };
    });
  return { rows, badCount: Object.keys(warnings).length, items: [...new Set(all.map((r) => r.item))] };
}

const getPurchase = (id) => one('SELECT * FROM purchases WHERE id = ?', id);

/* ---------- QUẢN LÝ KHÁCH HÀNG (Thêm, Sửa, Tra cứu, Đồng bộ) ---------- */
const CUSTOMER_FIELDS = ['name', 'phone', 'cccd', 'addr', 'note', 'cccd_front', 'cccd_back'];

function saveCustomer(c) {
  c = {
    id: c.id || '',
    name: titleCase(c.name || ''),
    phone: (c.phone || '').trim(),
    cccd: (c.cccd || '').trim(),
    addr: (c.addr || '').trim(),
    note: (c.note || '').trim(),
    cccd_front: c.cccd_front || '',
    cccd_back: c.cccd_back || '',
  };
  if (!c.name) throw new Error('Chưa nhập họ và tên khách hàng.');
  if (c.cccd && !/^\d{12}$/.test(c.cccd)) throw new Error('CCCD phải đủ 12 chữ số (hoặc để trống).');
  if (c.cccd) {
    const dup = one('SELECT id, name, deleted FROM customers WHERE cccd = ? AND id != ?', c.cccd, c.id);
    if (dup) {
      throw new Error(`Số CCCD "${c.cccd}" đã tồn tại ở khách hàng ${dup.name} (${dup.id})${dup.deleted ? ' [trong Thùng rác]' : ''}.`);
    }
  }

  return tx(() => {
    if (!c.id) {
      const id = nextCustomerCode();
      run('INSERT INTO customers (id, name, phone, cccd, addr, note, cccd_front, cccd_back) VALUES (?,?,?,?,?,?,?,?)',
        id, c.name, c.phone, c.cccd, c.addr, c.note, c.cccd_front, c.cccd_back);
      log(id, 'THÊM KH', `${c.name}${c.phone ? ' – ' + c.phone : ''}`);
      return id;
    }
    const old = one('SELECT * FROM customers WHERE id = ?', c.id);
    if (!old) throw new Error('Không tìm thấy khách hàng ' + c.id);
    run(`UPDATE customers SET ${CUSTOMER_FIELDS.map((k) => k + ' = ?').join(',')} WHERE id = ?`,
      ...CUSTOMER_FIELDS.map((k) => c[k]), c.id);
    log(c.id, 'SỬA KH', `${c.name}${c.phone ? ' – ' + c.phone : ''}`);
    return c.id;
  });
}

const getCustomer = (id) => one('SELECT * FROM customers WHERE id = ?', id);

function listCustomers(f = {}) {
  const kw = (f.q || '').trim().toLowerCase();
  const purchases = active('purchases');
  const all = q("SELECT id, name, phone, cccd, addr, note, (cccd_front != '' OR cccd_back != '') AS hasCccdImg FROM customers WHERE deleted = 0 ORDER BY id DESC");
  return all
    .filter((c) => !kw || [c.id, c.name, c.phone, c.cccd, c.addr, c.note].join(' ').toLowerCase().includes(kw))
    .map((c) => {
      const matched = purchases.filter((p) => (c.cccd && p.cccd === c.cccd) || p.name.toLowerCase() === c.name.toLowerCase());
      return {
        ...c,
        hasCccdImg: Boolean(c.hasCccdImg),
        txCount: matched.length,
        totalQty: matched.reduce((s, p) => s + p.qty, 0),
        totalAmt: matched.reduce((s, p) => s + total(p), 0),
      };
    });
}

/** Đồng bộ những người bán đã có trong bảng Thu mua sang danh mục Khách hàng (nếu chưa có). */
function syncCustomers() {
  return tx(() => {
    const existing = q('SELECT name, cccd FROM customers WHERE deleted = 0');
    const hasName = new Set(existing.map((c) => c.name.toLowerCase()));
    const hasCccd = new Set(existing.filter((c) => c.cccd).map((c) => c.cccd));
    let added = 0;
    for (const p of q('SELECT name, phone, cccd, addr FROM purchases WHERE deleted = 0 ORDER BY date DESC, id DESC')) {
      const key = p.name.toLowerCase();
      if (hasName.has(key) || (p.cccd && hasCccd.has(p.cccd))) continue;
      const id = nextCustomerCode();
      run('INSERT INTO customers (id, name, phone, cccd, addr, note) VALUES (?,?,?,?,?,?)',
        id, titleCase(p.name), p.phone || '', p.cccd || '', p.addr || '', 'Đồng bộ từ thu mua');
      hasName.add(key);
      if (p.cccd) hasCccd.add(p.cccd);
      added++;
    }
    if (added) log('KH', 'ĐỒNG BỘ KH', `Thêm ${added} khách hàng từ lịch sử thu mua`);
    return added;
  });
}

/* ---------- BÁN HÀNG (Thêm & Sửa) ---------- */
const SALE_FIELDS = ['date', 'item', 'qty', 'price', 'note'];

function saveSale(s) {
  s = { ...s, qty: Number(s.qty), price: Number(s.price), note: s.note || '' };
  if (!s.date || !s.item) throw new Error('Chọn ngày bán hợp lệ và loại hàng.');
  if (!(s.qty > 0)) throw new Error('Số kg bán phải lớn hơn 0.');
  if (!(s.price >= 0)) throw new Error('Nhập giá bán hợp lệ.');

  return tx(() => {
    if (!s.id) {
      const id = nextCode('sales', s.date);
      run('INSERT INTO sales (id, date, item, qty, price, note) VALUES (?,?,?,?,?,?)', id, s.date, s.item, s.qty, s.price, s.note);
      assertNotOversold(s.item);
      log(id, 'THÊM BÁN', `${s.item} – ${fmt(s.qty)} kg – ${fmt(total(s))} đ`);
      return id;
    }
    const old = one('SELECT * FROM sales WHERE id = ?', s.id);
    if (!old) throw new Error('Không tìm thấy lần bán ' + s.id);
    let id = old.id;
    if (s.date !== old.date) id = nextCode('sales', s.date);
    run(`UPDATE sales SET id = ?, ${SALE_FIELDS.map((k) => k + ' = ?').join(',')} WHERE id = ?`,
      id, ...SALE_FIELDS.map((k) => s[k]), old.id);
    assertNotOversold(old.item);
    if (s.item !== old.item) assertNotOversold(s.item);
    log(id, 'SỬA BÁN', `${s.item} – ${fmt(s.qty)} kg – ${fmt(total(s))} đ`);
    return id;
  });
}

const getSale = (id) => one('SELECT * FROM sales WHERE id = ?', id);
function listSales(f = {}) {
  return active('sales')
    .filter((r) => (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) && (!f.item || r.item === f.item))
    .reverse()
    .map((r) => ({ ...r, revenue: total(r) }));
}

/* ---------- CHI PHÍ (Thêm & Sửa) ---------- */
const COST_FIELDS = ['date', 'item', 'type', 'amount', 'note'];

function saveCost(c) {
  c = { ...c, amount: Number(c.amount), note: c.note || '' };
  if (!c.date || !c.item) throw new Error('Chọn ngày chi hợp lệ và loại hàng.');
  if (!(c.amount > 0)) throw new Error('Nhập số tiền chi phí lớn hơn 0.');

  return tx(() => {
    if (!c.id) {
      const id = nextCode('costs', c.date);
      run('INSERT INTO costs (id, date, item, type, amount, note) VALUES (?,?,?,?,?,?)', id, c.date, c.item, c.type, c.amount, c.note);
      log(id, 'THÊM CHI PHÍ', `${c.item} – ${c.type} – ${fmt(c.amount)} đ`);
      return id;
    }
    const old = one('SELECT * FROM costs WHERE id = ?', c.id);
    if (!old) throw new Error('Không tìm thấy chi phí ' + c.id);
    let id = old.id;
    if (c.date !== old.date) id = nextCode('costs', c.date);
    run(`UPDATE costs SET id = ?, ${COST_FIELDS.map((k) => k + ' = ?').join(',')} WHERE id = ?`,
      id, ...COST_FIELDS.map((k) => c[k]), old.id);
    log(id, 'SỬA CHI PHÍ', `${c.item} – ${c.type} – ${fmt(c.amount)} đ`);
    return id;
  });
}

const getCost = (id) => one('SELECT * FROM costs WHERE id = ?', id);
function listCosts(f = {}) {
  return active('costs')
    .filter((r) => (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) && (!f.item || r.item === f.item))
    .reverse();
}

/* ---------- TỒN KHO & LỢI NHUẬN ---------- */
const listItems = () => q(`SELECT item FROM purchases WHERE deleted = 0 UNION SELECT item FROM sales WHERE deleted = 0 ORDER BY item`).map((r) => r.item);

function stockReport() {
  const state = computeLedger(active('purchases'), active('sales'), active('costs'));
  return Object.entries(state).sort(([a], [b]) => a.localeCompare(b)).map(([item, z]) => ({ item, ...z }));
}

/* ---------- THÙNG RÁC / LỊCH SỬ ---------- */
function softDelete(kind, id) {
  tx(() => {
    const row = one(`SELECT * FROM ${TABLES[kind]} WHERE id = ?`, id);
    run(`UPDATE ${TABLES[kind]} SET deleted = 1 WHERE id = ?`, id);
    if (kind === 'purchase' && row) assertNotOversold(row.item);
    log(id, 'XÓA', kind);
  });
}

function restore(kind, id) {
  tx(() => {
    const row = one(`SELECT * FROM ${TABLES[kind]} WHERE id = ?`, id);
    if (kind === 'customer' && row && row.cccd) {
      const dup = one('SELECT id, name FROM customers WHERE deleted = 0 AND cccd = ? AND id != ?', row.cccd, id);
      if (dup) throw new Error(`Không thể khôi phục vì số CCCD "${row.cccd}" đang trùng với khách hàng ${dup.name} (${dup.id}).`);
    }
    run(`UPDATE ${TABLES[kind]} SET deleted = 0 WHERE id = ?`, id);
    if (row && (kind === 'sale' || kind === 'purchase')) assertNotOversold(row.item);
    log(id, 'KHÔI PHỤC', kind);
  });
}

function purge(list) {
  tx(() => list.forEach(({ kind, id }) => {
    run(`DELETE FROM ${TABLES[kind]} WHERE id = ? AND deleted = 1`, id);
    log(id, 'XÓA VĨNH VIỄN', kind);
  }));
}

function listTrash() {
  const rows = [];
  for (const r of q('SELECT * FROM purchases WHERE deleted = 1')) rows.push({ kind: 'purchase', label: 'Mua hàng', id: r.id, date: r.date, text: r.name, amount: total(r) });
  for (const r of q('SELECT * FROM sales WHERE deleted = 1')) rows.push({ kind: 'sale', label: 'Bán hàng', id: r.id, date: r.date, text: `${r.item} – ${fmt(r.qty)} kg`, amount: total(r) });
  for (const r of q('SELECT * FROM costs WHERE deleted = 1')) rows.push({ kind: 'cost', label: 'Chi phí', id: r.id, date: r.date, text: `${r.type} – ${r.item}`, amount: r.amount });
  for (const r of q('SELECT * FROM customers WHERE deleted = 1')) rows.push({ kind: 'customer', label: 'Khách hàng', id: r.id, date: '', text: `${r.name}${r.phone ? ' – ' + r.phone : ''}`, amount: 0 });
  return rows;
}

const listHistory = () => q('SELECT * FROM history ORDER BY seq DESC LIMIT 500');

/* ---------- CÀI ĐẶT ---------- */
function getSettings() {
  return Object.fromEntries(q('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
}

function saveSettings(s) {
  tx(() => Object.entries(s).forEach(([k, v]) => run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, String(v))));
}

function wipeAll() {
  tx(() => ['purchases', 'sales', 'costs', 'customers', 'history'].forEach((t) => run(`DELETE FROM ${t}`)));
}

module.exports = {
  nextCode, active, log, total, fmt, PREFIX,
  api: {
    previewCode,
    savePurchase, listPurchases, getPurchase,
    saveCustomer, getCustomer, listCustomers, syncCustomers,
    saveSale, getSale, listSales,
    saveCost, getCost, listCosts,
    listItems, stockReport,
    softDelete, restore, purge, listTrash, listHistory,
    getSettings, saveSettings, wipeAll,
  },
};
