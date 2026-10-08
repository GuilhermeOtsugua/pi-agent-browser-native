/** Native Windows regressions; fake custom shims do not launch a browser. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { hasManagedSessionRestoreProjectIdentity, createManagedSessionRestoreKey } from "../extensions/agent-browser/lib/managed-session-storage.js";
import { buildAgentBrowserSpawnCommand, runAgentBrowserProcess } from "../extensions/agent-browser/lib/process.js";
import { writeFakeAgentBrowserBinary as writeFixtureBinary } from "./helpers/agent-browser-harness.js";

// These cancellation/lifetime regressions deliberately use PowerShell/custom CMD.
function writeFakeAgentBrowserBinary(root: string, body: string) {
	return writeFixtureBinary(root, body, process.platform, "legacy");
}

const windowsOnly = { skip: process.platform !== "win32" };

async function recordedPids(path: string): Promise<number[]> {
	try { return JSON.parse(await readFile(path, "utf8")); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

function cleanFixturePids(pids: number[]): void {
	for (const pid of pids) {
		try { process.kill(pid, 0); } catch { continue; }
		execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 10_000 });
	}
}

function fixtureProcesses(root: string): number[] {
	const query = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|cmd)\\.exe$' -and $_.CommandLine -and $_.CommandLine.IndexOf('${root.replaceAll("'", "''")}', [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress`;
	const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", query], { encoding: "utf8", timeout: 10_000 }).trim();
	const parsed = raw ? JSON.parse(raw) : [];
	return Array.isArray(parsed) ? parsed : [parsed];
}

for (const reason of ["timeout", "abort"] as const) {
	test(`Windows 100ms ${reason} leaves no custom-shim survivors`, windowsOnly, async () => {
		for (let iteration = 0; iteration < 10; iteration++) {
			const root = await mkdtemp(join(tmpdir(), "piab-job-short-"));
			const pidPath = join(root, "pids.json");
			const controller = new AbortController();
			let timer: NodeJS.Timeout | undefined;
			try {
				await writeFakeAgentBrowserBinary(root, `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify([process.pid])); process.stdin.resume(); setInterval(() => {}, 1000);`);
				const pending = runAgentBrowserProcess({ args: ["wait", "5000"], cwd: root,
					env: { PATH: `${root}${delimiter}${process.env.PATH ?? ""}` },
					signal: controller.signal, timeoutMs: reason === "timeout" ? 100 : 5_000 });
				if (reason === "abort") timer = setTimeout(() => controller.abort(), 100);
				const result = await pending;
				assert.equal(result.timedOut, reason === "timeout");
				assert.equal(result.aborted, reason === "abort");
				for (const pid of await recordedPids(pidPath)) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
				assert.deepEqual(fixtureProcesses(root), [], `iteration ${iteration}: no late-born fixture processes`);
			} finally {
				if (timer) clearTimeout(timer);
				controller.abort();
				// Independent record read and exact fixture-path inspection, not inferred PID sweeps.
				cleanFixturePids([...new Set([...await recordedPids(pidPath), ...fixtureProcesses(root)])]);
				await rm(root, { recursive: true, force: true });
			}
		}
	});
}

test("Windows 100ms active cancellation reaps descendants born during launch", windowsOnly, async () => {
	const root = await mkdtemp(join(tmpdir(), "piab-job-active-"));
	const pidPath = join(root, "pids.lines");
	const controller = new AbortController();
	let timer: NodeJS.Timeout | undefined;
	let pending: ReturnType<typeof runAgentBrowserProcess> | undefined;
	const readPids = async () => {
		try { return (await readFile(pidPath, "utf8")).trim().split(/\s+/).filter(Boolean).map(Number); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
	};
	try {
		await writeFakeAgentBrowserBinary(root, `const fs = require('node:fs'); const { spawn } = require('node:child_process');
fs.appendFileSync(${JSON.stringify(pidPath)}, process.pid + '\\n');
setInterval(() => { const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'inherit' }); fs.appendFileSync(${JSON.stringify(pidPath)}, child.pid + '\\n'); child.unref(); }, 10);`);
		pending = runAgentBrowserProcess({ args: ["wait", "5000"], cwd: root,
			env: { PATH: `${root}${delimiter}${process.env.PATH ?? ""}` }, signal: controller.signal, timeoutMs: 5_000 });
		for (let attempt = 0; attempt < 150 && (await readPids()).length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
		assert.ok((await readPids()).length >= 2, "active CLI and descendant must exist before the 100ms cancellation window");
		timer = setTimeout(() => controller.abort(), 100);
		const result = await pending;
		assert.equal(result.aborted, true);
		assert.equal(result.timedOut, false);
		const pids = await readPids();
		assert.ok(pids.length > 2, "additional descendants must be born during the cancellation window");
		for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
	} finally {
		if (timer) clearTimeout(timer);
		controller.abort();
		await pending;
		cleanFixturePids(await readPids());
		await rm(root, { recursive: true, force: true });
	}
});

for (const [exitCode, writeStderr] of [[0, false], [7, false], [0, true], [7, true]] as const) {
	test(`Windows normal CLI exit ${exitCode}${writeStderr ? ' with stderr' : ''} retains its detached descendant`, windowsOnly, async () => {
		const root = await mkdtemp(join(tmpdir(), "piab-job-release-"));
		const pidPath = join(root, "pids.json");
		try {
			await writeFakeAgentBrowserBinary(root, `const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); child.unref(); require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify([child.pid])); ${writeStderr ? "process.stderr.write('normal diagnostic\\n');" : ''} process.exit(${exitCode});`);
			const result = await runAgentBrowserProcess({ args: ["get", "url"], cwd: root,
				env: { PATH: `${root}${delimiter}${process.env.PATH ?? ""}` }, timeoutMs: 5_000 });
			assert.equal(result.exitCode, exitCode);
			if (writeStderr) assert.match(result.stderr, /normal diagnostic/);
			assert.equal(result.spawnError, undefined);
			assert.equal(result.timedOut, false);
			const pids = await recordedPids(pidPath);
			assert.equal(pids.length, 1);
			assert.doesNotThrow(() => process.kill(pids[0]!, 0));
		} finally {
			cleanFixturePids(await recordedPids(pidPath));
			await rm(root, { recursive: true, force: true });
		}
	});
}

test("Windows job setup failure cannot invoke the CLI", windowsOnly, async () => {
	const command = buildAgentBrowserSpawnCommand(["--version"], "win32");
	const script = command.args.at(-1)!;
	assert.ok(!script.includes("Add-Type"), "interop must not spawn an external compiler");
	assert.ok(script.indexOf("AssignProcessToJobObject($job") < script.indexOf("Get-Command agent-browser.cmd"));
	const failed = script.replace("$native::AssignProcessToJobObject($job, $native::GetCurrentProcess())", "$false")
		.replace(/\$agentBrowser = Get-Command[\s\S]*?\$cliExitCode =/, "[Console]::Out.WriteLine('UNSAFE_CLI_EXECUTION'); $cliExitCode =");
	try {
		execFileSync(command.command, [...command.args.slice(0, -1), failed], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] });
		assert.fail("job setup must fail");
	} catch (error) {
		const failure = error as { status?: number; stdout?: string; stderr?: string };
		assert.equal(failure.status, 127);
		assert.match(String(failure.stderr), /PI_AGENT_BROWSER_WINDOWS_JOB_FAILED:AssignProcessToJobObject failed/);
		assert.ok(!String(failure.stdout).includes("UNSAFE_CLI_EXECUTION"));
	}
});

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
			// Read the fixture record independently even if an earlier assertion failed.
			try { ({ descendant, shim } = JSON.parse(await readFile(pidPath, "utf8"))); } catch {}
			for (const pid of [shim, descendant]) {
				if (pid) {
					try { process.kill(pid, 0); execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
				}
			}
			await rm(root, { recursive: true, force: true });
		}
	});
}
