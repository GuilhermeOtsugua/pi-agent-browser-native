/**
 * Purpose: Verify cross-process serialization for wrapper-owned daemon policy decisions.
 * Responsibilities: Assert bounded async contention, immutable-claim release, and proven-dead owner recovery.
 * Scope: The lock primitive only; browser orchestration coverage lives in extension tests.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { once } from "node:events";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test, { mock } from "node:test";

import {
	acquireManagedSessionPolicyLock,
	getManagedSessionPolicyLockPath,
	type ManagedSessionPolicyLock,
} from "../extensions/agent-browser/lib/managed-session-policy-lock.js";

// Windows foreign-PID identity checks launch PowerShell for every observation (no
// cached foreign identities). Four independent tsx processes plus repeated checks
// are fixture workload, not the production 1s coordination policy.
const coordinationTimeoutMs = process.platform === "win32" ? 10_000 : 1_000;
const sessionName = `piab-policy-lock-${process.pid}`;
const lockBasePath = getManagedSessionPolicyLockPath(sessionName);
const claimPrefix = `${basename(lockBasePath)}.claim-`;
const testOrphanPath = join(dirname(lockBasePath), `.pi-agent-browser-policy-remove-test-${process.pid}`);

async function claimPaths(): Promise<string[]> {
	try {
		return (await readdir(dirname(lockBasePath)))
			.filter((name) => name.startsWith(claimPrefix))
			.map((name) => join(dirname(lockBasePath), name));
	} catch {
		return [];
	}
}

async function onlyClaimPath(): Promise<string> {
	const paths = await claimPaths();
	assert.equal(paths.length, 1);
	return paths[0] as string;
}

test.afterEach(async () => {
	for (const path of await claimPaths()) await rm(path, { force: true, recursive: true });
	await rm(testOrphanPath, { force: true, recursive: true });
});

test("managed session policy lock waits asynchronously and releases only its immutable claim", async () => {
	const first = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(first);
	let timerRan = false;
	const waiting = acquireManagedSessionPolicyLock({ sessionName, timeoutMs: 50 });
	setTimeout(() => { timerRan = true; }, 5);
	assert.equal(await waiting, undefined);
	assert.equal(timerRan, true);
	const controller = new AbortController();
	const cancelled = acquireManagedSessionPolicyLock({ sessionName, timeoutMs: coordinationTimeoutMs, signal: controller.signal });
	controller.abort();
	assert.equal(await cancelled, undefined);
	assert.equal((await claimPaths()).length, 1);

	const claimPath = await onlyClaimPath();
	const ownerPath = join(claimPath, "owner.json");
	const original = await readFile(ownerPath, "utf8");
	const replacement = JSON.stringify({ ...JSON.parse(original), token: "replacement-token" });
	await writeFile(ownerPath, replacement, "utf8");
	await first.release();
	assert.equal(await readFile(ownerPath, "utf8"), replacement);
	await rm(claimPath, { force: true, recursive: true });

	const next = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(next);
	await next.release();
	assert.deepEqual(await claimPaths(), []);
});

test("managed session policy lock cleans dead removal artifacts", async () => {
	await mkdir(testOrphanPath, { mode: 0o700 });
	await writeFile(join(testOrphanPath, "owner.json"), JSON.stringify({ pid: 2_147_483_647, startIdentity: "dead", token: "orphan", version: 3 }), { mode: 0o600 });
	const lock = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(lock);
	await assert.rejects(stat(testOrphanPath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
	await lock.release();
});

test("managed session policy lock cleans a candidate left by an actual exited publisher", async () => {
	const moduleUrl = new URL("../extensions/agent-browser/lib/managed-session-policy-lock.ts", import.meta.url).href;
	const script = `import fs from "node:fs/promises"; import { syncBuiltinESMExports } from "node:module"; import { acquireManagedSessionPolicyLock } from ${JSON.stringify(moduleUrl)}; const rename = fs.rename; fs.rename = async (from, to) => { if (String(from).includes(".lock-v3.candidate-")) { process.stdout.write(JSON.stringify(from)); process.exit(0); } return rename(from, to); }; syncBuiltinESMExports(); await acquireManagedSessionPolicyLock({ sessionName: ${JSON.stringify(sessionName)} }); process.exit(2);`;
	const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
	child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
	const [code] = await once(child, "exit") as [number | null];
	assert.equal(code, 0, stderr);
	const candidatePath = JSON.parse(stdout) as string;
	try {
		await stat(candidatePath);
		const lock = await acquireManagedSessionPolicyLock({ sessionName });
		assert.ok(lock);
		try {
			await assert.rejects(stat(candidatePath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
		} finally { await lock.release(); }
	} finally {
		await rm(candidatePath, { force: true, recursive: true });
	}
});

test("managed session policy lock preserves unknown, unsafe, and owner-mismatched candidates", async () => {
	const first = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(first);
	const owner = JSON.parse(await readFile(join(await onlyClaimPath(), "owner.json"), "utf8"));
	await first.release();
	const fixtures = [
		{ suffix: "legacy-token", content: JSON.stringify({ ...owner, token: "legacy-token", pid: 2_147_483_647 }) },
		{ suffix: "9007199254740992-unknown-token", content: JSON.stringify({ ...owner, token: "unknown-token", pid: 2_147_483_647 }) },
		{ suffix: `${process.pid}-live-token`, content: JSON.stringify({ ...owner, token: "live-token" }) },
		{ suffix: "2147483647-mismatch-token", content: JSON.stringify({ ...owner, token: "mismatch-token" }) },
		{ suffix: "2147483647-path-token", content: JSON.stringify({ ...owner, token: "different-token", pid: 2_147_483_647 }) },
		{ suffix: "2147483647-unsafe-token", content: "x".repeat(4_097) },
	];
	try {
		for (const fixture of fixtures) {
			const path = `${lockBasePath}.candidate-${fixture.suffix}`;
			await mkdir(path, { mode: 0o700 });
			await writeFile(join(path, "owner.json"), fixture.content, { mode: 0o600 });
		}
		const lock = await acquireManagedSessionPolicyLock({ sessionName });
		assert.ok(lock);
		try {
			for (const fixture of fixtures) {
				assert.equal(await readFile(join(`${lockBasePath}.candidate-${fixture.suffix}`, "owner.json"), "utf8"), fixture.content);
			}
		} finally { await lock.release(); }
	} finally {
		for (const fixture of fixtures) await rm(`${lockBasePath}.candidate-${fixture.suffix}`, { force: true, recursive: true });
	}
});

test("managed session policy lock fails closed without repairing unsafe owner permissions", { skip: process.platform === "win32" ? "POSIX mode bits are not enforced by Windows chmod" : false }, async () => {
	const first = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(first);
	const claimPath = await onlyClaimPath();
	const ownerPath = join(claimPath, "owner.json");
	await chmod(ownerPath, 0o644);
	assert.equal(await acquireManagedSessionPolicyLock({ sessionName, timeoutMs: 25 }), undefined);
	assert.equal((await stat(ownerPath)).mode & 0o777, 0o644);
	await first.release();
	await stat(claimPath);
});

test("managed session policy lock fails closed on malformed owners on every platform", async () => {
	const first = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(first);
	const claimPath = await onlyClaimPath();
	const ownerPath = join(claimPath, "owner.json");
	await writeFile(ownerPath, "{invalid");
	assert.equal(await acquireManagedSessionPolicyLock({ sessionName, timeoutMs: 25 }), undefined);
	await first.release();
	assert.equal(await readFile(ownerPath, "utf8"), "{invalid");
});

test("managed session policy lock serializes concurrent contenders", async () => {
	let active = 0;
	let maxActive = 0;
	const outcomes = await Promise.all(Array.from({ length: 8 }, async () => {
		const started = Date.now();
		const lock = await acquireManagedSessionPolicyLock({ sessionName, timeoutMs: 1_000 });
		if (!lock) return { acquired: false, elapsedMs: Date.now() - started };
		active += 1;
		maxActive = Math.max(maxActive, active);
		await new Promise((resolve) => setTimeout(resolve, 5));
		active -= 1;
		await lock.release();
		return { acquired: true, elapsedMs: Date.now() - started };
	}));
	assert.equal(outcomes.every((outcome) => outcome.acquired), true, JSON.stringify({ outcomes, remainingClaims: await Promise.all((await claimPaths()).map(async (path) => ({ path, owner: await readFile(join(path, "owner.json"), "utf8").catch(String), ticket: await readFile(join(path, "ticket.json"), "utf8").catch(String) }))) }));
	assert.equal(maxActive, 1);
	assert.deepEqual(await claimPaths(), []);
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

async function heldReaderReleaseScenario(change?: "replacement" | "unsafe-ticket"): Promise<void> {
	const first = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(first);
	const claimPath = await onlyClaimPath();
	const ownerPath = join(claimPath, "owner.json");
	const ticketPath = join(claimPath, "ticket.json");
	const originalOwner = await readFile(ownerPath, "utf8");
	const held = deferred();
	const unblock = deferred();
	const controller = new AbortController();
	const pending: Promise<unknown>[] = [];
	const originalReadFile = fs.readFile;
	let intercepted = false;
	const mocked = mock.method(fs, "readFile", async (path: Parameters<typeof fs.readFile>[0], options: Parameters<typeof fs.readFile>[1]) => {
		if (path !== ownerPath || intercepted) return originalReadFile(path, options);
		intercepted = true;
		const handle = await fs.open(ownerPath, "r");
		try {
			const content = await handle.readFile("utf8");
			held.resolve();
			await unblock.promise;
			return content;
		} finally {
			await handle.close();
		}
	});
	syncBuiltinESMExports();
	let watchdog!: NodeJS.Timeout;
	let timedOut = false;
	// Real filesystem handles cannot be advanced with fake timers. This timer is
	// only a fixture escape hatch; all normal sequencing uses deferred barriers.
	const expired = new Promise<never>((_, reject) => {
		watchdog = setTimeout(() => {
			timedOut = true;
			held.resolve();
			controller.abort();
			unblock.resolve();
			reject(new Error("held-reader fixture watchdog expired"));
		}, 5_000);
	});
	try {
		const scenario = (async () => {
			let active = 1;
			let maxActive = active;
			const waiting = acquireManagedSessionPolicyLock({ sessionName, signal: controller.signal }).then(async (lock) => {
				if (lock) {
					active++;
					maxActive = Math.max(maxActive, active);
					active--;
					await lock.release();
				}
				return lock;
			});
			pending.push(waiting);
			await held.promise;
			assert.equal(timedOut, false, "held-reader fixture watchdog expired");
			let released = false;
			const releasing = first.release().then(() => { released = true; });
			pending.push(releasing);
			// A real event-loop boundary allows release to reach the held metadata read,
			// without pinning rename calls or injecting a sharing errno.
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(released, false, "release must not finish while its actual owner reader is open");
			let replacement: string | undefined;
			if (change === "replacement") {
				replacement = JSON.stringify({ ...JSON.parse(originalOwner), token: "replacement-token" });
				await writeFile(ownerPath, replacement, "utf8");
			} else if (change === "unsafe-ticket") {
				await writeFile(ticketPath, "x".repeat(4_097), "utf8");
			}
			// Cancel the published contender before the unchanged default deadline.
			controller.abort();
			active--;
			unblock.resolve();
			await releasing;
			assert.equal(await waiting, undefined);
			if (change === "replacement") {
				assert.equal(await readFile(ownerPath, "utf8"), replacement);
				await rm(claimPath, { force: true, recursive: true });
			} else if (change === "unsafe-ticket") {
				assert.equal(await readFile(ownerPath, "utf8"), originalOwner);
				assert.equal(await readFile(ticketPath, "utf8"), "x".repeat(4_097));
				await rm(claimPath, { force: true, recursive: true });
			}
			assert.deepEqual(await claimPaths(), []);
			const next = await acquireManagedSessionPolicyLock({ sessionName });
			assert.ok(next);
			active++;
			maxActive = Math.max(maxActive, active);
			active--;
			await next.release();
			assert.equal(maxActive, 1);
			assert.deepEqual(await claimPaths(), []);
		})();
		pending.push(scenario);
		await Promise.race([expired, scenario]);
	} finally {
		clearTimeout(watchdog);
		controller.abort();
		held.resolve();
		unblock.resolve();
		await Promise.allSettled(pending);
		mocked.mock.restore();
		syncBuiltinESMExports();
		await first.release();
	}
}

test("managed session policy lock drains an actual held reader before release and cancelled contender cleanup", async () => {
	await heldReaderReleaseScenario();
});

test("managed session policy lock preserves a replaced owner across a held-reader release boundary", async () => {
	await heldReaderReleaseScenario("replacement");
});

test("managed session policy lock preserves unsafe ticket metadata across a held-reader release boundary", async () => {
	await heldReaderReleaseScenario("unsafe-ticket");
});

test("candidate cleanup does not deny another process's in-progress publication", async () => {
	const moduleUrl = new URL("../extensions/agent-browser/lib/managed-session-policy-lock.ts", import.meta.url).href;
	const publisherSession = `${sessionName}-publisher`;
	const publisherBase = getManagedSessionPolicyLockPath(publisherSession);
	const script = `import fs from "node:fs/promises"; import { syncBuiltinESMExports } from "node:module"; import { acquireManagedSessionPolicyLock } from ${JSON.stringify(moduleUrl)}; function waitFor(command) { return new Promise(resolve => { const listener = message => { if (message === command) { process.off("message", listener); resolve(); } }; process.on("message", listener); }); } const rename = fs.rename; fs.rename = async (from, to) => { if (String(from).includes(".lock-v3.candidate-")) { const publish = waitFor("publish"); process.send({ stage: "candidate", path: String(from) }); await publish; } return rename(from, to); }; syncBuiltinESMExports(); const lock = await acquireManagedSessionPolicyLock({ sessionName: ${JSON.stringify(publisherSession)} }); const release = waitFor("release"); process.send({ stage: "result", acquired: !!lock }); if (!lock) process.exit(2); await release; await lock.release(); process.exit(0);`;
	const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
	const exit = once(child, "exit");
	let stderr = "";
	child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
	const held = deferred();
	const unblock = deferred();
	let reading: Promise<ManagedSessionPolicyLock | undefined> | undefined;
	let restoreReadFile: (() => void) | undefined;
	const unexpectedExit = exit.then(([code]) => {
		throw new Error(`publisher exited before its barrier completed: ${code}; ${stderr}`);
	});
	// The real child and real filesystem cannot use fake time; watchdog only
	// releases fixture barriers and terminates this fixture's owned child.
	const watchdog = setTimeout(() => {
		unblock.resolve();
		child.kill();
	}, 10_000);
	try {
		const [candidate] = await Promise.race([once(child, "message"), unexpectedExit]) as [{ stage: string; path: string }];
		const ownerPath = join(candidate.path, "owner.json");
		const originalReadFile = fs.readFile;
		const mocked = mock.method(fs, "readFile", async (path: Parameters<typeof fs.readFile>[0], options: Parameters<typeof fs.readFile>[1]) => {
			if (path !== ownerPath) return originalReadFile(path, options);
			const handle = await fs.open(ownerPath, "r");
			try {
				const content = await handle.readFile("utf8");
				held.resolve();
				await unblock.promise;
				return content;
			} finally { await handle.close(); }
		});
		restoreReadFile = () => mocked.mock.restore();
		syncBuiltinESMExports();
		reading = acquireManagedSessionPolicyLock({ sessionName });
		// Old cleanup reaches the actual held reader; safe cleanup instead returns
		// its acquired lock without opening the live publisher's candidate.
		await Promise.race([held.promise, reading, unexpectedExit]);
		const result = Promise.race([once(child, "message"), unexpectedExit]);
		child.send("publish");
		const [outcome] = await result as [{ stage: string; acquired: boolean }];
		unblock.resolve();
		const reader = await reading;
		assert.ok(reader);
		await reader.release();
		assert.equal(outcome.acquired, true, stderr);
		child.send("release");
		const [code] = await exit as [number | null];
		assert.equal(code, 0, stderr);
		assert.deepEqual(await claimPaths(), []);
		const names = await readdir(dirname(publisherBase));
		assert.deepEqual(names.filter((name) => name.startsWith(`${basename(publisherBase)}.`)), []);
	} finally {
		clearTimeout(watchdog);
		unblock.resolve();
		const reader = await reading?.catch(() => undefined);
		await reader?.release();
		restoreReadFile?.();
		syncBuiltinESMExports();
		if (child.exitCode === null && child.signalCode === null) child.kill();
		await exit.catch(() => undefined);
		for (const name of await readdir(dirname(publisherBase))) {
			if (name.startsWith(`${basename(publisherBase)}.`)) await rm(join(dirname(publisherBase), name), { force: true, recursive: true });
		}
	}
});

for (const code of ['EPERM', 'EBUSY']) {
	test(`managed session policy lock retries transient Windows ${code} release`, { skip: process.platform !== 'win32' }, async () => {
		const lock = await acquireManagedSessionPolicyLock({ sessionName });
		assert.ok(lock);
		const path = await onlyClaimPath();
		const rename = fs.rename;
		let failures = 0;
		const mocked = mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
			if (from === path && failures++ === 0) throw Object.assign(new Error('transient sharing conflict'), { code });
			return await rename(from, to);
		});
		syncBuiltinESMExports();
		try {
			await lock.release();
			assert.deepEqual(await claimPaths(), []);
		} finally { mocked.mock.restore(); syncBuiltinESMExports(); }
	});
}

test('managed session policy lock revalidates ownership after a Windows sharing conflict', { skip: process.platform !== 'win32' }, async () => {
	const lock = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(lock);
	const path = await onlyClaimPath();
	const ownerPath = join(path, 'owner.json');
	const replacement = JSON.stringify({ ...JSON.parse(await readFile(ownerPath, 'utf8')), token: 'replacement-token' });
	const rename = fs.rename;
	const mocked = mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
		if (from === path) {
			await writeFile(ownerPath, replacement);
			throw Object.assign(new Error('sharing conflict with replaced owner'), { code: 'EPERM' });
		}
		return await rename(from, to);
	});
	syncBuiltinESMExports();
	try {
		await lock.release();
		assert.equal(await readFile(ownerPath, 'utf8'), replacement);
	} finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});

for (const code of ['EPERM', 'EACCES'] as const) {
	test(`managed session policy lock leaves persistent ${code} release failures owned`, { skip: process.platform !== 'win32' }, async () => {
		const lock = await acquireManagedSessionPolicyLock({ sessionName });
		assert.ok(lock);
		const path = await onlyClaimPath();
		const owner = await readFile(join(path, 'owner.json'), 'utf8');
		const rename = fs.rename;
		const mocked = mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
			if (from === path) throw Object.assign(new Error('persistent conflict'), { code });
			return await rename(from, to);
		});
		syncBuiltinESMExports();
		try {
			await lock.release();
			assert.equal(await readFile(join(path, 'owner.json'), 'utf8'), owner);
		} finally { mocked.mock.restore(); syncBuiltinESMExports(); }
		await lock.release();
		assert.deepEqual(await claimPaths(), []);
	});
}

test("managed session policy lock excludes a live owner in another process", async () => {
	const moduleUrl = new URL("../extensions/agent-browser/lib/managed-session-policy-lock.ts", import.meta.url).href;
	const script = `import { acquireManagedSessionPolicyLock } from ${JSON.stringify(moduleUrl)}; const lock = await acquireManagedSessionPolicyLock({ sessionName: ${JSON.stringify(sessionName)} }); if (!lock) process.exit(2); process.stdout.write("acquired\\n"); await new Promise((resolve) => process.stdin.once("data", resolve)); await lock.release();`;
	const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { stdio: ["pipe", "pipe", "pipe"] });
	const [chunk] = await once(child.stdout, "data") as [Buffer];
	assert.equal(chunk.toString("utf8"), "acquired\n");
	assert.equal(await acquireManagedSessionPolicyLock({ sessionName, timeoutMs: 50 }), undefined);
	child.stdin.end("release");
	const [code] = await once(child, "exit") as [number | null];
	assert.equal(code, 0);
	const recovered = await acquireManagedSessionPolicyLock({ sessionName });
	assert.ok(recovered);
	await recovered.release();
});

test("competing cross-process reclaimers stay serialized after a stale claim", async (t) => {
	const moduleUrl = new URL("../extensions/agent-browser/lib/managed-session-policy-lock.ts", import.meta.url).href;
	const staleScript = `import { acquireManagedSessionPolicyLock } from ${JSON.stringify(moduleUrl)}; const lock = await acquireManagedSessionPolicyLock({ sessionName: ${JSON.stringify(sessionName)} }); if (!lock) process.exit(2);`;
	const stale = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", staleScript], { stdio: "ignore" });
	const [staleCode] = await once(stale, "exit") as [number | null];
	assert.equal(staleCode, 0);
	await onlyClaimPath();

	const logPath = join(dirname(lockBasePath), `${basename(lockBasePath)}.critical.log`);
	const contenderScript = `import fs from "node:fs"; import { acquireManagedSessionPolicyLock } from ${JSON.stringify(moduleUrl)}; const started = Date.now(); const lock = await acquireManagedSessionPolicyLock({ sessionName: ${JSON.stringify(sessionName)}, timeoutMs: ${coordinationTimeoutMs} }); process.stdout.write(JSON.stringify({ acquired: !!lock, elapsedMs: Date.now() - started, execPath: process.execPath, execArgv: process.execArgv, moduleUrl: ${JSON.stringify(moduleUrl)} }) + "\\n"); if (!lock) process.exit(2); fs.appendFileSync(${JSON.stringify(logPath)}, "start:" + process.pid + "\\n"); await new Promise((resolve) => setTimeout(resolve, 25)); fs.appendFileSync(${JSON.stringify(logPath)}, "end:" + process.pid + "\\n"); await lock.release();`;
	try {
		const contenders = Array.from({ length: 4 }, () => {
			const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", contenderScript], { stdio: ["ignore", "pipe", "pipe"] });
			let stderr = "";
			let stdout = "";
			child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
			child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
			return { child, exit: once(child, "exit"), getStderr: () => stderr, getStdout: () => stdout };
		});
		for (const contender of contenders) {
			const [code] = await contender.exit as [number | null];
			assert.equal(code, 0, contender.getStderr() + contender.getStdout());
			const evidence = JSON.parse(contender.getStdout());
			assert.equal(evidence.acquired, true);
			t.diagnostic(`reclaimer coordination: ${evidence.elapsedMs}ms; Node ${evidence.execPath}; tsx file URL ${moduleUrl}`);
		}
		const lines = (await readFile(logPath, "utf8")).trim().split("\n");
		let active = 0;
		let maxActive = 0;
		for (const line of lines) {
			active += line.startsWith("start:") ? 1 : -1;
			maxActive = Math.max(maxActive, active);
			assert.ok(active >= 0);
		}
		assert.equal(active, 0);
		assert.equal(maxActive, 1);
	} finally {
		await rm(logPath, { force: true });
	}
});

test("managed session policy lock reclaims only the proven-dead immutable claim", async () => {
	const moduleUrl = new URL("../extensions/agent-browser/lib/managed-session-policy-lock.ts", import.meta.url).href;
	const script = `import { acquireManagedSessionPolicyLock } from ${JSON.stringify(moduleUrl)}; const lock = await acquireManagedSessionPolicyLock({ sessionName: ${JSON.stringify(sessionName)} }); if (!lock) process.exit(2); process.stdout.write("acquired");`;
	const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
	child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
	const [code] = await once(child, "exit") as [number | null];
	assert.equal(code, 0, stderr);
	assert.equal(stdout, "acquired");
	const staleClaimPath = await onlyClaimPath();

	const recovered = await acquireManagedSessionPolicyLock({ sessionName, timeoutMs: 250 });
	assert.ok(recovered);
	const liveClaimPath = await onlyClaimPath();
	assert.notEqual(liveClaimPath, staleClaimPath);
	assert.equal(await acquireManagedSessionPolicyLock({ sessionName, timeoutMs: 50 }), undefined);
	assert.deepEqual(await claimPaths(), [liveClaimPath]);
	await recovered.release();
});
