/**
 * fert.js (renderer) - Màn hình Bán phân bón (đơn vị: bao).
 * Nạp SAU renderer.js, dùng lại: $, api, toast, guard, inDialog, confirmBox, fmt, money, moneyTag,
 * dmy, today, esc, options, emptyRow, VIEWS, loaders, OPENERS.
 */
(() => {
  VIEWS.push('fert');

  const TABS = ['sale', 'in', 'cost', 'stock'];
  let tab = 'sale', editIn = null, editSale = null, editCost = null;
  let stockMap = {}, custByLabel = {};
  const PRESET = ['Đầu Trâu', 'Kali'];

  const zOf = (name) => {
    const key = Object.keys(stockMap).find((k) => k.toLowerCase() === String(name).trim().toLowerCase());
    return key ? stockMap[key] : null;
  };
  const actBtns = (k, id) => `<td class="c nowrap"><button class="icon-btn" data-fa="edit" data-k="${k}" data-id="${id}" title="Sửa" aria-label="Sửa ${id}">✏️</button><button class="icon-btn d" data-fa="del" data-k="${k}" data-id="${id}" title="Xóa" aria-label="Xóa ${id}">🗑️</button></td>`;

  /* ---------- nạp danh sách gợi ý + tồn kho ---------- */
    async function loadLists() {
    const [items, custs, stock] = await Promise.all([api('fertItems'), api('listCustomers', {}), api('fertStock')]);
    $('#fert-items').innerHTML = items.map((x) => `<option value="${esc(x)}">`).join('');

    // Danh sách chọn trong 3 hộp thoại: Đầu Trâu, Kali, các loại đã lưu, Khác
    const dlgItems = [...PRESET, ...items.filter((x) => !PRESET.some((p) => p.toLowerCase() === x.toLowerCase()))];
    const dlgHtml = '<option value="">— Chọn loại phân bón —</option>'
      + dlgItems.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')
      + '<option value="__other">Khác (nhập tên mới)…</option>';
    ['fin', 'fsd', 'fcd'].forEach((p) => { $('#' + p + '-sel').innerHTML = dlgHtml; });
    // Bộ lọc loại hàng ở tab Bán ra / Nhập kho
    ['fs-item', 'fi-item'].forEach((id) => {
      const s = $('#' + id), cur = s.value;
      s.innerHTML = options(items, 'Tất cả loại hàng');
      s.value = items.includes(cur) ? cur : '';
    });

    custByLabel = {};
    $('#fert-custs').innerHTML = custs.map((c) => {
      const label = `${c.id} – ${c.name}${c.phone ? ' – ' + c.phone : ''}`;
      custByLabel[label] = c.id;
      return `<option value="${esc(label)}">`;
    }).join('');
    stockMap = Object.fromEntries(stock.map((z) => [z.item, z]));
    return stock;
  }
  /* ---------- ô chọn loại phân bón (Đầu Trâu / Kali / Khác) ---------- */
  function syncItem(p) {           // đặt ô chọn theo giá trị trong ô nhập
    const sel = $('#' + p + '-sel'), inp = $('#' + p + '-item'), v = inp.value.trim();
    const opt = [...sel.options].find((o) => o.value && o.value !== '__other' && o.value.toLowerCase() === v.toLowerCase());
    sel.value = !v ? '' : opt ? opt.value : '__other';
    inp.style.display = sel.value === '__other' ? '' : 'none';
    if (opt) inp.value = opt.value;
  }
  ['fin', 'fsd', 'fcd'].forEach((p) => {
    const sel = $('#' + p + '-sel'), inp = $('#' + p + '-item');
    sel.addEventListener('change', () => {
      const other = sel.value === '__other';
      inp.value = other ? '' : sel.value;
      inp.style.display = other ? '' : 'none';
      inp.dispatchEvent(new Event('input', { bubbles: true }));   // để calcSale tự cập nhật
      if (other) inp.focus();
    });
  });
  /* ---------- các tab ---------- */
  async function renderSale() {
    const rows = await api('listFertSales', { from: $('#fs-from').value, to: $('#fs-to').value, q: $('#fs-q').value, item: $('#fs-item').value });
    $('#fs-table').innerHTML = rows.map((r) => `<tr>
      <td class="nowrap"><b>${r.id}</b></td>
      <td class="nowrap">${dmy(r.date)}</td>
      <td><b>${esc(r.cust_name)}</b><br><small class="mut">${esc(r.cust_id)}</small></td>
      <td>${esc(r.item)}</td>
      <td class="r"><span class="qty">${fmt(r.qty)}</span></td>
      <td class="r"><span class="unit-price">${money(r.price)} đ</span></td>
      <td class="r">${moneyTag(r.revenue, 'in')}</td>
      <td>${esc(r.note)}</td>
      ${actBtns('sale', r.id)}
    </tr>`).join('') || emptyRow(9, 'Chưa có lần bán phân bón nào.');
    $('#fs-foot').innerHTML = rows.length
      ? `<tr><th colspan="4">TỔNG CỘNG (${rows.length} lần bán)</th><th class="r">${fmt(rows.reduce((s, r) => s + r.qty, 0))} bao</th><th></th><th class="r">${moneyTag(rows.reduce((s, r) => s + r.revenue, 0), 'in')}</th><th colspan="2"></th></tr>` : '';
  }

  async function renderIn() {
    const rows = await api('listFertIn', { from: $('#fi-from').value, to: $('#fi-to').value, q: $('#fi-q').value, item: $('#fi-item').value });
    $('#fi-table').innerHTML = rows.map((r) => `<tr>
      <td class="nowrap"><b>${r.id}</b></td>
      <td class="nowrap">${dmy(r.date)}</td>
      <td><b>${esc(r.item)}</b></td>
      <td>${esc(r.supplier)}</td>
      <td class="r"><span class="qty">${fmt(r.qty)}</span></td>
      <td class="r"><span class="unit-price">${money(r.price)} đ</span></td>
      <td class="r">${moneyTag(r.total, 'out')}</td>
      <td>${esc(r.note)}</td>
      ${actBtns('in', r.id)}
    </tr>`).join('') || emptyRow(9, 'Chưa có phiếu nhập phân bón nào.');
    $('#fi-foot').innerHTML = rows.length
      ? `<tr><th colspan="4">TỔNG CỘNG (${rows.length} phiếu)</th><th class="r">${fmt(rows.reduce((s, r) => s + r.qty, 0))} bao</th><th></th><th class="r">${moneyTag(rows.reduce((s, r) => s + r.total, 0), 'out')}</th><th colspan="2"></th></tr>` : '';
  }

  async function renderCost() {
    const rows = await api('listFertCosts', { from: $('#fc-from').value, to: $('#fc-to').value, q: $('#fc-q').value });
    $('#fc-table').innerHTML = rows.map((r) => `<tr>
      <td class="nowrap"><b>${r.id}</b></td>
      <td class="nowrap">${dmy(r.date)}</td>
      <td><b>${esc(r.item)}</b></td>
      <td>${esc(r.type)}</td>
      <td class="r">${moneyTag(r.amount, 'out')}</td>
      <td>${esc(r.note)}</td>
      ${actBtns('cost', r.id)}
    </tr>`).join('') || emptyRow(7, 'Chưa có chi phí phân bón nào.');
    $('#fc-foot').innerHTML = rows.length
      ? `<tr><th colspan="4">TỔNG CỘNG (${rows.length} khoản)</th><th class="r">${moneyTag(rows.reduce((s, r) => s + r.amount, 0), 'out')}</th><th colspan="2"></th></tr>` : '';
  }

  function renderStock(allRows) {
    const sel = $('#fk-item'), cur = sel.value, names = allRows.map((r) => r.item);
    sel.innerHTML = options(names, 'Tất cả loại phân bón');
    sel.value = names.includes(cur) ? cur : '';
    const rows = sel.value ? allRows.filter((r) => r.item === sel.value) : allRows;
    const cols = ['inQty', 'inCost', 'soldQty', 'qty', 'avgCost', 'cost', 'revenue', 'expense', 'net'];
    const sum = (k) => rows.reduce((s, z) => s + z[k], 0);
    const cell = (k, z) => {
      if (['inQty', 'soldQty', 'qty'].includes(k)) return `<span class="qty">${fmt(z[k])}</span>`;
      if (k === 'net') return moneyTag(z[k], z[k] >= 0 ? 'in' : 'loss');
      if (k === 'revenue') return `<span class="amt" style="color:var(--money)">${money(z[k])} đ</span>`;
      if (k === 'expense') return `<span class="amt" style="color:var(--cost)">${money(z[k])} đ</span>`;
      return `<span class="amt">${money(z[k])} đ</span>`;
    };
    $('#fk-table').innerHTML = rows.map((z) => `<tr><td><b>${esc(z.item)}</b></td>${cols.map((k) => `<td class="r">${cell(k, z)}</td>`).join('')}</tr>`).join('') || emptyRow(10, 'Chưa có dữ liệu nhập phân bón.');
    $('#fk-foot').innerHTML = rows.length ? `<tr><th>TỔNG CỘNG</th>${cols.map((k) => {
      if (k === 'avgCost') return '<th></th>';
      if (['inQty', 'soldQty', 'qty'].includes(k)) return `<th class="r">${fmt(sum(k))}</th>`;
      return `<th class="r">${money(sum(k))} đ</th>`;
    }).join('')}</tr>` : '';
    const over = allRows.filter((z) => z.oversold).map((z) => z.item);
    $('#fk-note').textContent = over.length
      ? `⚠ Bán vượt lượng tồn: ${over.join(', ')}. Hãy kiểm tra ngày nhập/bán.`
      : 'Đơn vị: bao. Lợi Nhuận Cuối = doanh thu − giá vốn hàng đã bán − chi phí.';
  }

  loaders.fert = async () => {
    const stock = await loadLists();
    const sum = (k) => stock.reduce((s, z) => s + z[k], 0), net = sum('net');
    $('#f-kpis').innerHTML = [
      ['Tồn kho phân bón', fmt(sum('qty')) + ' bao', ''],
      ['Giá trị tồn kho', money(sum('cost')) + ' đ', ''],
      ['Doanh thu bán phân', money(sum('revenue')) + ' đ', 'good'],
      ['Lợi Nhuận Cuối', money(net) + ' đ', net >= 0 ? 'good' : 'bad'],
    ].map(([t, v, c]) => `<div class="kpi ${c}"><small>${t}</small><b>${v}</b></div>`).join('');
    TABS.forEach((k) => {
      $('#fp-' + k).classList.toggle('hide', k !== tab);
      $(`[data-ftab="${k}"]`).classList.toggle('ghost', k !== tab);
    });
    if (tab === 'sale') await renderSale();
    else if (tab === 'in') await renderIn();
    else if (tab === 'cost') await renderCost();
    else renderStock(stock);
  };

  ['fs-from', 'fs-to', 'fs-q', 'fs-item'].forEach((id) => $('#' + id).addEventListener('input', () => guard(renderSale)));
  ['fi-from', 'fi-to', 'fi-q', 'fi-item'].forEach((id) => $('#' + id).addEventListener('input', () => guard(renderIn)));
  ['fc-from', 'fc-to', 'fc-q'].forEach((id) => $('#' + id).addEventListener('input', () => guard(renderCost)));
  $('#fk-item').addEventListener('change', () => guard(loaders.fert));

  /* ---------- hộp thoại NHẬP KHO ---------- */
  const calcIn = () => { $('#fin-total').textContent = money(Math.round(num($('#fin-qty').value) * num($('#fin-price').value))) + ' đ'; };
  ['fin-qty', 'fin-price'].forEach((id) => $('#' + id).addEventListener('input', calcIn));
  $('#fin-date').addEventListener('input', () => guard(async () => { $('#fin-id').value = await api('previewFertCode', 'in', $('#fin-date').value, editIn); }));

  async function openIn(id = null) {
    editIn = id;
    await loadLists();
    $('#dlg-fin .form-err').hidden = true;
    $('#fin-title').textContent = id ? `Sửa phiếu nhập ${id}` : 'Nhập kho phân bón';
    $('#fin-save').textContent = id ? 'Lưu thay đổi' : 'Lưu phiếu nhập';
    if (id) {
      const r = await api('getFertIn', id);
      $('#fin-id').value = r.id; $('#fin-date').value = r.date; $('#fin-item').value = r.item; $('#fin-sup').value = r.supplier;
      $('#fin-qty').value = r.qty; $('#fin-price').value = r.price; $('#fin-note').value = r.note || '';
    } else {
      $('#fin-date').value = today();
      ['fin-item', 'fin-sup', 'fin-qty', 'fin-price', 'fin-note'].forEach((k) => ($('#' + k).value = ''));
      $('#fin-id').value = await api('previewFertCode', 'in', $('#fin-date').value, null);
    }
    syncItem('fin');
    calcIn();
    calcIn();
    $('#dlg-fin').showModal();
    $('#fin-item').focus();
  }
  $('#fin-save').onclick = () => inDialog('dlg-fin', async () => {
    const id = await api('saveFertIn', { id: editIn, date: $('#fin-date').value, item: $('#fin-item').value, supplier: $('#fin-sup').value, qty: $('#fin-qty').value, price: $('#fin-price').value, note: $('#fin-note').value });
    $('#dlg-fin').close(); toast('Đã lưu phiếu nhập ' + id); await guard(loaders.fert);
  });

  /* ---------- hộp thoại BÁN CHO KHÁCH ---------- */
  function calcSale() {
    const qty = num($('#fsd-qty').value), price = num($('#fsd-price').value), rev = Math.round(qty * price);
    $('#fsd-total').textContent = money(rev) + ' đ';
    const z = zOf($('#fsd-item').value), avail = z ? z.qty : 0, avg = z ? z.avgCost : 0;
    const est = qty > 0 && price > 0 ? ` · Lãi gộp ước tính: <b>${money(rev - qty * avg)} đ</b>` : '';
    $('#fsd-stock').innerHTML = `Tồn kho hiện có: <b>${fmt(avail)} bao</b> · Giá vốn TB: <b>${money(avg)} đ/bao</b>${est}`;
    $('#fsd-fill').hidden = avail <= 0;
  }
  ['fsd-qty', 'fsd-price', 'fsd-item'].forEach((id) => $('#' + id).addEventListener('input', calcSale));
  $('#fsd-fill').onclick = () => {
    const z = zOf($('#fsd-item').value);
    if (z && z.qty > 0) { $('#fsd-qty').value = Number(z.qty.toFixed(2)); calcSale(); $('#fsd-price').focus(); }
  };
  $('#fsd-date').addEventListener('input', () => guard(async () => { $('#fsd-id').value = await api('previewFertCode', 'sale', $('#fsd-date').value, editSale); }));

  async function openSale(id = null) {
    editSale = id;
    await loadLists();
    $('#dlg-fsale .form-err').hidden = true;
    $('#fsd-title').textContent = id ? `Sửa lần bán ${id}` : 'Bán phân bón cho khách';
    $('#fsd-save').textContent = id ? 'Lưu thay đổi' : 'Lưu lần bán';
    if (id) {
      const r = await api('getFertSale', id);
      const label = Object.keys(custByLabel).find((l) => custByLabel[l] === r.cust_id) || r.cust_name;
      $('#fsd-id').value = r.id; $('#fsd-date').value = r.date; $('#fsd-cust').value = label; $('#fsd-item').value = r.item;
      $('#fsd-qty').value = r.qty; $('#fsd-price').value = r.price; $('#fsd-note').value = r.note || '';
    } else {
      $('#fsd-date').value = today();
      ['fsd-cust', 'fsd-item', 'fsd-qty', 'fsd-price', 'fsd-note'].forEach((k) => ($('#' + k).value = ''));
      $('#fsd-id').value = await api('previewFertCode', 'sale', $('#fsd-date').value, null);
    }
    syncItem('fsd');
    calcSale();
    calcSale();
    $('#dlg-fsale').showModal();
    $('#fsd-cust').focus();
  }
  $('#fsd-save').onclick = () => inDialog('dlg-fsale', async () => {
    const id = await api('saveFertSale', { id: editSale, date: $('#fsd-date').value, cust_id: custByLabel[$('#fsd-cust').value.trim()] || '', item: $('#fsd-item').value, qty: $('#fsd-qty').value, price: $('#fsd-price').value, note: $('#fsd-note').value });
    $('#dlg-fsale').close(); toast('Đã lưu lần bán ' + id); await guard(loaders.fert);
  });

  /* ---------- hộp thoại CHI PHÍ ---------- */
  $('#fcd-date').addEventListener('input', () => guard(async () => { $('#fcd-id').value = await api('previewFertCode', 'cost', $('#fcd-date').value, editCost); }));

  async function openCost(id = null) {
    editCost = id;
    await loadLists();
    $('#dlg-fcost .form-err').hidden = true;
    $('#fcd-title').textContent = id ? `Sửa chi phí ${id}` : 'Thêm chi phí phân bón';
    $('#fcd-save').textContent = id ? 'Lưu thay đổi' : 'Lưu chi phí';
    if (id) {
      const r = await api('getFertCost', id);
      $('#fcd-id').value = r.id; $('#fcd-date').value = r.date; $('#fcd-item').value = r.item;
      $('#fcd-type').value = r.type; $('#fcd-amt').value = r.amount; $('#fcd-note').value = r.note || '';
    } else {
      $('#fcd-date').value = today();
      ['fcd-item', 'fcd-amt', 'fcd-note'].forEach((k) => ($('#' + k).value = ''));
      $('#fcd-id').value = await api('previewFertCode', 'cost', $('#fcd-date').value, null);
    }
    syncItem('fcd');
    $('#dlg-fcost').showModal();
    $('#dlg-fcost').showModal();
    $('#fcd-item').focus();
  }
  $('#fcd-save').onclick = () => inDialog('dlg-fcost', async () => {
    const id = await api('saveFertCost', { id: editCost, date: $('#fcd-date').value, item: $('#fcd-item').value, type: $('#fcd-type').value, amount: $('#fcd-amt').value, note: $('#fcd-note').value });
    $('#dlg-fcost').close(); toast('Đã lưu chi phí ' + id); await guard(loaders.fert);
  });

  /* ---------- nút "＋" ở đầu trang, tab, sửa/xóa ---------- */
  OPENERS.fin = () => openIn();
  OPENERS.fsale = () => openSale();
  OPENERS.fcost = () => openCost();
  const OPEN = { in: openIn, sale: openSale, cost: openCost };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ftab],[data-fa]');
    if (!t) return;
    if (t.dataset.ftab) { tab = t.dataset.ftab; return guard(loaders.fert); }
    const { fa, k, id } = t.dataset;
    guard(async () => {
      if (fa === 'edit') await OPEN[k](id);
      else if (fa === 'del') {
        if (!(await confirmBox('Xóa dòng này?', `${id} sẽ bị xóa hẳn khỏi sổ phân bón và không thể khôi phục (nên Sao lưu trước ở mục Cài đặt).`, 'Xóa'))) return;
        await api('deleteFert', k, id); toast('Đã xóa ' + id); await loaders.fert();
      }
    });
  });
})();