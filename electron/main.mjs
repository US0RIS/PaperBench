import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPaperServer } from '../server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let backend = null;

function settingsPath() { return path.join(app.getPath('userData'), 'desktop-settings.json'); }
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), { mode: 0o600 });
}
function decryptKey(value) {
  if (!value) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch { return ''; }
}
function desktopAIProvider() {
  return {
    desktop: true,
    async get() {
      const s = readSettings();
      return { key: decryptKey(s.anthropicKey), model: s.anthropicModel || 'claude-sonnet-5-5' };
    },
    async set({ key, model }) {
      const s = readSettings();
      if (key) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable. The API key was not saved.');
        s.anthropicKey = safeStorage.encryptString(key).toString('base64');
      } else delete s.anthropicKey;
      s.anthropicModel = model || 'claude-sonnet-5-5';
      writeSettings(s);
    },
  };
}

function installMenu() {
  const template = [
    { role: 'appMenu', submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'AI Settings…', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('paperbench:open-assist') },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'PaperBench on GitHub', click: () => shell.openExternal('https://github.com/US0RIS/PaperBench') },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installIPC() {
  ipcMain.handle('paperbench:save-file', async (_event, payload) => {
    const name = path.basename(String(payload?.name || 'export.bin'));
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: name, nameFieldLabel: 'Save As:' });
    if (result.canceled || !result.filePath) return { canceled: true };
    const bytes = Buffer.from(payload.bytes || []);
    fs.writeFileSync(result.filePath, bytes);
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('paperbench:app-info', () => ({ version: app.getVersion(), platform: process.platform }));
}

async function createWindow() {
  const preload = path.join(here, 'preload.cjs');
  mainWindow = new BrowserWindow({
    width: 1500, height: 980, minWidth: 1000, minHeight: 700,
    title: 'PaperBench',
    backgroundColor: '#f5f3ef',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!backend || url.startsWith(backend.origin + '/')) return;
    event.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  await mainWindow.loadURL(backend.origin);
}

app.setName('PaperBench');
app.whenReady().then(async () => {
  installIPC(); installMenu();
  const root = path.join(app.getAppPath(), 'dist');
  backend = await startPaperServer({ root, aiProvider: desktopAIProvider(), port: 0 });
  await createWindow();
  app.on('activate', async () => { if (BrowserWindow.getAllWindows().length === 0) await createWindow(); });
}).catch((e) => { dialog.showErrorBox('PaperBench could not start', e.stack || e.message || String(e)); app.quit(); });

app.on('before-quit', () => { try { backend?.server?.close(); } catch { /* noop */ } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
