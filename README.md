# ytdl-sparks

Standalone Electron desktop app for playlist, video, and audio downloads powered by `yt-dlp`.

## Local setup

1. `npm install`
2. `npm run setup:python`
3. `npm run dev`

## Packaging

- `npm run dist:mac`
- `npm run dist:win`

Artifacts are written to `release/`.

## GitHub repo and releases

Copy `.env.example` to `.env.local` and set:

- `GH_RELEASE_OWNER`
- `GH_RELEASE_REPO`
- `GH_TOKEN`

Then use:

- `npm run github:repo:init`
- `npm run github:release`
