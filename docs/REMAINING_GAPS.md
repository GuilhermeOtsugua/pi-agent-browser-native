# Windows contracts and remaining gaps

Updated 9 October 2026 with Node 24.0.2 on native Windows. This report supersedes earlier open-fixture/cancellation dispositions, not their historical measurements. The complete default gate remains non-green; this is not release certification.

## Completed stages

### `f868f36` — native process/restore fixture contracts

The two previously non-green process/managed-restore suites now use native-safe fake launchers, isolated HOME/USERPROFILE, explicit encryption-key fixtures and safe hidden-`.git` mutation. Windows ownership, path reuse, checkout generation, malformed/missing keys and concurrent retention remain tested. POSIX UID/socket/permission cases are explicitly platform-skipped rather than treated as Windows behaviors. A direct Windows resolver regression bypasses the fixture's key injection and verifies missing/invalid keys still fail closed.

The process/restore/lifecycle group completed with **65 passed, zero failed, nine platform skips**. No new production defect was established by those fixture repairs. This isolated result does not certify short-watchdog cleanup under every launch timing.

### `5d84596` — config execution and credential environment

The setup CLI previously compared a file URL with `file://${process.argv[1]}`. Windows paths, encoded filenames and npm-linked entrypoints could silently return without executing. Standard canonical file URLs now establish direct execution; importing the module remains silent, including Node eval with a non-file argument.

Credential command subprocesses now receive the explicitly supplied environment, matching environment-based credential resolution. Defaults still use the parent environment. Command failures remain secret-safe; missing/invalid values and provider selection/fallback retain coverage. No provider was invoked or enabled.

Fixtures use bounded native subprocesses, isolated home/npm settings and an offline dependency-free npm package. Clipboard redaction coverage parses command semantics rather than assuming command/payload positions across Windows global-argument reordering. Standalone, multiline, object-error and batch redaction assertions remain intact.

**25 focused tests passed, zero failures/skips.** Build, TypeScript and generated-doc checks passed. POSIX execution of these changes was not measured here.

## Historical cancellation defect — repaired in tested scope

The combined 12-file verification completed with **177 passed, one failed, ten platform skips**, 265.09 seconds. The failure was `EBUSY` removing a 100 ms watchdog fixture directory.

Independent PID/process inspection reproduced a substantive race, not merely an antivirus/cleanup assumption:

- Original ten-run diagnostic: fixture descendants survived return in **9/10** runs.
- Instrumented three-run diagnostic: **2/3** survived despite taskkill returning **0 in all three**.
- Checked-in reproducer: **2/3** survived, all taskkill codes **0**, zero independent cleanup errors.
- Inspections occurred after return, so they establish survival, not exact disappearance latency. Recorded PIDs and unique fixture paths constrained cleanup; final inspection found no remaining owned fixtures.

The earlier repair stopped explicitly killing the parent before tree traversal. It did not make taskkill's process-tree snapshot atomic with future child creation. At a short deadline the PowerShell launcher can start a `.cmd`/Node descendant after traversal has selected its targets. A successful taskkill status and direct-parent exit therefore do not prove descendant disappearance. Increasing rm retries or startup timeouts would hide this defect, not repair it.

The measured scope was the PowerShell/custom-shim fallback. `90f7efb` now places the launcher in a non-inheritable kill-on-close Windows Job Object before external execution. Forced launcher termination closes the sole handle and kills members, including children created during cancellation. Normal completion clears kill-on-close so intentionally detached descendants survive CLI exit 0 or 7. Active-descendant regressions and two ten-run 100 ms fake-only watchdog checks passed with no survivors/cleanup errors. Short samples often stop before a CLI PID exists, so those samples alone are not active-child proof. The standard native route was not established to have the original race. No guessed-PID killing or upstream binary bundle was introduced.

Reproduce after installing dependencies (fake CLI only; no browser/HTTP/model work):

```sh
node node_modules/tsx/dist/cli.mjs scripts/benchmark-windows-short-watchdog.mjs 10
```

The diagnostic is Windows-only and bounded to 1–20 runs. It exits nonzero for surviving fixtures/cleanup errors and is not part of the default unit gate.

## Broader gates and upstream transport

Complete Windows default-unit measurements (different test revisions, not paired performance benchmarks):

| Revision/run | Passed | Failed | Skipped | Duration |
|---|---:|---:|---:|---:|
| First complete gate | 753 | 68 | 13 | 2,002.306 s |
| Standard-native fixtures | 814 | 9 | 15 | 614.687 s |
| Final repair gate | **826** | **2** | **16** | **614.796 s** |

The final 844-test run had zero cancellations. It retains two failures: eight same-process lock contenders at the unchanged 1 s budget leave a residual owned claim, and fresh sequential cold imports measured **272.6, 243.2, 230.9 ms**, exceeding the unchanged **250 ms** budget. Contention diagnostics are retained; no speculative reclaim or timeout relaxation was used to hide that failure. Independent cross-process serialization passes with an explicit Windows fixture-only 10 s budget (four Node/tsx processes and uncached PowerShell identity observations); this is not proof the production 1 s policy meets that workload.

Completed follow-ups include OS-owned shim lifetime/literal argv, restored Electron CIM ownership checks, implicit abandoned-launch shutdown tracking, native ref-guard/input-mode fixtures, and exact-path standard-native Node spawn adapters with real child cleanup. Source/file URL and ffmpeg fixtures are repaired. `fc9c007` makes the requested Electron probe deadline authoritative, preserving cancellation/attachment assertions.

`74dd747` repaired three maintainer CLI file-URL guards that silently skipped execution on Windows. Consequently earlier apparent generated-baseline/startup-profile successes are superseded: the real startup profile fails at **295.7 ms**; generated-doc checks now execute and pass, with LF/CRLF read-only/drift-repair tests. Build/typecheck pass. The independently executed **live command-reference gate fails** at `agent-browser skills list`: upstream reports a missing skills directory. The default gate stops at unit failure and does not certify later stages. The native fixture speedup is not live browser-performance proof; POSIX remains unexecuted.

The installed CLI doctor reported 0.36.0 and a successful headless about:blank launch. This is a health observation, not an EOF repair, configured-source reload, authentication/restore check or release matrix.

Official [upstream v0.36.0 connection source](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.36.0/cli/src/connection.rs), retrieved HTTP 200, shows Windows loopback TCP transport, newline response reading and JSON parsing. An empty response line explains the EOF parser diagnostic, but not why the peer closed without acknowledgement. The CLI retries transient failures against the same daemon up to five attempts; the wrapper must not infer navigation success or blindly replay another mutation. Existing same-session URL/snapshot recovery guidance remains appropriate. No correlated daemon/transport root cause was established. GitHub issue search was robots-denied and was not bypassed.

## Priority queue

- **P1:** diagnose same-process lock contention/residual claim without weakening ownership, stale-reclaim or deadline assertions.
- **P1:** meet the unchanged cold-start budget through measured implementation improvement; do not raise the threshold.
- **P1:** resolve the independently observed upstream missing-skills command-reference failure; validate the full default/release/POSIX matrix.
- **P1:** failed browser launch shutdown remains upstream-limited: native `close` can retry the invalid browser and fail. Ownership tracking is repaired, not daemon shutdown certification.
- **P1:** correlate upstream EOF with daemon logs/acknowledgements; keep unknown outcomes failed/uncertain.
- **P2:** eight model-free Chrome source-smoke steps and a 10,797-byte screenshot passed, but private-home `EBUSY` made the runner exit 1. This is not clean end-to-end dogfood or configured-source reload/restore. tmux dogfood remains uncertified.
- **P2:** `c8e58aa` removed maintainer Node-tool shell spawning; warnings from other subprocesses are separate. POSIX-bit subtests skip Windows explicitly; no NTFS ACL/privacy assurance follows.
- **P2:** running Pi must `/reload` or restart to activate rebuilt code. Windows restore still needs a valid explicit encryption key; no real key/security configuration was changed.

All completed stages were committed locally. No follow-up push or issue closure was performed. Benchmark evidence is software execution/fixture coverage, not new jobs, completed forms or submissions.
