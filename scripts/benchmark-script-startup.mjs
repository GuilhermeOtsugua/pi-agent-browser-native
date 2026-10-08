// Windows worker-entrypoint regression benchmark. No browser or network activity.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { runAgentBrowserScript, AGENT_BROWSER_SCRIPT_IPC_MESSAGE_MAX_BYTES } from "../dist/extensions/agent-browser/lib/input-modes/script.js";

const worker = fileURLToPath(new URL("../dist/extensions/agent-browser/script-worker.js", import.meta.url));
const attempts = 20;
const before = [];
const after = [];
const code = 'emit({ ok: true, title: "Criação — Comunicação" });';
for (let i = 0; i < attempts; i++) {
	const started = performance.now();
	const result = spawnSync(process.execPath, ["--permission", "--max-old-space-size=64", worker,
		String(AGENT_BROWSER_SCRIPT_IPC_MESSAGE_MAX_BYTES), "10000000"], {
		env: {}, encoding: "utf8", input: JSON.stringify({ type: "start", code }) + "\n", timeout: 5000,
	});
	before.push({ elapsedMs: performance.now() - started, exit: result.status,
		ready: result.stdout.includes('"type":"ready"'), permissionDenied: result.stderr.includes("ERR_ACCESS_DENIED") });
}
for (let i = 0; i < attempts; i++) {
	const started = performance.now();
	const result = await runAgentBrowserScript({ code, dispatch: async () => { throw new Error("No browser calls expected"); } });
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(result.data, { ok: true, title: "Criação — Comunicação" });
	after.push({ elapsedMs: performance.now() - started, ok: result.ok, callCount: result.callCount });
}
const scope = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${worker}`, "--eval",
	`console.log(JSON.stringify({ worker: process.permission.has('fs.read', ${JSON.stringify(worker)}), sibling: process.permission.has('fs.read', ${JSON.stringify(fileURLToPath(new URL('../package.json', import.meta.url)))}), child: process.permission.has('child') }));`],
	{ env: {}, encoding: "utf8", timeout: 5000 });
assert.equal(scope.status, 0, scope.stderr);
const permissionScope = JSON.parse(scope.stdout);
assert.deepEqual(permissionScope, { worker: true, sibling: false, child: false });
const report = { platform: process.platform, runtime: process.version,
	workload: "matched startup-permission control then compiled isolated emit runner; zero HTTP/browser calls",
	before: { attempts, ready: before.filter(r => r.ready).length, permissionDenied: before.filter(r => r.permissionDenied).length, observations: before },
	after: { attempts, successes: after.filter(r => r.ok).length, observations: after }, permissionScope };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
