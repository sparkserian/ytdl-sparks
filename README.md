# ytdl-sparks

`ytdl-sparks` is a desktop downloader built on top of `yt-dlp` with an Electron + React frontend and a platform-specific download bridge behind it. It is designed to make the common `yt-dlp` workflow usable through a compact GUI instead of the command line.

## What It Does

- Downloads single videos or full playlists
- Supports audio and video download modes
- Lets the user choose output container and quality presets
- Watches the clipboard for YouTube links while the app is active
- Probes playlist links and shows selectable items before download
- Supports advanced options for subtitles, metadata, SponsorBlock, cookies, archives, and ffmpeg overrides
- Builds macOS arm64 packages for Apple Silicon and Windows x64 `.exe` packages from the same codebase

## Product Shape

The app is intentionally split into a few layers:

- `src/main`: Electron main process, window setup, IPC wiring, runtime bridge selection
- `src/preload`: secure renderer bridge exposed as `window.desktopApi`
- `src/renderer`: React UI and styling
- `backend`: Python bridge for macOS and development, plus helper scripts for packaged resources
- `scripts`: release automation and asset generation helpers

Runtime bridge behavior:

- macOS packaged app: uses the frozen Python bridge binary
- Windows packaged app: uses the bundled `yt-dlp.exe` and `ffmpeg.exe` CLI bridge path
- development mode: uses the Python bridge script directly

## Core Features

### Main download flow

- Paste or copy a supported YouTube URL
- The app auto-probes the link and identifies single-item vs playlist content
- Choose `Audio` or `Video`
- Choose a container such as `AAC`, `MP3`, `MP4`, or `MKV`
- Choose a quality preset
- Choose a destination folder
- Start, monitor, and cancel downloads from the UI

### Playlist handling

- Playlist entries are displayed inside the main queue panel
- All playlist items are selected by default
- Users can use `Select all`, `Clear`, or individual item checkboxes
- Selected rows are converted into the actual `playlist_items` slice passed to `yt-dlp`

### Metadata and filenames

The default filename template is designed to keep the track title first:

`%(track,title)s - %(artist,uploader)s [%(id)s].%(ext)s`

That means:

- preferred: `Track - Artist`
- fallback: `Title - Uploader`

### Advanced options

The advanced settings overlay exposes a broader `yt-dlp` surface, including:

- custom format strings
- playlist slicing
- subtitle download options
- thumbnail and metadata embedding
- cookies and browser-cookie import
- download archives
- SponsorBlock segment removal
- ffmpeg location overrides
- rate limit and concurrent fragment controls

## Requirements

### Development

- Node.js and `npm`
- Python 3
- internet access for downloads and dependency installation

### Packaging

- macOS arm64 build: requires `ffmpeg` and `ffprobe` available locally, or `YTDL_SPARKS_FFMPEG_DIR`
- Windows build: the repo downloads the required `yt-dlp.exe`, `ffmpeg.exe`, and `ffprobe.exe` automatically into `resources/bin/win32-x64`

### GitHub release automation

Create `.env.local` in the repo root with:

```env
GH_RELEASE_OWNER=your-github-user-or-org
GH_RELEASE_REPO=ytdl-sparks
GH_TOKEN=your-github-token
```

What they mean:

- `GH_RELEASE_OWNER`: the GitHub user or org that owns the repo
- `GH_RELEASE_REPO`: the GitHub repository name
- `GH_TOKEN`: token with repo/release access

The scripts read:

1. real environment variables first
2. `.env.local` second

## Local Development

Install dependencies:

```bash
npm install
npm run setup:python
```

Run the desktop app in development:

```bash
npm run dev
```

Useful one-off commands:

```bash
npm run build:icons
npm run build
npm run build:backend
```

## Packaging

Artifacts are written to `release/`.

### macOS arm64

```bash
npm run dist:mac
```

Output:

- `.dmg`
- `.zip`
- blockmap files

### Windows x64

```bash
npm run dist:win
```

Output:

- NSIS installer `.exe`
- portable `.exe`
- blockmap for the installer

### Both

```bash
npm run dist
```

## Icons and Branding

The app icon source lives in:

- `build/icons/source.png`

Generated assets:

- `build/icons/icon.png`
- `build/icons/icon.icns`
- `build/icons/icon.ico`

Regenerate them with:

```bash
npm run build:icons
```

Those assets are used by Electron Builder for:

- the macOS app bundle
- the DMG
- the Windows executable
- the Windows installer and uninstaller

## GitHub Repo and Release Flow

Initialize or reconnect the local repo to GitHub:

```bash
npm run github:repo:init
```

Publish a release from already-built files in `release/`:

```bash
npm run github:release
```

Release behavior:

- reads `package.json`
- converts version `2.0.2` into tag `v2.0.2`
- scans `release/` for files containing that version string
- creates the GitHub Release if it does not exist
- or updates the existing release if it already exists
- uploads matching assets and replaces existing assets with the same normalized names

Uploaded asset types:

- `.exe`
- `.dmg`
- `.deb`
- `.appimage`
- `.zip`
- `.blockmap`
- `.7z`

Excluded:

- internal `.__uninstaller` files

## Recommended Release Order

Use this order to keep the GitHub tag aligned with the source code:

1. Bump the version
2. Commit and push source changes
3. Build artifacts locally
4. Run `npm run github:release`

If you skip the commit/push step, the uploaded binaries may be newer than the source code attached to the release tag.

## Current Platform Notes

- mac builds currently use ad-hoc signing unless proper Apple signing/notarization credentials are configured
- notarization is not handled by `.env.local`
- Windows signing is not driven by `.env.local`
- GitHub release publishing only uploads files that already exist in `release/`

## Repository Files Worth Knowing

- [`package.json`](./package.json): version, scripts, package metadata
- [`electron-builder.yml`](./electron-builder.yml): packaging targets, app icon config, release output
- [`backend/yt_dlp_gui_bridge.py`](./backend/yt_dlp_gui_bridge.py): Python download bridge
- [`src/main/pythonBridge.ts`](./src/main/pythonBridge.ts): Electron bridge runner for dev and mac packaged builds
- [`src/main/ytDlpCliBridge.ts`](./src/main/ytDlpCliBridge.ts): Windows packaged bridge path
- [`scripts/github-init-repo.mjs`](./scripts/github-init-repo.mjs): GitHub repo creation/init helper
- [`scripts/github-publish-release.mjs`](./scripts/github-publish-release.mjs): GitHub release uploader
- [`scripts/generate-icons.mjs`](./scripts/generate-icons.mjs): icon asset generator
