import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { extractUpstreamCommandTokens } from '../extensions/agent-browser/lib/argv-descriptor.js';
import { extractExplicitSessionName } from '../extensions/agent-browser/lib/argv-grammar.js';
import { createExtensionHarness, executeRegisteredTool, readInvocationLog, runExtensionEvent, withPatchedEnv, writeFakeAgentBrowserBinary } from './helpers/agent-browser-harness.js';

for (const mode of ['implicit', 'explicit', 'undispatched'] as const) {
 test(`failed launch cleanup: ${mode} retains correct shutdown ownership`, {concurrency:false}, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'piab-failed-launch-cleanup-'));
  const log = join(cwd, 'invocations.jsonl');
  await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
if (args.includes('open')) { process.stdout.write(JSON.stringify({success:false,error:'Chrome exited early before providing DevTools URL'})); process.exitCode=1; }
else { process.stdout.write(JSON.stringify({success:true,data:{closed:true}})); }`);
  try {
   await withPatchedEnv({PATH:`${cwd}:${process.env.PATH ?? ''}`}, async () => {
    const harness = createExtensionHarness({cwd});
    await runExtensionEvent(harness.handlers, 'session_start', {reason:'new'}, harness.ctx);
    const args = mode === 'explicit' ? ['--session','caller-owned','open','https://example.test/']
     : mode === 'undispatched' ? ['--args=--user-agent=invalid','open','https://example.test/']
     : ['open','https://example.test/'];
    const result = await executeRegisteredTool(harness.tool, harness.ctx, {args});
    assert.equal(result.isError, true);
    if (mode === 'implicit') {
     assert.equal(result.details?.agentBrowserStarted, true);
     const outcome = result.details?.managedSessionOutcome as {activeAfter?:boolean,status?:string};
     assert.equal(outcome.activeAfter, false);
     assert.equal(outcome.status, 'abandoned');
    }
    assert.equal((await readInvocationLog(log)).some(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), false, 'failure must remain available for readback, not trigger immediate close');
    await runExtensionEvent(harness.handlers, 'session_shutdown', {reason:'quit'}, harness.ctx);
    const entries = await readInvocationLog(log);
    const closes = entries.filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
    assert.equal(closes.length, mode === 'implicit' ? 1 : 0);
    if (mode === 'implicit') {
     const launched = entries.find(entry => extractUpstreamCommandTokens(entry.args)[0] === 'open');
     assert.ok(launched);
     assert.equal(extractExplicitSessionName(closes[0].args), extractExplicitSessionName(launched.args));
     await runExtensionEvent(harness.handlers, 'session_shutdown', {reason:'quit'}, harness.ctx);
     assert.equal((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close').length, 1);
    }
    if (mode === 'undispatched') assert.deepEqual(entries, []);
   });
  } finally { await rm(cwd, {recursive:true,force:true}); }
 });
}
