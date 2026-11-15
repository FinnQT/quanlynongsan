/**
 * excel.js - Xuất Bảng kê 02/TNDN (+ sheet dữ liệu) và nhập lại từ Excel (exceljs).
 */
const ExcelJS = require('exceljs');
const { getDb, tx } = require('./db');
const S = require('./services');

const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');
const FONT = (size, bold, italic) => ({ name: 'Times New Roman', size, bold: !!bold, italic: !!italic });
const THIN = { style: 'thin' };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/** Số tiền bằng chữ (tiếng Việt). */
function moneyToWords(n) {
  n = Math.round(n);
  if (!n) return 'Không đồng';
  const D = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const UNIT = ['', ' nghìn', ' triệu', ' tỷ'];
  const three = (x, full) => {
    const h = (x / 100) | 0, t = ((x % 100) / 10) | 0, u = x % 10;
    let s = '';
    if (h || full) s += D[h] + ' trăm ';
    if (t > 1) s += D[t] + ' mươi ' + (u === 1 ? 'mốt ' : u === 5 ? 'lăm ' : u ? D[u] + ' ' : '');
    else if (t === 1) s += 'mười ' + (u === 5 ? 'lăm ' : u ? D[u] + ' ' : '');
    else if (u) s += (h || full ? 'lẻ ' : '') + D[u] + ' ';
    return s;
  };
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  let s = '';
  for (let k = groups.length - 1; k >= 0; k--) if (groups[k]) s += three(groups[k], k < groups.length - 1) + UNIT[k].trim() + ' ';
  s = s.replace(/\s+/g, ' ').trim();
  return s[0].toUpperCase() + s.slice(1) + ' đồng chẵn';
}

/* ======================= XUẤT ======================= */

/** Vẽ sheet BANG_KE theo mẫu 02/TNDN. */
function buildBangKe(wb, rows, cfg, from, to) {
  const ws = wb.addWorksheet('BANG_KE', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  [14, 24, 32, 16, 13, 20, 10, 24, 17, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  let r = 1;
  const line = (text, size, bold, align = 'left', range = [1, 10]) => {
    ws.mergeCells(r, range[0], r, range[1]);
    const c = ws.getCell(r, range[0]);
    c.value = text; c.font = FONT(size, bold);
    c.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
    r++;
  };

  line('Mẫu số : 02/TNDN', 10, 0, 'left', [7, 10]);
  line('Ban hành kèm theo Thông tư số 20/2026/TT-BTC', 10, 0, 'left', [7, 10]);
  line('của Bộ trưởng Bộ Tài chính', 10, 0, 'left', [7, 10]);
  r++;
  line('BẢNG KÊ THU MUA HÀNG HÓA, DỊCH VỤ KHÔNG CÓ HOÁ ĐƠN', 16, 1, 'center');
  ws.getRow(r - 1).height = 24;
  line(from && from === to ? `( Ngày ${dmy(from)} )` : `( Từ ngày ${dmy(from) || '……'} đến ngày ${dmy(to) || '……'} )`, 10, 0, 'center');
  line(`Tên doanh nghiệp: ${cfg.name}      Mã Số Thuế: ${cfg.mst}`, 11, 1);
  line('Địa chỉ: ' + cfg.addr, 11, 1);
  line('Số điện thoại: ' + cfg.tel, 11, 1);
  line('Địa chỉ nơi tổ chức thu mua: ' + cfg.place, 11, 1);
  r++;

  // Tiêu đề bảng (2 dòng, gộp ô)
  const h = r;
  ws.mergeCells(h, 1, h + 1, 1); ws.mergeCells(h, 2, h, 5); ws.mergeCells(h, 6, h, 9); ws.mergeCells(h, 10, h + 1, 10);
  ws.getCell(h, 1).value = 'Ngày tháng\n năm mua \nhàng';
  ws.getCell(h, 2).value = 'Người bán';
  ws.getCell(h, 6).value = 'Hàng hóa mua vào';
  ws.getCell(h, 10).value = 'Ghi Chú';
  ['Tên người bán', 'Địa chỉ', 'Số CCCD', 'Số điện thoại', 'Tên hàng hoá, dịch vụ', 'Số lượng', 'Đơn giá', 'Tổng giá thanh toán']
    .forEach((t, i) => (ws.getCell(h + 1, i + 2).value = t));
  for (let rr = h; rr <= h + 1; rr++) for (let cc = 1; cc <= 10; cc++) {
    const c = ws.getCell(rr, cc);
    c.font = FONT(10, 1); c.border = BORDER; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  ws.getRow(h + 1).height = 28;
  r = h + 2;

  // Dữ liệu
  const first = r;
  for (const w of rows) {
    const values = [dmy(w.date), w.name, w.addr, w.cccd, w.phone, w.item, w.qty, w.price,
      { formula: `G${r}*H${r}`, result: S.total(w) }, [w.pay, w.note].filter(Boolean).join('; ')];
    values.forEach((val, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = val; c.font = FONT(10); c.border = BORDER;
      c.alignment = { vertical: 'middle', wrapText: true, horizontal: i === 0 ? 'center' : i > 5 && i < 9 ? 'right' : 'left' };
      if (i <= 4) c.numFmt = '@';
      if (i === 6) c.numFmt = '#,##0.##';
      if (i > 6 && i < 9) c.numFmt = '#,##0';
    });
    ws.getRow(r).height = 24; r++;
  }
  const last = r - 1;
  const sumQty = rows.reduce((s, w) => s + w.qty, 0), sumAmt = rows.reduce((s, w) => s + S.total(w), 0);
  for (let cc = 1; cc <= 10; cc++) { const c = ws.getCell(r, cc); c.border = BORDER; c.font = FONT(12, 1); }
  ws.getCell(r, 2).value = 'Tổng Cộng ';
  ws.getCell(r, 2).alignment = { horizontal: 'center' };
  ws.getCell(r, 7).value = { formula: `SUM(G${first}:G${last})`, result: sumQty }; ws.getCell(r, 7).numFmt = '0.##';
  ws.getCell(r, 9).value = { formula: `SUM(I${first}:I${last})`, result: sumAmt }; ws.getCell(r, 9).numFmt = '#,##0';
  r++;

  line(`Tổng giá trị hàng hóa mua vào: ${S.fmt(sumAmt)}          Số tiền bằng chữ: ${moneyToWords(sumAmt)}.`, 12, 0);
  ws.getRow(r - 1).height = 32;
  line(from && from === to ? `Ngày ${from.slice(8)} tháng ${from.slice(5, 7)} năm ${from.slice(0, 4)}` : 'Ngày ………. Tháng ………. Năm 20 …..', 10, 0, 'center', [7, 10]);
  line('NGƯỜI LẬP BẢNG KÊ', 10, 1, 'center', [2, 3]); r--;
  line('GIÁM ĐỐC', 10, 1, 'center', [7, 10]);
  r += 2;
  line('ghi chú:  chụp hình CCCD người bán', 9, 0, 'left', [7, 10]);
  line('              chuyển khoản từ tài khoản cty với số tiền > 5 triệu', 9, 0, 'left', [7, 10]);
}

/** Thêm một sheet dữ liệu thô (header đậm + dòng). */
function addDataSheet(wb, name, header, dataRows, textCols = []) {
  const ws = wb.addWorksheet(name);
  ws.addRow(header).font = { bold: true };
  dataRows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => (c.width = 18));
  textCols.forEach((i) => (ws.getColumn(i).numFmt = '@'));
}

const stateText = (r) => (r.deleted ? 'ĐÃ XÓA' : 'ĐANG DÙNG');

/** Xuất file .xlsx ra `filePath`. Trả về số dòng bảng kê. */
async function exportExcel(filePath, from, to) {
  const db = getDb();
  const rows = S.active('purchases').filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
  if (!rows.length) throw new Error('Không có giao dịch trong khoảng ngày này.');

  const wb = new ExcelJS.Workbook();
  buildBangKe(wb, rows, S.api.getSettings(), from, to);

  const all = (t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
  addDataSheet(wb, 'DU_LIEU',
    ['Mã giao dịch', 'Ngày mua', 'Họ tên người bán', 'Địa chỉ', 'Số CCCD', 'Số điện thoại', 'Tên hàng hóa', 'Số lượng (kg)', 'Đơn giá (đ)', 'Tổng tiền (đ)', 'Thanh toán', 'Ghi chú', 'Trạng thái'],
    all('purchases').map((w) => [w.id, dmy(w.date), w.name, w.addr, w.cccd, w.phone, w.item, w.qty, w.price, S.total(w), w.pay, w.note, stateText(w)]), [2, 5, 6]);
  addDataSheet(wb, 'BAN_HANG',
    ['Mã bán', 'Ngày bán', 'Loại hàng', 'Số lượng (kg)', 'Giá bán/kg', 'Doanh thu', 'Ghi chú', 'Trạng thái'],
    all('sales').map((x) => [x.id, dmy(x.date), x.item, x.qty, x.price, S.total(x), x.note, stateText(x)]), [2]);
  addDataSheet(wb, 'CHI_PHI',
    ['Mã chi phí', 'Ngày', 'Loại hàng', 'Loại chi phí', 'Số tiền', 'Ghi chú', 'Trạng thái'],
    all('costs').map((x) => [x.id, dmy(x.date), x.item, x.type, x.amount, x.note, stateText(x)]), [2]);
  addDataSheet(wb, 'KHACH_HANG',
    ['Mã KH', 'Họ và tên', 'Số điện thoại', 'Số CCCD', 'Địa chỉ', 'Ghi chú', 'Trạng thái'],
    all('customers').map((x) => [x.id, x.name, x.phone, x.cccd, x.addr, x.note, stateText(x)]), [3, 4]);

  await wb.xlsx.writeFile(filePath);
  return rows.length;
}

/* ======================= NHẬP ======================= */

/** Chuẩn hóa giá trị ô exceljs (công thức, rich text, Date...) thành chuỗi/số. */
function cellValue(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v ?? '';
}

/** Ô ngày (Date | 'dd/mm/yyyy' | 'yyyy-mm-dd') -> 'yyyy-mm-dd'. */
function toIsoDate(v) {
  v = cellValue(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  v = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

/** Đọc 1 sheet thành mảng các dòng (bỏ dòng tiêu đề), mỗi dòng là mảng 0-based. */
function readRows(ws) {
  const out = [];
  ws?.eachRow((row, i) => { if (i > 1) out.push(Array.from({ length: 13 }, (_, k) => cellValue(row.getCell(k + 1).value))); });
  return out;
}

/**
 * Nhập từ Excel: dòng đã có mã hoặc trùng nội dung sẽ bị bỏ qua (không ghi đè).
 * Mã để trống -> tự sinh theo ngày. Trả về { purchases, sales, costs }.
 */
async function importExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const db = getDb();
  const count = { purchases: 0, sales: 0, costs: 0, skippedNoCustomer: 0 };
  const str = (v) => String(v ?? '').trim();
  const deleted = (v) => (/XÓA/.test(str(v)) ? 1 : 0);

  /** Chèn 1 dòng nếu chưa tồn tại (theo mã hoặc theo nội dung). vals[0] luôn là ngày. */
  const insertRow = (table, c, dupSql, dupArgs, cols, vals) => {
    const id = str(c[0]);
    const exists = id ? db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) : db.prepare(dupSql).get(...dupArgs);
    if (exists) return;
    const newId = id || S.nextCode(table, vals[0]);
    db.prepare(`INSERT INTO ${table} (id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`).run(newId, ...vals);
    count[table]++;
  };

  tx(() => {
    // DU_LIEU: Mã | Ngày | Tên | Địa chỉ | CCCD | SĐT | Hàng | SL | Giá | Tổng | TT | Ghi chú | Trạng thái
    const sheet = wb.getWorksheet('DU_LIEU') || wb.worksheets[0];
        // Để trống Họ tên + có CCCD -> tự lấy tên/địa chỉ/SĐT từ danh mục Khách hàng; không có sẵn thì bỏ qua dòng.
    const custByCccd = {};
    for (const k of db.prepare("SELECT name, phone, cccd, addr FROM customers WHERE deleted = 0 AND cccd <> ''").all()) custByCccd[k.cccd] = k;
    for (const c of readRows(sheet)) {
      const date = toIsoDate(c[1]), item = str(c[6]), qty = Number(c[7]), price = Number(c[8]) || 0;
      if (!date || !item || !(qty > 0)) continue;
      let cccd = str(c[4]).replace(/\s/g, '');
      if (/^\d{11}$/.test(cccd)) cccd = '0' + cccd;   // Excel hay làm mất số 0 đầu
      c[4] = cccd;
      if (!str(c[2])) {
        const k = custByCccd[cccd];
        if (!k) { count.skippedNoCustomer++; continue; }
        c[2] = k.name;
        if (!str(c[3])) c[3] = k.addr;
        if (!str(c[5])) c[5] = k.phone;
      }
      insertRow('purchases', c,
        'SELECT 1 FROM purchases WHERE date=? AND name=? AND item=? AND qty=? AND price=?', [date, str(c[2]), item, qty, price],
        ['date', 'name', 'addr', 'cccd', 'phone', 'item', 'qty', 'price', 'pay', 'note', 'deleted'],
        [date, str(c[2]), str(c[3]), str(c[4]), str(c[5]), item, qty, price, str(c[10]), str(c[11]), deleted(c[12])]);
    }
    // BAN_HANG: Mã | Ngày | Hàng | SL | Giá | Doanh thu | Ghi chú | Trạng thái
    for (const c of readRows(wb.getWorksheet('BAN_HANG'))) {
      const date = toIsoDate(c[1]), item = str(c[2]), qty = Number(c[3]), price = Number(c[4]) || 0;
      if (!date || !item || !(qty > 0)) continue;
      insertRow('sales', c, 'SELECT 1 FROM sales WHERE date=? AND item=? AND qty=? AND price=?', [date, item, qty, price],
        ['date', 'item', 'qty', 'price', 'note', 'deleted'], [date, item, qty, price, str(c[6]), deleted(c[7])]);
    }
    // CHI_PHI: Mã | Ngày | Hàng | Loại | Số tiền | Ghi chú | Trạng thái
    for (const c of readRows(wb.getWorksheet('CHI_PHI'))) {
      const date = toIsoDate(c[1]), item = str(c[2]), amount = Number(c[4]);
      if (!date || !(amount > 0)) continue;
      insertRow('costs', c, 'SELECT 1 FROM costs WHERE date=? AND item=? AND type=? AND amount=?', [date, item, str(c[3]), amount],
        ['date', 'item', 'type', 'amount', 'note', 'deleted'], [date, item, str(c[3]), amount, str(c[5]), deleted(c[6])]);
    }
    // KHACH_HANG: Mã KH | Họ và tên | SĐT | CCCD | Địa chỉ | Ghi chú | Trạng thái
    for (const c of readRows(wb.getWorksheet('KHACH_HANG'))) {
      const name = str(c[1]);
      if (!name) continue;
      const id = str(c[0]);
      const exists = id
        ? db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)
        : db.prepare('SELECT 1 FROM customers WHERE LOWER(name) = LOWER(?)').get(name);
      if (exists) continue;
      const newId = id || S.api.previewCode('customer');
      db.prepare('INSERT INTO customers (id, name, phone, cccd, addr, note, deleted) VALUES (?,?,?,?,?,?,?)')
        .run(newId, name, str(c[2]), str(c[3]), str(c[4]), str(c[5]), deleted(c[6]));
      count.customers = (count.customers || 0) + 1;
    }
    const n = count.purchases + count.sales + count.costs + (count.customers || 0);
    if (n) S.log('—', 'NHẬP EXCEL', `Thêm ${n} dòng từ ${filePath}`);
  });
  return count;
}
/* ======================= NHẬP KHÁCH HÀNG TỪ EXCEL ======================= */

/** Bỏ dấu + chữ thường để so khớp tiêu đề cột. */
const noAccent = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

/** Xuất file mẫu để nhập khách hàng. */
async function exportCustomerTemplate(filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('KHACH_HANG');
  ws.addRow(['Họ và tên', 'Số điện thoại', 'Số CCCD', 'Địa chỉ', 'Ghi chú']).font = { bold: true };
  ws.addRow(['Nguyễn Văn A', '0912345678', '012345678901', 'Thôn 1, Xã Ea Kiết, Đắk Lắk', 'Ví dụ - xóa dòng này']);
  ws.columns.forEach((c) => (c.width = 24));
  [2, 3].forEach((i) => (ws.getColumn(i).numFmt = '@'));
  await wb.xlsx.writeFile(filePath);
}

/**
 * Nhập danh sách khách hàng từ Excel (dòng 1 là tiêu đề).
 * Trả về { added, skipped, errors: ['Dòng 5: ...'] }.
 */
async function importCustomersExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet('KHACH_HANG') || wb.worksheets[0];
  if (!ws) throw new Error('File Excel không có sheet nào.');
  const db = getDb();
  const str = (v) => String(cellValue(v) ?? '').trim();

  const head = Array.from({ length: 10 }, (_, k) => noAccent(cellValue(ws.getRow(1).getCell(k + 1).value)));
  const off = /^ma/.test(head[0]) ? 1 : 0;
  const find = (re, def) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : def; };
  const col = {
    name: find(/ho.*ten|^ten/, off),
    phone: find(/dien thoai|sdt|phone/, off + 1),
    cccd: find(/cccd|cmnd|can cuoc/, off + 2),
    addr: find(/dia chi/, off + 3),
    note: find(/ghi chu/, off + 4),
  };

  const existing = db.prepare('SELECT name, phone, cccd FROM customers WHERE deleted = 0').all();
  const hasKey = new Set(existing.map((c) => `${c.name.toLowerCase()}|${c.phone}`));
  const hasCccd = new Set(existing.filter((c) => c.cccd).map((c) => c.cccd));

  const result = { added: 0, skipped: 0, errors: [] };
  const rows = [];
  ws.eachRow((row, i) => { if (i > 1) rows.push({ i, row }); });

  for (const { i, row } of rows) {
    const g = (k) => str(row.getCell(col[k] + 1).value);
    const name = g('name');
    if (!name) continue;

    let phone = g('phone').replace(/[\s.]/g, '');
    if (/^[1-9]\d{8}$/.test(phone)) phone = '0' + phone;
    let cccd = g('cccd').replace(/\s/g, '');
    if (/^\d{11}$/.test(cccd)) cccd = '0' + cccd;

    const key = `${name.toLowerCase()}|${phone}`;
    if ((cccd && hasCccd.has(cccd)) || (!cccd && hasKey.has(key))) { result.skipped++; continue; }

    try {
      S.api.saveCustomer({ name, phone, cccd, addr: g('addr'), note: g('note') });
      hasKey.add(key);
      if (cccd) hasCccd.add(cccd);
      result.added++;
    } catch (e) {
      result.errors.push(`Dòng ${i}: ${e.message}`);
    }
  }
  if (result.added) S.log('KH', 'NHẬP KH EXCEL', `Thêm ${result.added} khách hàng từ ${filePath}`);
  return result;
}
module.exports = { exportExcel, importExcel, moneyToWords, importCustomersExcel, exportCustomerTemplate };