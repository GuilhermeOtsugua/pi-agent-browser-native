/** Exact-path test adapter for package-owned Windows native CLI fixtures.
 * The resolver sees a regular placeholder file; only its spawn runs the existing
 * Node fake. argv/options and real child lifecycle remain untouched.
 */
import childProcess, { type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, mock } from "node:test";

const fixtures = new Map<string, string>();
const children = new Set<ChildProcess>();
let restore: (() => void) | undefined;

export function registerNativeCliFixture(executable: string, script: string): void {
	fixtures.set(executable, script);
	if (restore) return;
	const originalSpawn = childProcess.spawn;
	const replacement: typeof childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
		const [command, argv, options] = args;
		const scriptPath = fixtures.get(command);
		if (!scriptPath) return originalSpawn(...args);
		const child = originalSpawn(process.execPath, [scriptPath, ...(argv ?? [])], options);
		children.add(child);
		return child;
	}) as typeof childProcess.spawn;
	const mocked = mock.method(childProcess, "spawn", replacement);
	syncBuiltinESMExports();
	restore = () => { mocked.mock.restore(); syncBuiltinESMExports(); };
}

afterEach(async () => {
	try {
		for (const child of children) {
			if (child.exitCode !== null || child.signalCode !== null) continue;
			const exited = once(child, "exit");
			child.kill("SIGKILL");
			await exited;
		}
		// Never infer ownership from argv (in particular profile arguments).
		for (const executable of fixtures.keys()) await rm(executable, { force: true });
	} finally {
		children.clear(); fixtures.clear(); restore?.(); restore = undefined;
	}
});
