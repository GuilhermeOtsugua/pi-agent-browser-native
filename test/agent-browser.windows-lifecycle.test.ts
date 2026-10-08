/** Native Windows regressions; fake custom shims do not launch a browser. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { hasManagedSessionRestoreProjectIdentity, createManagedSessionRestoreKey } from "../extensions/agent-browser/lib/managed-session-storage.js";
import { runAgentBrowserProcess } from "../extensions/agent-browser/lib/process.js";
import { writeFakeAgentBrowserBinary } from "./helpers/agent-browser-harness.js";

const windowsOnly = { skip: process.platform !== "win32" };

test("Windows checkout identity accepts native volume metadata and rejects path reuse", windowsOnly, async () => {
	const root = await mkdtemp(join(tmpdir(), "piab-windows-identity-"));
	const project = join(root, "project");
	try {
		execFileSync("git", ["init", "-q", project]);
		assert.equal(hasManagedSessionRestoreProjectIdentity(project), true);
		const original = createManagedSessionRestoreKey(project);
		assert.equal(createManagedSessionRestoreKey(project), original);
		await rm(project, { recursive: true, force: true });
		execFileSync("git", ["init", "-q", project]);
		assert.equal(hasManagedSessionRestoreProjectIdentity(project), true);
		assert.notEqual(createManagedSessionRestoreKey(project), original);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

for (const reason of ["timeout", "abort"] as const) {
	test(`Windows ${reason} reaps the custom-shim descendant before returning`, windowsOnly, async () => {
		const root = await mkdtemp(join(tmpdir(), "piab-windows-reap-"));
		const pidPath = join(root, "descendant.pid");
		let descendant: number | undefined;
		let shim: number | undefined;
		const controller = new AbortController();
		await writeFakeAgentBrowserBinary(root, `const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify({ shim: process.pid, descendant: child.pid }));
setInterval(() => {}, 1000);`);
		try {
			const pending = runAgentBrowserProcess({
				args: ["open", "https://fixture.invalid"],
				cwd: root,
				env: { PATH: `${root}${delimiter}${process.env.PATH ?? ""}` },
				signal: controller.signal,
				timeoutMs: 5_000,
			});
			for (let attempt = 0; attempt < 200; attempt++) {
				try {
					({ descendant, shim } = JSON.parse(await readFile(pidPath, "utf8")));
					break;
				} catch {
					await new Promise(resolve => setTimeout(resolve, 20));
				}
			}
			assert.ok(descendant, "fixture must start before cancellation");
			if (reason === "abort") controller.abort();
			const result = await pending;
			assert.equal(result.timedOut, reason === "timeout");
			assert.equal(result.aborted, reason === "abort");
			assert.throws(() => process.kill(descendant!, 0), { code: "ESRCH" });
		} finally {
			controller.abort();
			for (const pid of [shim, descendant]) {
				if (pid) {
					try { process.kill(pid, 0); execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
				}
			}
			await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
}
