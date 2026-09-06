import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveWindowsNativeLauncher } from "../extensions/agent-browser/lib/windows-native-launcher.js";
import { buildAgentBrowserSpawnCommand } from "../extensions/agent-browser/lib/process.js";

test("native Windows spawn preserves literal and empty argv without a shell", () => {
 const args = ['--session','pinned','fill','#answer','','ação','a"b','x & y','--literal'];
 assert.deepEqual(buildAgentBrowserSpawnCommand(args, 'win32', 'C:/bin/agent-browser.exe'), { command:'C:/bin/agent-browser.exe', args });
 assert.equal(buildAgentBrowserSpawnCommand(args, 'win32').command, 'powershell.exe');
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

test("resolve project npm .bin sibling", async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-local-'));
 try {const bin=join(root,'node_modules','.bin');await mkdir(bin,{recursive:true});await writeFile(join(bin,'agent-browser.cmd'),'fixture');const native=join(root,'node_modules','agent-browser','bin','agent-browser-win32-arm64.exe');await mkdir(join(native,'..'),{recursive:true});await writeFile(native,'fixture');assert.equal(await resolveWindowsNativeLauncher(bin,'arm64'),native);}finally{await rm(root,{recursive:true,force:true})}
});
