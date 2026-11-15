/**
 * main.js - Electron main process: mở cửa sổ, mở SQLite, đăng ký IPC.
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { openDb, getDb } = require('./db');
const { api } = require('./services');
Object.assign(api, require('./fert').api);
const { exportExcel, importExcel, importCustomersExcel, exportCustomerTemplate } = require('./excel');

let dbPath = '';

// Tránh xung đột khóa thư mục GPUCache/Cache trên Windows và đảm bảo chỉ mở 1 cửa sổ duy nhất
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1340, height: 860, title: 'Quản lý thu mua nông sản',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

/** Kênh duy nhất 'api': renderer gọi tên hàm trong services.api. Lỗi trả về dạng {error}. */
function registerIpc() {
  ipcMain.handle('api', (_e, name, ...args) => {
    try {
      if (!api[name]) throw new Error('API không tồn tại: ' + name);
      return { data: api[name](...args) };
    } catch (e) { return { error: e.message }; }
  });

  // Xuất / Nhập Excel
  ipcMain.handle('exportExcel', async (e, from, to) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: `Bang_ke_thu_mua_${to || new Date().toISOString().slice(0, 10)}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (canceled) return { data: null };
      return { data: { filePath, rows: await exportExcel(filePath, from, to) } };
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('importExcel', async (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] });
      if (canceled) return { data: null };
      return { data: await importExcel(filePaths[0]) };
    } catch (err) { return { error: 'Không đọc được file Excel: ' + err.message }; }
  });

  // Sao lưu file database.sqlite trực tiếp ra ổ đĩa / USB
  ipcMain.handle('backupDb', async (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: `Sao_luu_nong_san_${new Date().toISOString().slice(0, 10)}.sqlite`,
        filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }],
      });
      if (canceled) return { data: null };
      getDb().exec('PRAGMA wal_checkpoint(FULL);');
      fs.copyFileSync(dbPath, filePath);
      return { data: filePath };
    } catch (err) { return { error: 'Không sao lưu được: ' + err.message }; }
  });

  // Nhập danh sách khách hàng từ Excel
  ipcMain.handle('importCustomers', async (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] });
      if (canceled) return { data: null };
      return { data: await importCustomersExcel(filePaths[0]) };
    } catch (err) { return { error: 'Không đọc được file Excel: ' + err.message }; }
  });

  // Tải file Excel mẫu để nhập khách hàng
  ipcMain.handle('customerTemplate', async (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: 'Mau_nhap_khach_hang.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (canceled) return { data: null };
      await exportCustomerTemplate(filePath);
      return { data: filePath };
    } catch (err) { return { error: 'Không tạo được file mẫu: ' + err.message }; }
  });
  // Khôi phục từ file database.sqlite đã sao lưu
  ipcMain.handle('restoreDb', async (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }],
        properties: ['openFile'],
      });
      if (canceled) return { data: null };
      getDb().close();
      fs.copyFileSync(filePaths[0], dbPath);
      for (const ext of ['-wal', '-shm']) {
        try { fs.unlinkSync(dbPath + ext); } catch {}
      }
      openDb(dbPath);
      return { data: filePaths[0] };
    } catch (err) {
      try { openDb(dbPath); } catch {}
      return { error: 'Không khôi phục được: ' + err.message };
    }
  });
}

app.whenReady().then(() => {
  // File dữ liệu nằm ở %APPDATA%\<tên app>\database.sqlite – không mất khi tắt máy
  dbPath = path.join(app.getPath('userData'), 'database.sqlite');
  openDb(dbPath);
  registerIpc();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
