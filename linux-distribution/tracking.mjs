import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const upstream = 'deepseek-ai/deepseek-harness';
const versionPattern = /^(?:(?:dsh-)?v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Accept official dsh-v tags and ordinary semantic tags, excluding build metadata. */
export function parseVersion(tag) {
  const match = versionPattern.exec(tag);
  if (!match || match[4]?.split('.').some((part) => /^\d+$/.test(part) && /^0\d/.test(part))) return null;
  return { version: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`, numbers: match.slice(1, 4).map(BigInt), prerelease: match[4]?.split('.') ?? [] };
}

/** Compare parsed semantic versions, including numeric RC components. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === right) continue;
    if (left === undefined || right === undefined) return left === undefined ? -1 : 1;
    const ln = /^\d+$/.test(left);
    const rn = /^\d+$/.test(right);
    if (ln && rn) return BigInt(left) > BigInt(right) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

/** Select the newest eligible official tag; a manual request must exist upstream. */
export function selectCandidate(tags, { includePrereleases = true, requestedTag = '' } = {}) {
  if (requestedTag && !parseVersion(requestedTag)) throw new Error('Manual tag must be a semantic version tag (for example dsh-v0.2.1-rc.2)');
  const eligible = tags.flatMap((tag) => {
    const parsed = parseVersion(tag.name);
    if (!parsed || (!includePrereleases && parsed.prerelease.length) || (requestedTag && tag.name !== requestedTag)) return [];
    return [{ ...parsed, tag: tag.name, sha: tag.commit?.sha }];
  }).sort((a, b) => compareVersions(b, a));
  if (!eligible.length) throw new Error(requestedTag ? `Requested upstream tag ${requestedTag} not found or excluded by prerelease policy` : 'No eligible official semantic version tags');
  const chosen = eligible[0];
  if (!/^[a-f0-9]{40}$/.test(chosen.sha)) throw new Error('Official tag does not resolve to an immutable commit SHA');
  return { tag: chosen.tag, version: chosen.version, sha: chosen.sha, releaseTag: `linux-v${chosen.version}`, upstreamPrerelease: chosen.prerelease.length > 0 };
}

/** Retry unpublished drafts, skip complete releases, and refuse published asset replacement. */
export function publicationDecision(release) {
  if (!release || release.draft) return 'build';
  const names = release.assets.map((asset) => asset.name);
  if (!names.some((name) => name.endsWith('.deb')) || !['latest-linux.yml', 'app-update.yml', 'linux-source.json'].every((name) => names.includes(name))) throw new Error('Existing published Linux release is incomplete; refuse replacing immutable assets');
  return 'skip';
}

/** Recheck the live channel immediately before publication; never move it backwards. */
export function assertLatestAdvance(version, latest) {
  if (!latest) return;
  const latestVersion = latest.tag_name?.startsWith('linux-v') ? parseVersion(latest.tag_name.slice('linux-'.length)) : null;
  if (!latestVersion) throw new Error('Latest distribution release is not a Linux OTA release; use a dedicated distribution repository');
  const candidateVersion = parseVersion(version);
  if (!candidateVersion || compareVersions(candidateVersion, latestVersion) <= 0) throw new Error('Refuse publishing a version that would regress or repeat the current Linux OTA feed');
}

/** GitHub API access is confined to discovery and publication processes. */
export async function github(path, { method = 'GET', body, allow404 = false } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 404 && allow404) return null;
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? null : response.json();
}

async function allPages(path) {
  const items = [];
  for (let page = 1; page <= 20; page++) {
    const result = await github(`${path}?per_page=100&page=${page}`);
    if (!Array.isArray(result)) throw new Error('GitHub listing was not an array');
    items.push(...result);
    if (result.length < 100) return items;
  }
  throw new Error('GitHub listing exceeded 2000 records; refine tracking policy before continuing');
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('GITHUB_REPOSITORY must be owner/repository');
  if (repository === upstream) throw new Error('Run this workflow in your Linux distribution repository');
  const repo = await github(`/repos/${repository}`);
  if (repo.private) throw new Error('Linux OTA requires a public distribution repository');
  const [tags, releases] = await Promise.all([allPages(`/repos/${upstream}/tags`), allPages(`/repos/${upstream}/releases`)]);
  const source = process.env.DSH_UPSTREAM_SOURCE || 'tags';
  if (!['tags', 'releases'].includes(source)) throw new Error('DSH_UPSTREAM_SOURCE must be tags or releases');
  const releasedNames = new Set(releases.filter((release) => !release.draft).map((release) => release.tag_name));
  const candidate = selectCandidate(source === 'releases' ? tags.filter((tag) => releasedNames.has(tag.name)) : tags, {
    includePrereleases: process.env.DSH_TRACK_PRERELEASES !== 'false', requestedTag: process.env.DSH_UPSTREAM_TAG || '',
  });
  const existing = await github(`/repos/${repository}/releases/tags/${encodeURIComponent(candidate.releaseTag)}`, { allow404: true });
  const decision = publicationDecision(existing);
  const latest = await github(`/repos/${repository}/releases/latest`, { allow404: true });
  if (decision === 'build') assertLatestAdvance(candidate.version, latest);
  const plan = { ...candidate, repository, upstream, distributionCommit: process.env.GITHUB_SHA, decision };
  await writeFile('linux-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries({ build: decision === 'build', tag: candidate.tag, sha: candidate.sha, version: candidate.version, release_tag: candidate.releaseTag }).map(([key, value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
