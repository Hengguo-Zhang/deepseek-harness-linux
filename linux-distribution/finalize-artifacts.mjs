import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyArtifacts } from './verify-artifacts.mjs';

/** Bind downloads to a release so a concurrent newer latest feed cannot change the DEB. */
export async function finalizeArtifacts(directory, plan) {
  const names = await verifyArtifacts(directory, plan);
  const deb = names[0];
  const url = `https://github.com/${plan.repository}/releases/download/${plan.releaseTag}/${deb}`;
  const path = join(directory, 'latest-linux.yml');
  const original = await readFile(path, 'utf8');
  await writeFile(path, original.replace(/^(\s*- url:|path:)\s*.+$/gm, (_, prefix) => `${prefix} ${url}`));
  return verifyArtifacts(directory, plan);
}
