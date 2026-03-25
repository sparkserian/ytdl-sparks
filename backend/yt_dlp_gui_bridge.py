from __future__ import annotations

import json
import os
import queue
import shutil
import sys
import threading
import traceback
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if not getattr(sys, 'frozen', False):
    REPO_ROOT = Path(__file__).resolve().parents[1]
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))

import yt_dlp
from yt_dlp.utils import DownloadCancelled, parse_bytes


DEFAULT_OUTPUT_TEMPLATE = '%(track,title)s - %(artist,uploader)s [%(id)s].%(ext)s'
DEFAULT_SPONSORBLOCK_CATEGORIES = ('sponsor', 'selfpromo', 'interaction')


def simplify_entry(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(entry.get('id') or ''),
        'title': entry.get('title') or 'Untitled',
        'duration': entry.get('duration'),
        'thumbnail': entry.get('thumbnail'),
        'webpageUrl': entry.get('webpage_url') or entry.get('original_url') or entry.get('url'),
    }


def simplify_probe(info: dict[str, Any]) -> dict[str, Any]:
    entries = [
        simplify_entry(entry)
        for entry in (info.get('entries') or [])
        if isinstance(entry, dict)
    ]
    kind = 'playlist' if entries else 'single'
    return {
        'id': str(info.get('id') or ''),
        'kind': kind,
        'title': info.get('title') or 'Untitled',
        'uploader': info.get('uploader') or info.get('channel'),
        'duration': info.get('duration'),
        'thumbnail': info.get('thumbnail'),
        'webpageUrl': info.get('webpage_url') or info.get('original_url') or info.get('url'),
        'entryCount': info.get('playlist_count') or len(entries) or 1,
        'entries': entries[:200] if entries else [simplify_entry(info)],
    }


def parse_csv(value: Any) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in str(value).split(',') if item.strip()]


def parse_optional_int(value: Any, field_name: str) -> int | None:
    if value in (None, ''):
        return None
    try:
        parsed = int(str(value).strip())
    except ValueError as error:
        raise ValueError(f'{field_name} must be an integer') from error
    if parsed <= 0:
        raise ValueError(f'{field_name} must be greater than 0')
    return parsed


def parse_rate_limit(value: Any) -> int | None:
    if value in (None, ''):
        return None
    parsed = parse_bytes(str(value).strip())
    if parsed is None or parsed <= 0:
        raise ValueError('Rate limit must be a positive byte value such as 2M or 500K')
    return parsed


def normalize_browser(value: Any) -> tuple[str] | None:
    if not value:
        return None
    browser = str(value).strip().lower()
    if browser in {'', 'none'}:
        return None
    return (browser,)


def get_resource_platform_dir() -> str:
    return {
        'darwin': 'darwin',
        'win32': 'win32',
        'linux': 'linux',
    }.get(sys.platform, sys.platform)


def get_ffmpeg_binary_names() -> tuple[str, str]:
    if sys.platform == 'win32':
        return 'ffmpeg.exe', 'ffprobe.exe'
    return 'ffmpeg', 'ffprobe'


def has_ffmpeg_tools(directory: Path) -> bool:
    ffmpeg_name, ffprobe_name = get_ffmpeg_binary_names()
    return (
        directory.is_dir()
        and os.access(directory / ffmpeg_name, os.X_OK)
        and os.access(directory / ffprobe_name, os.X_OK)
    )


def get_ffmpeg_candidates(custom_location: Any) -> list[Path]:
    candidates: list[Path] = []

    if custom_location:
        custom_path = Path(str(custom_location).strip()).expanduser()
        candidates.append(custom_path if custom_path.is_dir() else custom_path.parent)

    if getattr(sys, 'frozen', False):
        candidates.append(Path(sys.executable).resolve().parent)
    else:
        candidates.append(Path(__file__).resolve().parents[1] / 'resources' / 'bin' / get_resource_platform_dir())

    for binary_name in get_ffmpeg_binary_names():
        discovered = shutil.which(binary_name)
        if discovered:
            candidates.append(Path(discovered).resolve().parent)

    candidates.extend([
        Path.home() / '.local' / 'opt' / 'ffmpeg' / 'bin',
        Path('/opt/homebrew/bin'),
        Path('/usr/local/bin'),
        Path('/usr/bin'),
    ])

    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def resolve_ffmpeg_location(custom_location: Any) -> str | None:
    for candidate in get_ffmpeg_candidates(custom_location):
        if has_ffmpeg_tools(candidate):
            return str(candidate)
    return None


def build_format_selector(mode: str, quality: str) -> str:
    if mode == 'audio':
        return 'bestaudio/best'
    if quality == 'best':
        return 'bv*+ba/b'
    try:
        height = int(quality)
    except ValueError:
        return 'bv*+ba/b'
    return f'bv*[height<={height}]+ba/b[height<={height}]'


def build_postprocessors(
    mode: str,
    container: str,
    quality: str,
    advanced: dict[str, Any],
) -> list[dict[str, Any]]:
    processors: list[dict[str, Any]] = []

    if mode == 'audio':
        extract_audio: dict[str, Any] = {
            'key': 'FFmpegExtractAudio',
            'preferredcodec': container,
        }
        if quality != 'best':
            extract_audio['preferredquality'] = quality
        processors.append(extract_audio)

    if advanced.get('sponsorblockRemove'):
        categories = parse_csv(advanced.get('sponsorblockCategories')) or list(DEFAULT_SPONSORBLOCK_CATEGORIES)
        processors.append({
            'key': 'SponsorBlock',
            'categories': categories,
            'api': 'https://sponsor.ajay.app',
            'when': 'after_filter',
        })
        processors.append({
            'key': 'ModifyChapters',
            'remove_chapters_patterns': [],
            'remove_sponsor_segments': categories,
            'remove_ranges': [],
            'sponsorblock_chapter_title': '[SponsorBlock]: %(category_names)l',
            'force_keyframes': False,
        })

    if advanced.get('embedMetadata'):
        processors.append({
            'key': 'FFmpegMetadata',
            'add_chapters': bool(advanced.get('sponsorblockRemove')),
            'add_metadata': True,
            'add_infojson': 'if_exists' if advanced.get('writeInfoJson') else False,
        })

    if advanced.get('embedThumbnail'):
        processors.append({
            'key': 'EmbedThumbnail',
            'already_have_thumbnail': bool(advanced.get('writeThumbnail')),
        })

    return processors


def requires_ffmpeg(mode: str, container: str, postprocessors: list[dict[str, Any]]) -> bool:
    if mode == 'audio':
        return True
    if mode == 'video' and container:
        return True
    return any(str(postprocessor.get('key') or '').startswith('FFmpeg') for postprocessor in postprocessors)


class JsonEmitter:
    def __init__(self) -> None:
        self._lock = threading.Lock()

    def send(self, payload: dict[str, Any]) -> None:
        with self._lock:
            sys.stdout.write(json.dumps(payload, ensure_ascii=True) + '\n')
            sys.stdout.flush()


@dataclass
class DownloadJob:
    job_id: str
    cancel_event: threading.Event
    thread: threading.Thread


class BridgeLogger:
    def __init__(self, emitter: JsonEmitter, job_id: str) -> None:
        self._emitter = emitter
        self._job_id = job_id

    def debug(self, message: str) -> None:
        if message.startswith('[debug] '):
            return
        self.info(message)

    def info(self, message: str) -> None:
        self._emitter.send({
            'type': 'event',
            'event': 'download-log',
            'payload': {
                'jobId': self._job_id,
                'level': 'info',
                'message': message,
            },
        })

    def warning(self, message: str) -> None:
        self._emitter.send({
            'type': 'event',
            'event': 'download-log',
            'payload': {
                'jobId': self._job_id,
                'level': 'warning',
                'message': message,
            },
        })

    def error(self, message: str) -> None:
        self._emitter.send({
            'type': 'event',
            'event': 'download-log',
            'payload': {
                'jobId': self._job_id,
                'level': 'error',
                'message': message,
            },
        })


class DesktopBridge:
    def __init__(self) -> None:
        self.emitter = JsonEmitter()
        self.jobs: dict[str, DownloadJob] = {}
        self.command_queue: queue.Queue[dict[str, Any] | None] = queue.Queue()

    def start(self) -> None:
        reader = threading.Thread(target=self._read_commands, daemon=True)
        reader.start()
        while True:
            command = self.command_queue.get()
            if command is None:
                break
            self._dispatch(command)

    def _read_commands(self) -> None:
        for line in sys.stdin:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError:
                self.emitter.send({
                    'id': -1,
                    'ok': False,
                    'error': {'message': 'Invalid JSON received by bridge'},
                })
                continue
            self.command_queue.put(payload)
        self.command_queue.put(None)

    def _dispatch(self, command: dict[str, Any]) -> None:
        request_id = command.get('id', -1)
        method = command.get('method')
        payload = command.get('payload') or {}

        try:
            if method == 'probe':
                result = self.handle_probe(payload)
            elif method == 'download.start':
                result = self.handle_download_start(payload)
            elif method == 'download.cancel':
                result = self.handle_download_cancel(payload)
            else:
                raise ValueError(f'Unknown bridge method: {method}')
        except Exception as error:
            self.emitter.send({
                'id': request_id,
                'ok': False,
                'error': {'message': str(error)},
            })
            return

        self.emitter.send({
            'id': request_id,
            'ok': True,
            'payload': result,
        })

    def handle_probe(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = str(payload.get('url') or '').strip()
        if not url:
            raise ValueError('A URL is required for probing')

        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extract_flat': 'in_playlist',
            'lazy_playlist': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            sanitized = ydl.sanitize_info(info)

        if not isinstance(sanitized, dict):
            raise ValueError('yt-dlp did not return a serializable info dictionary')
        return simplify_probe(sanitized)

    def handle_download_start(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = str(payload.get('url') or '').strip()
        destination = str(payload.get('destination') or '').strip()
        mode = str(payload.get('mode') or 'audio')
        container = str(payload.get('container') or '')
        quality = str(payload.get('quality') or 'best')
        advanced = payload.get('advanced') or {}

        if not url:
            raise ValueError('A URL is required to start a download')
        if not destination:
            raise ValueError('A destination directory is required')
        if mode not in {'audio', 'video'}:
            raise ValueError(f'Unsupported mode: {mode}')
        if not isinstance(advanced, dict):
            raise ValueError('Advanced options payload must be an object')

        job_id = str(payload.get('jobId') or uuid.uuid4())
        cancel_event = threading.Event()
        thread = threading.Thread(
            target=self._run_download,
            args=(job_id, url, destination, mode, container, quality, advanced, cancel_event),
            daemon=True,
        )
        self.jobs[job_id] = DownloadJob(job_id=job_id, cancel_event=cancel_event, thread=thread)
        thread.start()
        return {'jobId': job_id}

    def handle_download_cancel(self, payload: dict[str, Any]) -> dict[str, Any]:
        job_id = str(payload.get('jobId') or '')
        job = self.jobs.get(job_id)
        if not job:
            return {'cancelled': False}
        job.cancel_event.set()
        return {'cancelled': True}

    def _build_ydl_opts(
        self,
        job_id: str,
        destination: str,
        mode: str,
        container: str,
        quality: str,
        advanced: dict[str, Any],
        progress_hook: Any,
        postprocessor_hook: Any,
    ) -> dict[str, Any]:
        custom_format = str(advanced.get('customFormat') or '').strip()
        output_template = str(advanced.get('outputTemplate') or '').strip() or DEFAULT_OUTPUT_TEMPLATE
        playlist_items = str(advanced.get('playlistItems') or '').strip() or None
        subtitle_languages = parse_csv(advanced.get('subtitleLanguages'))
        concurrent_fragments = parse_optional_int(advanced.get('concurrentFragments'), 'Concurrent fragments')
        rate_limit = parse_rate_limit(advanced.get('rateLimit'))
        ffmpeg_location = resolve_ffmpeg_location(advanced.get('ffmpegLocation'))
        cookie_file = str(advanced.get('cookieFile') or '').strip() or None
        cookies_from_browser = normalize_browser(advanced.get('cookiesFromBrowser'))
        download_archive = str(advanced.get('downloadArchive') or '').strip() or None
        postprocessors = build_postprocessors(mode, container, quality, advanced)

        ydl_opts: dict[str, Any] = {
            'quiet': True,
            'no_warnings': True,
            'paths': {'home': destination},
            'outtmpl': {'default': output_template},
            'format': custom_format or build_format_selector(mode, quality),
            'postprocessors': postprocessors,
            'progress_hooks': [progress_hook],
            'postprocessor_hooks': [postprocessor_hook],
            'logger': BridgeLogger(self.emitter, job_id),
            'noplaylist': bool(advanced.get('noPlaylist')),
            'playlist_items': playlist_items,
            'writesubtitles': bool(advanced.get('writeSubtitles')),
            'writeautomaticsub': bool(advanced.get('writeAutoSubtitles')),
            'subtitlesformat': str(advanced.get('subtitleFormat') or '').strip() or 'best',
            'subtitleslangs': subtitle_languages or None,
            'writethumbnail': bool(advanced.get('writeThumbnail')) or bool(advanced.get('embedThumbnail')),
            'writeinfojson': bool(advanced.get('writeInfoJson')),
            'restrictfilenames': bool(advanced.get('restrictFilenames')),
            'ignoreerrors': True if advanced.get('ignoreErrors') else False,
            'cookiefile': cookie_file,
            'cookiesfrombrowser': cookies_from_browser,
            'download_archive': download_archive,
            'concurrent_fragment_downloads': concurrent_fragments or 1,
            'ratelimit': rate_limit,
        }

        if mode == 'video' and container:
            ydl_opts['merge_output_format'] = container

        if requires_ffmpeg(mode, container, postprocessors):
            if not ffmpeg_location:
                raise ValueError(
                    'ffmpeg is required for the selected download options but was not found. '
                    'Install ffmpeg or set Advanced > FFmpeg path.'
                )
            ydl_opts['ffmpeg_location'] = ffmpeg_location

        if not ydl_opts['writesubtitles'] and not ydl_opts['writeautomaticsub']:
            ydl_opts.pop('subtitleslangs')
            ydl_opts.pop('subtitlesformat')

        for key in ('playlist_items', 'cookiefile', 'cookiesfrombrowser', 'download_archive', 'ratelimit'):
            if ydl_opts.get(key) in (None, ''):
                ydl_opts.pop(key, None)

        if not postprocessors:
            ydl_opts.pop('postprocessors')

        return ydl_opts

    def _run_download(
        self,
        job_id: str,
        url: str,
        destination: str,
        mode: str,
        container: str,
        quality: str,
        advanced: dict[str, Any],
        cancel_event: threading.Event,
    ) -> None:
        def progress_hook(progress: dict[str, Any]) -> None:
            if cancel_event.is_set():
                raise DownloadCancelled('Cancelled by user')

            info_dict = progress.get('info_dict') or {}
            self.emitter.send({
                'type': 'event',
                'event': 'download-progress',
                'payload': {
                    'jobId': job_id,
                    'status': progress.get('status'),
                    'downloadedBytes': progress.get('downloaded_bytes'),
                    'totalBytes': progress.get('total_bytes') or progress.get('total_bytes_estimate'),
                    'speed': progress.get('speed'),
                    'eta': progress.get('eta'),
                    'filename': progress.get('filename'),
                    'entry': simplify_entry(info_dict) if isinstance(info_dict, dict) else None,
                },
            })

        def postprocessor_hook(progress: dict[str, Any]) -> None:
            self.emitter.send({
                'type': 'event',
                'event': 'download-stage',
                'payload': {
                    'jobId': job_id,
                    'stage': f"{progress.get('postprocessor', 'postprocess')}: {progress.get('status', 'running')}",
                },
            })

        try:
            ydl_opts = self._build_ydl_opts(
                job_id,
                destination,
                mode,
                container,
                quality,
                advanced,
                progress_hook,
                postprocessor_hook,
            )
            self.emitter.send({
                'type': 'event',
                'event': 'download-stage',
                'payload': {
                    'jobId': job_id,
                    'stage': 'Starting yt-dlp job',
                },
            })
            ffmpeg_location = ydl_opts.get('ffmpeg_location')
            if ffmpeg_location:
                self.emitter.send({
                    'type': 'event',
                    'event': 'download-stage',
                    'payload': {
                        'jobId': job_id,
                        'stage': f'Using ffmpeg from {ffmpeg_location}',
                    },
                })
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
        except DownloadCancelled:
            self.emitter.send({
                'type': 'event',
                'event': 'download-cancelled',
                'payload': {'jobId': job_id},
            })
        except Exception as error:
            self.emitter.send({
                'type': 'event',
                'event': 'download-error',
                'payload': {
                    'jobId': job_id,
                    'message': str(error),
                    'traceback': traceback.format_exc(),
                },
            })
        else:
            self.emitter.send({
                'type': 'event',
                'event': 'download-complete',
                'payload': {'jobId': job_id},
            })
        finally:
            self.jobs.pop(job_id, None)


def main() -> int:
    DesktopBridge().start()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
