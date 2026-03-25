import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { PythonBridge, type BridgeEvent } from './pythonBridge';
import { YtDlpCliBridge } from './ytDlpCliBridge';

if (process.platform === 'win32') {
  app.setAppUserModelId('com.ytdl.sparks');
}

const bridge = app.isPackaged && process.platform === 'win32'
  ? new YtDlpCliBridge()
  : new PythonBridge();

function createWindow() {
  const window = new BrowserWindow({
    width: 600,
    height: 860,
    minWidth: 580,
    minHeight: 840,
    backgroundColor: '#181818',
    icon: app.isPackaged ? undefined : path.join(app.getAppPath(), 'build', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  bridge.on('event', (event: BridgeEvent) => {
    window.webContents.send('bridge:event', event);
  });

  window.webContents.on('did-fail-load', (_event, code, description, validatedUrl) => {
    console.error('Renderer failed to load', { code, description, validatedUrl });
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited', details);
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return window;
  }

  void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
}

app.whenReady().then(() => {
  ipcMain.handle('app:get-default-download-path', () => app.getPath('downloads'));

  ipcMain.handle('app:pick-destination', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('bridge:probe', async (_event, payload) => bridge.request('probe', payload));
  ipcMain.handle('bridge:download-start', async (_event, payload) => bridge.request('download.start', payload));
  ipcMain.handle('bridge:download-cancel', async (_event, payload) => bridge.request('download.cancel', payload));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  bridge.dispose();
});
