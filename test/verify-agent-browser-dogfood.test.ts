/**
 * Purpose: Lock the deterministic dogfood verifier's lightweight CLI parser without launching a browser.
 * Responsibilities: Assert opt-in artifact/json flags are accepted and missing values fail before the live smoke starts.
 * Scope: Unit coverage for scripts/verify-agent-browser-dogfood.ts argument parsing only; the real browser flow is exercised by `npm run verify -- dogfood`.
 * Usage: Runs under `npm test` via tsx's test runner.
 * Invariants/Assumptions: Importing the dogfood script must not execute its live browser smoke.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { cleanupDogfoodRun, parseDogfoodArgs } from "../scripts/verify-agent-browser-dogfood.ts";

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

test("parseDogfoodArgs rejects unknown options and missing artifact directory values", () => {
	assert.throws(() => parseDogfoodArgs(["--artifact-dir"]), /--artifact-dir requires a path/);
	assert.throws(() => parseDogfoodArgs(["--artifact-dir", "--json"]), /--artifact-dir requires a path/);
	assert.throws(() => parseDogfoodArgs(["--bogus"]), /Unknown dogfood argument: --bogus/);
});
