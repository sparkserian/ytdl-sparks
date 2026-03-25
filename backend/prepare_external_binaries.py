from __future__ import annotations

import json
import shutil
import urllib.request
import zipfile
from pathlib import Path


YTDLP_RELEASE_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
FFMPEG_RELEASE_URL = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest'


def download_json(url: str) -> dict:
    with urllib.request.urlopen(url) as response:
        return json.load(response)


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as response, destination.open('wb') as output:
        shutil.copyfileobj(response, output)


def pick_asset(assets: list[dict], predicate) -> dict:
    for asset in assets:
        if predicate(asset['name']):
            return asset
    raise SystemExit('Expected release asset was not found')


def install_windows_yt_dlp(resources_dir: Path) -> None:
    release = download_json(YTDLP_RELEASE_URL)
    assets = release['assets']

    x64_asset = pick_asset(assets, lambda name: name == 'yt-dlp.exe')

    x64_dir = resources_dir / 'win32-x64'
    download_file(x64_asset['browser_download_url'], x64_dir / 'yt-dlp.exe')


def install_windows_ffmpeg(resources_dir: Path) -> None:
    release = download_json(FFMPEG_RELEASE_URL)
    assets = release['assets']

    def select_asset(arch: str) -> dict:
        stable_assets = [
            asset for asset in assets
            if asset['name'].startswith('ffmpeg-n8.0-latest-')
            and arch in asset['name']
            and asset['name'].endswith('.zip')
            and 'shared' not in asset['name']
        ]
        if stable_assets:
            return stable_assets[0]
        return pick_asset(
            assets,
            lambda name: name.startswith('ffmpeg-master-latest-')
            and arch in name
            and name.endswith('.zip')
            and 'shared' not in name,
        )

    asset = select_asset('win64')
    target_dir = resources_dir / 'win32-x64'
    archive_path = target_dir / asset['name']
    download_file(asset['browser_download_url'], archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        members = {Path(member.filename).name: member for member in archive.infolist()}
        for binary in ('ffmpeg.exe', 'ffprobe.exe'):
            member = members.get(binary)
            if member is None:
                raise SystemExit(f'{binary} was not found in {asset["name"]}')
            with archive.open(member) as source, (target_dir / binary).open('wb') as output:
                shutil.copyfileobj(source, output)
    archive_path.unlink()


def main() -> int:
    desktop_dir = Path(__file__).resolve().parent.parent
    resources_dir = desktop_dir / 'resources' / 'bin'
    resources_dir.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(resources_dir / 'win32-arm64', ignore_errors=True)

    install_windows_yt_dlp(resources_dir)
    install_windows_ffmpeg(resources_dir)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
