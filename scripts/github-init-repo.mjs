import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { GithubHttpError, githubRequest, projectRoot, requireGithubConfig } from './github-common.mjs';

function hasGitRepo() {
  return fs.existsSync(path.join(projectRoot, '.git'));
}

function runGit(args) {
  execFileSync('git', args, { cwd: projectRoot, stdio: 'inherit' });
}

async function ensureRemoteRepo(owner, repo) {
  try {
    return await githubRequest(`/repos/${owner}/${repo}`);
  } catch (error) {
    if (!(error instanceof GithubHttpError) || error.status !== 404) {
      throw error;
    }
  }

  const ownerInfo = await githubRequest(`/users/${owner}`);
  const viewer = await githubRequest('/user');
  const createPath = ownerInfo.type === 'Organization' ? `/orgs/${owner}/repos` : '/user/repos';

  if (ownerInfo.type !== 'Organization' && viewer.login !== owner) {
    throw new Error(`Cannot create a user repo under ${owner} with the current token. Use the authenticated account or switch GH_RELEASE_OWNER.`);
  }

  return githubRequest(createPath, {
    method: 'POST',
    body: {
      name: repo,
      private: true,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
    },
  });
}

async function main() {
  const { owner, repo } = await requireGithubConfig();
  await ensureRemoteRepo(owner, repo);

  if (!hasGitRepo()) {
    runGit(['init', '-b', 'main']);
  }

  const remoteUrl = `https://github.com/${owner}/${repo}.git`;
  try {
    execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: projectRoot, stdio: 'ignore' });
    runGit(['remote', 'set-url', 'origin', remoteUrl]);
  } catch {
    runGit(['remote', 'add', 'origin', remoteUrl]);
  }

  console.log(`GitHub repo ready: ${remoteUrl}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
