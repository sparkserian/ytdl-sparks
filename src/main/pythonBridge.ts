import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type BridgeEvent =
  | { event: 'download-progress'; payload: Record<string, unknown> }
  | { event: 'download-stage'; payload: Record<string, unknown> }
  | { event: 'download-log'; payload: Record<string, unknown> }
  | { event: 'download-complete'; payload: Record<string, unknown> }
  | { event: 'download-cancelled'; payload: Record<string, unknown> }
  | { event: 'download-error'; payload: Record<string, unknown> };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type BridgeMessage =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: { message: string } }
  | ({ type: 'event' } & BridgeEvent);

function resolveBridgeRuntime() {
  if (app.isPackaged) {
    const executableName = process.platform === 'win32' ? 'yt-dlp-gui-bridge.exe' : 'yt-dlp-gui-bridge';
    const packagedBinary = path.join(process.resourcesPath, 'bin', process.platform, executableName);
    if (fs.existsSync(packagedBinary)) {
      return {
        command: packagedBinary,
        args: [] as string[],
        cwd: path.dirname(packagedBinary),
      };
    }

    throw new Error(`Packaged Python bridge binary is missing: ${packagedBinary}`);
  }

  const desktopRoot = app.getAppPath();
  const bridgeScript = path.join(desktopRoot, 'backend', 'yt_dlp_gui_bridge.py');
  return {
    command: process.platform === 'win32' ? 'python' : 'python3',
    args: [bridgeScript],
    cwd: desktopRoot,
  };
}

export class PythonBridge extends EventEmitter {
  private proc?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';

  ensureStarted() {
    if (this.proc) {
      return;
    }

    const runtime = resolveBridgeRuntime();
    this.proc = spawn(runtime.command, runtime.args, {
      cwd: runtime.cwd,
      stdio: 'pipe',
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        this.handleMessage(trimmed);
      }
    });

    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => {
      this.emit('event', {
        event: 'download-log',
        payload: {
          level: 'stderr',
          message: chunk.trim(),
        },
      } satisfies BridgeEvent);
    });

    this.proc.on('error', (error) => {
      for (const request of this.pending.values()) {
        request.reject(error);
      }
      this.pending.clear();
      this.emit('event', {
        event: 'download-error',
        payload: {
          message: error.message,
        },
      } satisfies BridgeEvent);
      this.proc = undefined;
      this.buffer = '';
    });

    this.proc.on('exit', (code) => {
      const error = new Error(`Python bridge exited with code ${code ?? 'unknown'}`);
      for (const request of this.pending.values()) {
        request.reject(error);
      }
      this.pending.clear();
      this.proc = undefined;
      this.buffer = '';
    });
  }

  async request<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    this.ensureStarted();
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, payload });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc?.stdin.write(`${message}\n`, 'utf8');
    });
  }

  dispose() {
    if (!this.proc) {
      return;
    }
    this.proc.kill();
    this.proc = undefined;
  }

  private handleMessage(line: string) {
    let message: BridgeMessage;
    try {
      message = JSON.parse(line) as BridgeMessage;
    } catch {
      this.emit('event', {
        event: 'download-log',
        payload: {
          level: 'parse-error',
          message: line,
        },
      } satisfies BridgeEvent);
      return;
    }

    if ('type' in message && message.type === 'event') {
      this.emit('event', message);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);

    if (message.ok) {
      pending.resolve(message.payload);
      return;
    }

    pending.reject(new Error(message.error.message));
  }
}
