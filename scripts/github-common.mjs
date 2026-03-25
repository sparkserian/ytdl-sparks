import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');
export const releaseDir = path.join(projectRoot, 'release');

const RELEASE_EXTENSIONS = new Set(['.exe', '.dmg', '.deb', '.appimage', '.zip', '.blockmap', '.7z']);

export class GithubHttpError extends Error {
  constructor(message, status, details = '') {
    super(message);
    this.name = 'GithubHttpError';
    this.status = status;
    this.details = details;
  }
}

function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }
    const key = normalized.slice(0, equalsIndex).trim();
    let value = normalized.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readEnvLocal() {
  const envPath = path.join(projectRoot, '.env.local');
  try {
    return parseEnvFile(await fs.readFile(envPath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function getGithubConfig() {
  const envLocal = await readEnvLocal();
  return {
    owner: process.env.GH_RELEASE_OWNER || envLocal.GH_RELEASE_OWNER || '',
    repo: process.env.GH_RELEASE_REPO || envLocal.GH_RELEASE_REPO || '',
    token: process.env.GH_TOKEN || envLocal.GH_TOKEN || '',
  };
}

export async function requireGithubConfig() {
  const config = await getGithubConfig();
  const missing = Object.entries({
    GH_RELEASE_OWNER: config.owner,
    GH_RELEASE_REPO: config.repo,
    GH_TOKEN: config.token,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing GitHub configuration: ${missing.join(', ')}. Set them in the environment or .env.local.`);
  }

  return config;
}

export async function readPackageJson() {
  const packagePath = path.join(projectRoot, 'package.json');
  return JSON.parse(await fs.readFile(packagePath, 'utf8'));
}

export function versionToTag(version) {
  return version.startsWith('v') ? version : `v${version}`;
}

export function normalizeAssetName(filename) {
  return filename.replaceAll(' ', '-');
}

export function isReleaseAsset(filename, version) {
  if (!filename.includes(version) || filename.endsWith('.__uninstaller')) {
    return false;
  }
  return RELEASE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export async function listReleaseAssets(version) {
  const entries = await fs.readdir(releaseDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isReleaseAsset(entry.name, version))
    .map((entry) => ({
      path: path.join(releaseDir, entry.name),
      fileName: entry.name,
      uploadName: normalizeAssetName(entry.name),
    }));
}

export async function githubRequest(target, options = {}) {
  const { token } = await requireGithubConfig();
  const {
    method = 'GET',
    headers = {},
    body,
    raw = false,
  } = options;

  const url = target.startsWith('http') ? target : `https://api.github.com${target}`;
  const requestHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...headers,
  };

  let payload = body;
  if (body && !raw && !(body instanceof Uint8Array)) {
    requestHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: payload,
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new GithubHttpError(parsed?.message || `GitHub request failed: ${response.status}`, response.status, text);
  }
  return parsed;
}
