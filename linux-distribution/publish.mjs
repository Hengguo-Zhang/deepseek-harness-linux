import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { github, publicationDecision, assertLatestAdvance } from './tracking.mjs';
import { finalizeArtifacts } from './finalize-artifacts.mjs';

const [directory, planPath] = process.argv.slice(2);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
if (plan.repository !== process.env.GITHUB_REPOSITORY || plan.distributionCommit !== process.env.GITHUB_SHA) throw new Error('Release target does not match the executing distribution workflow');
const names = await finalizeArtifacts(directory, plan);
let release = await github(`/repos/${plan.repository}/releases/tags/${encodeURIComponent(plan.releaseTag)}`, { allow404: true });
if (publicationDecision(release) === 'skip') {
  console.log(`Already published ${plan.releaseTag}; no assets changed`);
} else {
  assertLatestAdvance(plan.version, await github(`/repos/${plan.repository}/releases/latest`, { allow404: true }));
  if (!release) release = await github(`/repos/${plan.repository}/releases`, {
    method: 'POST', body: {
      tag_name: plan.releaseTag, target_commitish: plan.distributionCommit,
      name: `DeepSeek Harness Linux amd64 ${plan.version}${plan.upstreamPrerelease ? ' (official RC)' : ''}`,
      draft: true, prerelease: false,
      body: `Unofficial Ubuntu 24.04 amd64 distribution.\n\nOfficial source: https://github.com/${plan.upstream}/tree/${plan.sha}\nOfficial tag: ${plan.tag}\nDistribution source: https://github.com/${plan.repository}/tree/${plan.distributionCommit}\n\n${plan.upstreamPrerelease ? 'This build follows an official prerelease. The GitHub release is marked non-prerelease to support the dedicated Linux OTA latest/download endpoint.' : 'This build follows an official stable tag.'}\n\nInstall the DEB once, then use Check for Updates. See README-LINUX-OTA.md for setup, Linux privilege requirements, and limitations.`,
    },
  });
  // Never use --clobber: a maintainer may publish the draft while this job uploads.
  // Retrying the failed publish job reuses its original artifact and fills missing assets.
  const missing = [];
  for (const name of names) {
    const existing = release.assets.find((asset) => asset.name === name);
    if (!existing) { missing.push(join(directory, name)); continue; }
    const digest = `sha256:${createHash('sha256').update(await readFile(join(directory, name))).digest('hex')}`;
    if (existing.digest !== digest) throw new Error(`Draft asset ${name} differs or has no verifiable digest. Delete the unpublished draft manually, then rerun; no asset is overwritten.`);
  }
  if (missing.length) execFileSync('gh', ['release', 'upload', plan.releaseTag, ...missing, '--repo', plan.repository], { stdio: 'inherit' });
  const refreshed = await github(`/repos/${plan.repository}/releases/${release.id}`);
  if (!refreshed.draft) throw new Error('Release was published concurrently; stop before changing visibility');
  const actual = new Set(refreshed.assets.map((asset) => asset.name));
  if (!names.every((name) => actual.has(name))) throw new Error('Draft is missing release assets');
  assertLatestAdvance(plan.version, await github(`/repos/${plan.repository}/releases/latest`, { allow404: true }));
  await github(`/repos/${plan.repository}/releases/${release.id}`, { method: 'PATCH', body: { draft: false, prerelease: false, make_latest: 'true' } });
  console.log(`Published https://github.com/${plan.repository}/releases/tag/${plan.releaseTag}`);
}
