from __future__ import annotations

import os
import shutil
from pathlib import Path


def is_executable_file(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def iter_candidate_dirs() -> list[Path]:
    candidates: list[Path] = []

    override = str(os.environ.get('YTDL_SPARKS_FFMPEG_DIR') or '').strip()
    if override:
        override_path = Path(override).expanduser()
        candidates.append(override_path if override_path.is_dir() else override_path.parent)

    discovered_ffmpeg = shutil.which('ffmpeg')
    discovered_ffprobe = shutil.which('ffprobe')
    for discovered in (discovered_ffmpeg, discovered_ffprobe):
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


def resolve_ffmpeg_dir() -> Path:
    for candidate in iter_candidate_dirs():
        if is_executable_file(candidate / 'ffmpeg') and is_executable_file(candidate / 'ffprobe'):
            return candidate
    raise SystemExit(
        'ffmpeg and ffprobe are required for mac builds. '
        'Install them or set YTDL_SPARKS_FFMPEG_DIR to the containing directory.'
    )


def main() -> int:
    desktop_dir = Path(__file__).resolve().parent.parent
    target_dir = desktop_dir / 'resources' / 'bin' / 'darwin'
    source_dir = resolve_ffmpeg_dir()

    target_dir.mkdir(parents=True, exist_ok=True)

    for binary_name in ('ffmpeg', 'ffprobe'):
        source = source_dir / binary_name
        destination = target_dir / binary_name
        shutil.copy2(source, destination)
        destination.chmod(0o755)

    print(f'Copied macOS ffmpeg tools from {source_dir} to {target_dir}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
