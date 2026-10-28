import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCandidate, publicationDecision, assertLatestAdvance, publishedLine } from '../tracking.mjs';

const sha = 'a'.repeat(40);
const tag = (name) => ({ name, commit: { sha } });

test('sorts semantic versions rather than dates or lexical order', () => {
  const result = selectCandidate([tag('dsh-v0.2.9'), tag('dsh-v0.2.10-rc.2'), tag('dsh-v0.2.10-rc.10'), tag('unrelated')]);
  assert.equal(result.version, '0.2.10-rc.10');
  assert.equal(result.sha, sha);
  assert.equal(result.releaseTag, 'linux-v0.2.10-rc.10');
});

test('stable-only tracking excludes RC tags and stable outranks its RC', () => {
  assert.equal(selectCandidate([tag('v0.2.1-rc.3'), tag('v0.2.0')], { includePrereleases: false }).version, '0.2.0');
  assert.equal(selectCandidate([tag('v0.2.1-rc.3'), tag('v0.2.1')]).version, '0.2.1');
});

test('scheduled tracking stays on the released line until a manual tag adopts another', () => {
  const tags = [tag('dsh-v0.2.1-rc.3'), tag('dsh-v0.2.1-rc.4'), tag('dsh-v0.2.2-alpha.2')];
  assert.equal(selectCandidate(tags, { line: '0.2.1' }).version, '0.2.1-rc.4');
  // A stable release on the same line outranks its RC and stays automatic.
  assert.equal(selectCandidate([tag('dsh-v0.2.1-rc.4'), tag('dsh-v0.2.1')], { line: '0.2.1' }).version, '0.2.1');
  // Only an explicit manual tag crosses to another line.
  assert.equal(selectCandidate(tags, { line: '0.2.1', requestedTag: 'dsh-v0.2.2-alpha.2' }).version, '0.2.2-alpha.2');
  assert.throws(() => selectCandidate([tag('dsh-v0.2.2-alpha.2')], { line: '0.2.1' }), /published line 0\.2\.1/);
});

test('the published line comes from the live Linux release tag', () => {
  assert.equal(publishedLine(null), '');
  assert.equal(publishedLine({ tag_name: 'linux-v0.2.1-rc.3' }), '0.2.1');
  assert.throws(() => publishedLine({ tag_name: 'other-product-v1' }), /dedicated distribution/);
});

test('manual request must name an actual semantic upstream tag', () => {
  assert.equal(selectCandidate([tag('v0.2.0'), tag('v0.2.1')], { requestedTag: 'v0.2.0' }).version, '0.2.0');
  assert.throws(() => selectCandidate([tag('v0.2.0')], { requestedTag: 'main' }), /semantic version/);
  assert.throws(() => selectCandidate([tag('v0.2.0')], { requestedTag: 'v0.2.1' }), /not found/);
});

test('published complete release is immutable and skipped', () => {
  assert.equal(publicationDecision({ draft: false, assets: [{ name: 'x.deb' }, { name: 'latest-linux.yml' }, { name: 'app-update.yml' }, { name: 'linux-source.json' }] }), 'skip');
});

test('failed draft is retried but incomplete published release fails closed', () => {
  assert.equal(publicationDecision(null), 'build');
  assert.equal(publicationDecision({ draft: true, assets: [] }), 'build');
  assert.throws(() => publicationDecision({ draft: false, assets: [] }), /incomplete/);
});

test('rejects malformed upstream versions and commit references', () => {
  assert.throws(() => selectCandidate([tag('v01.2.0'), tag('v0.2.0-01')]), /No eligible/);
  assert.throws(() => selectCandidate([{ name: 'v0.2.0', commit: { sha: 'main' } }]), /commit SHA/);
});

test('publication refuses a newer or equal live feed after a long build', () => {
  assert.doesNotThrow(() => assertLatestAdvance('0.2.1-rc.2', { tag_name: 'linux-v0.2.0' }));
  assert.doesNotThrow(() => assertLatestAdvance('0.2.1-rc.2', null));
  assert.throws(() => assertLatestAdvance('0.2.1-rc.2', { tag_name: 'linux-v0.2.2' }), /regress or repeat/);
  assert.throws(() => assertLatestAdvance('0.2.1-rc.2', { tag_name: 'linux-v0.2.1-rc.2' }), /regress or repeat/);
  assert.throws(() => assertLatestAdvance('0.2.1-rc.2', { tag_name: 'other-product-v1' }), /dedicated distribution/);
});
