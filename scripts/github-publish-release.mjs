import fs from 'node:fs/promises';

import {
  GithubHttpError,
  githubRequest,
  listReleaseAssets,
  readPackageJson,
  requireGithubConfig,
  versionToTag,
} from './github-common.mjs';

function resolveUploadUrl(template, name) {
  const cleanTemplate = template.replace(/\{\?name,label\}$/, '');
  const url = new URL(cleanTemplate);
  url.searchParams.set('name', name);
  return url.toString();
}

async function ensureRelease(owner, repo, tag) {
  try {
    return await githubRequest(`/repos/${owner}/${repo}/releases/tags/${tag}`);
  } catch (error) {
    if (!(error instanceof GithubHttpError) || error.status !== 404) {
      throw error;
    }
  }

  return githubRequest(`/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    body: {
      tag_name: tag,
      name: tag,
      draft: false,
      prerelease: false,
    },
  });
}

async function uploadAsset(release, asset) {
  const existing = (release.assets || []).find((entry) => entry.name === asset.uploadName);
  if (existing) {
    await githubRequest(`/repos/${release.author.login}/${release.name}/releases/assets/${existing.id}`, {
      method: 'DELETE',
    });
  }

  const fileBuffer = await fs.readFile(asset.path);
  return githubRequest(resolveUploadUrl(release.upload_url, asset.uploadName), {
    method: 'POST',
    body: fileBuffer,
    raw: true,
    headers: {
      'Content-Type': 'application/octet-stream',
    },
  });
}

async function main() {
  const { owner, repo } = await requireGithubConfig();
  const packageJson = await readPackageJson();
  const version = packageJson.version;
  const tag = versionToTag(version);
  const assets = await listReleaseAssets(version);

  if (assets.length === 0) {
    throw new Error(`No release artifacts matching version ${version} were found in release/. Build the app before publishing.`);
  }

  const release = await ensureRelease(owner, repo, tag);

  for (const asset of assets) {
    const existing = (release.assets || []).find((entry) => entry.name === asset.uploadName);
    if (existing) {
      await githubRequest(`/repos/${owner}/${repo}/releases/assets/${existing.id}`, {
        method: 'DELETE',
      });
    }

    await githubRequest(resolveUploadUrl(release.upload_url, asset.uploadName), {
      method: 'POST',
      body: await fs.readFile(asset.path),
      raw: true,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    });
    console.log(`Uploaded ${asset.uploadName}`);
  }

  console.log(`GitHub release ready: ${tag}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
