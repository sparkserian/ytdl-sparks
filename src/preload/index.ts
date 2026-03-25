import { clipboard, contextBridge, ipcRenderer } from 'electron';

const api = {
  probeUrl: (payload: Record<string, unknown>) => ipcRenderer.invoke('bridge:probe', payload),
  startDownload: (payload: Record<string, unknown>) => ipcRenderer.invoke('bridge:download-start', payload),
  cancelDownload: (payload: Record<string, unknown>) => ipcRenderer.invoke('bridge:download-cancel', payload),
  getDefaultDownloadPath: (): Promise<string> => ipcRenderer.invoke('app:get-default-download-path'),
  readClipboardText: (): string => clipboard.readText(),
  getPlatform: (): string => process.platform,
  pickDestination: (): Promise<string | null> => ipcRenderer.invoke('app:pick-destination'),
  onBridgeEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on('bridge:event', wrapped);
    return () => ipcRenderer.removeListener('bridge:event', wrapped);
  },
};

contextBridge.exposeInMainWorld('desktopApi', api);
