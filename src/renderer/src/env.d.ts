/// <reference types="vite/client" />

type ProbeResponse = {
  id: string;
  kind: 'single' | 'playlist';
  title: string;
  uploader?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  webpageUrl?: string | null;
  entryCount?: number;
  entries: Array<{
    id: string;
    title: string;
    duration?: number | null;
    thumbnail?: string | null;
    webpageUrl?: string | null;
  }>;
};

type BridgeEvent =
  | { event: 'download-progress'; payload: Record<string, unknown> }
  | { event: 'download-stage'; payload: Record<string, unknown> }
  | { event: 'download-log'; payload: Record<string, unknown> }
  | { event: 'download-complete'; payload: Record<string, unknown> }
  | { event: 'download-cancelled'; payload: Record<string, unknown> }
  | { event: 'download-error'; payload: Record<string, unknown> };

interface Window {
  desktopApi: {
    probeUrl: (payload: { url: string }) => Promise<ProbeResponse>;
    startDownload: (payload: Record<string, unknown>) => Promise<{ jobId: string }>;
    cancelDownload: (payload: { jobId: string }) => Promise<{ cancelled: boolean }>;
    getDefaultDownloadPath: () => Promise<string>;
    readClipboardText: () => string;
    getPlatform: () => string;
    pickDestination: () => Promise<string | null>;
    onBridgeEvent: (listener: (event: BridgeEvent) => void) => () => void;
  };
}
