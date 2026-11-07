# Quản lý thu mua nông sản (Electron + SQLite)

## Chạy trong 5 phút
1. Cài Node.js LTS (>= 20) từ https://nodejs.org
2. Mở PowerShell tại thư mục dự án:
   ```
   npm install      # cài electron, exceljs, electron-builder
   npm start        # chạy ứng dụng
   ```
3. Đóng gói file cài đặt `.exe`:
   ```
   npm run dist     # kết quả: thư mục dist\*.exe
   ```
Dữ liệu lưu tại `%APPDATA%\quan-ly-nong-san\database.sqlite` (không mất khi tắt máy / gỡ app).

## Kiểm thử
- `npm test` – test logic giá vốn bình quân + đối soát.
- `set ELECTRON_RUN_AS_NODE=1 && npx electron tests/smoke.js` – test DB + Excel trong runtime Electron.

## Cấu trúc
```
package.json
src/main/        (Node/Electron)
  main.js        cửa sổ + IPC + hộp thoại chọn file
  preload.js     cầu nối an toàn window.bridge
  db.js          schema SQLite (purchases, sales, costs, history, settings), transaction
  services.js    CRUD + nghiệp vụ gọi từ UI (mỗi hàm = 1 API)
  ledger.js      giá vốn bình quân di động, tồn kho, lợi nhuận, đối soát (hàm thuần)
  excel.js       xuất Mẫu 02/TNDN + nhập Excel (exceljs)
src/renderer/    index.html, style.css, renderer.js
tests/           ledger.test.js, smoke.js
```

## Thiết kế DB
| Bảng | Cột chính |
|---|---|
| purchases | id (TM01-061126) PK, date, name, addr, cccd (''/12 ký tự), phone, item, qty>0, price>=0, pay ('' / TM / CK), note, deleted |
| sales | id (BH..), date, item, qty>0, price, note, deleted |
| costs | id (CP..), date, item, type, amount>0, note, deleted |
| history | seq PK, time, ref_id, action, detail |
| settings | key PK, value (tên DN, MST, địa chỉ, SĐT, nơi thu mua) |

`deleted = 1` là Thùng rác (xóa mềm). Tồn kho/lợi nhuận KHÔNG lưu bảng riêng: tính lại từ purchases + sales + costs mỗi lần xem nên luôn đúng.

## Thêm tính năng mới (mẫu)
1. Viết hàm trong `services.js` và thêm vào object `api`.
2. Gọi `await api('tenHam', ...)` trong `renderer.js`.
