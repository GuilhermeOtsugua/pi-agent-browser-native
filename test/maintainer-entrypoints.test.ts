import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const run = promisify(execFile);
for (const name of ['check-command-reference-baseline', 'verify-command-reference', 'profile-startup']) {
 test(`${name} executes help and imports silently`, async () => {
  const file = resolve('scripts', name+'.mjs');
  const help = await run(process.execPath,[file,'--help'],{timeout:10000});
  assert.match(help.stdout,/Usage:/);
  const imported = await run(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(file).href)})`,'nonexistent-argv-entry'],{timeout:10000});
  assert.equal(imported.stdout,'');
  assert.equal(imported.stderr,'');
 });
}
