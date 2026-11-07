/**
 * db.js - Khởi tạo SQLite (module có sẵn `node:sqlite`, không cần build native).
 * Quy ước: tiền là số nguyên (đồng), kg là số thực, ngày lưu dạng 'YYYY-MM-DD'.
 * Xóa mềm: cột `deleted` = 1 nghĩa là đang ở Thùng rác.
 */
const _emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => (a[0] === 'ExperimentalWarning' || (w && w.name === 'ExperimentalWarning')) ? undefined : _emitWarning.call(process, w, ...a);
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS purchases (          -- Thu mua
  id         TEXT PRIMARY KEY,                  -- TM01-061126
  date       TEXT NOT NULL,
  name       TEXT NOT NULL,                     -- người bán
  addr       TEXT NOT NULL DEFAULT '',
  cccd       TEXT NOT NULL DEFAULT '' CHECK (cccd = '' OR length(cccd) = 12),
  phone      TEXT NOT NULL DEFAULT '',
  item       TEXT NOT NULL,                     -- loại hàng
  qty        REAL NOT NULL CHECK (qty > 0),     -- kg
  price      INTEGER NOT NULL CHECK (price >= 0),
  pay        TEXT NOT NULL DEFAULT '' CHECK (pay IN ('', 'TM', 'CK')),
  note       TEXT NOT NULL DEFAULT '',
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sales (              -- Bán ra
  id       TEXT PRIMARY KEY,                    -- BH01-061126
  date     TEXT NOT NULL,
  item     TEXT NOT NULL,
  qty      REAL NOT NULL CHECK (qty > 0),
  price    INTEGER NOT NULL CHECK (price >= 0),
  note     TEXT NOT NULL DEFAULT '',
  deleted  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS costs (              -- Chi phí bán hàng
  id       TEXT PRIMARY KEY,                    -- CP01-061126
  date     TEXT NOT NULL,
  item     TEXT NOT NULL,
  type     TEXT NOT NULL,                       -- Vận chuyển, Bốc xếp...
  amount   INTEGER NOT NULL CHECK (amount > 0),
  note     TEXT NOT NULL DEFAULT '',
  deleted  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS customers (          -- Danh mục Khách hàng / Người bán
  id         TEXT PRIMARY KEY,                  -- KH001, KH002...
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  cccd       TEXT NOT NULL DEFAULT '' CHECK (cccd = '' OR length(cccd) = 12),
  addr       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  cccd_front TEXT NOT NULL DEFAULT '',          -- Ảnh CCCD mặt trước (Data URL)
  cccd_back  TEXT NOT NULL DEFAULT '',          -- Ảnh CCCD mặt sau (Data URL)
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS history (            -- Nhật ký thao tác (audit log)
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  time    TEXT NOT NULL,
  ref_id  TEXT NOT NULL,
  action  TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (           -- Thông tin doanh nghiệp (key/value)
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_sales_date     ON sales(date);
`;

const DEFAULT_SETTINGS = {
  name: 'CÔNG TY TNHH PHƯƠNG HÀ BMT',
  mst: '6001812340',
  addr: 'Thôn I, Xã Ea Kiết, tỉnh Đắk Lắk, Việt Nam',
  tel: '0968549496',
  place: 'Thôn I, Xã Ea Kiết, tỉnh Đắk Lắk',
};

let db = null;

/** Mở (hoặc tạo) file database và đảm bảo đủ bảng. */
function openDb(file) {
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const cols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
  if (!cols.includes('cccd_front')) db.exec("ALTER TABLE customers ADD COLUMN cccd_front TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('cccd_back')) db.exec("ALTER TABLE customers ADD COLUMN cccd_back TEXT NOT NULL DEFAULT ''");
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  return db;
}

const getDb = () => db;

/** Chạy fn trong transaction; có lỗi thì ROLLBACK và ném lỗi tiếp. */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb, getDb, tx };
