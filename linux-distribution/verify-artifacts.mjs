import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function scalar(text) {
  const value = text.trim();
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/** Check the single-DEB electron-builder metadata without installing build dependencies. */
export async function verifyArtifacts(directory, plan) {
  const names = await readdir(directory);
  const debs = names.filter((name) => name.endsWith('.deb'));
  if (debs.length !== 1 || !/^[A-Za-z0-9._+-]+\.deb$/.test(debs[0])) throw new Error('Expected exactly one safely named amd64 DEB');
  const deb = debs[0];
  const bytes = await readFile(join(directory, deb));
  if (bytes.length < 8 || bytes.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('DEB is not an ar package');
  const digest = createHash('sha512').update(bytes).digest('base64');
  const metadata = await readFile(join(directory, 'latest-linux.yml'), 'utf8');
  const version = scalar(/^version:\s*(.+)$/m.exec(metadata)?.[1] ?? '');
  if (version !== plan.version) throw new Error('OTA version differs from selected official tag');
  const urls = [...metadata.matchAll(/^\s*- url:\s*(.+)$/gm)].map((match) => scalar(match[1]));
  const paths = [...metadata.matchAll(/^path:\s*(.+)$/gm)].map((match) => scalar(match[1]));
  const immutableUrl = `https://github.com/${plan.repository}/releases/download/${plan.releaseTag}/${deb}`;
  if (urls.length !== 1 || ![deb, immutableUrl].includes(urls[0]) || paths.some((path) => path !== urls[0])) throw new Error('OTA URLs must name the uploaded DEB or its immutable release URL');
  const digests = [...metadata.matchAll(/^\s*sha512:\s*(.+)$/gm)].map((match) => scalar(match[1]));
  const sizes = [...metadata.matchAll(/^\s*size:\s*(\d+)\s*$/gm)].map((match) => Number(match[1]));
  if (!digests.length || digests.some((value) => value !== digest) || !sizes.length || sizes.some((size) => size !== bytes.length)) throw new Error('OTA DEB SHA-512 or size does not match');
  const config = await readFile(join(directory, 'app-update.yml'), 'utf8');
  const provider = scalar(/^provider:\s*(.+)$/m.exec(config)?.[1] ?? '');
  const url = scalar(/^url:\s*(.+)$/m.exec(config)?.[1] ?? '').replace(/\/$/, '');
  if (provider !== 'generic' || url !== `https://github.com/${plan.repository}/releases/latest/download`) throw new Error('Packaged updater feed differs from distribution repository');
  const source = JSON.parse(await readFile(join(directory, 'linux-source.json'), 'utf8'));
  for (const key of ['tag', 'version', 'sha', 'repository', 'distributionCommit']) {
    if (source[key] !== plan[key]) throw new Error(`Build source record differs from tracking plan: ${key}`);
  }
  return [deb, 'latest-linux.yml', 'app-update.yml', 'linux-source.json'];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, planPath] = process.argv.slice(2);
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  console.log((await verifyArtifacts(directory, plan)).join('\n'));
}
