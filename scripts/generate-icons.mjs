import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const iconDir = path.join(projectRoot, 'build', 'icons');
const sourcePath = path.join(iconDir, 'source.png');
const tempDir = path.join(iconDir, '.tmp');

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsMapping = {
  'icon_16x16.png': 16,
  'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32,
  'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128,
  'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256,
  'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512,
  'icon_512x512@2x.png': 1024,
};

function run(command, args) {
  execFileSync(command, args, { stdio: 'ignore' });
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function removeDir(target) {
  await fs.rm(target, { recursive: true, force: true });
}

function resizePng(source, destination, size) {
  run('sips', ['-z', String(size), String(size), source, '--out', destination]);
}

async function buildIco() {
  const pngs = [];
  for (const size of icoSizes) {
    const target = path.join(tempDir, `ico-${size}.png`);
    resizePng(sourcePath, target, size);
    pngs.push(target);
  }

  const buffer = await pngToIco(pngs);
  await fs.writeFile(path.join(iconDir, 'icon.ico'), buffer);
}

async function buildIcns() {
  const iconsetDir = path.join(tempDir, 'icon.iconset');
  await ensureDir(iconsetDir);

  for (const [fileName, size] of Object.entries(icnsMapping)) {
    resizePng(sourcePath, path.join(iconsetDir, fileName), size);
  }

  run('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(iconDir, 'icon.icns')]);
}

async function main() {
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`Icon source is missing: ${sourcePath}`);
  }

  await ensureDir(iconDir);
  await removeDir(tempDir);
  await ensureDir(tempDir);

  resizePng(sourcePath, path.join(iconDir, 'icon.png'), 1024);
  await buildIco();

  if (process.platform === 'darwin') {
    await buildIcns();
  }

  await removeDir(tempDir);
  console.log(`Generated app icons in ${iconDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
