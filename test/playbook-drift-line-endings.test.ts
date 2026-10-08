/** Generated-doc drift is content drift, not Git's native checkout line endings. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const targets = ["README.md", "docs/COMMAND_REFERENCE.md", "docs/TOOL_CONTRACT.md"];

for (const eol of ["\n", "\r\n"]) {
	test(`playbook checks ignore ${eol === "\n" ? "LF" : "CRLF"} while writes preserve it and repair real drift`, async () => {
		const root = await mkdtemp(join(tmpdir(), "piab-playbook-eol-"));
		try {
			await mkdir(join(root, "docs"));
			for (const path of targets) {
				const source = (await readFile(join(project, path), "utf8")).replaceAll("\r\n", "\n");
				await writeFile(join(root, path), source.replaceAll("\n", eol));
			}
			const run = (mode: string) => spawnSync(process.execPath, [
				join(project, "node_modules/tsx/dist/cli.mjs"),
				join(project, "scripts/check-playbook-drift.ts"), mode,
			], { cwd: root, encoding: "utf8", timeout: 15_000 });
			const original = await readFile(join(root, "README.md"), "utf8");
			for (const mode of ["--check", "--write"]) {
				const result = run(mode);
				assert.equal(result.status, 0, result.stderr);
				assert.equal(await readFile(join(root, "README.md"), "utf8"), original);
			}
			await writeFile(join(root, "README.md"), original.replace("Native inspection calls use", "Stale inspection calls use"));
			const stale = run("--check");
			assert.equal(stale.status, 1);
			assert.match(stale.stderr, /README\.md#inspection/);
			const repaired = run("--write");
			assert.equal(repaired.status, 0, repaired.stderr);
			assert.equal(await readFile(join(root, "README.md"), "utf8"), original);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
