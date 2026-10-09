/**
 * Purpose: Lock the dogfood verifier's CLI and resource/teardown ownership without launching a browser.
 * Responsibilities: Cover setup failures, caller-owned artifact retention and primary/cleanup error preservation.
 * Scope: Unit coverage; the real browser flow is exercised by `npm run verify -- dogfood`.
 * Usage: Runs under `npm test` via tsx's test runner.
 * Invariants/Assumptions: Importing the dogfood script must not execute its live browser smoke.
 */

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cleanupDogfoodRun, parseDogfoodArgs, runAgentBrowserDogfood } from "../scripts/verify-agent-browser-dogfood.ts";

test("parseDogfoodArgs accepts artifact, retention, json, and help flags", () => {
	assert.deepEqual(parseDogfoodArgs(["--artifact-dir", "/tmp/pi-dogfood", "--keep-artifacts", "--json"]), {
		artifactDir: "/tmp/pi-dogfood",
		help: false,
		json: true,
		keepArtifacts: true,
	});
	assert.deepEqual(parseDogfoodArgs(["--help"]), { help: true });
});

test('dogfood cleanup preserves primary and cleanup failures while settling every resource', async () => {
	const calls: string[] = [];
	const primary = new Error('failed smoke step');
	await assert.rejects(cleanupDogfoodRun({
		removeOwnedArtifacts: async () => { calls.push('artifacts'); },
		closeFixture: async () => { calls.push('fixture'); throw new Error('fixture error'); },
		shutdown: async () => { calls.push('shutdown'); throw new Error('shutdown error'); },
		closeSession: async () => { calls.push('close'); throw new Error('close error'); },
	}, primary), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors[0], primary);
		assert.equal(error.errors.length, 4);
		assert.match(error.message, /failed smoke step/);
		assert.match(error.message, /shutdown error/);
		return true;
	});
	assert.deepEqual(calls, ['close', 'shutdown', 'fixture', 'artifacts']);
});

test('successful dogfood cleanup omits recovery close and caller-owned artifact removal', async () => {
	const calls: string[] = [];
	await cleanupDogfoodRun({ shutdown: async () => { calls.push('shutdown'); }, closeFixture: async () => { calls.push('fixture'); } });
	assert.deepEqual(calls, ['shutdown', 'fixture']);
});

test('dogfood cleanup does not replace an existing failure when teardown succeeds', async () => {
	await cleanupDogfoodRun({ shutdown: async () => {}, closeFixture: async () => {} }, new Error('original'));
});

test('fixture setup failure cleans only owned unretained artifacts without spawning upstream', { concurrency: false }, async (t) => {
	const root = await fs.mkdtemp(join(tmpdir(), 'piab-dogfood-setup-test-'));
	const originalMkdtemp = fs.mkdtemp;
	const failure = new Error('fixture setup failed');
	let automaticArtifactDir: string | undefined;
	let spawnCalls = 0;
	t.mock.method(fs, 'mkdtemp', async (prefix: string) => {
		const directory = await originalMkdtemp(prefix);
		if (prefix.endsWith('pi-agent-browser-dogfood-')) automaticArtifactDir = directory;
		return directory;
	});
	t.mock.method(http, 'createServer', () => { throw failure; });
	t.mock.method(childProcess, 'spawn', () => { spawnCalls++; throw new Error('unexpected upstream spawn'); });
	syncBuiltinESMExports();
	try {
		for (const options of [{}, { keepArtifacts: true }, { artifactDir: join(root, 'caller-artifacts') }]) {
			automaticArtifactDir = undefined;
			await assert.rejects(runAgentBrowserDogfood(options), (error: unknown) => error === failure);
			const directory = 'artifactDir' in options ? options.artifactDir : automaticArtifactDir;
			assert.ok(directory);
			if ('keepArtifacts' in options || 'artifactDir' in options) {
				assert.equal((await fs.stat(directory)).isDirectory(), true);
			} else {
				await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
			}
			await fs.rm(directory, { recursive: true, force: true });
		}
		assert.equal(spawnCalls, 0);
	} finally {
		t.mock.restoreAll();
		syncBuiltinESMExports();
		if (automaticArtifactDir) await fs.rm(automaticArtifactDir, { recursive: true, force: true });
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("parseDogfoodArgs rejects unknown options and missing artifact directory values", () => {
	assert.throws(() => parseDogfoodArgs(["--artifact-dir"]), /--artifact-dir requires a path/);
	assert.throws(() => parseDogfoodArgs(["--artifact-dir", "--json"]), /--artifact-dir requires a path/);
	assert.throws(() => parseDogfoodArgs(["--bogus"]), /Unknown dogfood argument: --bogus/);
});
