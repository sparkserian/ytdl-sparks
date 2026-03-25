import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

type BridgeEvent =
  | { event: 'download-progress'; payload: Record<string, unknown> }
  | { event: 'download-stage'; payload: Record<string, unknown> }
  | { event: 'download-log'; payload: Record<string, unknown> }
  | { event: 'download-complete'; payload: Record<string, unknown> }
  | { event: 'download-cancelled'; payload: Record<string, unknown> }
  | { event: 'download-error'; payload: Record<string, unknown> };

type RunningJob = {
  jobId: string;
  process: ChildProcessWithoutNullStreams;
  cancelled: boolean;
  completed: boolean;
};

const PROGRESS_PREFIX = '__YTDLP_GUI_PROGRESS__';
const COMPLETE_PREFIX = '__YTDLP_GUI_COMPLETE__';
const DEFAULT_SPONSORBLOCK_CATEGORIES = 'sponsor,selfpromo,interaction';

function getWindowsResourceDir() {
  return path.join(process.resourcesPath, 'bin', `win32-${process.arch}`);
}

function getBundledExecutable(name: string) {
  return path.join(getWindowsResourceDir(), name);
}

function ensureBundledExecutable(name: string) {
  const executablePath = getBundledExecutable(name);
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Missing packaged Windows dependency: ${executablePath}`);
  }
  return executablePath;
}

function simplifyProbe(info: Record<string, unknown>) {
  const rawEntries = Array.isArray(info.entries) ? info.entries : [];
  const entries = rawEntries
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .slice(0, 25)
    .map((entry) => ({
      id: String(entry.id ?? ''),
      title: String(entry.title ?? 'Untitled'),
      duration: typeof entry.duration === 'number' ? entry.duration : null,
      thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : null,
      webpageUrl: String(entry.webpage_url ?? entry.original_url ?? entry.url ?? ''),
    }));

  return {
    id: String(info.id ?? ''),
    kind: entries.length > 0 ? 'playlist' : 'single',
    title: String(info.title ?? 'Untitled'),
    uploader: typeof info.uploader === 'string' ? info.uploader : typeof info.channel === 'string' ? info.channel : null,
    duration: typeof info.duration === 'number' ? info.duration : null,
    thumbnail: typeof info.thumbnail === 'string' ? info.thumbnail : null,
    webpageUrl: String(info.webpage_url ?? info.original_url ?? info.url ?? ''),
    entryCount: typeof info.playlist_count === 'number' ? info.playlist_count : entries.length || 1,
    entries: entries.length > 0
      ? entries
      : [{
          id: String(info.id ?? ''),
          title: String(info.title ?? 'Untitled'),
          duration: typeof info.duration === 'number' ? info.duration : null,
          thumbnail: typeof info.thumbnail === 'string' ? info.thumbnail : null,
          webpageUrl: String(info.webpage_url ?? info.original_url ?? info.url ?? ''),
        }],
  };
}

function buildFormat(mode: string, quality: string, customFormat?: string) {
  if (customFormat?.trim()) {
    return customFormat.trim();
  }
  if (mode === 'audio') {
    return 'bestaudio/best';
  }
  if (quality === 'best') {
    return 'bv*+ba/b';
  }
  return `bv*[height<=${quality}]+ba/b[height<=${quality}]`;
}

function pushOptionalArg(args: string[], flag: string, value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === undefined || normalized === null || normalized === '') {
    return;
  }
  args.push(flag, String(normalized));
}

function toLineChunks(buffer: string) {
  const lines = buffer.split(/\r?\n/);
  return {
    lines: lines.slice(0, -1),
    rest: lines.at(-1) ?? '',
  };
}

export class YtDlpCliBridge extends EventEmitter {
  private jobs = new Map<string, RunningJob>();

  async request<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    if (method === 'probe') {
      return this.probe(payload) as Promise<T>;
    }
    if (method === 'download.start') {
      return this.startDownload(payload) as Promise<T>;
    }
    if (method === 'download.cancel') {
      return this.cancelDownload(payload) as Promise<T>;
    }
    throw new Error(`Unknown bridge method: ${method}`);
  }

  dispose() {
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      job.process.kill();
    }
    this.jobs.clear();
  }

  private async probe(payload: Record<string, unknown>) {
    const url = String(payload.url ?? '').trim();
    if (!url) {
      throw new Error('A URL is required for probing');
    }

    const ytDlp = ensureBundledExecutable('yt-dlp.exe');
    const args = ['-J', '--flat-playlist', '--playlist-end', '25', '--no-warnings', '--skip-download', url];
    const { stdout } = await this.runCommand(ytDlp, args);
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return simplifyProbe(parsed);
  }

  private async startDownload(payload: Record<string, unknown>) {
    const jobId = String(payload.jobId ?? '');
    const url = String(payload.url ?? '').trim();
    const destination = String(payload.destination ?? '').trim();
    const mode = String(payload.mode ?? 'audio');
    const container = String(payload.container ?? '');
    const quality = String(payload.quality ?? 'best');
    const advanced = (payload.advanced ?? {}) as Record<string, unknown>;

    if (!jobId || !url || !destination) {
      throw new Error('jobId, url, and destination are required');
    }

    const ytDlp = ensureBundledExecutable('yt-dlp.exe');
    const ffmpegDir = getWindowsResourceDir();
    const args: string[] = [
      '--newline',
      '--no-warnings',
      '--ignore-config',
      '-P',
      destination,
      '-o',
      String(advanced.outputTemplate || '%(title)s [%(id)s].%(ext)s'),
      '-f',
      buildFormat(mode, quality, String(advanced.customFormat || '')),
      '--progress-template',
      `download:${PROGRESS_PREFIX}%(progress.status)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s\t%(progress.filename)s`,
      '--print',
      `after_move:${COMPLETE_PREFIX}%(filepath)s`,
    ];

    if (mode === 'audio') {
      args.push('-x', '--audio-format', container);
      if (quality !== 'best') {
        args.push('--audio-quality', quality);
      }
    } else if (container) {
      args.push('--merge-output-format', container);
    }

    if (advanced.noPlaylist) {
      args.push('--no-playlist');
    }
    if (advanced.writeSubtitles) {
      args.push('--write-subs');
    }
    if (advanced.writeAutoSubtitles) {
      args.push('--write-auto-subs');
    }
    if (advanced.writeThumbnail) {
      args.push('--write-thumbnail');
    }
    if (advanced.embedThumbnail) {
      args.push('--embed-thumbnail');
    }
    if (advanced.writeInfoJson) {
      args.push('--write-info-json');
    }
    if (advanced.embedMetadata) {
      args.push('--embed-metadata');
    }
    if (advanced.restrictFilenames) {
      args.push('--restrict-filenames');
    }
    if (advanced.ignoreErrors) {
      args.push('--ignore-errors');
    }
    if (advanced.sponsorblockRemove) {
      args.push('--sponsorblock-remove', String(advanced.sponsorblockCategories || DEFAULT_SPONSORBLOCK_CATEGORIES));
    }

    pushOptionalArg(args, '--playlist-items', advanced.playlistItems);
    pushOptionalArg(args, '--sub-langs', advanced.subtitleLanguages);
    pushOptionalArg(args, '--sub-format', advanced.subtitleFormat);
    pushOptionalArg(args, '-N', advanced.concurrentFragments);
    pushOptionalArg(args, '-r', advanced.rateLimit);
    pushOptionalArg(args, '--cookies', advanced.cookieFile);
    pushOptionalArg(args, '--download-archive', advanced.downloadArchive);

    const cookieBrowser = String(advanced.cookiesFromBrowser || 'none');
    if (cookieBrowser && cookieBrowser !== 'none') {
      args.push('--cookies-from-browser', cookieBrowser);
    }

    const customFfmpeg = String(advanced.ffmpegLocation || '').trim();
    const effectiveFfmpegLocation = customFfmpeg || ffmpegDir;
    if (fs.existsSync(path.join(effectiveFfmpegLocation, 'ffmpeg.exe'))) {
      args.push('--ffmpeg-location', effectiveFfmpegLocation);
    }

    args.push(url);

    const child = spawn(ytDlp, args, {
      cwd: destination,
      stdio: 'pipe',
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const job: RunningJob = {
      jobId,
      process: child,
      cancelled: false,
      completed: false,
    };
    this.jobs.set(jobId, job);
    this.emit('event', {
      event: 'download-stage',
      payload: {
        jobId,
        stage: 'Starting yt-dlp job',
      },
    } satisfies BridgeEvent);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const handleChunk = (chunk: string) => {
      const next = toLineChunks(chunk);
      return next;
    };

    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const { lines, rest } = handleChunk(stdoutBuffer);
      stdoutBuffer = rest;
      for (const line of lines) {
        this.handleOutputLine(job, line);
      }
    });

    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      const { lines, rest } = handleChunk(stderrBuffer);
      stderrBuffer = rest;
      for (const line of lines) {
        this.handleOutputLine(job, line);
      }
    });

    child.on('error', (error) => {
      this.emit('event', {
        event: 'download-error',
        payload: {
          jobId,
          message: error.message,
        },
      } satisfies BridgeEvent);
      this.jobs.delete(jobId);
    });

    child.on('exit', (code) => {
      if (stdoutBuffer.trim()) {
        this.handleOutputLine(job, stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        this.handleOutputLine(job, stderrBuffer.trim());
      }

      this.jobs.delete(jobId);
      if (job.cancelled) {
        this.emit('event', {
          event: 'download-cancelled',
          payload: { jobId },
        } satisfies BridgeEvent);
        return;
      }
      if (code === 0) {
        if (!job.completed) {
          this.emit('event', {
            event: 'download-complete',
            payload: { jobId },
          } satisfies BridgeEvent);
        }
        return;
      }
      this.emit('event', {
        event: 'download-error',
        payload: {
          jobId,
          message: `yt-dlp exited with code ${code ?? 'unknown'}`,
        },
      } satisfies BridgeEvent);
    });

    return { jobId };
  }

  private async cancelDownload(payload: Record<string, unknown>) {
    const jobId = String(payload.jobId ?? '');
    const job = this.jobs.get(jobId);
    if (!job) {
      return { cancelled: false };
    }
    job.cancelled = true;
    job.process.kill();
    return { cancelled: true };
  }

  private handleOutputLine(job: RunningJob, rawLine: string) {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    if (line.startsWith(PROGRESS_PREFIX)) {
      const data = line.slice(PROGRESS_PREFIX.length).split('\t');
      this.emit('event', {
        event: 'download-progress',
        payload: {
          jobId: job.jobId,
          status: data[0] || 'downloading',
          downloadedBytes: Number(data[1]) || undefined,
          totalBytes: Number(data[2]) || Number(data[3]) || undefined,
          speed: Number(data[4]) || undefined,
          eta: Number(data[5]) || undefined,
          filename: data[6] || undefined,
        },
      } satisfies BridgeEvent);
      return;
    }

    if (line.startsWith(COMPLETE_PREFIX)) {
      job.completed = true;
      this.emit('event', {
        event: 'download-complete',
        payload: {
          jobId: job.jobId,
          filepath: line.slice(COMPLETE_PREFIX.length),
        },
      } satisfies BridgeEvent);
      return;
    }

    this.emit('event', {
      event: 'download-log',
      payload: {
        jobId: job.jobId,
        level: 'info',
        message: line,
      },
    } satisfies BridgeEvent);
  }

  private async runCommand(command: string, args: string[]) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'pipe',
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code ?? 'unknown'}`));
      });
    });
  }
}
