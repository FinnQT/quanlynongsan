/**
 * renderer.js - Logic giao diện. Mọi dữ liệu lấy qua `api('tenHam', ...)` (xem services.js).
 * Gồm:
 *  - Bộ chọn ngày (Date Picker) Tiếng Việt hoàn toàn (chọn lịch tháng popup, khóa nhập bàn phím).
 *  - Bộ lọc nhập số (chặn nhập chữ, tự định dạng dấu phẩy hàng nghìn cho tiền tệ).
 *  - Combobox chọn/tìm kiếm Khách hàng trực tiếp theo chữ cái trong form Thu mua.
 */
const { api, exportExcel, importExcel, backupDb, restoreDb } = window.bridge;

/* ---------- tiện ích ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
const fmt = (n) => num(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money = (n) => Math.round(num(n)).toLocaleString('en-US');
const moneyTag = (n, kind = '') => `<span class="amt ${kind}">${money(n)} đ</span>`;
const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const options = (list, first = '') => (first ? `<option value="">${first}</option>` : '') + list.map((x) => `<option>${esc(x)}</option>`).join('');
const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;
const payPill = (p) => (p ? `<span class="pill ${p.toLowerCase()}">${p}</span>` : '<span class="pill none">⏳ Chưa TT</span>');
const cleanMsg = (e) => e.message.replace(/^Error invoking remote method '\w+': Error: /, '');
const normVi = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

/* ---------- 5. Chặn nhập chữ cho các ô số & tự định dạng tiền ---------- */
function sanitizeNumeric(raw, mode) {
  if (mode === 'digits') return raw.replace(/\D/g, '');
  if (mode === 'money') {
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
  }
  // mode === 'dec': chỉ cho phép số và tối đa 1 dấu chấm thập phân (đổi dấu phẩy thành chấm)
  const norm = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const [intPart = '', ...rest] = norm.split('.');
  return rest.length ? `${intPart}.${rest.join('')}` : intPart;
}

function initNumericInputs() {
  const valDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const ALLOWED_KEYS = new Set(['Backspace', 'Delete', 'Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

  $$('input[data-num]').forEach((el) => {
    const mode = el.dataset.num; // 'digits' | 'money' | 'dec'

    // Khi đọc/ghi el.value từ code: trả về số sạch (không dấu phẩy) và hiển thị có định dạng
    if (mode === 'money') {
      Object.defineProperty(el, 'value', {
        get() { return valDesc.get.call(el).replace(/,/g, ''); },
        set(v) { valDesc.set.call(el, sanitizeNumeric(String(v ?? ''), 'money')); },
      });
    }

    // Chặn ngay phím chữ trước khi ký tự xuất hiện trong ô
    el.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ALLOWED_KEYS.has(e.key)) return;
      if (/^\d$/.test(e.key)) return;
      if (mode === 'dec' && (e.key === '.' || e.key === ',') && !valDesc.get.call(el).includes('.')) return;
      e.preventDefault();
    });

    // Làm sạch khi gõ hoặc dán (paste)
    el.addEventListener('input', () => {
      const raw = valDesc.get.call(el);
      const formatted = sanitizeNumeric(raw, mode);
      if (raw !== formatted) valDesc.set.call(el, formatted);
    });
  });
}

/* ---------- 2. Component Date Picker Tiếng Việt duy nhất (chỉ chọn lịch, không nhập bàn phím) ---------- */
function initVietnameseDatePickers() {
  const valDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
  const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  const cal = document.createElement('div');
  cal.className = 'vn-cal hide';
  cal.setAttribute('popover', 'manual');
  document.body.append(cal);
  let state = null;

  const isOpen = () => !cal.classList.contains('hide');
  const closeCal = () => {
    cal.classList.add('hide');
    if (cal.matches(':popover-open')) cal.hidePopover();
    state = null;
  };
  const pad = (n) => String(n).padStart(2, '0');

  function drawCal() {
    const { y, m, el } = state;
    const sel = valDesc.get.call(el), td = today();
    const firstOffset = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let html = `<div class="ch">
      <button type="button" class="nav-b" data-n="-1" title="Tháng trước">‹</button>
      <b>${MONTHS[m]} năm ${y}</b>
      <button type="button" class="nav-b" data-n="1" title="Tháng sau">›</button>
    </div><div class="g7">${WEEKDAYS.map((w) => `<div class="wd">${w}</div>`).join('')}`;
    for (let i = 0; i < firstOffset; i++) html += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
      html += `<button type="button" class="dd${iso === sel ? ' on' : ''}${iso === td ? ' td' : ''}" data-d="${iso}">${d}</button>`;
    }
    html += `</div><div class="ft">
      <button type="button" data-a="today">Hôm nay</button>
      <button type="button" data-a="clear">Xóa ngày</button>
    </div>`;
    cal.innerHTML = html;
  }

  function openCal(el, wrap, applyIso) {
    if (state && state.el === el && isOpen()) return closeCal();
    if (cal.matches(':popover-open')) cal.hidePopover();
    const host = wrap.closest('dialog') || document.body;
    if (cal.parentNode !== host) host.append(cal);

    const curIso = valDesc.get.call(el) || today();
    const [y, m] = curIso.split('-').map(Number);
    state = { el, wrap, y, m: m - 1, applyIso };
    drawCal();
    cal.classList.remove('hide');
    cal.showPopover();

    const r = wrap.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = Math.min(r.left, innerWidth - 308);
    if (top + 330 > innerHeight && r.top > 340) top = r.top - 334;
    cal.style.top = Math.max(8, top) + 'px';
    cal.style.left = Math.max(8, left) + 'px';
  }

  cal.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button');
    if (!b || !state) return;
    if (b.dataset.n) {
      state.m += Number(b.dataset.n);
      if (state.m < 0) { state.m = 11; state.y--; }
      if (state.m > 11) { state.m = 0; state.y++; }
      drawCal();
    } else if (b.dataset.d) { const fn = state.applyIso; closeCal(); fn(b.dataset.d); }
    else if (b.dataset.a === 'today') { const fn = state.applyIso; closeCal(); fn(today()); }
    else if (b.dataset.a === 'clear') { const fn = state.applyIso; closeCal(); fn(''); }
  });

  document.addEventListener('mousedown', (e) => {
    if (state && !cal.contains(e.target) && !state.wrap.contains(e.target)) closeCal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); closeCal(); }
  });
  window.addEventListener('resize', closeCal);
  $$('dialog').forEach((d) => d.addEventListener('close', closeCal));

  $$('input[type="date"]').forEach((el) => {
    const id = el.id;
    const wrap = document.createElement('div');
    wrap.className = 'dp-wrap';

    const txt = document.createElement('input');
    txt.type = 'text';
    txt.className = 'dp-text';
    txt.readOnly = true;
    txt.placeholder = 'Chọn ngày (dd/mm/yyyy)';
    txt.autocomplete = 'off';

    const lbl = id && document.querySelector(`label[for="${id}"]`);
    if (lbl) lbl.setAttribute('for', id + '-txt');
    txt.id = id + '-txt';

    const btn = document.createElement('span');
    btn.className = 'dp-btn';
    btn.textContent = '📅';
    btn.setAttribute('aria-hidden', 'true');

    el.parentNode.insertBefore(wrap, el);
    wrap.append(txt, btn, el);
    el.type = 'hidden';

    Object.defineProperty(el, 'value', {
      get() { return valDesc.get.call(el); },
      set(v) {
        valDesc.set.call(el, v || '');
        txt.value = v ? dmy(v) : '';
      },
    });

    const applyIso = (iso) => {
      valDesc.set.call(el, iso);
      txt.value = iso ? dmy(iso) : '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    wrap.addEventListener('click', (e) => {
      e.preventDefault();
      openCal(el, wrap, applyIso);
    });

    txt.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') return;
      e.preventDefault();
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) openCal(el, wrap, applyIso);
      else if (['Backspace', 'Delete'].includes(e.key)) { closeCal(); applyIso(''); }
    });
  });
}

/* ---------- thông báo & hộp xác nhận ---------- */
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = isError ? 'err' : '';
  if (!t.matches(':popover-open')) t.showPopover();
  clearTimeout(t._h); t._h = setTimeout(() => t.hidePopover(), 3500);
}

async function guard(fn) { try { return await fn(); } catch (e) { toast(cleanMsg(e), true); } }

async function inDialog(dlg, fn) {
  const box = $(`#${dlg} .form-err`);
  box.hidden = true;
  try { await fn(); } catch (e) { box.textContent = cleanMsg(e); box.hidden = false; }
}

function confirmBox(title, text, okLabel = 'Xác nhận') {
  const d = $('#dlg-confirm');
  $('#cf-t').textContent = title; $('#cf-p').textContent = text; $('#dlg-confirm [value=ok]').textContent = okLabel;
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => {
    const ok = d.returnValue === 'ok';
    d.returnValue = '';
    resolve(ok);
  }, { once: true }));
}

/* ---------- điều hướng ---------- */
const VIEWS = ['dash', 'list', 'cust', 'sales', 'cost', 'stock', 'excel', 'trash', 'hist', 'settings'];
const loaders = {};
let current = 'dash';

async function show(v) {
  current = v;
  VIEWS.forEach((k) => $('#v-' + k).classList.toggle('hide', k !== v));
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  scrollTo(0, 0);
  await guard(() => loaders[v]?.());
}
const refresh = () => guard(() => loaders[current]?.());

/* ---------- HỘP THOẠI THU MUA & COMBOBOX KHÁCH HÀNG ---------- */
const ITEMS = ['Cà phê nhân', 'Cà phê tươi', 'Tiêu đen', 'Tiêu lép', 'Hạt điều'];
const DEFAULT_ADDR = 'Ea Kiết';
const FIELDS = ['date', 'name', 'addr', 'cccd', 'phone', 'qty', 'price', 'pay', 'note'];
let editId = null, editSaleId = null, editCostId = null, editCustId = null;
let custList = [], custCache = {}, ddIdx = -1;

$('#f-item').innerHTML = options([...ITEMS, 'Khác']);
const fv = (k) => $('#f-' + k).value.trim();

async function updatePreviewId(kind, dateInputId, idInputId, curId) {
  const date = dateInputId ? $('#' + dateInputId).value : '';
  $('#' + idInputId).value = (kind === 'customer' || date) ? await api('previewCode', kind, date, curId) : '';
}

async function loadCustomerCache() {
  custList = await api('listCustomers', {});
  custCache = Object.fromEntries(custList.map((c) => [c.id, c]));
}

function updatePurchaseCccdBtn() {
  const cccd = fv('cccd'), name = fv('name').toLowerCase();
  const mc = custList.find((c) => (cccd && c.cccd === cccd) || (name && c.name.toLowerCase() === name));
  const btn = $('#f-view-cccd');
  if (mc && mc.hasCccdImg) {
    btn.hidden = false;
    btn.dataset.cid = mc.id;
  } else {
    btn.hidden = true;
    btn.dataset.cid = '';
  }
}

$('#f-view-cccd').onclick = () => {
  const cid = $('#f-view-cccd').dataset.cid;
  if (cid) guard(() => openCccdPreview(cid));
};

function applyCustomerToPurchase(c) {
  if (!c) return;
  $('#f-name').value = c.name || '';
  $('#f-cccd').value = c.cccd || '';
  $('#f-phone').value = c.phone || '';
  $('#f-addr').value = c.addr || DEFAULT_ADDR;
  closeCustDropdown();
  updatePurchaseCccdBtn();
}

function closeCustDropdown() {
  $('#cust-dd').classList.add('hide');
  ddIdx = -1;
}

function renderCustDropdown(filterText = '') {
  const dd = $('#cust-dd');
  const q = normVi(filterText);
  const filtered = q
    ? custList.filter((c) => normVi(`${c.name} ${c.phone} ${c.cccd} ${c.id} ${c.addr}`).includes(q))
    : custList;

  ddIdx = filtered.length ? 0 : -1;
  const listHtml = filtered.length
    ? filtered.map((c, i) => {
        const sub = [c.phone && `ĐT: ${esc(c.phone)}`, c.cccd && `CCCD: ${esc(c.cccd)}`, c.hasCccdImg && '🪪 Có ảnh CCCD', esc(c.addr)].filter(Boolean).join(' · ') || 'Chưa có SĐT / CCCD';
        return `<div class="cust-opt${i === 0 ? ' act' : ''}" data-cid="${esc(c.id)}">
          <div class="co-main"><b>${esc(c.name)}</b><span class="co-id">${esc(c.id)}</span></div>
          <div class="co-sub">${sub}</div>
        </div>`;
      }).join('')
    : `<div class="cust-empty">Không tìm thấy khách hàng "${esc(filterText.trim())}" trong danh bạ.</div>`;

  const addLabel = filterText.trim() ? `＋ Thêm khách hàng mới "${esc(filterText.trim())}"` : '＋ Thêm khách hàng mới...';
  dd.innerHTML = `${listHtml}<div class="cust-add-item" data-add-cust="1">${addLabel}</div>`;
  dd.classList.remove('hide');
}

// Sự kiện trên ô tìm/chọn khách hàng (#f-name)
$('#f-name').addEventListener('focus', () => renderCustDropdown(''));
$('#f-name').addEventListener('click', () => renderCustDropdown($('#f-name').value));
$('#f-name').addEventListener('input', () => { renderCustDropdown($('#f-name').value); updatePurchaseCccdBtn(); });
$('#f-cccd').addEventListener('input', updatePurchaseCccdBtn);

$('#cust-caret').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!$('#cust-dd').classList.contains('hide')) closeCustDropdown();
  else { $('#f-name').focus(); renderCustDropdown(''); }
});

$('#f-name').addEventListener('keydown', (e) => {
  const dd = $('#cust-dd');
  const opts = [...dd.querySelectorAll('.cust-opt')];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (dd.classList.contains('hide')) return renderCustDropdown($('#f-name').value);
    if (opts.length) {
      ddIdx = (ddIdx + 1) % opts.length;
      opts.forEach((el, i) => el.classList.toggle('act', i === ddIdx));
      opts[ddIdx]?.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (opts.length) {
      ddIdx = (ddIdx - 1 + opts.length) % opts.length;
      opts.forEach((el, i) => el.classList.toggle('act', i === ddIdx));
      opts[ddIdx]?.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'Enter' && !dd.classList.contains('hide')) {
    e.preventDefault();
    if (opts[ddIdx]) {
      applyCustomerToPurchase(custCache[opts[ddIdx].dataset.cid]);
      $('#f-qty').focus();
    } else {
      closeCustDropdown();
      openAddCustomerFromPurchase();
    }
  } else if (e.key === 'Escape' && !dd.classList.contains('hide')) {
    e.stopPropagation();
    closeCustDropdown();
  }
});

$('#cust-dd').addEventListener('mousedown', (e) => {
  // Dùng mousedown để chọn ngay trước khi input bị blur
  e.preventDefault();
  const opt = e.target.closest('.cust-opt');
  if (opt) {
    applyCustomerToPurchase(custCache[opt.dataset.cid]);
    $('#f-qty').focus();
    return;
  }
  if (e.target.closest('[data-add-cust]')) {
    closeCustDropdown();
    openAddCustomerFromPurchase();
  }
});

document.addEventListener('mousedown', (e) => {
  if (!$('#cust-combo').contains(e.target)) closeCustDropdown();
});

function openAddCustomerFromPurchase() {
  guard(() => openCustomer(null, {
    name: fv('name'),
    phone: fv('phone'),
    cccd: fv('cccd'),
    addr: fv('addr') || DEFAULT_ADDR,
  }));
}
$('#f-add-cust').onclick = openAddCustomerFromPurchase;

function calcTotal() {
  const tot = Math.round(num(fv('qty')) * num(fv('price')));
  $('#f-total').textContent = money(tot) + ' đ';
  $('#oth').classList.toggle('hide', $('#f-item').value !== 'Khác');
  if (!editId && tot >= 5e6 && !$('#f-pay').value) $('#f-pay').value = 'CK';
}
['qty', 'price', 'item'].forEach((k) => ($('#f-' + k).addEventListener('input', calcTotal)));
$('#f-date').addEventListener('input', () => updatePreviewId('purchase', 'f-date', 'f-id', editId));

function fillForm(r) {
  FIELDS.forEach((k) => ($('#f-' + k).value = r[k] ?? ''));
  const known = ITEMS.includes(r.item);
  $('#f-item').value = known ? r.item : 'Khác';
  $('#f-other').value = known ? '' : r.item;
  $('#f-id').value = r.id || '';
  closeCustDropdown();
  updatePurchaseCccdBtn();
  calcTotal();
}

async function resetForm(keep) {
  const kept = { date: fv('date'), price: fv('price'), pay: fv('pay'), item: $('#f-item').value, other: fv('other') };
  fillForm({ date: today(), addr: DEFAULT_ADDR, item: ITEMS[0] });
  if (keep) {
    $('#f-date').value = kept.date; $('#f-price').value = kept.price; $('#f-pay').value = kept.pay;
    $('#f-item').value = kept.item; $('#f-other').value = kept.other; calcTotal();
  }
  await updatePreviewId('purchase', 'f-date', 'f-id', null);
  $('#f-name').focus();
}

async function openPurchase(id = null) {
  editId = id;
  await loadCustomerCache();
  $('#dlg-purchase .form-err').hidden = true;
  $('#dp-title').textContent = id ? `Sửa giao dịch ${id}` : 'Thu mua mới';
  $('#b-save').textContent = id ? 'Lưu thay đổi' : 'Lưu giao dịch';
  $('#b-save-next').hidden = !!id;
  if (id) fillForm(await api('getPurchase', id)); else await resetForm(false);
  $('#dlg-purchase').showModal();
  closeCustDropdown();
}

async function printPurchase(id) {
  const [r, cfg] = await Promise.all([api('getPurchase', id), api('getSettings')]);
  if (!r) return;
  const tot = Math.round(r.qty * r.price);
  const pa = $('#print-area');
  pa.classList.remove('bk-mode');
  pa.innerHTML = `
    <div><b>${esc(cfg.name)}</b><br><small>MST: ${esc(cfg.mst)} · ĐT: ${esc(cfg.tel)}<br>Đ/c: ${esc(cfg.addr)}</small></div>
    <h2>PHIẾU THU MUA NÔNG SẢN</h2>
    <p class="p-sub">Mã phiếu: <b>${esc(r.id)}</b> — Ngày: <b>${dmy(r.date)}</b></p>
    <p>Họ tên người bán: <b>${esc(r.name)}</b> ${r.phone ? `· SĐT: <b>${esc(r.phone)}</b>` : ''} ${r.cccd ? `· CCCD: <b>${esc(r.cccd)}</b>` : ''}<br>
    Địa chỉ: ${esc(r.addr || '—')} · Thanh toán: <b>${r.pay || 'Chưa thanh toán (Công nợ)'}</b></p>
    <table>
      <thead><tr><th>Tên hàng hóa</th><th class="r">Số lượng (kg)</th><th class="r">Đơn giá (đ/kg)</th><th class="r">Thành tiền (đ)</th></tr></thead>
      <tbody><tr><td><b>${esc(r.item)}</b></td><td class="r">${fmt(r.qty)}</td><td class="r">${money(r.price)}</td><td class="r"><b>${money(tot)} đ</b></td></tr></tbody>
    </table>
    ${r.note ? `<p>Ghi chú: ${esc(r.note)}</p>` : ''}
    <div class="p-sign"><div><b>Người bán hàng</b><br><small>(Ký, ghi rõ họ tên)</small><br><br><br>${esc(r.name)}</div>
    <div><b>Đại diện thu mua</b><br><small>(Ký, ghi rõ họ tên)</small></div></div>`;
  window.print();
}

function savePurchase(andNext, andPrint = false) {
  return inDialog('dlg-purchase', async () => {
    const p = { id: editId };
    FIELDS.forEach((k) => (p[k] = fv(k)));
    p.item = $('#f-item').value === 'Khác' ? fv('other') : $('#f-item').value;
    const id = await api('savePurchase', p);
    toast(`Đã lưu ${id}`);
    if (andNext) await resetForm(true); else $('#dlg-purchase').close();
    await refresh();
    if (andPrint) await printPurchase(id);
  });
}
$('#b-save').onclick = () => savePurchase(false, false);
$('#b-save-next').onclick = () => savePurchase(true, false);
$('#b-save-print').onclick = () => savePurchase(false, true);

/* ---------- TRANG THU MUA: danh sách + đối soát ---------- */
loaders.list = async () => {
  const f = { q: $('#q').value, from: $('#q-from').value, to: $('#q-to').value, pay: $('#q-pay').value, item: $('#q-item').value, bad: $('#q-bad').checked };
  const { rows, badCount, items } = await api('listPurchases', f);
  const cur = $('#q-item').value, all = [...new Set([...ITEMS, ...items])];
  if ($('#q-item').dataset.n !== String(all.length)) { $('#q-item').innerHTML = options(all, 'Tất cả loại hàng'); $('#q-item').value = cur; $('#q-item').dataset.n = all.length; }

  const sumQty = rows.reduce((s, r) => s + r.qty, 0);
  const sumAmt = rows.reduce((s, r) => s + r.total, 0);
  const unpaidAmt = rows.filter((r) => !r.pay).reduce((s, r) => s + r.total, 0);
  $('#sum').textContent = `${rows.length} giao dịch · ${fmt(sumQty)} kg · Tổng ${money(sumAmt)} đ${unpaidAmt ? ` · Chưa TT: ${money(unpaidAmt)} đ` : ''} · ${badCount} cần kiểm tra`;
  $('#tb').innerHTML = rows.map((r) => {
    const eyeBtn = r.hasCccdImg ? `<button type="button" class="eye-pill" data-act="view-cccd" data-id="${r.custId}" title="Xem hình CCCD của ${esc(r.name)}">👁️ CCCD</button>` : '';
    const actEye = r.hasCccdImg ? `<button class="icon-btn" data-act="view-cccd" data-id="${r.custId}" title="Xem hình CCCD" aria-label="Xem CCCD ${esc(r.name)}">👁️</button>` : '';
    return `<tr>
    <td class="nowrap"><b>${r.id}</b></td>
    <td class="nowrap">${dmy(r.date)}</td>
    <td><b>${esc(r.name)}</b>${r.cccd ? `<small class="mut"> · CCCD: ${esc(r.cccd)}</small>` : ''}${eyeBtn}${r.addr ? `<div class="mut">${esc(r.addr)}</div>` : ''}${r.warnings.length ? `<span class="warn">⚠ ${esc(r.warnings.join('; '))}</span>` : ''}</td>
    <td>${esc(r.item)}</td>
    <td class="r"><span class="qty">${fmt(r.qty)}</span></td>
    <td class="r"><span class="unit-price">${money(r.price)} đ</span></td>
    <td class="r">${moneyTag(r.total, 'out')}</td>
    <td class="c">${payPill(r.pay)}</td>
    <td class="c nowrap">${actEye}<button class="icon-btn" data-act="print-purchase" data-id="${r.id}" title="In phiếu" aria-label="In phiếu ${r.id}">🖨️</button><button class="icon-btn" data-act="edit-purchase" data-id="${r.id}" title="Sửa" aria-label="Sửa ${r.id}">✏️</button><button class="icon-btn d" data-act="del" data-kind="purchase" data-id="${r.id}" title="Xóa" aria-label="Xóa ${r.id}">🗑️</button></td>
  </tr>`;
  }).join('') || emptyRow(9, 'Chưa có giao dịch nào. Bấm “＋ Thu mua mới” để bắt đầu.');
  $('#tf').innerHTML = rows.length ? `<tr><th colspan="4">TỔNG CỘNG (${rows.length} giao dịch)</th><th class="r">${fmt(sumQty)} kg</th><th></th><th class="r">${moneyTag(sumAmt, 'out')}</th><th colspan="2"></th></tr>` : '';
};
['q', 'q-from', 'q-to', 'q-pay', 'q-item', 'q-bad'].forEach((id) => ($('#' + id).addEventListener('input', () => guard(loaders.list))));

/* ---------- QUẢN LÝ KHÁCH HÀNG & HÌNH CCCD (Thêm, Sửa, Xem Preview lớn, Đồng bộ) ---------- */
let custFrontData = '', custBackData = '', viewingCustId = null;

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được file ảnh.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Định dạng ảnh không hợp lệ.'));
      img.onload = () => {
        const maxDim = 1600;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderCustImgSlots() {
  const setSlot = (side, data, label) => {
    const box = $(`#k-${side}-box`);
    $(`#k-${side}-view`).hidden = !data;
    $(`#k-${side}-del`).hidden = !data;
    box.innerHTML = data
      ? `<img src="${data}" alt="${label}" data-preview-side="${side}" title="Click để phóng to ảnh ${label}">`
      : `<span class="mut">Chưa có ảnh ${label} (Bấm “📷 Chọn ảnh”)</span>`;
  };
  setSlot('front', custFrontData, 'mặt trước');
  setSlot('back', custBackData, 'mặt sau');
}

['front', 'back'].forEach((side) => {
  $(`#k-${side}-file`).addEventListener('change', (e) => guard(async () => {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await compressImageFile(f);
    if (side === 'front') custFrontData = dataUrl; else custBackData = dataUrl;
    renderCustImgSlots();
  }));
  $(`#k-${side}-del`).onclick = () => {
    if (side === 'front') custFrontData = ''; else custBackData = '';
    $(`#k-${side}-file`).value = '';
    renderCustImgSlots();
  };
  $(`#k-${side}-view`).onclick = () => openCccdPreview(null, {
    id: $('#k-id').value || 'Mới',
    name: $('#k-name').value || 'Khách hàng',
    phone: $('#k-phone').value,
    cccd: $('#k-cccd').value,
    addr: $('#k-addr').value,
    cccd_front: custFrontData,
    cccd_back: custBackData,
  });
  $(`#k-${side}-box`).addEventListener('click', (e) => {
    if (e.target.closest('img')) $(`#k-${side}-view`).click();
  });
});

async function openCccdPreview(custId, rawObj = null) {
  const c = rawObj || (await api('getCustomer', custId));
  if (!c) return toast('Không tìm thấy thông tin khách hàng.', true);
  if (!c.cccd_front && !c.cccd_back) return toast(`Khách hàng ${c.name} chưa lưu ảnh CCCD nào.`, true);

  viewingCustId = rawObj ? null : c.id;
  $('#vcc-edit-cust').hidden = !!rawObj;
  $('#vcc-title').textContent = `🪪 Hình ảnh CCCD — ${c.name} (${c.id})`;
  $('#vcc-sub').textContent = `Số CCCD: ${c.cccd || 'Chưa nhập'} · SĐT: ${c.phone || '—'} · Địa chỉ: ${c.addr || '—'}`;

  const grid = $('#vcc-grid');
  const both = Boolean(c.cccd_front && c.cccd_back);
  grid.classList.toggle('single-col', !both);
  $('#vcc-toggle-layout').hidden = !both;
  $('#vcc-toggle-layout').textContent = '🔍 Phóng to 1 cột';

  const cardHtml = (title, src, key) => src ? `
    <div class="cccd-view-card">
      <div class="cccd-view-head">
        <b>${title}</b>
        <button type="button" class="btn s ghost" data-rot="${key}">🔄 Xoay 90°</button>
      </div>
      <div class="cccd-img-stage">
        <img id="vcc-img-${key}" src="${src}" data-deg="0" alt="${title}" title="Click vào ảnh để phóng to / thu nhỏ">
      </div>
    </div>` : '';

  grid.innerHTML = cardHtml('🪪 Mặt trước CCCD', c.cccd_front, 'f') + cardHtml('🪪 Mặt sau CCCD', c.cccd_back, 'b');
  $('#dlg-cccd').showModal();
}

$('#vcc-toggle-layout').onclick = () => {
  const grid = $('#vcc-grid');
  const single = grid.classList.toggle('single-col');
  $('#vcc-toggle-layout').textContent = single ? '🗗 Xem 2 mặt cạnh nhau' : '🔍 Phóng to 1 cột';
};

$('#vcc-grid').addEventListener('click', (e) => {
  const rotBtn = e.target.closest('[data-rot]');
  if (rotBtn) {
    const img = $(`#vcc-img-${rotBtn.dataset.rot}`);
    if (!img) return;
    const deg = (Number(img.dataset.deg || 0) + 90) % 360;
    img.dataset.deg = deg;
    img.style.transform = `rotate(${deg}deg)`;
    return;
  }
  if (e.target.closest('img') && !$('#vcc-toggle-layout').hidden) {
    $('#vcc-toggle-layout').click();
  }
});

$('#vcc-edit-cust').onclick = () => {
  const cid = viewingCustId;
  $('#dlg-cccd').close();
  if (cid) guard(() => openCustomer(cid));
};

async function openCustomer(id = null, prefill = null) {
  editCustId = id;
  $('#dlg-cust .form-err').hidden = true;
  $('#dk-title').textContent = id ? `Sửa khách hàng ${id}` : 'Thêm khách hàng mới';
  $('#k-save').textContent = id ? 'Lưu thay đổi' : 'Lưu khách hàng';
  $('#k-front-file').value = '';
  $('#k-back-file').value = '';
  if (id) {
    const c = await api('getCustomer', id);
    $('#k-id').value = c.id; $('#k-name').value = c.name; $('#k-phone').value = c.phone || '';
    $('#k-cccd').value = c.cccd || ''; $('#k-addr').value = c.addr || ''; $('#k-note').value = c.note || '';
    custFrontData = c.cccd_front || '';
    custBackData = c.cccd_back || '';
  } else {
    $('#k-name').value = prefill?.name || '';
    $('#k-phone').value = prefill?.phone || '';
    $('#k-cccd').value = prefill?.cccd || '';
    $('#k-addr').value = prefill?.addr || DEFAULT_ADDR;
    $('#k-note').value = '';
    custFrontData = '';
    custBackData = '';
    await updatePreviewId('customer', '', 'k-id', null);
  }
  renderCustImgSlots();
  $('#dlg-cust').showModal();
  $('#k-name').focus();
}

$('#k-save').onclick = () => inDialog('dlg-cust', async () => {
  const id = await api('saveCustomer', {
    id: editCustId,
    name: $('#k-name').value,
    phone: $('#k-phone').value,
    cccd: $('#k-cccd').value,
    addr: $('#k-addr').value,
    note: $('#k-note').value,
    cccd_front: custFrontData,
    cccd_back: custBackData,
  });
  $('#dlg-cust').close();
  toast('Đã lưu khách hàng ' + id);
  if ($('#dlg-purchase').open) {
    await loadCustomerCache();
    applyCustomerToPurchase(custCache[id]);
    $('#f-qty').focus();
  }
  refresh();
});

$('#k-sync').onclick = () => guard(async () => {
  const added = await api('syncCustomers');
  toast(added ? `Đã đồng bộ thêm ${added} khách hàng từ lịch sử thu mua.` : 'Tất cả người bán trong Thu mua đã có trong danh sách Khách hàng.');
  await loaders.cust();
});

loaders.cust = async () => {
  const rows = await api('listCustomers', { q: $('#kq').value });
  const sumQty = rows.reduce((s, c) => s + c.totalQty, 0);
  const sumAmt = rows.reduce((s, c) => s + c.totalAmt, 0);
  $('#k-sum').textContent = `${rows.length} khách hàng · Tổng mua: ${fmt(sumQty)} kg · ${money(sumAmt)} đ`;
  $('#k-table').innerHTML = rows.map((c) => {
    const eyePill = c.hasCccdImg ? `<button type="button" class="eye-pill" data-act="view-cccd" data-id="${c.id}" title="Xem hình CCCD của ${esc(c.name)}">👁️ Xem CCCD</button>` : '';
    const actEye = c.hasCccdImg ? `<button class="icon-btn" data-act="view-cccd" data-id="${c.id}" title="Xem hình CCCD" aria-label="Xem CCCD ${c.id}">👁️</button>` : '';
    return `<tr>
    <td class="nowrap"><b>${c.id}</b></td>
    <td><b>${esc(c.name)}</b></td>
    <td class="nowrap">${esc(c.phone || '—')}</td>
    <td class="nowrap">${esc(c.cccd || '—')}${eyePill}</td>
    <td>${esc(c.addr || '—')}</td>
    <td class="r"><span class="qty">${c.txCount} lần</span></td>
    <td class="r"><span class="qty">${fmt(c.totalQty)} kg</span></td>
    <td class="r">${moneyTag(c.totalAmt, 'out')}</td>
    <td>${esc(c.note)}</td>
    <td class="c nowrap">${actEye}<button class="icon-btn" data-act="edit-cust" data-id="${c.id}" title="Sửa / Thêm ảnh CCCD" aria-label="Sửa ${c.id}">✏️</button><button class="icon-btn d" data-act="del" data-kind="customer" data-id="${c.id}" title="Xóa" aria-label="Xóa ${c.id}">🗑️</button></td>
  </tr>`;
  }).join('') || emptyRow(10, 'Chưa có khách hàng nào. Bấm “＋ Thêm khách hàng” hoặc “🔄 Đồng bộ từ Thu mua”.');
  $('#k-foot').innerHTML = rows.length ? `<tr><th colspan="5">TỔNG CỘNG (${rows.length} khách hàng)</th><th class="r">${rows.reduce((s, c) => s + c.txCount, 0)} lần</th><th class="r">${fmt(sumQty)} kg</th><th class="r">${moneyTag(sumAmt, 'out')}</th><th colspan="2"></th></tr>` : '';
};
$('#kq').addEventListener('input', () => guard(loaders.cust));

/* ---------- BÁN HÀNG (Thêm & Sửa) ---------- */
let stockCache = {};
async function refreshItemSelects() {
  const [items, stock] = await Promise.all([api('listItems'), api('stockReport')]);
  stockCache = Object.fromEntries(stock.map((z) => [z.item, z]));
  const list = items.length ? items : ITEMS;
  ['s-item', 'c-item'].forEach((id) => { const cur = $('#' + id).value; $('#' + id).innerHTML = options(list); if (list.includes(cur)) $('#' + id).value = cur; });
  ['sq-item', 'cq-item'].forEach((id) => {
    const el = $('#' + id);
    if (!el) return;
    const cur = el.value, all = [...new Set([...ITEMS, ...items])];
    if (el.dataset.n !== String(all.length)) { el.innerHTML = options(all, 'Tất cả loại hàng'); el.value = cur; el.dataset.n = all.length; }
  });
}

function calcRevenue() {
  const qty = num($('#s-qty').value), price = num($('#s-price').value), rev = Math.round(qty * price);
  $('#s-revenue').textContent = money(rev) + ' đ';
  const z = stockCache[$('#s-item').value];
  const avail = z ? z.qty : 0, avg = z ? z.avgCost : 0;
  const estProfit = qty > 0 && price > 0 ? ` · Lãi gộp ước tính: <b>${money(rev - qty * avg)} đ</b>` : '';
  $('#s-stock-info').innerHTML = `Tồn kho hiện có: <b>${fmt(avail)} kg</b> · Giá vốn TB: <b>${money(avg)} đ/kg</b>${estProfit}`;
  $('#s-fill-max').hidden = avail <= 0;
}
$('#s-qty').addEventListener('input', calcRevenue);
$('#s-price').addEventListener('input', calcRevenue);
$('#s-item').addEventListener('change', calcRevenue);
$('#s-fill-max').onclick = () => {
  const z = stockCache[$('#s-item').value];
  if (z && z.qty > 0) { $('#s-qty').value = Number(z.qty.toFixed(2)); calcRevenue(); $('#s-price').focus(); }
};
$('#s-date').addEventListener('input', () => updatePreviewId('sale', 's-date', 's-id', editSaleId));

async function openSale(id = null) {
  editSaleId = id;
  await refreshItemSelects();
  $('#dlg-sale .form-err').hidden = true;
  $('#ds-title').textContent = id ? `Sửa lần bán ${id}` : 'Ghi nhận bán hàng';
  $('#s-save').textContent = id ? 'Lưu thay đổi' : 'Lưu lần bán';
  if (id) {
    const r = await api('getSale', id);
    $('#s-id').value = r.id; $('#s-date').value = r.date; $('#s-item').value = r.item;
    $('#s-qty').value = r.qty; $('#s-price').value = r.price; $('#s-note').value = r.note || '';
  } else {
    $('#s-date').value = today();
    ['s-qty', 's-price', 's-note'].forEach((k) => ($('#' + k).value = ''));
    await updatePreviewId('sale', 's-date', 's-id', null);
  }
  calcRevenue();
  $('#dlg-sale').showModal();
  $('#s-qty').focus();
}

$('#s-save').onclick = () => inDialog('dlg-sale', async () => {
  const id = await api('saveSale', { id: editSaleId, date: $('#s-date').value, item: $('#s-item').value, qty: $('#s-qty').value, price: $('#s-price').value, note: $('#s-note').value.trim() });
  $('#dlg-sale').close(); toast('Đã lưu lần bán ' + id); refresh();
});

loaders.sales = async () => {
  await refreshItemSelects();
  const rows = await api('listSales', { from: $('#sq-from').value, to: $('#sq-to').value, item: $('#sq-item').value });
  const sumQty = rows.reduce((s, r) => s + r.qty, 0);
  const sumRev = rows.reduce((s, r) => s + r.revenue, 0);
  $('#s-table').innerHTML = rows.map((r) => `<tr>
    <td class="nowrap"><b>${r.id}</b></td>
    <td class="nowrap">${dmy(r.date)}</td>
    <td><b>${esc(r.item)}</b></td>
    <td class="r"><span class="qty">${fmt(r.qty)}</span></td>
    <td class="r"><span class="unit-price">${money(r.price)} đ</span></td>
    <td class="r">${moneyTag(r.revenue, 'in')}</td>
    <td>${esc(r.note)}</td>
    <td class="c nowrap"><button class="icon-btn" data-act="edit-sale" data-id="${r.id}" title="Sửa" aria-label="Sửa ${r.id}">✏️</button><button class="icon-btn d" data-act="del" data-kind="sale" data-id="${r.id}" title="Xóa" aria-label="Xóa ${r.id}">🗑️</button></td>
  </tr>`).join('') || emptyRow(8, 'Chưa có lần bán nào.');
  $('#s-foot').innerHTML = rows.length ? `<tr><th colspan="3">TỔNG CỘNG (${rows.length} lần bán)</th><th class="r">${fmt(sumQty)} kg</th><th></th><th class="r">${moneyTag(sumRev, 'in')}</th><th colspan="2"></th></tr>` : '';
};
['sq-from', 'sq-to', 'sq-item'].forEach((id) => ($('#' + id).addEventListener('input', () => guard(loaders.sales))));

/* ---------- CHI PHÍ (Thêm & Sửa) ---------- */
$('#c-date').addEventListener('input', () => updatePreviewId('cost', 'c-date', 'c-id', editCostId));

async function openCost(id = null) {
  editCostId = id;
  await refreshItemSelects();
  $('#dlg-cost .form-err').hidden = true;
  $('#dc-title').textContent = id ? `Sửa chi phí ${id}` : 'Thêm chi phí';
  $('#c-save').textContent = id ? 'Lưu thay đổi' : 'Lưu chi phí';
  if (id) {
    const r = await api('getCost', id);
    $('#c-id').value = r.id; $('#c-date').value = r.date; $('#c-item').value = r.item;
    $('#c-type').value = r.type; $('#c-amt').value = r.amount; $('#c-note').value = r.note || '';
  } else {
    $('#c-date').value = today(); $('#c-amt').value = ''; $('#c-note').value = '';
    await updatePreviewId('cost', 'c-date', 'c-id', null);
  }
  $('#dlg-cost').showModal();
  $('#c-amt').focus();
}

$('#c-save').onclick = () => inDialog('dlg-cost', async () => {
  const id = await api('saveCost', { id: editCostId, date: $('#c-date').value, item: $('#c-item').value, type: $('#c-type').value, amount: $('#c-amt').value, note: $('#c-note').value.trim() });
  $('#dlg-cost').close(); toast('Đã lưu chi phí ' + id); refresh();
});

loaders.cost = async () => {
  await refreshItemSelects();
  const rows = await api('listCosts', { from: $('#cq-from').value, to: $('#cq-to').value, item: $('#cq-item').value });
  $('#c-table').innerHTML = rows.map((r) => `<tr>
    <td class="nowrap"><b>${r.id}</b></td>
    <td class="nowrap">${dmy(r.date)}</td>
    <td><b>${esc(r.item)}</b></td>
    <td>${esc(r.type)}</td>
    <td class="r">${moneyTag(r.amount, 'out')}</td>
    <td>${esc(r.note)}</td>
    <td class="c nowrap"><button class="icon-btn" data-act="edit-cost" data-id="${r.id}" title="Sửa" aria-label="Sửa ${r.id}">✏️</button><button class="icon-btn d" data-act="del" data-kind="cost" data-id="${r.id}" title="Xóa" aria-label="Xóa ${r.id}">🗑️</button></td>
  </tr>`).join('') || emptyRow(7, 'Chưa có chi phí nào.');
  $('#c-foot').innerHTML = rows.length ? `<tr><th colspan="4">TỔNG CHI PHÍ</th><th class="r">${moneyTag(rows.reduce((s, r) => s + r.amount, 0), 'out')}</th><th colspan="2"></th></tr>` : '';
};
['cq-from', 'cq-to', 'cq-item'].forEach((id) => ($('#' + id).addEventListener('input', () => guard(loaders.cost))));

/* ---------- TỒN KHO & LỢI NHUẬN ---------- */
loaders.stock = async () => {
  const allRows = await api('stockReport');
  const sel = $('#st-item'), cur = sel.value, names = allRows.map((r) => r.item);
  sel.innerHTML = options(names, 'Tất cả loại hàng hóa');
  sel.value = names.includes(cur) ? cur : '';

  const rows = sel.value ? allRows.filter((r) => r.item === sel.value) : allRows;
  const cols = ['inQty', 'inCost', 'soldQty', 'qty', 'avgCost', 'cost', 'revenue', 'profit', 'expense', 'net'];
  const sum = (k) => rows.reduce((s, z) => s + z[k], 0);
  const cell = (k, z) => {
    if (['inQty', 'soldQty', 'qty'].includes(k)) return `<span class="qty">${fmt(z[k])}</span>`;
    if (k === 'net') return moneyTag(z[k], z[k] >= 0 ? 'in' : 'loss');
    if (k === 'revenue' || k === 'profit') return `<span class="amt" style="color:var(--money)">${money(z[k])} đ</span>`;
    if (k === 'expense') return `<span class="amt" style="color:var(--cost)">${money(z[k])} đ</span>`;
    return `<span class="amt">${money(z[k])} đ</span>`;
  };
  $('#stock-table').innerHTML = rows.map((z) => `<tr><td><b>${esc(z.item)}</b></td>${cols.map((k) => `<td class="r">${cell(k, z)}</td>`).join('')}</tr>`).join('') || emptyRow(11, 'Chưa có dữ liệu nhập hàng.');
  $('#stock-foot').innerHTML = rows.length ? `<tr><th>TỔNG CỘNG</th>${cols.map((k) => {
    if (k === 'avgCost') return '<th></th>';
    if (['inQty', 'soldQty', 'qty'].includes(k)) return `<th class="r">${fmt(sum(k))}</th>`;
    return `<th class="r">${money(sum(k))} đ</th>`;
  }).join('')}</tr>` : '';
  const over = allRows.filter((z) => z.oversold).map((z) => z.item);
  $('#stock-note').textContent = over.length ? `⚠ Bán vượt lượng tồn: ${over.join(', ')}. Hãy kiểm tra ngày nhập/bán.` : 'Lãi gộp = doanh thu − giá vốn hàng đã bán. Lợi nhuận sau chi phí = lãi gộp − chi phí.';
};
$('#st-item').addEventListener('change', () => guard(loaders.stock));

/* ---------- TỔNG QUAN ---------- */
loaders.dash = async () => {
  const [stock, { rows, badCount }] = await Promise.all([api('stockReport'), api('listPurchases', {})]);
  const sum = (k) => stock.reduce((s, z) => s + z[k], 0);
  const net = sum('net');
  $('#kpis').innerHTML = [
    ['Tổng hàng tồn kho', fmt(sum('qty')) + ' kg', ''],
    ['Giá trị tồn kho', money(sum('cost')) + ' đ', ''],
    ['Doanh thu đã bán', money(sum('revenue')) + ' đ', 'good'],
    ['Lợi nhuận sau chi phí', money(net) + ' đ', net >= 0 ? 'good' : 'bad'],
  ].map(([t, v, c]) => `<div class="kpi ${c}"><small>${t}</small><b>${v}</b></div>`).join('');
  $('#alert-box').innerHTML = badCount ? `<div class="alert"><span>⚠ Có ${badCount} giao dịch thu mua cần kiểm tra (thiếu thanh toán, trên 5 triệu chưa CK, trùng người bán...)</span><button class="btn s" data-bad>Xem ngay</button></div>` : '';
  $('#dash-stock').innerHTML = stock.map((z) => `<tr><td><b>${esc(z.item)}</b></td><td class="r"><span class="qty">${fmt(z.qty)}</span></td><td class="r"><span class="unit-price">${money(z.avgCost)} đ</span></td><td class="r"><span class="amt">${money(z.cost)} đ</span></td><td class="r">${moneyTag(z.net, z.net >= 0 ? 'in' : 'loss')}</td></tr>`).join('') || emptyRow(5, 'Chưa có dữ liệu.');
  $('#dash-recent').innerHTML = rows.slice(0, 6).map((r) => `<tr><td class="nowrap">${dmy(r.date)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.item)}</td><td class="r">${moneyTag(r.total, 'out')}</td></tr>`).join('') || emptyRow(4, 'Chưa có giao dịch.');
};

/* ---------- THÙNG RÁC & LỊCH SỬ ---------- */
loaders.trash = async () => {
  const rows = await api('listTrash');
  $('#tt').innerHTML = rows.map((r) => `<tr><td class="c"><input type="checkbox" class="tk" data-kind="${r.kind}" data-id="${r.id}" aria-label="Chọn ${r.id}"></td>
    <td><b>${r.label}</b></td><td class="nowrap">${r.id}</td><td class="nowrap">${dmy(r.date)}</td><td>${esc(r.text)}</td><td class="r">${moneyTag(r.amount)}</td>
    <td class="c nowrap"><button class="btn s ghost" data-act="restore" data-kind="${r.kind}" data-id="${r.id}">Khôi phục</button>
    <button class="btn s danger" data-act="purge" data-kind="${r.kind}" data-id="${r.id}">Xóa vĩnh viễn</button></td></tr>`).join('') || emptyRow(7, 'Thùng rác trống.');
  $('#tk-all').checked = false;
};

loaders.hist = async () => {
  const rows = await api('listHistory');
  $('#th').innerHTML = rows.map((h) => `<tr><td class="nowrap">${esc(h.time)}</td><td class="nowrap"><b>${esc(h.ref_id)}</b></td><td><b>${esc(h.action)}</b></td><td>${esc(h.detail)}</td></tr>`).join('') || emptyRow(4, 'Chưa có lịch sử.');
};

$('#tk-all').onclick = (e) => $$('#tt .tk').forEach((c) => (c.checked = e.target.checked));
$('#tk-del').onclick = () => guard(async () => {
  const list = $$('#tt .tk:checked').map((c) => ({ kind: c.dataset.kind, id: c.dataset.id }));
  if (!list.length) return toast('Chưa chọn mục nào.');
  if (await confirmBox('Xóa vĩnh viễn', `Xóa vĩnh viễn ${list.length} mục? Không thể khôi phục.`, 'Xóa vĩnh viễn')) { await api('purge', list); toast('Đã xóa vĩnh viễn.'); await loaders.trash(); }
});

/* ---------- EXCEL & IN TRỰC TIẾP BẢNG KÊ 02/TNDN ---------- */
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

loaders.excel = async () => {
  const { rows } = await api('listPurchases', { from: $('#x-from').value, to: $('#x-to').value });
  $('#x-info').textContent = `${rows.length} giao dịch trong khoảng ngày đã chọn (để trống = tất cả), tổng ${money(rows.reduce((s, r) => s + r.total, 0))} đ.`;
};
['x-from', 'x-to'].forEach((id) => ($('#' + id).addEventListener('input', () => guard(loaders.excel))));

$('#x-xlsx').onclick = () => guard(async () => {
  const res = await exportExcel($('#x-from').value, $('#x-to').value);
  if (res) toast(`Đã xuất ${res.rows} giao dịch: ${res.filePath}`);
});

$('#x-print').onclick = () => guard(async () => {
  const from = $('#x-from').value, to = $('#x-to').value;
  const [{ rows }, cfg] = await Promise.all([api('listPurchases', { from, to }), api('getSettings')]);
  if (!rows.length) return toast('Không có giao dịch nào trong khoảng ngày đã chọn để in.', true);

  // Sắp xếp tăng dần theo id (giống thứ tự trong file Excel xuất ra)
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const sumQty = sorted.reduce((s, w) => s + w.qty, 0);
  const sumAmt = sorted.reduce((s, w) => s + w.total, 0);
  const dateLabel = from && from === to
    ? `( Ngày ${dmy(from)} )`
    : `( Từ ngày ${dmy(from) || '……'} đến ngày ${dmy(to) || '……'} )`;
  const signDate = from && from === to
    ? `Ngày ${from.slice(8)} tháng ${from.slice(5, 7)} năm ${from.slice(0, 4)}`
    : 'Ngày ………. Tháng ………. Năm 20 …..';

  const pa = $('#print-area');
  pa.classList.add('bk-mode');
  pa.innerHTML = `
    <div class="bk-wrap">
      <div class="bk-top-right">
        <div>Mẫu số : 02/TNDN</div>
        <div>Ban hành kèm theo Thông tư số 20/2026/TT-BTC</div>
        <div>của Bộ trưởng Bộ Tài chính</div>
      </div>
      <h2 class="bk-title">BẢNG KÊ THU MUA HÀNG HÓA, DỊCH VỤ KHÔNG CÓ HOÁ ĐƠN</h2>
      <p class="bk-sub">${esc(dateLabel)}</p>
      <div class="bk-co">
        <div><b>Tên doanh nghiệp: ${esc(cfg.name)} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Mã Số Thuế: ${esc(cfg.mst)}</b></div>
        <div><b>Địa chỉ: ${esc(cfg.addr)}</b></div>
        <div><b>Số điện thoại: ${esc(cfg.tel)}</b></div>
        <div><b>Địa chỉ nơi tổ chức thu mua: ${esc(cfg.place)}</b></div>
      </div>
      <table class="bk-tbl">
        <colgroup>
          <col style="width:9.5%">
          <col style="width:13%">
          <col style="width:15%">
          <col style="width:11%">
          <col style="width:10%">
          <col style="width:11.5%">
          <col style="width:6.5%">
          <col style="width:7.5%">
          <col style="width:9%">
          <col style="width:7%">
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">Ngày tháng<br>năm mua<br>hàng</th>
            <th colspan="4">Người bán</th>
            <th colspan="4">Hàng hóa mua vào</th>
            <th rowspan="2">Ghi Chú</th>
          </tr>
          <tr>
            <th>Tên người bán</th>
            <th>Địa chỉ</th>
            <th>Số CCCD</th>
            <th>Số điện thoại</th>
            <th>Tên hàng hoá, dịch vụ</th>
            <th>Số lượng</th>
            <th>Đơn giá</th>
            <th>Tổng giá thanh toán</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((w) => `<tr>
            <td class="c">${dmy(w.date)}</td>
            <td>${esc(w.name)}</td>
            <td>${esc(w.addr)}</td>
            <td class="c">${esc(w.cccd)}</td>
            <td class="c">${esc(w.phone)}</td>
            <td>${esc(w.item)}</td>
            <td class="r">${fmt(w.qty)}</td>
            <td class="r">${money(w.price)}</td>
            <td class="r">${money(w.total)}</td>
            <td>${esc([w.pay, w.note].filter(Boolean).join('; '))}</td>
          </tr>`).join('')}
          <tr class="bk-total-row">
            <td></td>
            <td class="c"><b>Tổng Cộng</b></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td class="r"><b>${fmt(sumQty)}</b></td>
            <td></td>
            <td class="r"><b>${money(sumAmt)}</b></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <p class="bk-words">Tổng giá trị hàng hóa mua vào: <b>${money(sumAmt)}</b> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Số tiền bằng chữ: <b>${esc(moneyToWords(sumAmt))}.</b></p>
      <div class="bk-sign-grid">
        <div class="bk-sign-col">
          <div style="height:20px"></div>
          <b>NGƯỜI LẬP BẢNG KÊ</b>
        </div>
        <div class="bk-sign-col">
          <div class="bk-sign-date">${esc(signDate)}</div>
          <b>GIÁM ĐỐC</b>
          <div class="bk-foot-note">
            ghi chú: chụp hình CCCD người bán<br>
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; chuyển khoản từ tài khoản cty với số tiền &gt; 5 triệu
          </div>
        </div>
      </div>
    </div>`;
  window.print();
});

$('#imp-btn').onclick = () => guard(async () => {
  const c = await importExcel();
  if (!c) return;
  const kh = c.customers || 0;
  const n = c.purchases + c.sales + c.costs + kh;
  toast(n ? `Đã nhập ${n} dòng: ${c.purchases} mua, ${c.sales} bán, ${c.costs} chi phí, ${kh} khách hàng.` : 'Không có dòng mới nào (đã tồn tại hoặc không đọc được).');
  if (c.purchases) show('list');
});

/* ---------- CÀI ĐẶT ---------- */
const CFG_LABELS = { name: 'Tên doanh nghiệp', mst: 'Mã số thuế', addr: 'Địa chỉ', tel: 'Số điện thoại', place: 'Địa chỉ nơi tổ chức thu mua' };

loaders.settings = async () => {
  const cfg = await api('getSettings');
  $('#cfg').innerHTML = Object.entries(CFG_LABELS).map(([k, label]) => `<div class="${['name', 'addr', 'place'].includes(k) ? 'wide' : ''}"><label for="cfg-${k}">${label}</label><input id="cfg-${k}" data-c="${k}" value="${esc(cfg[k])}"></div>`).join('');
};

$('#cfg-save').onclick = () => guard(async () => {
  await api('saveSettings', Object.fromEntries($$('#cfg input').map((i) => [i.dataset.c, i.value.trim()])));
  await refreshHeader(); toast('Đã lưu thông tin doanh nghiệp.');
});

$('#db-backup').onclick = () => guard(async () => {
  const file = await backupDb();
  if (file) toast('Đã sao lưu Database: ' + file);
});

$('#db-restore').onclick = () => guard(async () => {
  if (!(await confirmBox('Khôi phục Database?', 'Dữ liệu hiện tại sẽ được thay thế bằng bản sao lưu bạn chọn. Tiếp tục?', 'Chọn file khôi phục'))) return;
  const file = await restoreDb();
  if (file) { await refreshHeader(); toast('Đã khôi phục từ: ' + file); show('dash'); }
});

$('#wipe').onclick = () => guard(async () => {
  if (await confirmBox('Xóa toàn bộ dữ liệu', 'Xóa sạch mua, bán, chi phí, thùng rác và lịch sử? Không thể khôi phục.', 'Xóa tất cả')
    && await confirmBox('Xác nhận lần cuối', 'Bạn chắc chắn muốn làm mới toàn bộ?', 'Xóa tất cả')) { await api('wipeAll'); toast('Đã xóa toàn bộ dữ liệu.'); show('dash'); }
});

/* ---------- thao tác chung (ủy quyền click) ---------- */
const OPENERS = { purchase: () => openPurchase(), sale: () => openSale(), cost: () => openCost(), cust: () => openCustomer() };
const AFTER_DELETE = { purchase: 'list', sale: 'sales', cost: 'cost', customer: 'cust' };

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-v],[data-open],[data-act],[data-bad]');
  if (!t) return;
  if (t.dataset.v) return show(t.dataset.v);
  if (t.dataset.open) return guard(OPENERS[t.dataset.open]);
  if (t.hasAttribute('data-bad')) { $('#q-bad').checked = true; return show('list'); }
  const { act, id, kind } = t.dataset;
  guard(async () => {
    if (act === 'edit-purchase') await openPurchase(id);
    else if (act === 'print-purchase') await printPurchase(id);
    else if (act === 'view-cccd') await openCccdPreview(id);
    else if (act === 'edit-sale') await openSale(id);
    else if (act === 'edit-cost') await openCost(id);
    else if (act === 'edit-cust') await openCustomer(id);
    else if (act === 'del') {
      if (!(await confirmBox('Chuyển vào Thùng rác?', `${id} sẽ không còn được tính vào bảng kê, tồn kho. Bạn có thể khôi phục lại.`, 'Chuyển vào thùng rác'))) return;
      await api('softDelete', kind, id); toast(`Đã chuyển ${id} vào Thùng rác`);
      await loaders[AFTER_DELETE[kind]]();
    } else if (act === 'restore') { await api('restore', kind, id); toast('Đã khôi phục ' + id); await loaders.trash(); }
    else if (act === 'purge') {
      if (await confirmBox('Xóa vĩnh viễn', `Xóa vĩnh viễn ${id}? Không thể khôi phục.`, 'Xóa vĩnh viễn')) { await api('purge', [{ kind, id }]); await loaders.trash(); }
    }
  });
});

// Ctrl+N: thu mua mới
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'n' && !document.querySelector('dialog:modal')) { e.preventDefault(); guard(OPENERS.purchase); }
});

/* ---------- khởi động ---------- */
async function refreshHeader() {
  const c = await api('getSettings');
  $('#co').textContent = c.name; $('#co').title = `${c.name} | MST: ${c.mst}`;
}
initNumericInputs();
initVietnameseDatePickers();
guard(async () => { await refreshHeader(); await show('dash'); });
