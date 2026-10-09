// @ts-check
import { stat } from "node:fs/promises";
import { join } from "node:path";

/** @param {string} path */
async function isFile(path) {
	try { return (await stat(path)).isFile(); } catch (error) {
		if (["ENOENT", "ENOTDIR"].includes(/** @type {NodeJS.ErrnoException} */ (error).code ?? "")) return false;
		throw error;
	}
}

/** Resolve the first PATH installation, not a later executable of a different version.
 * Standard npm shims have a sibling package-owned native binary. Custom shims
 * retain the existing PowerShell path instead of silently selecting another install.
 * @param {string | undefined} path
 * @param {string} [arch]
 */
export async function resolveWindowsNativeLauncher(path, arch = process.arch) {
	if (!path || !["x64", "arm64"].includes(arch)) return undefined;
	for (const entry of path.split(";")) {
		const directory = entry.trim().replace(/^"(.*)"$/, "$1");
		if (!directory) continue;
		const exe = join(directory, "agent-browser.exe");
		if (await isFile(exe)) return exe;
		if (await isFile(join(directory, "agent-browser.cmd"))) {
			const binary = `agent-browser-win32-${arch}.exe`;
			for (const candidate of [join(directory, "node_modules", "agent-browser", "bin", binary), join(directory, "..", "agent-browser", "bin", binary)]) {
				if (await isFile(candidate)) return candidate;
			}
			return undefined;
		}
	}
	return undefined;
}
