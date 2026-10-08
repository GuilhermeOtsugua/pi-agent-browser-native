/**
 * Diagnose the observed short-watchdog process-tree race in the Windows custom-shim fallback.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/benchmark-windows-short-watchdog.mjs [runs]
 * Windows-only, 1–20 runs, fake CLI only, zero browser/HTTP/model work.
 * Exits nonzero on surviving fixtures or cleanup errors. This is NOT a release gate.
 * taskkill instrumentation records completion separately from descendant disappearance.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { runAgentBrowserProcess } from '../extensions/agent-browser/lib/process.ts';
import { writeFakeAgentBrowserBinary } from '../test/helpers/agent-browser-harness.ts';

if (process.platform !== 'win32') throw new Error('Windows-only diagnostic; no POSIX equivalence claimed.');
const runs = Number(process.argv[2] ?? 10);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('runs must be 1–20.');
const results = [];
const taskkills = [];
const originalSpawn = childProcess.spawn;
childProcess.spawn = (file, args, options) => {
  if (file !== 'taskkill.exe') return originalSpawn(file, args, options);
  const trace = { args, stdout: '', stderr: '', code: null };
  taskkills.push(trace);
  const child = originalSpawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { trace.stdout = (trace.stdout + String(chunk)).slice(0, 4096); });
  child.stderr.on('data', chunk => { trace.stderr = (trace.stderr + String(chunk)).slice(0, 4096); });
  child.on('close', code => { trace.code = code; });
  return child;
};
syncBuiltinESMExports();

try {
  for (let iteration = 0; iteration < runs; iteration++) {
    const dir = await mkdtemp(join(tmpdir(), 'piab-short-watchdog-audit-'));
    const pidPath = join(dir, 'fixture-pid');
    let processes = [];
    let cleanupError = null;
    let observation;
    try {
      await writeFakeAgentBrowserBinary(dir,
        `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); process.stdin.resume(); setTimeout(()=>process.stdout.write(JSON.stringify({success:true,data:'late'})),5000);`);
      const start = Date.now();
      const result = await runAgentBrowserProcess({
        args: ['wait', '5000'], cwd: dir,
        env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` }, timeoutMs: 100,
      });
      const returned = Date.now();
      let recordedPid = null;
      try { recordedPid = Number(await readFile(pidPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      // Unique fixture path restricts inspection/cleanup to this run, not user sessions.
      const query = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|cmd)\\.exe$' -and $_.CommandLine -and $_.CommandLine.IndexOf('${dir.replaceAll("'", "''")}', [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`;
      const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', query], {
        encoding: 'utf8', timeout: 10000,
      }).trim();
      const parsed = raw ? JSON.parse(raw) : [];
      processes = Array.isArray(parsed) ? parsed : [parsed];
      observation = {
        iteration, returnMs: returned - start, inspectedAfterReturnMs: Date.now() - returned,
        recordedPid, timedOut: result.timedOut, exitCode: result.exitCode,
        survivingFixtures: processes,
      };
    } finally {
      const roots = processes.filter(owned =>
        !processes.some(parent => parent.ProcessId === owned.ParentProcessId));
      for (const owned of roots) {
        try { execFileSync('taskkill.exe', ['/PID', String(owned.ProcessId), '/T', '/F'], {
          stdio: 'ignore', timeout: 10000,
        }); } catch (error) { cleanupError = String(error); }
      }
      try { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
      catch (error) { cleanupError = String(error); }
    }
    results.push({ ...observation, cleanupError });
  }
} finally {
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
}
console.log(JSON.stringify({ scope: 'Windows custom shim; not standard native executable',
  httpRequests: 0, results, taskkills }, null, 2));
if (results.some(row => row.survivingFixtures.length || row.cleanupError)) process.exitCode = 1;
