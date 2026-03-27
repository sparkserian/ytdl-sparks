import { useEffect, useMemo, useRef, useState } from 'react';

type DownloadMode = 'audio' | 'video';
type MainAudioFormat = 'aac' | 'mp3';
type MainVideoFormat = 'mp4' | 'mkv';
type MainAudioQuality = 'best' | '320' | '192';
type MainVideoQuality = 'best' | '1080' | '720';
type BrowserCookieSource = 'none' | 'chrome' | 'firefox' | 'safari' | 'edge' | 'brave' | 'chromium';

type AdvancedSettings = {
  customFormat: string;
  outputTemplate: string;
  playlistItems: string;
  noPlaylist: boolean;
  writeSubtitles: boolean;
  writeAutoSubtitles: boolean;
  subtitleLanguages: string;
  subtitleFormat: string;
  writeThumbnail: boolean;
  embedThumbnail: boolean;
  writeInfoJson: boolean;
  embedMetadata: boolean;
  restrictFilenames: boolean;
  ignoreErrors: boolean;
  concurrentFragments: string;
  rateLimit: string;
  ffmpegLocation: string;
  cookieFile: string;
  cookiesFromBrowser: BrowserCookieSource;
  downloadArchive: string;
  sponsorblockRemove: boolean;
  sponsorblockCategories: string;
};

type BooleanAdvancedKey =
  | 'noPlaylist'
  | 'writeSubtitles'
  | 'writeAutoSubtitles'
  | 'writeThumbnail'
  | 'embedThumbnail'
  | 'writeInfoJson'
  | 'embedMetadata'
  | 'restrictFilenames'
  | 'ignoreErrors'
  | 'sponsorblockRemove';

type TextAdvancedKey = Exclude<keyof AdvancedSettings, BooleanAdvancedKey>;

type AdvancedField = {
  key: TextAdvancedKey;
  label: string;
  help: string;
  placeholder?: string;
  kind?: 'text' | 'select';
};

type AdvancedToggle = {
  key: BooleanAdvancedKey;
  label: string;
  help: string;
};

type AdvancedGroup = {
  title: string;
  description: string;
  fields?: AdvancedField[];
  toggles?: AdvancedToggle[];
};

const browserSources: BrowserCookieSource[] = ['none', 'chrome', 'firefox', 'safari', 'edge', 'brave', 'chromium'];

const advancedGroups: AdvancedGroup[] = [
  {
    title: 'Download setup',
    description: 'Adjust naming, format selection, and playlist slicing.',
    fields: [
      {
        key: 'customFormat',
        label: 'Raw format selector',
        help: 'Direct yt-dlp format selector. Leave blank for the normal audio or video presets.',
        placeholder: 'Optional yt-dlp format string',
      },
      {
        key: 'outputTemplate',
        label: 'Output template',
        help: 'Controls the saved filename. Leave blank to use the app default.',
        placeholder: '%(track,title)s - %(artist,uploader)s [%(id)s].%(ext)s',
      },
      {
        key: 'playlistItems',
        label: 'Playlist items',
        help: 'Download only a slice of a playlist, such as 1-25 or 1,3,5.',
        placeholder: '1-25,30,40',
      },
    ],
    toggles: [
      {
        key: 'noPlaylist',
        label: 'Force single item',
        help: 'Ignore the rest of a playlist and download only the currently linked item.',
      },
      {
        key: 'restrictFilenames',
        label: 'Restrict filenames',
        help: 'Avoid spaces and special characters for simpler cross-platform filenames.',
      },
      {
        key: 'ignoreErrors',
        label: 'Ignore item errors',
        help: 'Keep a playlist job moving when one item fails instead of stopping the whole run.',
      },
    ],
  },
  {
    title: 'Subtitles and artwork',
    description: 'Write subtitle files, thumbnails, and related side assets.',
    fields: [
      {
        key: 'subtitleLanguages',
        label: 'Subtitle languages',
        help: 'Comma-separated language codes for subtitle downloads.',
        placeholder: 'en,es',
      },
      {
        key: 'subtitleFormat',
        label: 'Subtitle format',
        help: 'Preferred subtitle file format when subtitles are available.',
        placeholder: 'best',
      },
    ],
    toggles: [
      {
        key: 'writeSubtitles',
        label: 'Write subtitles',
        help: 'Save manual subtitle tracks when the source provides them.',
      },
      {
        key: 'writeAutoSubtitles',
        label: 'Write auto subtitles',
        help: 'Save auto-generated subtitles when manual captions are unavailable.',
      },
      {
        key: 'writeThumbnail',
        label: 'Write thumbnail',
        help: 'Save the source artwork as a separate image file.',
      },
      {
        key: 'embedThumbnail',
        label: 'Embed thumbnail',
        help: 'Attach the artwork to the final audio or video file when the format supports it.',
      },
    ],
  },
  {
    title: 'Metadata and archive',
    description: 'Keep richer records and skip content you already downloaded.',
    fields: [
      {
        key: 'downloadArchive',
        label: 'Download archive',
        help: 'Path to a text archive used to skip items that were already downloaded before.',
        placeholder: '/path/to/archive.txt',
      },
      {
        key: 'sponsorblockCategories',
        label: 'SponsorBlock categories',
        help: 'Comma-separated SponsorBlock categories to remove when chapter cleanup is enabled.',
        placeholder: 'sponsor,selfpromo,interaction',
      },
    ],
    toggles: [
      {
        key: 'writeInfoJson',
        label: 'Write info JSON',
        help: 'Save the extractor metadata beside each file for auditing or later reuse.',
      },
      {
        key: 'embedMetadata',
        label: 'Embed metadata',
        help: 'Write title, artist, album, and related tags into the final file when possible.',
      },
      {
        key: 'sponsorblockRemove',
        label: 'Remove sponsor segments',
        help: 'Cut marked sponsor segments when SponsorBlock data exists for the video.',
      },
    ],
  },
  {
    title: 'Network and tools',
    description: 'Use cookies, override ffmpeg, and tune transfer behavior.',
    fields: [
      {
        key: 'cookieFile',
        label: 'Cookie file',
        help: 'Path to a cookies.txt file when a site requires your logged-in browser session.',
        placeholder: '/path/to/cookies.txt',
      },
      {
        key: 'cookiesFromBrowser',
        label: 'Cookies from browser',
        help: 'Import cookies directly from an installed browser profile.',
        kind: 'select',
      },
      {
        key: 'ffmpegLocation',
        label: 'ffmpeg location',
        help: 'Optional path to a custom ffmpeg folder if you do not want to use the bundled tools.',
        placeholder: '/opt/homebrew/bin',
      },
      {
        key: 'concurrentFragments',
        label: 'Concurrent fragments',
        help: 'Higher values can speed up fragmented downloads, but they use more network connections.',
        placeholder: '4',
      },
      {
        key: 'rateLimit',
        label: 'Rate limit',
        help: 'Throttle bandwidth with values like 2M or 500K.',
        placeholder: '2M',
      },
    ],
  },
];

const initialAdvancedSettings: AdvancedSettings = {
  customFormat: '',
  outputTemplate: '',
  playlistItems: '',
  noPlaylist: false,
  writeSubtitles: false,
  writeAutoSubtitles: false,
  subtitleLanguages: 'en',
  subtitleFormat: 'best',
  writeThumbnail: false,
  embedThumbnail: false,
  writeInfoJson: false,
  embedMetadata: false,
  restrictFilenames: false,
  ignoreErrors: true,
  concurrentFragments: '4',
  rateLimit: '',
  ffmpegLocation: '',
  cookieFile: '',
  cookiesFromBrowser: 'none',
  downloadArchive: '',
  sponsorblockRemove: false,
  sponsorblockCategories: 'sponsor,selfpromo,interaction',
};

function formatDuration(value?: number | null) {
  if (!value) {
    return '--:--';
  }
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  }
  return [minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatBytes(value?: number) {
  if (!value || value <= 0) {
    return 'Unknown size';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function toYouTubeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /(?:youtube\.com|youtu\.be)/i.test(trimmed) ? trimmed : null;
}

function buildPlaylistSelection(items: ProbeResponse['entries'], selectedIds: string[]) {
  const selected = new Set(selectedIds);
  const indices = items
    .map((entry, index) => (selected.has(entry.id) ? index + 1 : null))
    .filter((value): value is number => value !== null);

  if (indices.length === 0) {
    return '';
  }

  const ranges: string[] = [];
  let start = indices[0];
  let end = indices[0];

  for (let index = 1; index < indices.length; index += 1) {
    const current = indices[index];
    if (current === end + 1) {
      end = current;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = current;
    end = current;
  }

  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(',');
}

function App() {
  const desktopApi = typeof window !== 'undefined' ? window.desktopApi : undefined;
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<DownloadMode>('audio');
  const [audioFormat, setAudioFormat] = useState<MainAudioFormat>('aac');
  const [videoFormat, setVideoFormat] = useState<MainVideoFormat>('mp4');
  const [audioQuality, setAudioQuality] = useState<MainAudioQuality>('best');
  const [videoQuality, setVideoQuality] = useState<MainVideoQuality>('1080');
  const [destination, setDestination] = useState('');
  const [platform, setPlatform] = useState('device');
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedSettings>(initialAdvancedSettings);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [progress, setProgress] = useState<{
    status: string;
    downloadedBytes?: number;
    totalBytes?: number;
    speed?: number;
    eta?: number;
    filename?: string;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tipText, setTipText] = useState('Copy a YouTube link while the app is active and it will load automatically.');
  const clipboardSeenRef = useRef('');
  const probingUrlRef = useRef('');

  useEffect(() => {
    if (!desktopApi) {
      setError('Desktop bridge is unavailable. The preload script did not initialize.');
      return;
    }

    void desktopApi.getDefaultDownloadPath().then((path) => {
      setDestination(path);
    });
    setPlatform(desktopApi.getPlatform());

    return desktopApi.onBridgeEvent((event) => {
      if (event.event === 'download-progress') {
        const payload = event.payload as {
          jobId?: string;
          status: string;
          downloadedBytes?: number;
          totalBytes?: number;
          speed?: number;
          eta?: number;
          filename?: string;
        };
        if (payload.jobId !== jobId) {
          return;
        }
        setProgress(payload);
        if (payload.status === 'finished') {
          setTipText(`Finished ${payload.filename ?? 'download'}`);
        }
      }

      if (event.event === 'download-stage') {
        const payload = event.payload as { jobId?: string; stage: string };
        if (payload.jobId !== jobId) {
          return;
        }
        setLogs((current) => [payload.stage, ...current].slice(0, 8));
      }

      if (event.event === 'download-log') {
        const payload = event.payload as { jobId?: string; message?: string };
        if (payload.jobId && payload.jobId !== jobId) {
          return;
        }
        if (payload.message) {
          setLogs((current) => [payload.message, ...current].slice(0, 8));
        }
      }

      if (event.event === 'download-complete') {
        const payload = event.payload as { jobId?: string };
        if (payload.jobId !== jobId) {
          return;
        }
        setIsDownloading(false);
        setProgress((current) => (current ? { ...current, status: 'complete' } : current));
        setTipText('Download completed.');
      }

      if (event.event === 'download-cancelled') {
        const payload = event.payload as { jobId?: string };
        if (payload.jobId !== jobId) {
          return;
        }
        setIsDownloading(false);
        setTipText('Download cancelled.');
      }

      if (event.event === 'download-error') {
        const payload = event.payload as { jobId?: string; message?: string };
        if (payload.jobId && payload.jobId !== jobId) {
          return;
        }
        setIsDownloading(false);
        setError(payload.message ?? 'Download failed');
      }
    });
  }, [desktopApi, jobId]);

  useEffect(() => {
    if (!probe) {
      setSelectedEntryIds([]);
      return;
    }
    setSelectedEntryIds(probe.entries.map((entry) => entry.id));
    setQueueExpanded(true);
  }, [probe]);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    const interval = window.setInterval(() => {
      if (isProbing || isDownloading) {
        return;
      }

      const text = desktopApi.readClipboardText();
      const nextUrl = toYouTubeUrl(text);
      if (!nextUrl || nextUrl === clipboardSeenRef.current) {
        return;
      }
      clipboardSeenRef.current = nextUrl;
      setTipText('YouTube link detected from clipboard.');
      setUrl(nextUrl);
      void analyzeUrl(nextUrl, true);
    }, 1200);

    return () => {
      window.clearInterval(interval);
    };
  }, [desktopApi, isDownloading, isProbing]);

  const deviceLabel = useMemo(() => {
    if (platform === 'darwin') {
      return 'Download to this Mac';
    }
    if (platform === 'win32') {
      return 'Download to this PC';
    }
    return 'Download to this device';
  }, [platform]);

  const selectedContainer = mode === 'audio' ? audioFormat : videoFormat;
  const selectedQuality = mode === 'audio' ? audioQuality : videoQuality;
  const percent =
    progress?.downloadedBytes && progress.totalBytes
      ? Math.max(0, Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100))
      : 0;
  const heroEntry = probe?.entries?.[0];
  const listEntries = probe?.entries ?? [];
  const selectionDuration = probe?.duration ?? heroEntry?.duration ?? null;
  const sourceKind = probe?.kind === 'playlist' ? 'Playlist' : probe ? 'Single item' : 'Ready';
  const statusLine = error ?? logs[0] ?? tipText;
  const selectedEntryCount = probe?.kind === 'playlist' ? selectedEntryIds.length : listEntries.length;

  async function analyzeUrl(nextUrl: string, fromClipboard = false) {
    if (!desktopApi) {
      setError('Desktop bridge is unavailable. The preload script did not initialize.');
      return;
    }
    if (!nextUrl.trim()) {
      setError('Paste or copy a YouTube URL first.');
      return;
    }
    if (probingUrlRef.current === nextUrl) {
      return;
    }

    setError(null);
    setIsProbing(true);
    probingUrlRef.current = nextUrl;

    try {
      const nextProbe = await desktopApi.probeUrl({ url: nextUrl.trim() });
      setProbe(nextProbe);
      setTipText(fromClipboard ? 'Clipboard link analyzed.' : `Loaded ${nextProbe.title}`);
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : 'Unable to inspect URL');
    } finally {
      probingUrlRef.current = '';
      setIsProbing(false);
    }
  }

  function updateAdvanced<K extends keyof AdvancedSettings>(key: K, value: AdvancedSettings[K]) {
    setAdvanced((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handlePickDestination() {
    if (!desktopApi) {
      setError('Desktop bridge is unavailable. The preload script did not initialize.');
      return;
    }
    const selected = await desktopApi.pickDestination();
    if (selected) {
      setDestination(selected);
    }
  }

  async function handleDownload() {
    if (!desktopApi) {
      setError('Desktop bridge is unavailable. The preload script did not initialize.');
      return;
    }
    if (!probe || !url.trim()) {
      setError('Load a YouTube video or playlist first.');
      return;
    }
    if (!destination) {
      setError('Choose a destination folder first.');
      return;
    }
    if (probe.kind === 'playlist' && selectedEntryIds.length === 0) {
      setError('Select at least one playlist item first.');
      return;
    }

    setError(null);
    setLogs([]);
    setProgress(null);
    setIsDownloading(true);
    const nextJobId = crypto.randomUUID();
    setJobId(nextJobId);

    const effectiveAdvanced = {
      ...advanced,
      playlistItems: probe.kind === 'playlist'
        ? buildPlaylistSelection(probe.entries, selectedEntryIds)
        : advanced.playlistItems,
    };

    try {
      await desktopApi.startDownload({
        jobId: nextJobId,
        url: url.trim(),
        destination,
        mode,
        container: selectedContainer,
        quality: selectedQuality,
        advanced: effectiveAdvanced,
      });
    } catch (downloadError) {
      setJobId(null);
      setIsDownloading(false);
      setError(downloadError instanceof Error ? downloadError.message : 'Unable to start download');
    }
  }

  async function handleCancel() {
    if (!desktopApi || !jobId) {
      return;
    }
    await desktopApi.cancelDownload({ jobId });
  }

  function toggleEntry(entryId: string) {
    setSelectedEntryIds((current) => (
      current.includes(entryId)
        ? current.filter((id) => id !== entryId)
        : [...current, entryId]
    ));
  }

  function selectAllEntries() {
    setSelectedEntryIds(listEntries.map((entry) => entry.id));
  }

  function clearAllEntries() {
    setSelectedEntryIds([]);
  }

  return (
    <div className="app-canvas">
      <main className="utility-window">
        <header className="window-strip">
          <strong className="window-title">ytdl-sparks</strong>
          <div className="window-tools">
            {probe && <span className="window-state">{sourceKind}</span>}
            <button
              type="button"
              className={`window-tool-button ${showAdvanced ? 'active' : ''}`}
              onClick={() => setShowAdvanced((value) => !value)}
            >
              Advanced
            </button>
          </div>
        </header>

        <div className="window-body">
          {!probe && <div className="idle-spacer" />}

          <div className="source-bar">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste a YouTube link"
            />
            <button
              type="button"
              className="source-go"
              onClick={() => void analyzeUrl(url)}
              disabled={isProbing}
            >
              {isProbing ? '...' : 'Go'}
            </button>
          </div>

          {!probe && !isProbing && (
            <div className="idle-hint">
              <p>Clipboard watch is active — copy a YouTube link and it loads automatically.</p>
            </div>
          )}

          {!probe && <div className="idle-spacer" />}

          {probe && (
            <div className="meta-row">
              <div className="meta-art">
                {heroEntry?.thumbnail ? (
                  <img src={heroEntry.thumbnail} alt={heroEntry.title} />
                ) : (
                  <div className="meta-art-fallback">YT</div>
                )}
              </div>
              <div className="meta-copy">
                <h1>{probe.title}</h1>
                <span className="meta-sub">
                  {probe.uploader ? `${probe.uploader} \u00b7 ` : ''}{formatDuration(selectionDuration)}
                </span>
              </div>
            </div>
          )}

          {probe?.kind === 'playlist' && !isDownloading && (
            <div className="queue-section">
              <button
                type="button"
                className="queue-toggle"
                onClick={() => setQueueExpanded((value) => !value)}
              >
                <span>{selectedEntryCount} of {probe.entryCount ?? listEntries.length} items selected</span>
                <span className="queue-chevron">{queueExpanded ? '\u25b4' : '\u25be'}</span>
              </button>
              {queueExpanded && (
                <>
                  <div className="queue-list">
                    {listEntries.map((entry, index) => (
                      <div
                        key={entry.id || `${entry.title}-${index}`}
                        className={`queue-row ${selectedEntryIds.includes(entry.id) ? 'selected' : ''}`}
                        onClick={() => toggleEntry(entry.id)}
                      >
                        <input
                          type="checkbox"
                          className="queue-check"
                          checked={selectedEntryIds.includes(entry.id)}
                          onChange={() => toggleEntry(entry.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
                        <div className="queue-copy">
                          <strong>{entry.title}</strong>
                          <span>{formatDuration(entry.duration)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="queue-actions">
                    <button type="button" className="mini-text-button" onClick={selectAllEntries}>
                      Select all
                    </button>
                    <button type="button" className="mini-text-button" onClick={clearAllEntries}>
                      Clear
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {probe && !isDownloading && (
            <div className="controls-section">
              <div className="control-row">
                <label>Mode</label>
                <div className="segmented-row">
                  <button type="button" className={mode === 'audio' ? 'active' : ''} onClick={() => setMode('audio')}>
                    Audio
                  </button>
                  <button type="button" className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}>
                    Video
                  </button>
                </div>
              </div>

              <div className="control-row">
                <label>Format</label>
                <div className="segmented-row">
                  {mode === 'audio' ? (
                    <>
                      <button type="button" className={audioFormat === 'aac' ? 'active' : ''} onClick={() => setAudioFormat('aac')}>
                        AAC
                      </button>
                      <button type="button" className={audioFormat === 'mp3' ? 'active' : ''} onClick={() => setAudioFormat('mp3')}>
                        MP3
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={videoFormat === 'mp4' ? 'active' : ''} onClick={() => setVideoFormat('mp4')}>
                        MP4
                      </button>
                      <button type="button" className={videoFormat === 'mkv' ? 'active' : ''} onClick={() => setVideoFormat('mkv')}>
                        MKV
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="control-row">
                <label>Quality</label>
                <div className="segmented-row">
                  {mode === 'audio' ? (
                    <>
                      <button type="button" className={audioQuality === 'best' ? 'active' : ''} onClick={() => setAudioQuality('best')}>
                        Best
                      </button>
                      <button type="button" className={audioQuality === '320' ? 'active' : ''} onClick={() => setAudioQuality('320')}>
                        320
                      </button>
                      <button type="button" className={audioQuality === '192' ? 'active' : ''} onClick={() => setAudioQuality('192')}>
                        192
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={videoQuality === '1080' ? 'active' : ''} onClick={() => setVideoQuality('1080')}>
                        1080
                      </button>
                      <button type="button" className={videoQuality === '720' ? 'active' : ''} onClick={() => setVideoQuality('720')}>
                        720
                      </button>
                      <button type="button" className={videoQuality === 'best' ? 'active' : ''} onClick={() => setVideoQuality('best')}>
                        Best
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="destination-row">
                <div className="destination-copy">
                  <strong>Save to</strong>
                  <span>{destination || 'No folder selected'}</span>
                </div>
                <button type="button" className="mini-text-button" onClick={handlePickDestination}>
                  Change
                </button>
              </div>

              <button
                type="button"
                className="action-button primary"
                onClick={handleDownload}
                disabled={isDownloading}
              >
                {deviceLabel}
              </button>
            </div>
          )}

          {isDownloading && (
            <div className="progress-section">
              <div className="progress-info">
                <span className="progress-label">
                  {percent > 0 ? `${percent.toFixed(1)}%` : 'Preparing\u2026'}
                </span>
                <span className="progress-stats">
                  {formatBytes(progress?.downloadedBytes)} / {formatBytes(progress?.totalBytes)}
                  {progress?.speed ? ` \u00b7 ${formatBytes(progress.speed)}/s` : ''}
                </span>
              </div>
              <div className="progress-meter">
                <div style={{ width: `${percent}%` }} />
              </div>
              <button type="button" className="action-button cancel" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          )}
        </div>

        <footer className={`status-strip ${error ? 'error' : ''}`}>
          <span className="status-chip">{error ? 'Error' : isDownloading ? 'Working' : 'Status'}</span>
          <span className="status-copy">{statusLine}</span>
        </footer>

        {showAdvanced ? (
          <div className="advanced-overlay" onClick={() => setShowAdvanced(false)}>
            <aside className="advanced-modal" onClick={(event) => event.stopPropagation()}>
              <div className="advanced-header">
                <div>
                  <strong>Advanced options</strong>
                  <p>These controls change how yt-dlp selects formats, writes side files, and handles cookies or ffmpeg.</p>
                </div>
                <button type="button" className="mini-text-button" onClick={() => setShowAdvanced(false)}>
                  Close
                </button>
              </div>

              <div className="advanced-scroll">
                {advancedGroups.map((group) => (
                  <section key={group.title} className="advanced-section">
                    <div className="advanced-section-head">
                      <strong>{group.title}</strong>
                      <span>{group.description}</span>
                    </div>

                    {group.fields?.map((field) => (
                      <label key={field.key} className="advanced-field">
                        <span>{field.label}</span>
                        <small>{field.help}</small>
                        {field.kind === 'select' ? (
                          <select
                            value={advanced[field.key] as BrowserCookieSource}
                            onChange={(event) => updateAdvanced(field.key, event.target.value as AdvancedSettings[typeof field.key])}
                          >
                            {browserSources.map((browser) => (
                              <option key={browser} value={browser}>
                                {browser === 'none' ? 'Disabled' : browser}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={String(advanced[field.key] ?? '')}
                            onChange={(event) => updateAdvanced(field.key, event.target.value as AdvancedSettings[typeof field.key])}
                            placeholder={field.placeholder}
                          />
                        )}
                      </label>
                    ))}

                    {group.toggles ? (
                      <div className="advanced-toggle-list">
                        {group.toggles.map((toggle) => (
                          <label key={toggle.key} className="advanced-toggle">
                            <div className="advanced-toggle-copy">
                              <span>{toggle.label}</span>
                              <small>{toggle.help}</small>
                            </div>
                            <input type="checkbox" checked={advanced[toggle.key]} onChange={(event) => updateAdvanced(toggle.key, event.target.checked)} />
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </aside>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default App;
