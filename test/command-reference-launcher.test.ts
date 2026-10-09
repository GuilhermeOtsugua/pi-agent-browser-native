import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveCommandReferenceExecutable } from '../scripts/verify-command-reference.mjs';

test('command reference uses the first Windows package-owned launcher, not a later standalone copy', async () => {
 const root=await mkdtemp(join(tmpdir(),'pi-command-launcher-'));
 const first=join(root,'first'), later=join(root,'later');
 const binary=join(first,'node_modules','agent-browser','bin',`agent-browser-win32-${process.arch}.exe`);
 try {
  await mkdir(join(first,'node_modules','agent-browser','bin'),{recursive:true});
  await mkdir(later);
  await writeFile(join(first,'agent-browser.cmd'),'fixture');
  await writeFile(binary,'fixture');
  await writeFile(join(later,'agent-browser.exe'),'fixture');
  assert.equal(await resolveCommandReferenceExecutable('win32',`${first};${later}`),binary);
  await rm(binary);
  await assert.rejects(resolveCommandReferenceExecutable('win32',`${first};${later}`),/first PATH/);
  await writeFile(join(first,'agent-browser.exe'),'fixture');
  assert.equal(await resolveCommandReferenceExecutable('win32',`${first};${later}`),join(first,'agent-browser.exe'));
 } finally {await rm(root,{recursive:true,force:true});}
});

test('command reference retains POSIX PATH execution', async () => {
 assert.equal(await resolveCommandReferenceExecutable('linux',''), 'agent-browser');
});
