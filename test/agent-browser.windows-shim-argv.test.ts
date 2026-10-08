import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAgentBrowserSpawnCommand, runAgentBrowserProcess } from "../extensions/agent-browser/lib/process.js";
import { resolveWindowsNativeLauncher } from "../extensions/agent-browser/lib/windows-native-launcher.js";

// Fake-only CLI: no browser, network, provider, or real shell mutation commands.
test("Windows custom cmd preserves literal argv or fails before dispatch", { skip: process.platform !== "win32", timeout: 60_000 }, async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-shim-argv space-"));
	const cli = join(directory, "echo.cjs");
	const log = join(directory, "invocations.jsonl");
	const shim = join(directory, "agent-browser.cmd");
	const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
	const json = '{"token":"route-secret"}';
	try {
		await writeFile(cli, `const fs = require('node:fs'); const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n'); process.stdout.write(JSON.stringify(args)); if(args[0]==='exit-status'){process.stderr.write('fake stderr marker');process.exitCode=23;}`);
		await writeFile(shim, `@echo off\r\n"${process.execPath}" "%~dp0echo.cjs" %*\r\n`);
		const env = { PATH: `${directory};${process.env.PATH ?? ""}` };
		assert.equal(await resolveWindowsNativeLauncher(env.PATH), undefined);

		// Reproduce the old PS5 native binder boundary independently of the fix.
		const old = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `& ${psQuote(shim)} ${psQuote(json)}`], { encoding: "utf8", timeout: 10_000 });
		assert.equal(old.status, 0, old.stderr);
		assert.deepEqual(JSON.parse(old.stdout), ["{token:route-secret}"]);
		console.log("PS5 single-quoted argv reproduction: JSON quotes stripped before Node receives argv");

		for (const values of [
			[json, JSON.stringify({ nested: { text: 'nested "quote" with spaces', path: "C:\\space dir\\" } }), 'one"quote', '\\"', "", "a b", "tail\\", "O'Brien", "Unicode 日本語"],
			["literal & marker", "literal | marker", "literal < marker", "literal > marker", "literal ^ marker", "literal (marker)", "space tail\\"],
		]) {
			const result = await runAgentBrowserProcess({ args: ["probe", ...values], cwd: directory, env, timeoutMs: 10_000 });
			assert.equal(result.spawnError, undefined, result.stderr);
			assert.equal(result.exitCode, 0, result.stderr);
			assert.equal(result.agentBrowserStarted, true);
			assert.deepEqual(JSON.parse(result.stdout), ["probe", ...values]);
		}
		const before = await readFile(log, "utf8");
		for (const values of [["%PATH%"], ["!fake!"], ["line\nbreak"], ["line\rbreak"], ["nul\0data"], ['"quote & marker'], ['"quote', "& marker"], [json, "^ marker"], [json, "(marker)"]]) {
			const result = await runAgentBrowserProcess({ args: ["probe", ...values], cwd: directory, env, timeoutMs: 10_000 });
			assert.equal(result.exitCode, 127);
			assert.equal(result.agentBrowserStarted, false);
			assert.match(result.spawnError?.message ?? "", /WINDOWS_SHIM_ARGV_UNREPRESENTABLE.*native executable/);
			assert.equal(result.stdout, "");
			assert.equal(await readFile(log, "utf8"), before, "unsupported argv must not reach the fake CLI");
			// The shim guard does not change the native argv plan. OS constraints
			// (notably NUL) still apply; representable values are executed below.
			const plan = buildAgentBrowserSpawnCommand(values, "win32", process.execPath);
			assert.deepEqual(plan, { command: process.execPath, args: values });
		}
		const nativeValues = [json, 'quoted " & | < > ^ %PATH% !fake!', "", "trailing \\", "line\nbreak"];
		const native = buildAgentBrowserSpawnCommand([cli, ...nativeValues], "win32", process.execPath);
		const nativeResult = spawnSync(native.command, native.args, { encoding: "utf8", timeout: 10_000 });
		assert.equal(nativeResult.status, 0, nativeResult.stderr);
		assert.deepEqual(JSON.parse(nativeResult.stdout), nativeValues);

		const nonzero = await runAgentBrowserProcess({ args: ["exit-status"], cwd: directory, env, timeoutMs: 10_000 });
		assert.equal(nonzero.exitCode, 23);
		assert.equal(nonzero.stderr, "fake stderr marker");
		assert.equal(nonzero.spawnError, undefined);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
