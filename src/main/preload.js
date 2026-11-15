/**
 * preload.js - Cầu nối an toàn giữa giao diện và main process.
 * Giao diện chỉ gọi được window.bridge.api / exportExcel / importExcel / backupDb / restoreDb.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Gọi và tự ném lỗi nếu main trả về { error }. */
const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res.error) throw new Error(res.error);
  return res.data;
};

contextBridge.exposeInMainWorld('bridge', {
  api: (name, ...args) => call('api', name, ...args),
  exportExcel: (from, to) => call('exportExcel', from, to),
  importExcel: () => call('importExcel'),
  importCustomers: () => call('importCustomers'),
  customerTemplate: () => call('customerTemplate'),
  backupDb: () => call('backupDb'),
  restoreDb: () => call('restoreDb'),
  importCustomers: () => call('importCustomers'),
  customerTemplate: () => call('customerTemplate'),
});
