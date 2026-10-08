/** Test-only Windows adapter for explicitly registered fake Electron Node scripts.
 * No PATH lookup, executable sniffing, upstream interception, or PID emulation.
 * Suites must call disposeElectronScriptFixtures in afterEach; real child handles,
 * launch argv/options, native signals, and loopback ports remain production-owned.
 */
import childProcess, { type ChildProcess } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";
import { rm } from "node:fs/promises";
import { isTestPidAlive, stopTestPid } from "./extension-validation-fixtures.js";

const scripts = new Set<string>();
const children = new Set<ChildProcess>();
let restore: (() => void) | undefined;

export function registerElectronScriptFixture(scriptPath: string): void {
	if (process.platform !== "win32") return;
	scripts.add(scriptPath);
	if (restore) return;
	const originalSpawn = childProcess.spawn;
	const replacement: typeof childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
		const [command, argv, options] = args;
		if (!scripts.has(command)) return originalSpawn(...args);
		const child = originalSpawn(process.execPath, [command, ...(argv ?? [])], options);
		children.add(child);
		return child;
	}) as typeof childProcess.spawn;
	const mocked = mock.method(childProcess, "spawn", replacement);
	syncBuiltinESMExports();
	restore = () => { mocked.mock.restore(); syncBuiltinESMExports(); };
}

export async function disposeElectronScriptFixtures(): Promise<void> {
	try {
		for (const child of children) {
			await stopTestPid(child.pid);
			if (isTestPidAlive(child.pid)) throw new Error(`Fixture PID ${child.pid} survived cleanup; retaining its profile.`);
			const profileArg = child.spawnargs.find((arg) => arg.startsWith("--user-data-dir="));
			// Only profiles passed to our exact registered scripts; after assertions.
			if (profileArg) await rm(profileArg.slice("--user-data-dir=".length), { recursive: true, force: true });
		}
	} finally {
		children.clear(); scripts.clear(); restore?.(); restore = undefined;
	}
}
