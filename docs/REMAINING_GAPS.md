# Windows contracts and remaining gaps

Updated 10 October 2026 with Node 24.0.2 on native Windows. This report supersedes earlier open-fixture/cancellation dispositions, not their historical measurements. Three earlier complete native Windows default gates remain historical; the current repair's final complete default gate passed after the two recorded red phases below. Native Windows verification is not release, cross-platform or universal startup-latency certification.

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

Historical complete Windows default-unit measurements (different test revisions, not paired performance benchmarks; these predate the current managed-close repair):

| Revision/run | Passed | Failed | Skipped | Duration |
|---|---:|---:|---:|---:|
| First complete gate | 753 | 68 | 13 | 2,002.306 s |
| Standard-native fixtures | 814 | 9 | 15 | 614.687 s |
| Earlier repair gate | 826 | 2 | 16 | 614.796 s |
| Lock/launcher/lazy-execution follow-up | 836 | 0 | 16 | 729.735 s |
| Repeat, including live-harness import boundary | 836 | 1 | 16 | 701.513 s |
| Electron-contract/cleanup run | 840 | 1 | 16 | 813.858 s |
| Script split and npm diagnostic coverage | **843** | **0** | **16** | **668.292 s** |
| Previous repeat, startup sample diagnostics | 843 | 0 | 16 | 496.088 s |
| Historical smoke setup-ownership coverage | **844** | **0** | **16** | **642.033 s** |

The earlier 853-test repeat had zero cancellations and one cold-start failure: **310.2, 230.7, 262.1 ms** against the unchanged **250 ms** budget. The earlier 857-test run also had zero cancellations; startup/lock/Electron coverage passed, but a documented offline npm-exec config example reached its unchanged 20 s subprocess deadline. Two isolated repeats passed. This intermittent fixture failure remains unresolved; a focused retry is not whole-gate certification. The preceding 852-test default gate passed through live command-reference verification. Six independent fresh samples then passed at **171.4–210.4 ms** (mean 192.9 ms); earlier worker samples also intermittently exceeded the threshold. `8ee66e9` demand-loads execution phases inside the existing async queue while keeping factory/tool/schema/render/lifecycle registration synchronous. ESM-load tests cover the actual dependency boundary. Those earlier observations did not establish stable latency or a reliably green gate. Failure diagnostics now persist startup measurements before exiting nonzero.

`ba624e5` extracts pure Electron transcript/constants and demand-loads host execution/nonempty owned cleanup within existing queues (ESM loads **127 → 118**). `acaef9d` keeps script constants/validation/lease identity pure and demand-loads its unchanged child executor inside active-script shutdown tracking. Eager compiled script code falls **20,803 → 4,738 bytes**. Red/green import-boundary evidence, sandbox/lifecycle tests and fresh-context static security review preserve exact permission grants, pre-spawn leases, cancellation, environment isolation, quotas and cleanup.

The current rotated three-arm comparison (ten fresh processes each, same dependencies/config/Node) measured medians **203.239 ms** at `ab94d49`, **172.303 ms** at Electron split `0d819bd`, and **168.516 ms** at script split `acaef9d`: combined **34.723 ms / 17.1%**, modest script-only **3.787 ms / 2.2%**. Candidate maximum was 221.727 ms, with 0/10 over 250 ms versus baseline 3/10. Prior two-arm samples still had an overrun; finite passing samples do not establish universal reliability.

The two earlier **859-test** gates and historical **860-test** Windows gate passed through live command-reference verification, with zero cancellations. That unit phase was 642.033 s versus the previous 496.088 s: **145.945 s slower**, not a measured native speed gain. No native execution-loading change was made in that pass. `25b2114` preserves passing and failing startup sample timings; its whole-gate samples were **156.612/149.072/141.882 ms** (previous repeat 110.557/131.807/115.776 ms). `211f653` preserves command/code/signal/elapsed/deadline/kill/exit and bounded redacted npm diagnostic tails. The 20 s npm timeout did not recur in that gate; no causal root repair was established, and neither it nor the 250 ms startup / 1 s production lock budgets changed.

`e4964cd` repaired the residual owned claim: instrumented release reproduced Windows directory-rename **EPERM**. At most three additional sharing-error retries revalidate the token before every rename; other errors and replacement ownership fail closed. Ten repeated eight-contender runs passed at the unchanged **1 s** budget. Persistent-error and replacement-owner tests pass; both subsequent full gates pass the lock group. Independent cross-process serialization uses an explicit Windows fixture-only 10 s budget (four Node/tsx processes and uncached PowerShell identity observations); it does not prove the production 1 s policy meets that workload.

Completed follow-ups include OS-owned shim lifetime/literal argv, restored Electron CIM ownership checks, implicit abandoned-launch shutdown tracking, native ref-guard/input-mode fixtures, and exact-path standard-native Node spawn adapters with real child cleanup. Source/file URL and ffmpeg fixtures are repaired. `fc9c007` makes the requested Electron probe deadline authoritative, preserving cancellation/attachment assertions.

`74dd747` repaired three silently skipped Windows maintainer CLI entrypoints; earlier apparent generated-baseline/startup-profile successes were superseded. Generated-doc/build/typecheck checks now execute and pass. `c57726c`/`ded6d67` repaired live skills verification and the packaged doctor: Node's bare `execFile` selected a later standalone copy instead of the first npm install. They now share the runtime's JSDoc-checked native launcher resolver, preserve PATH/environment, and resolve the package-owned binary with its shipped skills. Official [v0.36.0 skills source](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.36.0/cli/src/skills.rs) confirms executable-relative package discovery. No skill override, copied binary, dependency edit, or version shim was added. Live command-reference and read-only doctor checks pass; 34 doctor/package tests and an unpacked-package CLI-help smoke passed without dependency installation. A custom shim without native layout remains an explicit maintainer-check blocker; runtime fallback support is unchanged.

`eedcd3b` keeps Node test-runner hook registration out of live dogfood imports while retaining root-context fixture cleanup in Node tests. Two earlier Chrome loopback smokes passed all eight steps with verified 10,797-byte screenshots, but private checkout deletion still raised **EBUSY**. Runner exits were 7 before the import-boundary fix and 1 afterward; exact private-home removal succeeded after each runner exited. This repairs test-runner contamination, not the unresolved directory-handle lifetime. Checkout-only approved-model native `--version` smokes passed; they are not browser or reload certification. POSIX remains unexecuted.

`b2d87b8` repairs an early dogfood setup leak: automatic artifacts and harness/fixture acquisition now share the existing teardown boundary. A forced fixture-creation error previously left its owned directory; the regression now proves owned/unretained disappearance before rejection, caller/explicit-retention preservation and zero upstream spawn. Seven focused tests and full Windows verification pass. The actual loopback eight-step run and verified 10,797-byte screenshot also pass.

The pinned [0.36.0 native daemon source](https://github.com/vercel-labs/agent-browser/blob/v0.36.0/cli/src/native/daemon.rs), fetched HTTP 200, explicitly writes the successful close response, sleeps **100 ms**, then notifies graceful shutdown. This explains the observed acknowledgement/exit gap in that version. The latest scoped live diagnostic still sees a fresh daemon alive during EBUSY and exact-home deletion succeeding after **203.252 ms**, when that PID is absent. No arbitrary sleep, unverified kill, upstream dependency patch or budget increase was introduced. Actual OS handle ownership is still not measured. The tool contract now distinguishes close acknowledgement from OS daemon exit.

The installed CLI doctor reported 0.36.0 and a successful headless about:blank launch. This is a health observation, not an EOF repair, configured-source reload, authentication/restore check or release matrix.

Official [upstream v0.36.0 connection source](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.36.0/cli/src/connection.rs), retrieved HTTP 200, shows Windows loopback TCP transport, newline response reading and JSON parsing. An empty response line explains the EOF parser diagnostic, but not why the peer closed without acknowledgement. The CLI retries transient failures against the same daemon up to five attempts; the wrapper must not infer navigation success or blindly replay another mutation. Existing same-session URL/snapshot recovery guidance remains appropriate. No correlated daemon/transport root cause was established. GitHub issue search was robots-denied and was not bypassed.

## Current managed-close repair — native Windows default gate passed

Managed cleanup now accepts only a real JSON envelope with boolean `success: true` and successful process completion; empty, false, malformed, or plugin-normalized responses cannot retire ownership. Ordinary plugin parsing is unchanged. Every eligible owned close is attempted, failures are aggregated, and failed owners remain tracked. The host-visible message/stack includes a globally bounded, credential-redacted owner/reason summary rather than requiring inspection of nested errors alone.

Dispatched failed fresh wrapper-owned resources are tracked independently of the `usedImplicitSession` selection hint, including when the previous current session is preserved. This does not claim caller-owned named sessions, undispatched work, or an active page from failed launch. Model-invisible version-1 pending/closed cleanup transitions preserve exact namespace/session, original cwd, attachment, restore-disabled state, unknown versus known-null daemon restore key, and autosave policy across fresh factories. ACK-only terminal retirement supersedes stale active transcript state. A successful current ACK immediately invalidates scoped state and rotates/reserves the next identity even if another cleanup fails.

Runtime-retained ACK tombstones dominate earlier active messages and pending custom cleanup entries on another branch, clearing current/scoped state and reusing the reserved post-close identity. Actual pending lifecycle persistence may clear its exact tombstone; other still-owned off-branch resources remain eligible for cleanup. This uses existing runtime retention and durable branch records, not a new cross-branch persistence store.

`details.attemptedManagedSessionAutosavePolicy` separates the attempted headed policy from current-session presentation. Parent observations covered actual default interval **0** and explicit **700** retained after the environment changed to **900**; no later environment override was substituted during cleanup.

Parent-observed evidence:

- Cleanup/security **33/33 tests in 18.50 s**; platform **9/9 tests in 13.25 s**. All six new policy/state regressions failed before and passed after repair.
- Standalone fake-process public API: **three failed fresh launches, three initial closes, two invalid ACKs aggregated, exactly two fresh-factory retries, zero extra closes after settlement**. Headed variant: original **700** on all **five cleanup invocations** despite later **900**, credentials absent. Direct canonical redaction preserved owner/reason, noncredential fields, and help placeholders.
- Actual owned loopback-browser dogfood: **eight successful steps**, verified **10,797-byte screenshot**. Requested private evidence is retained outside the published repository.
- Separate actual owned page / `get url` / implicit quit / fresh-factory smoke: exit **0**, accepted ACK and no resurrection. This is not OS daemon-exit evidence.
- Direct Windows platform doctor: **four missing prerequisites**, not platform readiness. Isolated actual npm-context repository hygiene check: **zero failures**. Earlier concurrent `npm run smoke:platform:doctor` had npm-pack inspection unavailable; the cause remains unestablished, and the isolated pass does not erase that observation.
- Final redaction consumers **79/79 in 6.319 s**: complete HTTP slash credentials, legacy userinfo, literal-question-mark sensitive values, structured/relative URL diagnostics, ordinary context, outer JSON, help, idempotence and bounded repeated-public-query scans. Earlier targeted runs exposed and corrected partial-span leaks; the prior first-security fixture failure's exact cause remains unestablished because its original returned details were not captured. The strict success assertion now retains full failure diagnostics.
- Actual held-reader API: before, four real `EPERM` attempts and a completed release left its claim behind after the reader closed; after, release waited for the reader and no claim remained. Actual live-candidate API: before, cleanup opened a live publisher's owner file and its real publication failed `EPERM`; after, cleanup skipped the live candidate and both owned consumers acquired without rename errors. These are source-backed hazards, not proof of the exact branch behind the original intermittent failures or a matched native latency gain.
- Canonical redaction API: mixed string/structured assignments, Cookie headers, credential suffixes, legacy userinfo and sensitive relative query values failed privacy checks before their corrections, then passed with ordinary status/owner/URI context, sanitized Basic/Bearer schemes and idempotence. An 18-case relative-URI boundary matrix also passed; this is software privacy proof, not acquisition timing.
- Closed-branch cleanup consumers **30/30 in 26.170 s**: four new message-only/stale-pending × default/explicit-namespace cases cover repeated restoration, fresh identity reservation, new dispatched lifecycle continuity and off-branch failed-owner retention. The standalone registered API failed before by reporting the ACKed identity active, then passed with `activeBefore: false` and a different fresh identity.
- The final-source owned loopback dogfood passed all eight steps in **8.30 s**, with a verified **10,797-byte screenshot**. The separate post-lifecycle actual implicit-quit/fresh-factory scenario passed without owner resurrection; accepted ACK was observed, OS daemon exit was explicitly not certified.

Per-claim FIFO metadata coordination serializes only local metadata/removal, not acquisition or browser critical sections. Non-authoritative candidate PID hints prevent inspection of live or unknown publishers; deletion still requires complete owner/PID/token/security/death validation and a fresh metadata recheck. Legacy/unhinted and unknown candidates remain conservatively untouched. Foreign-process sharing of published claims remains the existing bounded behavior; the one-second wait, ten-millisecond poll and four sharing attempts are unchanged.

Doctor hygiene now uses portable npm invocation and root-scoped filesystem enumeration, maximum depth two, skipping `node_modules`, without following directory symlinks or reading artifact contents. Unavailable tracked, local, or pack inspection fails closed. Its **20 s** deadline is unchanged.

The first complete native Windows default gate for this repair passed playbook drift, build and TypeScript, then failed its unit phase: **863 passed / nine failed / 16 skipped, 624.233 s**; the complete command took **651.11 s**. Failures exposed authentication-scheme erasure, obsolete restore/transcript assertions and a contended claim left behind at the unchanged one-second policy budget. This is recorded red evidence, not certification. Full release/POSIX/platform-matrix and configured-source real reload/authentication restore, EOF root cause, OS daemon exit/private-cwd lifetime, and real Windows encryption-key requirements remain unresolved. No retry-budget, **250 ms** startup or **1 s** lock change, blind mutation replay, fixed sleep, unknown-PID kill, native speed gain, model/full-application goal, job, or submission claim follows. No push or issue closure occurred.

The subsequent whole gate reached **893 passed / one failed / 16 skipped, 633.375 s** (**682.47 s** command). Its sole failure pinned spacing in a rendered native JSON example. Obsolete example-copy/format tests were deleted, not re-pinned; remaining presentation consumers passed **16/16 in 0.789 s**, and a direct API smoke parsed four native calls while preserving quoted URL/profile boundaries and heredoc payloads and excluding comments. This is retained intermediate red evidence, not the final gate.

The final complete native Windows default gate passed playbook drift, build, TypeScript and both command-reference checks: **892 passed / zero failed / 16 skipped, 583.021 s**; **606.13 s** for the complete command. Fresh-process startup samples were **150.929 / 134.868 / 136.475 ms**, below the unchanged **250 ms** budget. This closes the software default-gate prerequisite, not the release/POSIX/platform matrix or upstream lifetime/EOF diagnosis. Changed tests and unmatched gate durations do not establish a native speed gain.

## Priority queue

- **P1:** validate the full release/POSIX/platform matrix and configured-source reload/restore; completed lock and launcher repairs are scoped evidence, not release certification.
- **P1:** failed browser launch shutdown remains upstream-limited: native `close` can retry the invalid browser and fail. Ownership tracking is repaired, not daemon shutdown certification.
- **P1:** correlate upstream EOF with daemon logs/acknowledgements; keep unknown outcomes failed/uncertain.
- **P2:** finish Windows private-checkout lifetime diagnosis. Current default-location PID probes, constrained to the unique checkout fingerprint, captured the fresh managed daemon still alive after close/shutdown and during EBUSY. Exact-home deletion succeeded after **108.467/197.820 ms**, when that PID was no longer alive. Both eight-step Chrome smokes and 10,797-byte screenshots passed; no process was terminated or foreign session acted on. Pinned 0.36.0 source now explains the acknowledgement/exit gap as an intentional 100 ms graceful-shutdown delay; current repetition completes deletion at 203.252 ms. This does not prove exact OS handle ownership or PID start-identity. Earlier 205/104 ms diagnostics had no PID evidence. `627e1fe` preserves all teardown failures; tmux dogfood remains uncertified.
- **P2:** monitor startup variability and investigate recurrent acquisition or offline npm-exec failures using retained diagnostics. The final current default gate and three historical gates passed without threshold changes; corrected red phases do not erase earlier intermittent failures or certify universal startup latency.
- **P2:** `c8e58aa` removed maintainer Node-tool shell spawning; warnings from other subprocesses are separate. POSIX-bit subtests skip Windows explicitly; no NTFS ACL/privacy assurance follows.
- **P2:** running Pi must `/reload` or restart to activate rebuilt code. Windows restore still needs a valid explicit encryption key; no real key/security configuration was changed.

Earlier completed stages were pushed to the user's fork/main (native) and origin/main (Kumomi) with authorization. Follow-up Electron/script loading, setup/teardown/diagnostic evidence and timing-report stages are committed locally; no additional push or issue closure was performed. Benchmark evidence is software execution/fixture coverage, not new jobs, completed forms or submissions.
