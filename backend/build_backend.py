from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> int:
    backend_dir = Path(__file__).resolve().parent
    repo_root = backend_dir.parent
    script_path = backend_dir / 'yt_dlp_gui_bridge.py'

    try:
        subprocess.run(
            [sys.executable, '-m', 'PyInstaller', '--version'],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        raise SystemExit(f'PyInstaller is installed but unavailable: {error.stderr.strip()}') from error
    except FileNotFoundError as error:
        raise SystemExit('PyInstaller is required for packaged desktop builds. Install it with `python3 -m pip install pyinstaller`.') from error

    try:
        __import__('yt_dlp')
    except ImportError as error:
        raise SystemExit(
            'The Python package `yt-dlp` is required for desktop builds. '
            'Install backend dependencies with `python3 -m pip install -r backend/requirements.txt`.'
        ) from error

    platform_name = {
        'Darwin': 'darwin',
        'Windows': 'win32',
        'Linux': 'linux',
    }.get(platform.system(), sys.platform)

    binary_name = 'yt-dlp-gui-bridge.exe' if os.name == 'nt' else 'yt-dlp-gui-bridge'
    dist_dir = backend_dir / 'dist'
    work_dir = backend_dir / 'build'
    spec_dir = backend_dir / 'spec'
    target_dir = repo_root / 'resources' / 'bin' / platform_name

    target_dir.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        '-m',
        'PyInstaller',
        '--noconfirm',
        '--clean',
        '--onefile',
        '--name',
        'yt-dlp-gui-bridge',
        '--distpath',
        str(dist_dir),
        '--workpath',
        str(work_dir),
        '--specpath',
        str(spec_dir),
        '--paths',
        str(repo_root),
        '--collect-submodules',
        'yt_dlp',
        '--collect-data',
        'yt_dlp',
        str(script_path),
    ]

    subprocess.run(command, check=True, cwd=repo_root)

    built_binary = dist_dir / binary_name
    if not built_binary.exists():
        raise SystemExit(f'Expected backend binary was not produced: {built_binary}')

    shutil.copy2(built_binary, target_dir / binary_name)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
