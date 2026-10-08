# Windows contracts and remaining gaps

Validated 8 October 2026 with Node 24.0.2 on native Windows. This report supersedes the earlier open-fixture dispositions, not their historical measurements. It is not a full release certification.

## Completed stages

### `f868f36` — native process/restore fixture contracts

The two previously non-green process/managed-restore suites now use native-safe fake launchers, isolated HOME/USERPROFILE, explicit encryption-key fixtures and safe hidden-`.git` mutation. Windows ownership, path reuse, checkout generation, malformed/missing keys and concurrent retention remain tested. POSIX UID/socket/permission cases are explicitly platform-skipped rather than treated as Windows behaviors. A direct Windows resolver regression bypasses the fixture's key injection and verifies missing/invalid keys still fail closed.

The process/restore/lifecycle group completed with **65 passed, zero failed, nine platform skips**. No new production defect was established by those fixture repairs. This isolated result does not certify short-watchdog cleanup under every launch timing.

### `5d84596` — config execution and credential environment

The setup CLI previously compared a file URL with `file://${process.argv[1]}`. Windows paths, encoded filenames and npm-linked entrypoints could silently return without executing. Standard canonical file URLs now establish direct execution; importing the module remains silent, including Node eval with a non-file argument.

Credential command subprocesses now receive the explicitly supplied environment, matching environment-based credential resolution. Defaults still use the parent environment. Command failures remain secret-safe; missing/invalid values and provider selection/fallback retain coverage. No provider was invoked or enabled.

Fixtures use bounded native subprocesses, isolated home/npm settings and an offline dependency-free npm package. Clipboard redaction coverage parses command semantics rather than assuming command/payload positions across Windows global-argument reordering. Standalone, multiline, object-error and batch redaction assertions remain intact.

**25 focused tests passed, zero failures/skips.** Build, TypeScript and generated-doc checks passed. POSIX execution of these changes was not measured here.

## New observed cancellation defect — unresolved

The combined 12-file verification completed with **177 passed, one failed, ten platform skips**, 265.09 seconds. The failure was `EBUSY` removing a 100 ms watchdog fixture directory.

Independent PID/process inspection reproduced a substantive race, not merely an antivirus/cleanup assumption:

- Original ten-run diagnostic: fixture descendants survived return in **9/10** runs.
- Instrumented three-run diagnostic: **2/3** survived despite taskkill returning **0 in all three**.
- Checked-in reproducer: **2/3** survived, all taskkill codes **0**, zero independent cleanup errors.
- Inspections occurred after return, so they establish survival, not exact disappearance latency. Recorded PIDs and unique fixture paths constrained cleanup; final inspection found no remaining owned fixtures.

The earlier repair stopped explicitly killing the parent before tree traversal. It did not make taskkill's process-tree snapshot atomic with future child creation. At a short deadline the PowerShell launcher can start a `.cmd`/Node descendant after traversal has selected its targets. A successful taskkill status and direct-parent exit therefore do not prove descendant disappearance. Increasing rm retries or startup timeouts would hide this defect, not repair it.

The measured scope is the PowerShell/custom-shim fallback. The standard package-owned native executable route was **not** established to have the same race. A production fix needs an evidence-led OS-owned process-lifetime contract; no speculative process framework, guessed-PID killing or upstream bundle was introduced.

Reproduce after installing dependencies (fake CLI only; no browser/HTTP/model work):

```sh
node node_modules/tsx/dist/cli.mjs scripts/benchmark-windows-short-watchdog.mjs 10
```

The diagnostic is Windows-only and bounded to 1–20 runs. It exits nonzero for surviving fixtures/cleanup errors and is not part of the default unit gate.

## Broader gates and upstream transport

The attempted full default unit run stopped at its 650-second caller limit, with **120 pass lines and 42 fail lines**, no final summary. Nine config and one clipboard failures were subsequently reproduced and verified repaired separately. Other failures include Electron/platform fixtures, semantic-action/QA matrices, recovery and command/artifact coverage. They remain individually undispositioned; do not classify them all as harmless fixtures or new runtime regressions. No full-suite-green claim is supported.

The installed CLI doctor reported 0.36.0 and a successful headless about:blank launch. This is a health observation, not an EOF repair, configured-source reload, authentication/restore check or release matrix.

Official [upstream v0.36.0 connection source](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.36.0/cli/src/connection.rs), retrieved HTTP 200, shows Windows loopback TCP transport, newline response reading and JSON parsing. An empty response line explains the EOF parser diagnostic, but not why the peer closed without acknowledgement. The CLI retries transient failures against the same daemon up to five attempts; the wrapper must not infer navigation success or blindly replay another mutation. Existing same-session URL/snapshot recovery guidance remains appropriate. No correlated daemon/transport root cause was established. GitHub issue search was robots-denied and was not bypassed.

## Priority queue

- **P1:** repair the reproduced short-watchdog ownership/cancellation race without weakening disappearance assertions.
- **P1:** disposition the remaining default-suite failures; validate the complete gate, POSIX/platform matrix and configured-source reload/restore. tmux dogfood remains unavailable here.
- **P1:** correlate upstream EOF with daemon logs and transport acknowledgements; keep unknown outcomes failed/uncertain.
- **P2:** maintainer build orchestration still emits Node DEP0190 for shell-argument spawning; this pass did not rewrite that runner.
- **P2:** running Pi must `/reload` or restart to activate rebuilt extension code. Windows restore still requires a valid explicit encryption key; no real key/security configuration was changed.

All completed stages were committed locally. No follow-up push or issue closure was performed. Benchmark evidence is software execution/fixture coverage, not new jobs, completed forms or submissions.
