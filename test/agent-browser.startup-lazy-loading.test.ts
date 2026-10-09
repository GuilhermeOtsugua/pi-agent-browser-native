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
const deferred = ['/browser-run/index.js', '/browser-run/prepare.js', '/browser-run/process-output.js'];
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
