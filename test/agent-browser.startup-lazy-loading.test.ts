import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { execPath } from "node:process";
import { test } from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("compiled startup registers synchronously without loading browser execution phases", async () => {
	// A fresh process observes actual ESM loads, including transitive imports. This
	// must not pass merely because a static import was moved behind another barrel.
	const script = `
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const deferred = [
  '/browser-run/index.js', '/browser-run/prepare.js', '/browser-run/process-output.js',
  '/browser-run/final-result.js', '/browser-run/diagnostics.js',
  '/electron-host/index.js', '/electron/cleanup.js', '/electron/launch.js',
  '/orchestration/script-run.js'
];
let executionRequested = false;
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (deferred.some(path => url.endsWith(path))) {
      assert.equal(executionRequested, true, 'execution graph loaded during registration or empty lifecycle');
      throw new Error('DEMAND_EXECUTION_IMPORT');
    }
    return nextLoad(url, context);
  }
});
const extension = await import('./dist/extensions/agent-browser/index.js');
const handlers = new Map();
const tools = [];
const pi = { on(name, handler) { handlers.set(name, handler); }, registerTool(tool) { tools.push(tool); } };
assert.equal(extension.default(pi), undefined, 'factory must remain synchronous');
const tool = tools.find(tool => tool.name === 'agent_browser');
assert.ok(tool);
assert.equal(tool.parameters.type, 'object');
assert.ok(tool.parameters.properties.args);
assert.ok(tool.parameters.properties.script);
assert.equal(typeof tool.execute, 'function');
assert.equal(typeof tool.renderCall, 'function');
assert.equal(typeof tool.renderResult, 'function');
assert.deepEqual([...handlers.keys()].sort(), ['before_agent_start', 'session_shutdown', 'session_start', 'session_tree', 'tool_call', 'tool_result']);
const ctx = {
  cwd: process.cwd(),
  sessionManager: {
    getSessionId() { return 'startup-lazy-test'; },
    getBranch() { return []; },
    getSessionFile() { return undefined; }
  }
};
await handlers.get('session_start')({}, ctx);
await handlers.get('session_tree')({}, ctx);
await handlers.get('session_shutdown')({ reason: 'quit' }, ctx);
executionRequested = true;
await assert.rejects(tool.execute('lazy-test', { args: ['--help'] }, undefined, undefined, ctx), /DEMAND_EXECUTION_IMPORT/);
hook.deregister();
console.log('synchronous registration, empty restore/cleanup, and demand import verified');
`;
	const result = await execFile(execPath, ["--input-type=module", "-e", script], {
		timeout: 10_000,
	});
	assert.match(result.stdout, /demand import verified/);
});

test("Electron transcript replay stays pure and host actions/owned shutdown demand-load execution", async () => {
	// Separate processes prove both boundaries; ESM caches a rejected import.
	for (const boundary of ["host", "shutdown"]) {
	const script = `
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
let executionRequested = false;
let demandLoads = 0;
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/electron-host/index.js')) {
      assert.equal(executionRequested, true, 'host execution loaded during transcript replay');
      demandLoads++;
      throw new Error('DEMAND_HOST_IMPORT');
    }
    return nextLoad(url, context);
  }
});
const extension = await import('./dist/extensions/agent-browser/index.js');
const contract = await import('./dist/extensions/agent-browser/lib/orchestration/electron-host/contract.js');
const launch = {
  version: 1, launchedByWrapper: true, launchId: 'owned-launch', appName: 'fixture',
  executablePath: 'fixture', userDataDir: 'fixture', port: 9222, createdAtMs: 1,
  cleanupState: 'active', sessionName: 'owned-session'
};
const entry = (electron, namespace = 'fixture-namespace') => ({
  type: 'message', message: { toolName: 'agent_browser', details: { electron, namespace } }
});
const launchEntry = entry({ launch });
const cleaned = { ...launch, cleanupState: 'cleaned', sessionName: undefined };
assert.equal(contract.restoreElectronLaunchRecordsFromBranch([launchEntry]).get(launch.launchId).namespace, 'fixture-namespace');
assert.equal(contract.restoreElectronLaunchRecordsFromBranch([entry({ launch: { ...launch, namespace: '' } })]).get(launch.launchId).namespace, '');
assert.deepEqual(contract.restoreElectronLaunchRecordsFromBranch([launchEntry, entry({ cleanup: { records: [cleaned] } })]).get(launch.launchId), { ...cleaned, namespace: 'fixture-namespace' });
const handlers = new Map();
const tools = [];
assert.equal(extension.default({ on(name, handler) { handlers.set(name, handler); }, registerTool(tool) { tools.push(tool); } }), undefined);
let branch = [launchEntry];
const ctx = { cwd: process.cwd(), sessionManager: {
  getSessionId() { return 'electron-lazy-test'; }, getBranch() { return branch; }, getSessionFile() { return undefined; }
} };
await handlers.get('session_start')({}, ctx);
await handlers.get('session_tree')({}, ctx);
executionRequested = true;
const tool = tools.find(tool => tool.name === 'agent_browser');
if ('${boundary}' === 'host') {
  await assert.rejects(tool.execute('host-demand', { electron: { action: 'status', all: true } }, undefined, undefined, ctx), /DEMAND_HOST_IMPORT/);
} else {
  await assert.rejects(handlers.get('session_shutdown')({ reason: 'quit' }, ctx), /DEMAND_HOST_IMPORT/);
}
assert.equal(demandLoads, 1);
hook.deregister();
console.log('pure replay and host/owned cleanup demand import verified');
`;
	const result = await execFile(execPath, ["--input-type=module", "-e", script], { timeout: 10_000 });
	assert.match(result.stdout, /owned cleanup demand import verified/);
	}
});
