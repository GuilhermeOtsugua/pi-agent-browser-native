import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { markedCommandReferenceBaselineBlock } from '../scripts/check-command-reference-baseline.mjs';
import { COMMAND_REFERENCE_BASELINE_BLOCK_IDS } from '../scripts/agent-browser-capability-baseline.mjs';
const run=promisify(execFile);
for (const ending of ['\n','\r\n']) {
 test(`command reference check/write preserves ${ending==='\n'?'LF':'CRLF'}`,async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'pi-command-reference-eol-'));
  const file=join(cwd,'docs','COMMAND_REFERENCE.md');
  const script=resolve('scripts/check-command-reference-baseline.mjs');
  await mkdir(join(cwd,'docs'));
  const expected=('Header\n'+COMMAND_REFERENCE_BASELINE_BLOCK_IDS.map(markedCommandReferenceBaselineBlock).join('\n')+'\nFooter\n').replaceAll('\n',ending);
  try {
   await writeFile(file,expected);
   await run(process.execPath,[script,'--check'],{cwd,timeout:10000});
   assert.equal(await readFile(file,'utf8'),expected,'check must be read-only');
   await writeFile(file,expected.replace('Generated from','Stale from'));
   await assert.rejects(run(process.execPath,[script,'--check'],{cwd,timeout:10000}));
   await run(process.execPath,[script,'--write'],{cwd,timeout:10000});
   assert.equal(await readFile(file,'utf8'),expected,'real drift repair preserves line endings');
  } finally {await rm(cwd,{recursive:true,force:true});}
 });
}
