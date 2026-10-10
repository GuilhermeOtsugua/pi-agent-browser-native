import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
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
   await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`}, async () => {
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

for (const [label, response] of [
 ['success:false', JSON.stringify({success:false,error:'fixture close rejected'})],
 ['empty output', ''],
 ['malformed JSON', '{"success":'],
 ['missing success', JSON.stringify({data:{closed:true}})],
 ['string success', JSON.stringify({success:'true',data:{closed:true}})],
 ['number success', JSON.stringify({success:1,data:{closed:true}})],
 ['null success', JSON.stringify({success:null,data:{closed:true}})],
 ['empty array', JSON.stringify([])],
 ['plugin list', JSON.stringify({plugins:[]})],
 ['plugin show', JSON.stringify({plugin:{name:'fixture'}})],
] as const) {
 test(`failed launch cleanup: exit0 ${label} rejects shutdown and retries the same owned session`, {concurrency:false}, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'piab-close-ack-'));
  const log = join(cwd, 'invocations.jsonl');
  await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line)) : [];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
if (args.includes('open')) { process.stdout.write(JSON.stringify({success:false,error:'Chrome exited early before providing DevTools URL'})); process.exitCode=1; }
else if (args.includes('close')) {
 process.stdout.write(previous.some(entry => entry.args.includes('close')) ? JSON.stringify({success:true,data:{closed:true}}) : ${JSON.stringify(response)});
 process.exitCode=0;
}
else { process.stdout.write(JSON.stringify({success:true})); }`);
  try {
   await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`}, async () => {
    const harness = createExtensionHarness({cwd});
    await runExtensionEvent(harness.handlers, 'session_start', {reason:'new'}, harness.ctx);
    const failedLaunch = await executeRegisteredTool(harness.tool, harness.ctx, {args:['open','https://example.test/']});
    assert.equal(failedLaunch.isError, true);
    assert.equal(failedLaunch.details?.agentBrowserStarted, true);
    const outcome = failedLaunch.details?.managedSessionOutcome;
    assert.ok(outcome && typeof outcome === 'object' && 'status' in outcome);
    assert.equal(outcome.status, 'abandoned');
    const launched = (await readInvocationLog(log)).find(entry => extractUpstreamCommandTokens(entry.args)[0] === 'open');
    assert.ok(launched);
    const sessionName = extractExplicitSessionName(launched.args);
    assert.ok(sessionName, 'implicit launch must have an exact generated session');
    assert.equal((await readInvocationLog(log)).some(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), false, 'failed launch remains available for readback');

    await assert.rejects(
     runExtensionEvent(harness.handlers, 'session_shutdown', {reason:'reload'}, harness.ctx),
     'exit0 is not a valid close acknowledgement without boolean success:true',
    );
    const firstCloses = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
    assert.deepEqual(firstCloses.map(entry => extractExplicitSessionName(entry.args)), [sessionName]);
    const reloaded = createExtensionHarness({cwd, branch: harness.ctx.sessionManager.getBranch()});
    await runExtensionEvent(reloaded.handlers, 'session_start', {reason:'reload'}, reloaded.ctx);
    assert.deepEqual((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), firstCloses, 'a new factory must restore the failed owner without cleanup during startup');

    await runExtensionEvent(reloaded.handlers, 'session_shutdown', {reason:'quit'}, reloaded.ctx);
    const retriedCloses = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
    assert.deepEqual(retriedCloses.map(entry => extractExplicitSessionName(entry.args)), [sessionName,sessionName], 'failed close must retain ownership for the next quit');
    assert.deepEqual(retriedCloses[1].args, retriedCloses[0].args, 'retry must address the exact same resource');
    const settled = createExtensionHarness({cwd, branch: reloaded.ctx.sessionManager.getBranch()});
    await runExtensionEvent(settled.handlers, 'session_start', {reason:'reload'}, settled.ctx);
    await runExtensionEvent(settled.handlers, 'session_shutdown', {reason:'quit'}, settled.ctx);
    assert.deepEqual((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), retriedCloses, 'valid later acknowledgement settles ownership once');
   });
  } finally { await rm(cwd, {recursive:true,force:true}); }
 });
}

for (const mode of ['explicit', 'undispatched'] as const) {
 test(`failed launch cleanup: invalid close ACK cannot claim ${mode} ownership`, {concurrency:false}, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'piab-unowned-close-ack-'));
  const log = join(cwd, 'invocations.jsonl');
  await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
if (args.includes('open')) { process.stdout.write(JSON.stringify({success:false,error:'Chrome exited early before providing DevTools URL'})); process.exitCode=1; }
else { process.stdout.write(JSON.stringify({success:false,error:'unowned session must never be closed'})); process.exitCode=0; }`);
  try {
   await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`}, async () => {
    const harness = createExtensionHarness({cwd});
    await runExtensionEvent(harness.handlers, 'session_start', {reason:'new'}, harness.ctx);
    const args = mode === 'explicit' ? ['--session','caller-owned','open','https://example.test/']
     : ['--args=--user-agent=invalid','open','https://example.test/'];
    assert.equal((await executeRegisteredTool(harness.tool, harness.ctx, {args})).isError, true);
    await runExtensionEvent(harness.handlers, 'session_shutdown', {reason:'quit'}, harness.ctx);
    const reloaded = createExtensionHarness({cwd, branch: harness.ctx.sessionManager.getBranch()});
    await runExtensionEvent(reloaded.handlers, 'session_start', {reason:'reload'}, reloaded.ctx);
    await runExtensionEvent(reloaded.handlers, 'session_shutdown', {reason:'quit'}, reloaded.ctx);
    const entries = await readInvocationLog(log);
    assert.deepEqual(entries.filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), []);
    if (mode === 'explicit') {
     const launched = entries.find(entry => extractUpstreamCommandTokens(entry.args)[0] === 'open');
     assert.ok(launched);
     assert.equal(extractExplicitSessionName(launched.args), 'caller-owned');
    } else assert.deepEqual(entries, [], 'rejected plan must never dispatch a fake process');
   });
  } finally { await rm(cwd, {recursive:true,force:true}); }
 });
}

test('failed launch cleanup: quit finishes all owned closes and aggregates invalid ACKs before retrying only failed owners', {concurrency:false}, async () => {
 const cwd = await mkdtemp(join(tmpdir(), 'piab-multiple-close-acks-'));
 const log = join(cwd, 'invocations.jsonl');
 await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line)) : [];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
if (args.includes('open')) { process.stdout.write(JSON.stringify({success:false,error:'Chrome exited early before providing DevTools URL'})); process.exitCode=1; }
else if (args.includes('close')) {
 const sessionOf = argv => {
  let session;
  for (let index = 0; index < argv.length; index++) {
   if (argv[index] === '--session') session = argv[++index];
   else if (argv[index].startsWith('--session=')) session = argv[index].slice('--session='.length);
  }
  return session;
 };
 const session = sessionOf(args);
 const opens = previous.filter(entry => entry.args.includes('open'));
 const firstTwoSessions = opens.slice(0,2).map(entry => sessionOf(entry.args));
 if (!session || firstTwoSessions.length !== 2 || firstTwoSessions.some(value => !value)) throw new Error('fixture cannot identify exact owned sessions from argv');
 const retried = previous.some(entry => entry.args.includes('close') && sessionOf(entry.args) === session);
 process.stdout.write(JSON.stringify(firstTwoSessions.includes(session) && !retried ? {success:false,error:'fixture close rejected for ' + session + ' token=cleanup-secret ' + 'x'.repeat(8_000)} : {success:true,data:{closed:true}}));
 process.exitCode=0;
}
else { process.stdout.write(JSON.stringify({success:true})); }`);
 try {
  await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`}, async () => {
   const harness = createExtensionHarness({cwd});
   await runExtensionEvent(harness.handlers, 'session_start', {reason:'new'}, harness.ctx);
   for (const resource of ['first','second','third']) {
    const result = await executeRegisteredTool(harness.tool, harness.ctx, {args:['open',`https://example.test/${resource}`],sessionMode:'fresh'});
    assert.equal(result.isError, true);
    assert.equal(result.details?.agentBrowserStarted, true);
    const outcome = result.details?.managedSessionOutcome;
    assert.ok(outcome && typeof outcome === 'object' && 'status' in outcome);
    assert.equal(outcome.status, 'abandoned');
   }
   const entries = await readInvocationLog(log);
   const sessions = entries.filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'open').map(entry => extractExplicitSessionName(entry.args));
   assert.equal(sessions.length, 3);
   assert.ok(sessions.every(session => typeof session === 'string' && session.length > 0));
   assert.equal(new Set(sessions).size, 3, 'fresh failed launches must own distinct resources');
   assert.deepEqual(entries.filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), []);

   await assert.rejects(runExtensionEvent(harness.handlers, 'session_shutdown', {reason:'quit'}, harness.ctx), (error:unknown) => {
    assert.ok(error instanceof AggregateError, 'quit must report all failed cleanup acknowledgements together');
    assert.equal(error.errors.length, 2);
    for (const session of sessions.slice(0,2)) {
     assert.ok(error.errors.some(failure => String(failure).includes(session!)), 'each cleanup failure must identify its owned session');
     assert.ok(error.message.includes(session!), 'the host forwards only message/stack, so the aggregate message must identify each failed owner');
     assert.ok(error.stack?.includes(session!));
    }
    assert.ok(error.message.includes('fixture close rejected'), 'the host-visible message must include the cleanup reason');
    assert.ok(error.message.length <= 4_096, 'the whole aggregate summary must be bounded');
    assert.ok(!error.message.includes('cleanup-secret'));
    assert.ok(!error.stack?.includes('cleanup-secret'));
    return true;
   });
   const firstCloses = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
   assert.deepEqual(firstCloses.map(entry => extractExplicitSessionName(entry.args)).sort(), [...sessions].sort(), 'one invalid ACK must not prevent closing other owned resources');

   const reloaded = createExtensionHarness({cwd, branch: harness.ctx.sessionManager.getBranch()});
   await runExtensionEvent(reloaded.handlers, 'session_start', {reason:'reload'}, reloaded.ctx);
   await runExtensionEvent(reloaded.handlers, 'session_shutdown', {reason:'quit'}, reloaded.ctx);
   const allCloses = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
   assert.deepEqual(allCloses.slice(firstCloses.length).map(entry => extractExplicitSessionName(entry.args)).sort(), sessions.slice(0,2).sort(), 'only failed owners are retried');
   for (const retry of allCloses.slice(firstCloses.length)) {
    assert.deepEqual(retry.args, firstCloses.find(entry => extractExplicitSessionName(entry.args) === extractExplicitSessionName(retry.args))?.args);
   }
   const settled = createExtensionHarness({cwd, branch: reloaded.ctx.sessionManager.getBranch()});
   await runExtensionEvent(settled.handlers, 'session_start', {reason:'reload'}, settled.ctx);
   await runExtensionEvent(settled.handlers, 'session_shutdown', {reason:'quit'}, settled.ctx);
   assert.deepEqual((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), allCloses);
  });
 } finally { await rm(cwd, {recursive:true,force:true}); }
});

test('failed fresh launch preserves prior active owner and retries both exact cleanup identities across factories', {concurrency:false}, async () => {
 const cwd = await mkdtemp(join(tmpdir(), 'piab-prior-active-fresh-'));
 const log = join(cwd, 'invocations.jsonl');
 await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line)) : [];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
const sessionOf = argv => {
 let session;
 for (let index = 0; index < argv.length; index++) {
  if (argv[index] === '--session') session = argv[++index];
  else if (argv[index].startsWith('--session=')) session = argv[index].slice('--session='.length);
 }
 return session;
};
if (args.includes('open') && !args.includes('https://example.test/prior')) {
 process.stdout.write(JSON.stringify({success:false,error:'Chrome exited early before providing DevTools URL'})); process.exitCode=1;
} else if (args.includes('close')) {
 const session = sessionOf(args);
 if (!session) throw new Error('fixture requires exact cleanup identity');
 const retried = previous.some(entry => entry.args.includes('close') && sessionOf(entry.args) === session);
 process.stdout.write(JSON.stringify(retried ? {success:true,data:{closed:true}} : {success:false,error:'prior-active fixture close rejected'}));
} else process.stdout.write(JSON.stringify({success:true,data:{url:'https://example.test/prior',title:'fixture',result:'https://example.test/prior'}}));`);
 try {
  await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`}, async () => {
   const harness = createExtensionHarness({cwd});
   await runExtensionEvent(harness.handlers, 'session_start', {reason:'new'}, harness.ctx);
   const prior = await executeRegisteredTool(harness.tool, harness.ctx, {args:['open','https://example.test/prior']});
   assert.equal(prior.isError, false, JSON.stringify(prior));
   const failed = await executeRegisteredTool(harness.tool, harness.ctx, {args:['open','https://example.test/failed'],sessionMode:'fresh'});
   assert.equal(failed.isError, true);
   assert.equal(failed.details?.agentBrowserStarted, true);
   assert.equal(failed.details?.usedImplicitSession, false, 'selection hint must not control fresh cleanup ownership');
   const outcome = failed.details?.managedSessionOutcome as {status?:string;activeBefore?:boolean;activeAfter?:boolean;attemptedSessionName?:string;currentSessionName?:string};
   assert.equal(outcome.status, 'preserved');
   assert.equal(outcome.activeBefore, true);
   assert.equal(outcome.activeAfter, true);
   const ownedOpens = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'open');
   const ownedSessions = ownedOpens.map(entry => extractExplicitSessionName(entry.args));
   assert.equal(ownedSessions.length, 2);
   assert.ok(ownedSessions.every(session => typeof session === 'string' && session.length > 0));
   assert.equal(new Set(ownedSessions).size, 2);
   assert.equal(outcome.currentSessionName, ownedSessions[0], 'failed fresh attempt must not replace the active page');
   assert.equal(outcome.attemptedSessionName, ownedSessions[1]);
   for (const params of [
    {args:['--session','caller-owned','open','https://example.test/caller'],sessionMode:'fresh' as const},
    {args:['--args=--user-agent=invalid','open','https://example.test/undispatched'],sessionMode:'fresh' as const},
   ]) assert.equal((await executeRegisteredTool(harness.tool, harness.ctx, params)).isError, true);
   assert.deepEqual((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), [], 'preserved failure remains available for readback');
   await assert.rejects(runExtensionEvent(harness.handlers, 'session_shutdown', {reason:'quit'}, harness.ctx), (error:unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    for (const session of ownedSessions) assert.ok(error.message.includes(session!));
    return true;
   });
   const firstCloses = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
   assert.deepEqual(firstCloses.map(entry => extractExplicitSessionName(entry.args)).sort(), [...ownedSessions].sort(), 'quit closes attempted and prior owners, never caller-owned or undispatched resources');
   const reloaded = createExtensionHarness({cwd, branch:harness.ctx.sessionManager.getBranch()});
   await runExtensionEvent(reloaded.handlers, 'session_start', {reason:'reload'}, reloaded.ctx);
   assert.deepEqual((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), firstCloses, 'restoration must not close before quit');
   await runExtensionEvent(reloaded.handlers, 'session_shutdown', {reason:'quit'}, reloaded.ctx);
   const allCloses = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
   assert.deepEqual(allCloses.slice(firstCloses.length).map(entry => extractExplicitSessionName(entry.args)).sort(), [...ownedSessions].sort());
   for (const retry of allCloses.slice(firstCloses.length)) assert.deepEqual(retry.args, firstCloses.find(entry => extractExplicitSessionName(entry.args) === extractExplicitSessionName(retry.args))?.args);
   const settled = createExtensionHarness({cwd, branch:reloaded.ctx.sessionManager.getBranch()});
   await runExtensionEvent(settled.handlers, 'session_start', {reason:'reload'}, settled.ctx);
   await runExtensionEvent(settled.handlers, 'session_shutdown', {reason:'quit'}, settled.ctx);
   assert.deepEqual((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), allCloses, 'acknowledged owners must not resurrect');
  });
 } finally { await rm(cwd, {recursive:true,force:true}); }
});

for (const attached of [false, true]) {
 test(`managed cleanup durable policy: kept owner restores namespace, disabled restore and known-null provenance (attached=${attached})`, {concurrency:false}, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'piab-durable-policy-'));
  const log = join(cwd, 'invocations.jsonl');
  await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args, autosave:process.env.AGENT_BROWSER_AUTOSAVE_INTERVAL_MS ?? null})+'\\n');
if (args.includes('session') && args.includes('info')) process.stdout.write(JSON.stringify({success:true,data:{active:previous.some(entry => entry.args.includes('open')),runtime:{restoreKey:null}}}));
else if (args.includes('close')) process.stdout.write(JSON.stringify(previous.some(entry => entry.args.includes('close')) ? {success:true,data:{closed:true}} : {success:false,error:'policy fixture rejected close'}));
else process.stdout.write(JSON.stringify({success:true,data:{url:'https://example.test/',title:'fixture',result:'https://example.test/'}}));`);
  try {
   await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`, PI_AGENT_BROWSER_MANAGED_SESSION_RESTORE:'0', PI_AGENT_BROWSER_TEST_CUSTOM_SESSION_INFO:'1', AGENT_BROWSER_AUTOSAVE_INTERVAL_MS:'700', AGENT_BROWSER_HEADED:undefined}, async () => {
    const original = createExtensionHarness({cwd});
    await runExtensionEvent(original.handlers, 'session_start', {reason:'new'}, original.ctx);
    const result = await executeRegisteredTool(original.tool, original.ctx, {args:['--namespace','durable-policy',...(attached ? ['--cdp','http://127.0.0.1:9222'] : ['--headed']),'open','https://example.test/']});
    assert.equal(result.isError, false, JSON.stringify(result));
    // Retain the real tool transcript too: terminal custom entries must win over
    // its stale active launch state in all subsequent factories.
    original.ctx.sessionManager.getBranch().push({type:'message',message:{toolName:'agent_browser',details:result.details,isError:false}});
    await runExtensionEvent(original.handlers, 'session_shutdown', {reason:'reload'}, original.ctx);
    const branch = original.ctx.sessionManager.getBranch();
    const pending = original.appendedEntries.filter(entry => entry.customType === 'agent-browser-managed-cleanup').at(-1)?.data as {state:string; attached:boolean; restoreDisabled:boolean; daemonRestoreKey?:string|null};
    assert.equal(pending.state, 'pending');
    assert.equal(pending.attached, attached);
    assert.equal(pending.restoreDisabled, true);
    assert.equal(Object.hasOwn(pending, 'daemonRestoreKey'), true);
    assert.equal(pending.daemonRestoreKey, null);
    const reloaded = createExtensionHarness({cwd, branch});
    await runExtensionEvent(reloaded.handlers, 'session_start', {reason:'reload'}, reloaded.ctx);
    await assert.rejects(runExtensionEvent(reloaded.handlers, 'session_shutdown', {reason:'quit'}, reloaded.ctx));
    const retry = createExtensionHarness({cwd, branch});
    await runExtensionEvent(retry.handlers, 'session_start', {reason:'reload'}, retry.ctx);
    await runExtensionEvent(retry.handlers, 'session_shutdown', {reason:'quit'}, retry.ctx);
    const closes = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
    assert.equal(closes.length, 2);
    assert.deepEqual(closes[0], closes[1], 'close retry preserves original namespace and launch-time autosave policy');
    assert.ok(closes[0].args.includes('durable-policy'));
    const settled = createExtensionHarness({cwd, branch});
    await runExtensionEvent(settled.handlers, 'session_start', {reason:'reload'}, settled.ctx);
    await runExtensionEvent(settled.handlers, 'session_shutdown', {reason:'quit'}, settled.ctx);
    assert.equal((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close').length, 2);
   });
  } finally { await rm(cwd, {recursive:true,force:true}); }
 });
}

test('managed cleanup restoration rejects malformed, foreign and undispatched ownership records', {concurrency:false}, async () => {
 const cwd = await mkdtemp(join(tmpdir(), 'piab-cleanup-record-validation-'));
 const log = join(cwd, 'invocations.jsonl');
 await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs'); const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
process.stdout.write(JSON.stringify(args.includes('open') ? {success:false,error:'fixture failed launch'} : {success:true}));`);
 try {
  await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`}, async () => {
   const original = createExtensionHarness({cwd});
   await runExtensionEvent(original.handlers, 'session_start', {reason:'new'}, original.ctx);
   await executeRegisteredTool(original.tool, original.ctx, {args:['open','https://example.test/']});
   const data = original.appendedEntries.find(entry => entry.customType === 'agent-browser-managed-cleanup')?.data;
   assert.ok(data);
   type FixtureRecord = Record<string, unknown> & {owner?: Record<string, unknown>};
   for (const mutate of [
    (record:FixtureRecord) => { record.dispatched = false; },
    (record:FixtureRecord) => { record.owner!.sessionName = 'caller-owned'; },
    (record:FixtureRecord) => { record.sessionId = 'foreign-pi-session'; },
    (record:FixtureRecord) => { record.owner!.cwd = tmpdir(); },
    (record:FixtureRecord) => { record.restoreDisabled = 'false'; },
    (record:FixtureRecord) => { record.owner!.namespace = ' bad namespace '; },
    (record:FixtureRecord) => { record.daemonRestoreKey = 'secret-token'; },
    (record:FixtureRecord) => { delete record.owner; },
   ]) {
    const forged = structuredClone(data) as FixtureRecord;
    mutate(forged);
    const harness = createExtensionHarness({cwd, branch:[{type:'custom',customType:'agent-browser-managed-cleanup',data:forged}]});
    await runExtensionEvent(harness.handlers, 'session_start', {reason:'reload'}, harness.ctx);
    await runExtensionEvent(harness.handlers, 'session_shutdown', {reason:'quit'}, harness.ctx);
   }
   assert.deepEqual((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), []);
  });
 } finally { await rm(cwd, {recursive:true,force:true}); }
});

for (const interval of [undefined, '700']) {
 for (const preservePrior of [false, true]) {
  test(`failed headed fresh cleanup retains launch autosave through changed env and factories (interval=${interval ?? 'default'}, prior=${preservePrior})`, {concurrency:false}, async () => {
   const cwd = await mkdtemp(join(tmpdir(), 'piab-failed-headed-policy-'));
   const log = join(cwd, 'invocations.jsonl');
   await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args, autosave:process.env.AGENT_BROWSER_AUTOSAVE_INTERVAL_MS ?? null})+'\\n');
if (args.includes('open') && args.includes('https://example.test/failed')) {
 process.stdout.write(JSON.stringify({success:false,error:'Chrome exited early before providing DevTools URL',data:{managedSessionHeadedAutosaveInterval:'999',managedSessionHeadedAutosaveDisabled:false}})); process.exitCode=1;
} else if (args.includes('close')) {
 process.stdout.write(JSON.stringify(previous.some(entry => entry.args.includes('close')) ? {success:true,data:{closed:true}} : {success:false,error:'headed fixture rejected close'}));
} else process.stdout.write(JSON.stringify({success:true,data:{url:'https://example.test/prior',title:'fixture',result:'https://example.test/prior'}}));`);
   try {
    await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`, AGENT_BROWSER_AUTOSAVE_INTERVAL_MS:interval, AGENT_BROWSER_HEADED:undefined}, async () => {
     const original = createExtensionHarness({cwd});
     await runExtensionEvent(original.handlers, 'session_start', {reason:'new'}, original.ctx);
     if (preservePrior) assert.equal((await executeRegisteredTool(original.tool, original.ctx, {args:['open','https://example.test/prior']})).isError, false);
     const failed = await executeRegisteredTool(original.tool, original.ctx, {args:['--namespace','failed-headed','--headed','open','https://example.test/failed'],sessionMode:'fresh'});
     assert.equal(failed.isError, true);
     assert.equal(failed.details?.agentBrowserStarted, true);
     const outcome = failed.details?.managedSessionOutcome as {status?:string;attemptedSessionName?:string};
     assert.equal(outcome.status, preservePrior ? 'preserved' : 'abandoned');
     assert.ok(outcome.attemptedSessionName);
     assert.equal(failed.details?.managedSessionHeadedAutosaveInterval, undefined, 'attempted-owner policy must not masquerade as the retained current session policy');
     const opens = (await readInvocationLog(log)) as Array<{args:string[];autosave:string|null}>;
     const attempted = opens.find(entry => entry.args.includes('https://example.test/failed'));
     assert.equal(attempted?.autosave, interval ?? '0');
     assert.equal(opens.some(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close'), false, 'failed launch remains available for readback');
     await withPatchedEnv({AGENT_BROWSER_AUTOSAVE_INTERVAL_MS:'900'}, async () => {
      await assert.rejects(runExtensionEvent(original.handlers, 'session_shutdown', {reason:'reload'}, original.ctx));
      const reloaded = createExtensionHarness({cwd, branch:original.ctx.sessionManager.getBranch()});
      await runExtensionEvent(reloaded.handlers, 'session_start', {reason:'reload'}, reloaded.ctx);
      const closesBeforeQuit = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
      assert.equal(closesBeforeQuit.length, 1, 'reload closes only the failed fresh owner and startup must not close again');
      await runExtensionEvent(reloaded.handlers, 'session_shutdown', {reason:'quit'}, reloaded.ctx);
      const closes = (await readInvocationLog(log) as Array<{args:string[];autosave:string|null}>).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close' && extractExplicitSessionName(entry.args) === outcome.attemptedSessionName);
      assert.equal(closes.length, 2);
      assert.equal(closes[0].autosave, interval ?? '0', 'cleanup uses trusted launch-time policy, not changed env or upstream data');
      assert.deepEqual(closes[1], closes[0], 'new factory retries the exact identity and original policy');
     });
    });
   } finally { await rm(cwd, {recursive:true,force:true}); }
  });
 }
}

for (const restoreFactory of [false, true]) {
 test(`partial quit ACK invalidates closed current state while retaining only failed fresh owner (restore=${restoreFactory})`, {concurrency:false}, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'piab-partial-current-close-'));
  const log = join(cwd, 'invocations.jsonl');
  await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
if (args.includes('open') && args.includes('https://example.test/failed')) {
 process.stdout.write(JSON.stringify({success:false,error:'Chrome exited early before providing DevTools URL'})); process.exitCode=1;
} else if (args.includes('close')) {
 const failed = args.includes('failed-owner');
 const retried = previous.some(entry => entry.args.includes('close') && entry.args.includes('failed-owner'));
 process.stdout.write(JSON.stringify(failed && !retried ? {success:false,error:'fresh owner close rejected'} : {success:true,data:{closed:true}}));
} else if (args.includes('snapshot')) {
 process.stdout.write(JSON.stringify({success:true,data:{origin:'https://example.test/prior',refs:{e1:{role:'button',name:'Prior'}},snapshot:'- button "Prior" [ref=e1]'}}));
} else process.stdout.write(JSON.stringify({success:true,data:{url:'https://example.test/prior',title:'fixture',result:'https://example.test/prior'}}));`);
  try {
   await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`}, async () => {
    const original = createExtensionHarness({cwd});
    await runExtensionEvent(original.handlers, 'session_start', {reason:'new'}, original.ctx);
    const prior = await executeRegisteredTool(original.tool, original.ctx, {args:['--namespace','current-owner','open','https://example.test/prior']});
    assert.equal(prior.isError, false);
    const snapshot = await executeRegisteredTool(original.tool, original.ctx, {args:['--namespace','current-owner','snapshot','-i']});
    assert.equal(snapshot.isError, false);
    const snapshotRefs = snapshot.details?.refSnapshot;
    assert.ok(snapshotRefs && typeof snapshotRefs === 'object' && 'refIds' in snapshotRefs);
    assert.deepEqual(snapshotRefs.refIds, ['e1']);
    const failed = await executeRegisteredTool(original.tool, original.ctx, {args:['--namespace','failed-owner','open','https://example.test/failed'],sessionMode:'fresh'});
    assert.equal(failed.isError, true);
    for (const result of [prior,snapshot,failed]) original.ctx.sessionManager.getBranch().push({type:'message',message:{toolName:'agent_browser',details:result.details,isError:result.isError}});
    const failedOutcome = failed.details?.managedSessionOutcome;
    assert.ok(failedOutcome && typeof failedOutcome === 'object' && 'attemptedSessionName' in failedOutcome);
    const failedSession = failedOutcome.attemptedSessionName;
    await assert.rejects(runExtensionEvent(original.handlers, 'session_shutdown', {reason:'quit'}, original.ctx));
    const firstCloses = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
    assert.equal(firstCloses.length, 2);
    const current = restoreFactory ? createExtensionHarness({cwd, branch:original.ctx.sessionManager.getBranch()}) : original;
    if (restoreFactory) await runExtensionEvent(current.handlers, 'session_start', {reason:'reload'}, current.ctx);
    const readback = await executeRegisteredTool(current.tool, current.ctx, {args:['get','url']});
    assert.equal(readback.isError, false, JSON.stringify(readback));
    const readbackOutcome = readback.details?.managedSessionOutcome;
    assert.ok(readbackOutcome && typeof readbackOutcome === 'object' && 'activeBefore' in readbackOutcome);
    assert.equal(readbackOutcome.activeBefore, false, 'ACK of the exact current owner clears active state');
    assert.notEqual(readback.details?.sessionName, prior.details?.sessionName, 'closed current identity must rotate');
    assert.equal(readback.details?.refSnapshot, undefined, 'closed current refs must not survive cleanup');
    await runExtensionEvent(current.handlers, 'session_shutdown', {reason:'quit'}, current.ctx);
    const originalSessions = firstCloses.map(entry => extractExplicitSessionName(entry.args));
    const retries = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close' && originalSessions.includes(extractExplicitSessionName(entry.args))).slice(firstCloses.length);
    assert.deepEqual(retries.map(entry => extractExplicitSessionName(entry.args)), [failedSession], 'only the failed original owner is retried');
   });
  } finally { await rm(cwd, {recursive:true,force:true}); }
 });
}

for (const stalePending of [false, true]) {
 for (const namespace of [undefined, 'closed-scope']) {
 test(`retained close ACK dominates ${stalePending ? 'stale pending custom entry and' : 'message-only'} active branch history (namespace=${namespace ?? 'default'})`, {concurrency:false}, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'piab-retained-close-branch-'));
  const log = join(cwd, 'invocations.jsonl');
  await writeFakeAgentBrowserBinary(cwd, `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
if (args.includes('open') && args.includes('https://example.test/off-branch')) {
 process.stdout.write(JSON.stringify({success:false,error:'Chrome exited early before providing DevTools URL'})); process.exitCode=1;
} else if (args.includes('snapshot')) {
 process.stdout.write(JSON.stringify({success:true,data:{origin:'https://example.test/prior',refs:{e1:{role:'button',name:'Prior'}},snapshot:'- button "Prior" [ref=e1]'}}));
} else process.stdout.write(JSON.stringify({success:true,data:{closed:true,url:'https://example.test/prior',title:'fixture',result:'https://example.test/prior'}}));`);
  try {
   await withPatchedEnv({PATH:`${cwd}${delimiter}${process.env.PATH ?? ''}`, AGENT_BROWSER_NAMESPACE:undefined}, async () => {
    const harness = createExtensionHarness({cwd});
    await runExtensionEvent(harness.handlers, 'session_start', {reason:'new'}, harness.ctx);
    const namespaceArgs = namespace ? ['--namespace',namespace] : [];
    const opened = await executeRegisteredTool(harness.tool, harness.ctx, {args:[...namespaceArgs,'open','https://example.test/prior']});
    assert.equal(opened.isError, false, JSON.stringify(opened));
    const closedSession = opened.details?.sessionName;
    assert.ok(typeof closedSession === 'string');
    const snapshot = await executeRegisteredTool(harness.tool, harness.ctx, {args:[...namespaceArgs,'snapshot','-i']});
    assert.equal(snapshot.isError, false, JSON.stringify(snapshot));
    assert.ok(snapshot.details?.refSnapshot);
    const oldMessages = [opened,snapshot].map(result => ({type:'message',message:{toolName:'agent_browser',details:result.details,isError:false}}));
    const oldPending = harness.ctx.sessionManager.getBranch().filter(entry => {
     return entry !== null && typeof entry === 'object'
      && 'type' in entry && entry.type === 'custom'
      && 'customType' in entry && entry.customType === 'agent-browser-managed-cleanup';
    });
    assert.ok(oldPending.length > 0, 'capture real pre-close pending history, not a forged ownership record');
    const failed = await executeRegisteredTool(harness.tool, harness.ctx, {args:['--namespace','off-branch','open','https://example.test/off-branch'],sessionMode:'fresh'});
    assert.equal(failed.isError, true);
    const failedOutcome = failed.details?.managedSessionOutcome;
    assert.ok(failedOutcome && typeof failedOutcome === 'object' && 'attemptedSessionName' in failedOutcome);
    assert.ok(typeof failedOutcome.attemptedSessionName === 'string');
    const closed = await executeRegisteredTool(harness.tool, harness.ctx, {args:[...namespaceArgs,'--session',closedSession,'close']});
    assert.equal(closed.isError, false, JSON.stringify(closed));
    const closedOutcome = closed.details?.managedSessionOutcome;
    assert.ok(closedOutcome && typeof closedOutcome === 'object' && 'currentSessionName' in closedOutcome && 'activeAfter' in closedOutcome);
    assert.equal(closedOutcome.activeAfter, false);
    assert.ok(closedOutcome.currentSessionName);
    assert.notEqual(closedOutcome.currentSessionName, closedSession);
    const staleBranch = stalePending ? [...oldPending,...oldMessages] : oldMessages;
    harness.setBranch(staleBranch);
    await runExtensionEvent(harness.handlers, 'session_tree', {newLeafId:'old-active',oldLeafId:'closed'}, harness.ctx);
    await runExtensionEvent(harness.handlers, 'session_tree', {newLeafId:'old-active-again',oldLeafId:'old-active'}, harness.ctx);
    const readback = await executeRegisteredTool(harness.tool, harness.ctx, {args:['get','url']});
    assert.equal(readback.isError, false, JSON.stringify(readback));
    const readbackOutcome = readback.details?.managedSessionOutcome;
    assert.ok(readbackOutcome && typeof readbackOutcome === 'object' && 'activeBefore' in readbackOutcome && 'attemptedSessionName' in readbackOutcome);
    assert.equal(readbackOutcome.activeBefore, false, 'retained ACK must invalidate the historical active page');
    assert.equal(readbackOutcome.attemptedSessionName, closedOutcome.currentSessionName, 'repeated stale restores reuse the already reserved post-close identity');
    assert.notEqual(readback.details?.sessionName, closedSession);
    assert.equal(readback.details?.refSnapshot, undefined, 'closed identity snapshot refs must not return');
    assert.equal(readback.details?.namespace, undefined, 'closed namespace must not leak into the fresh identity');
    assert.deepEqual((await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close').map(entry => extractExplicitSessionName(entry.args)), [closedSession], 'branch restoration never re-closes an acknowledged owner');

    // A real dispatch has now created a fresh pending lifecycle. Restore the whole
    // resulting branch, including its stale history, without resetting that page.
    harness.ctx.sessionManager.getBranch().push({type:'message',message:{toolName:'agent_browser',details:readback.details,isError:false}});
    await runExtensionEvent(harness.handlers, 'session_tree', {newLeafId:'reopened',oldLeafId:'old-active-again'}, harness.ctx);
    const reopened = await executeRegisteredTool(harness.tool, harness.ctx, {args:['get','url']});
    assert.equal(reopened.isError, false, JSON.stringify(reopened));
    const reopenedOutcome = reopened.details?.managedSessionOutcome;
    assert.ok(reopenedOutcome && typeof reopenedOutcome === 'object' && 'activeBefore' in reopenedOutcome);
    assert.equal(reopenedOutcome.activeBefore, true);
    assert.equal(reopened.details?.sessionName, readback.details?.sessionName, 'new pending lifecycle remains active across whole-branch restore');
    await runExtensionEvent(harness.handlers, 'session_shutdown', {reason:'quit'}, harness.ctx);
    const closes = (await readInvocationLog(log)).filter(entry => extractUpstreamCommandTokens(entry.args)[0] === 'close');
    assert.deepEqual(closes.map(entry => extractExplicitSessionName(entry.args)).sort(), [closedSession,failedOutcome.attemptedSessionName,readback.details?.sessionName].sort(), 'quit retains off-branch ownership and closes only live resources, never the old ACKed identity twice');
   });
  } finally { await rm(cwd, {recursive:true,force:true}); }
 });
 }
}
