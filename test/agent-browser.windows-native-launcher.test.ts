import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveWindowsNativeLauncher } from "../extensions/agent-browser/lib/windows-native-launcher.js";
import { buildAgentBrowserSpawnCommand, runAgentBrowserProcess } from "../extensions/agent-browser/lib/process.js";
import { withPatchedEnv, writeFakeAgentBrowserBinary } from "./helpers/agent-browser-harness.js";

test("native Windows spawn preserves literal and empty argv without a shell", () => {
 const args = ['--session','pinned','fill','#answer','','ação','a"b','x & y','--literal'];
 assert.deepEqual(buildAgentBrowserSpawnCommand(args, 'win32', 'C:/bin/agent-browser.exe'), { command:'C:/bin/agent-browser.exe', args });
 assert.equal(buildAgentBrowserSpawnCommand(['--version'], 'win32').command, 'powershell.exe');
 assert.throws(() => buildAgentBrowserSpawnCommand(args, 'win32'), /WINDOWS_SHIM_ARGV_UNREPRESENTABLE/);
 assert.deepEqual(buildAgentBrowserSpawnCommand(args, 'linux'), { command:'agent-browser', args });
});

test("resolve first PATH npm install; never fall through a custom shim", async () => {
 const root = await mkdtemp(join(tmpdir(),'native-launcher-'));
 try {
  const first=join(root,'first install'),second=join(root,'second');
  await mkdir(first);await mkdir(second);
  await writeFile(join(first,'agent-browser.cmd'),'@echo custom');
  await writeFile(join(second,'agent-browser.exe'),'fixture');
  const path=`"${first}";${second}`;
  assert.equal(await resolveWindowsNativeLauncher(path,'x64'),undefined);
  const bin=join(first,'node_modules','agent-browser','bin');await mkdir(bin,{recursive:true});
  const native=join(bin,'agent-browser-win32-x64.exe');await writeFile(native,'fixture');
  assert.equal(await resolveWindowsNativeLauncher(path,'x64'),native);
  assert.equal(await resolveWindowsNativeLauncher(path,'arm64'),undefined);
  assert.equal(await resolveWindowsNativeLauncher(second,'x64'),join(second,'agent-browser.exe'));
  assert.equal(await resolveWindowsNativeLauncher('', 'x64'),undefined);
  assert.equal(await resolveWindowsNativeLauncher(path,'unsupported'),undefined);
 } finally {await rm(root,{recursive:true,force:true});}
});

test("fake standard native layout forwards exact argv, stdin and env without intercepting other children", async () => {
 const root = await mkdtemp(join(tmpdir(), 'native-fake-'));
 try {
  await writeFakeAgentBrowserBinary(root, `let stdin = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => stdin += chunk); process.stdin.on('end', () => process.stdout.write(JSON.stringify({args: process.argv.slice(2), stdin, env: process.env.PI_NATIVE_FIXTURE_ENV})));`, 'win32');
  const native = await resolveWindowsNativeLauncher(root);
  assert.ok(native);
  assert.equal((await stat(native)).isFile(), true);
  if (process.platform === 'win32') {
   const args = ['--session', 'pinned', 'fill', '#answer', '', 'ação', 'a"b', 'x & y', 'file:///C:/encoded%20path'];
   await withPatchedEnv({ PATH: root, PI_NATIVE_FIXTURE_ENV: 'isolated' }, async () => {
    const result = await runAgentBrowserProcess({ args, cwd: root, stdin: 'unchanged stdin', timeoutMs: 5000 });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {args, stdin: 'unchanged stdin', env: 'isolated'});
    const unrelated = spawn(process.execPath, ['-e', 'process.stdout.write("unrelated")']);
    let stdout = ''; unrelated.stdout.on('data', chunk => stdout += chunk);
    await once(unrelated, 'close');
    assert.equal(stdout, 'unrelated');
   });
  }
 } finally { await rm(root, {recursive: true, force: true}); }
});

test("explicit legacy fixture has no package-owned native executable", async () => {
 const root = await mkdtemp(join(tmpdir(), 'legacy-fake-'));
 try {
  await writeFakeAgentBrowserBinary(root, '', 'win32', 'legacy');
  assert.equal(await resolveWindowsNativeLauncher(root), undefined);
 } finally { await rm(root, {recursive: true, force: true}); }
});

test("resolve project npm .bin sibling", async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-local-'));
 try {const bin=join(root,'node_modules','.bin');await mkdir(bin,{recursive:true});await writeFile(join(bin,'agent-browser.cmd'),'fixture');const native=join(root,'node_modules','agent-browser','bin','agent-browser-win32-arm64.exe');await mkdir(join(native,'..'),{recursive:true});await writeFile(native,'fixture');assert.equal(await resolveWindowsNativeLauncher(bin,'arm64'),native);}finally{await rm(root,{recursive:true,force:true})}
});
