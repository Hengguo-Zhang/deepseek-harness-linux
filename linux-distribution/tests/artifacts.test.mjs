import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { finalizeArtifacts } from '../finalize-artifacts.mjs';
import { verifyArtifacts } from '../verify-artifacts.mjs';

const plan = { tag: 'dsh-v0.2.1-rc.2', version: '0.2.1-rc.2', sha: 'a'.repeat(40), repository: 'test/linux', distributionCommit: 'b'.repeat(40), releaseTag: 'linux-v0.2.1-rc.2' };
const debName = 'deepseek-harness_0.2.1-rc.2_amd64.deb';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'linux-ota-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const deb = Buffer.from('!<arch>\nfixture-deb');
  const hash = createHash('sha512').update(deb).digest('base64');
  await writeFile(join(directory, debName), deb);
  await writeFile(join(directory, 'latest-linux.yml'), `version: ${plan.version}\nfiles:\n  - url: ${debName}\n    sha512: ${hash}\n    size: ${deb.length}\npath: ${debName}\nsha512: ${hash}\nreleaseDate: '2026-10-19T00:00:00.000Z'\n`);
  await writeFile(join(directory, 'app-update.yml'), 'provider: generic\nurl: https://github.com/test/linux/releases/latest/download/\nchannel: latest\n');
  await writeFile(join(directory, 'linux-source.json'), JSON.stringify(plan));
  return directory;
}

test('final metadata downloads the selected immutable release even if latest advances', async (t) => {
  const directory = await fixture(t);
  await finalizeArtifacts(directory, plan);
  const metadata = await readFile(join(directory, 'latest-linux.yml'), 'utf8');
  assert.match(metadata, /url: https:\/\/github.com\/test\/linux\/releases\/download\/linux-v0\.2\.1-rc\.2\//);
  assert.match(metadata, /path: https:\/\/github.com\/test\/linux\/releases\/download\/linux-v0\.2\.1-rc\.2\//);
  assert.equal((await verifyArtifacts(directory, plan)).length, 4);
});

test('rejects corrupted DEB content before publication', async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, debName), '!<arch>\nchanged');
  await assert.rejects(verifyArtifacts(directory, plan), /SHA-512 or size/);
});

test('rejects metadata pointing to another release or local file', async (t) => {
  const directory = await fixture(t);
  const path = join(directory, 'latest-linux.yml');
  await writeFile(path, (await readFile(path, 'utf8')).replaceAll(debName, '../other.deb'));
  await assert.rejects(verifyArtifacts(directory, plan), /OTA URLs/);
});

test('rejects wrong app feed and source records', async (t) => {
  const directory = await fixture(t);
  await assert.rejects(verifyArtifacts(directory, { ...plan, repository: 'other/repo' }), /updater feed/);
  await assert.rejects(verifyArtifacts(directory, { ...plan, sha: 'c'.repeat(40) }), /source record/);
  await assert.rejects(verifyArtifacts(directory, { ...plan, version: '0.2.0' }), /OTA version/);
});
