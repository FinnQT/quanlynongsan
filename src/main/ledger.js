/**
 * ledger.js - Nghiệp vụ thuần (không đụng DB/UI): giá vốn bình quân di động,
 * tồn kho, lợi nhuận và đối soát giao dịch bất thường.
 */

const total = (r) => Math.round(r.qty * r.price); // thành tiền

/**
 * Giá vốn bình quân gia quyền di động theo từng loại hàng.
 * - Mua: cộng vào kho (kg + tiền).
 * - Bán: giá vốn = kg bán × (tiền kho / kg kho) ngay trước lúc bán.
 * - Cùng ngày: mua trước, bán sau.
 * Trả về { item: { inQty, inCost, soldQty, qty, cost, revenue, cogs, profit, expense, net, oversold } }
 */
function computeLedger(purchases, sales, costs) {
  const events = [
    ...purchases.map((r) => ({ buy: true, ...r })),
    ...sales.map((r) => ({ buy: false, ...r })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (b.buy - a.buy) || a.id.localeCompare(b.id));

  const state = {};
  const get = (item) =>
    (state[item] ||= { inQty: 0, inCost: 0, soldQty: 0, qty: 0, cost: 0,
                       revenue: 0, cogs: 0, profit: 0, expense: 0, net: 0, oversold: false });

  for (const e of events) {
    const z = get(e.item);
    if (e.buy) {
      z.inQty += e.qty; z.inCost += total(e); z.qty += e.qty; z.cost += total(e);
    } else {
      if (e.qty > z.qty + 1e-8) z.oversold = true;
      const avg = z.qty > 0 ? z.cost / z.qty : 0;
      const cogs = e.qty * avg;
      z.soldQty += e.qty; z.revenue += total(e); z.cogs += cogs;
      z.profit += total(e) - cogs; z.qty -= e.qty; z.cost -= cogs;
    }
  }
  for (const c of costs) get(c.item).expense += c.amount;
  for (const z of Object.values(state)) {
    z.avgCost = z.qty > 0 ? z.cost / z.qty : 0;   // đơn giá tồn kho
    z.net = z.profit - z.expense;                  // lợi nhuận sau chi phí
  }
  return state;
}

/**
 * Đối soát giao dịch thu mua. Trả về { [id]: ['cảnh báo 1', ...] }.
 * Các quy tắc: CCCD sai, >5 triệu chưa CK (để trống hình thức thanh toán là hợp lệ),
 * trùng người bán trong ngày, đơn giá lệch >10% so với TB cùng ngày + cùng hàng.
 */
function findWarnings(purchases) {
  const prices = {}, sellerCount = {}, result = {};
  for (const r of purchases) {
    (prices[`${r.date}|${r.item}`] ||= []).push(r.price);
    const k = `${r.date}|${r.name.toLowerCase()}`;
    sellerCount[k] = (sellerCount[k] || 0) + 1;
  }
  for (const r of purchases) {
    const w = [], list = prices[`${r.date}|${r.item}`];
    const mean = list.reduce((s, x) => s + x, 0) / list.length;
    if (r.cccd && !/^\d{12}$/.test(r.cccd)) w.push('CCCD sai số');
    if (total(r) > 5e6 && r.pay !== 'CK') w.push('Trên 5 triệu chưa ghi CK');
    if (sellerCount[`${r.date}|${r.name.toLowerCase()}`] > 1) w.push('Trùng người bán trong ngày');
    if (list.length > 2 && mean > 0 && Math.abs(r.price - mean) / mean > 0.1) w.push('Đơn giá lệch >10%');
    if (w.length) result[r.id] = w;
  }
  return result;
}

module.exports = { total, computeLedger, findWarnings };
