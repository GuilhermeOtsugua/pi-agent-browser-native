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
| Earlier repair gate | 826 | 2 | 16 | 614.796 s |
| Lock/launcher/lazy-execution follow-up | 836 | 0 | 16 | 729.735 s |
| Repeat, including live-harness import boundary | 836 | 1 | 16 | 701.513 s |
| Latest Electron-contract/cleanup run | **840** | **1** | **16** | **813.858 s** |

The earlier 853-test repeat had zero cancellations and one cold-start failure: **310.2, 230.7, 262.1 ms** against the unchanged **250 ms** budget. The latest 857-test run also had zero cancellations; startup/lock/Electron coverage passed, but a documented offline npm-exec config example reached its unchanged 20 s subprocess deadline. Two isolated repeats passed. This intermittent fixture failure remains unresolved; a focused retry is not whole-gate certification. The preceding 852-test default gate passed through live command-reference verification. Six independent fresh samples then passed at **171.4–210.4 ms** (mean 192.9 ms); earlier worker samples also intermittently exceeded the threshold. `8ee66e9` demand-loads execution phases inside the existing async queue while keeping factory/tool/schema/render/lifecycle registration synchronous. ESM-load tests cover the actual dependency boundary. This is a measured improvement, not stable latency or reliably green default-gate certification. Failure diagnostics now persist startup measurements before exiting nonzero.

`ba624e5` extracts the pure Electron transcript/constants contract and demand-loads host execution and nonempty owned cleanup within existing queues. Startup ESM loads decrease **127 → 118**. A matched ten-repeat alternating comparison against `ab94d49`, using the same dependency tree/config/Node version, measured median **234.760 → 218.004 ms** (16.755 ms / 7.1% saved). Candidate maximum was 258.583 ms, with 1/10 over the unchanged threshold versus baseline 2/10; reliability is still uncertified. Separate worker six-sample timings were 170.8–193.9 ms. See Kumomi `tooling/web-intelligence/docs/PERFORMANCE_PROGRESS.md` for matched versus nonmatched timings.

`e4964cd` repaired the residual owned claim: instrumented release reproduced Windows directory-rename **EPERM**. At most three additional sharing-error retries revalidate the token before every rename; other errors and replacement ownership fail closed. Ten repeated eight-contender runs passed at the unchanged **1 s** budget. Persistent-error and replacement-owner tests pass; both subsequent full gates pass the lock group. Independent cross-process serialization uses an explicit Windows fixture-only 10 s budget (four Node/tsx processes and uncached PowerShell identity observations); it does not prove the production 1 s policy meets that workload.

Completed follow-ups include OS-owned shim lifetime/literal argv, restored Electron CIM ownership checks, implicit abandoned-launch shutdown tracking, native ref-guard/input-mode fixtures, and exact-path standard-native Node spawn adapters with real child cleanup. Source/file URL and ffmpeg fixtures are repaired. `fc9c007` makes the requested Electron probe deadline authoritative, preserving cancellation/attachment assertions.

`74dd747` repaired three silently skipped Windows maintainer CLI entrypoints; earlier apparent generated-baseline/startup-profile successes were superseded. Generated-doc/build/typecheck checks now execute and pass. `c57726c`/`ded6d67` repaired live skills verification and the packaged doctor: Node's bare `execFile` selected a later standalone copy instead of the first npm install. They now share the runtime's JSDoc-checked native launcher resolver, preserve PATH/environment, and resolve the package-owned binary with its shipped skills. Official [v0.36.0 skills source](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.36.0/cli/src/skills.rs) confirms executable-relative package discovery. No skill override, copied binary, dependency edit, or version shim was added. Live command-reference and read-only doctor checks pass; 34 doctor/package tests and an unpacked-package CLI-help smoke passed without dependency installation. A custom shim without native layout remains an explicit maintainer-check blocker; runtime fallback support is unchanged.

`eedcd3b` keeps Node test-runner hook registration out of live dogfood imports while retaining root-context fixture cleanup in Node tests. Two current Chrome loopback smokes passed all eight steps with verified 10,797-byte screenshots, but private checkout deletion still raised **EBUSY**. Runner exits were 7 before the import-boundary fix and 1 afterward; exact private-home removal succeeded after each runner exited. This repairs test-runner contamination, not the unresolved directory-handle lifetime. Checkout-only approved-model native `--version` smokes passed; they are not browser or reload certification. POSIX remains unexecuted.

The installed CLI doctor reported 0.36.0 and a successful headless about:blank launch. This is a health observation, not an EOF repair, configured-source reload, authentication/restore check or release matrix.

Official [upstream v0.36.0 connection source](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.36.0/cli/src/connection.rs), retrieved HTTP 200, shows Windows loopback TCP transport, newline response reading and JSON parsing. An empty response line explains the EOF parser diagnostic, but not why the peer closed without acknowledgement. The CLI retries transient failures against the same daemon up to five attempts; the wrapper must not infer navigation success or blindly replay another mutation. Existing same-session URL/snapshot recovery guidance remains appropriate. No correlated daemon/transport root cause was established. GitHub issue search was robots-denied and was not bypassed.

## Priority queue

- **P1:** make the unchanged cold-start budget reliable; the matched candidate still exceeded it once, although the latest complete startup assertion passed.
- **P1:** diagnose the intermittent offline npm-exec config timeout without increasing its 20 s deadline; the latest whole gate remains non-green.
- **P1:** validate the full release/POSIX/platform matrix and configured-source reload/restore; completed lock and launcher repairs are scoped evidence, not release certification.
- **P1:** failed browser launch shutdown remains upstream-limited: native `close` can retry the invalid browser and fail. Ownership tracking is repaired, not daemon shutdown certification.
- **P1:** correlate upstream EOF with daemon logs/acknowledgements; keep unknown outcomes failed/uncertain.
- **P2:** identify the directory-handle owner behind private-checkout EBUSY. Two bounded deletion diagnostics succeeded within the same runner after approximately 205/104 ms, following eight passing Chrome steps and verified 10,797-byte screenshots. No process was terminated and no daemon PID was observed; this shows transient release in those runs, not PID-disappearance/root-cause certification. `627e1fe` now preserves smoke plus teardown failures while settling every resource, instead of silently discarding shutdown/recovery-close errors. tmux dogfood remains uncertified.
- **P2:** `c8e58aa` removed maintainer Node-tool shell spawning; warnings from other subprocesses are separate. POSIX-bit subtests skip Windows explicitly; no NTFS ACL/privacy assurance follows.
- **P2:** running Pi must `/reload` or restart to activate rebuilt code. Windows restore still needs a valid explicit encryption key; no real key/security configuration was changed.

Earlier completed stages were pushed to the user's fork/main (native) and origin/main (Kumomi) with authorization. This follow-up's Electron-contract, teardown-evidence and timing-report stages are committed locally; no additional push or issue closure was performed. Benchmark evidence is software execution/fixture coverage, not new jobs, completed forms or submissions.
