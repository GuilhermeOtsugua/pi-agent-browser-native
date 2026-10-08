import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);

test('build runs local compiler through Node in a literal Unicode/shell-special path', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'piab-build-runner-'));
    const root = join(temp, 'build & space # ü');
    try {
        await mkdir(join(root, 'scripts'), { recursive: true });
        await mkdir(join(root, 'node_modules', 'typescript', 'bin'), { recursive: true });
        await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
        await mkdir(join(root, 'dist'), { recursive: true });
        await writeFile(join(root, 'dist', 'stale'), 'stale');
        await writeFile(join(root, 'scripts', 'build.mjs'), await readFile('scripts/build.mjs'));
        await writeFile(join(root, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript"}');
        await writeFile(join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
            'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
        const shim = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
        await writeFile(shim, process.platform === 'win32'
            ? '@echo off\r\necho shell shim must not run >&2\r\nexit /b 9\r\n'
            : '#!/bin/sh\necho shell shim must not run >&2\nexit 9\n');
        await chmod(shim, 0o755);
        const result = await execute(process.execPath, [join(root, 'scripts', 'build.mjs')], {
            cwd: root, timeout: 10000,
        });
        assert.deepEqual(JSON.parse(result.stdout), ['-p', 'tsconfig.build.json']);
        assert.equal(result.stderr, '');
        await assert.rejects(readFile(join(root, 'dist', 'stale')), { code: 'ENOENT' });
    } finally {
        await rm(temp, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
});
