import assert from "node:assert/strict";
import test from "node:test";
import { win32 } from "node:path";
import {
	buildElectronProcessCommandLineCommand,
	restoredLaunchCommandMatchesRecord,
} from "../extensions/agent-browser/lib/electron/cleanup.js";
import type { ElectronLaunchRecord } from "../extensions/agent-browser/lib/electron/launch.js";

const record = { userDataDir: "C:\\Temp\\owned profile" } as ElectronLaunchRecord;

test("restored Electron command inspection uses system Windows CIM and preserves POSIX ps", () => {
	const windows = buildElectronProcessCommandLineCommand(1234, "win32");
	assert.ok(windows);
	assert.equal(win32.isAbsolute(windows.file), true);
	assert.match(windows.file, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
	assert.deepEqual(windows.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
	assert.match(windows.args[3] ?? "", /Get-CimInstance.*Win32_Process.*ProcessId = 1234/);
	assert.match(windows.args[3] ?? "", /CommandLine/);
	assert.deepEqual(buildElectronProcessCommandLineCommand(1234, "linux"), {
		file: "ps", args: ["-ww", "-p", "1234", "-o", "command="],
	});
	for (const pid of [undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		assert.equal(buildElectronProcessCommandLineCommand(pid, "win32"), undefined);
		assert.equal(buildElectronProcessCommandLineCommand(pid, "linux"), undefined);
	}
});

test("restored Electron ownership matches exact quoted Windows flag/value forms", () => {
	for (const flag of [
		`"--user-data-dir=${record.userDataDir}"`,
		`--user-data-dir="${record.userDataDir}"`,
	]) {
		assert.equal(restoredLaunchCommandMatchesRecord(record, `"C:\\Program Files\\Electron.exe" ${flag} --remote-debugging-port=0`), true, flag);
	}
	const posix = { userDataDir: "/tmp/owned-profile" } as ElectronLaunchRecord;
	assert.equal(restoredLaunchCommandMatchesRecord(posix, "electron --user-data-dir=/tmp/owned-profile --remote-debugging-port=0"), true);
	for (const command of [undefined, "", "electron", `electron "--user-data-dir=${record.userDataDir}-unrelated"`,
		`electron --user-data-dir="${record.userDataDir}-unrelated"`,
		`electron --other=--user-data-dir="${record.userDataDir}"`,
		`electron "--user-data-dir=${record.userDataDir}"suffix`]) {
		assert.equal(restoredLaunchCommandMatchesRecord(record, command), false, command);
	}
	assert.equal(restoredLaunchCommandMatchesRecord(posix, "electron --user-data-dir=/tmp/owned-profile-unrelated"), false);
});
