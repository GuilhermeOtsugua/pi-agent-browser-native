# Windows lifecycle and restore hardening

Historical bounded pass. See [current contracts and remaining gaps](REMAINING_GAPS.md) for the subsequent Job Object cancellation repair, native fixture/CLI fixes and the current repeated passing Windows gates and remaining upstream/platform gaps. The tree-ordering repair below was superseded; it is not complete cancellation certification.

Validated 8 October 2026 with Node 24.0.2 on native Windows. This is a bounded repair pass, not a release-gate or all-platform certification.

## Runtime fixes

### Reap the tree before killing its launcher

The old timeout/abort path started `taskkill /PID … /T /F` and immediately killed the direct child. That could remove the PowerShell launcher before `taskkill` discovered its `.cmd`/Node descendants. A baseline regression run left fake-shim processes alive and temp directories locked; PID/command-line inspection confirmed the survivors.

Windows now leaves the launcher alive while `taskkill` traverses its tree. A failed tree-kill falls back to the direct child signal. The existing two-second escalation remains; already-exited children are not targeted again, and subsequent abort/timeout events do not start overlapping termination sequences. No completion is inferred from JSON output. Existing close/timeout/exit-code precedence is unchanged: a Windows taskkill close code can remain nonzero rather than 124, while `timedOut` still identifies the wrapper deadline.

The new native-only regressions start a real custom shim and descendant, wait for its PID record, and assert that the descendant is gone **before** timeout/abort returns. Cleanup independently targets recorded fixture PIDs even when an assertion fails; no browser or HTTP acquisition is involved.

### Accept Windows volume metadata without path-only identity

Node on the tested NTFS volume reports `stat.dev = 0`. Rejecting every zero device ID made legitimate Windows checkout identity unavailable, silently suppressing automatic managed restore even with a valid encryption key.

Windows identity now scopes the file ID to the canonical drive/UNC root and retains birth time plus the checkout-generation marker. POSIX device requirements are unchanged. Missing file IDs/birth time still fail closed; replacing a checkout at the same path yields a different restore key. Windows still requires a valid 64-character hexadecimal encryption key. This does not add permissions, weaken pool ownership, or turn paths alone into restore identity.

## Test/debt corrections

- Custom Windows shims reorder global argv; semantic assertions now parse the upstream command tokens rather than assuming the command is always the final token. Exact close-argv checks retain the documented Windows `--restore=value` shape.
- Restore fixtures explicitly supply isolated `HOME`/`USERPROFILE` and a valid test encryption key. They no longer depend on the operator's real Windows profile or accidentally test restore-disabled behavior.
- Proxy fixtures respect case-insensitive Windows environment names; deleting `https_proxy` must not erase the intended `HTTPS_PROXY` input.
- POSIX socket configuration is not injected into a Windows named-pipe scenario. Artifact assertions still require the resolved native path and fail for missing files.
- Timeout recovery allows launch overhead rather than timing out before the fake command starts.
- Shutdown coverage waits for actual sandbox/browser work and verifies its close, instead of racing a shared version preflight with a fixed 50 ms sleep.
- The architecture subprocess description now distinguishes native installations from custom-shim fallback.
- Generated-doc checks compare content after CRLF normalization and preserve block line endings on writes. The previous checker reported stale README blocks solely because Git checked them out with CRLF; rewriting them produced no semantic Git diff. LF/CRLF regressions still reject actual stale content.

## Verification

| Check | Result | Scope |
|---|---|---|
| Build, TypeScript, generated-doc checks | Passed | Current checkout |
| Generated-doc LF/CRLF regressions | 2 passed | Read-only checks do not rewrite; real content drift fails and repairs preserve line endings |
| Native Windows lifecycle regressions | 3 passed | Real local process tree and checkout generation; zero browser/HTTP |
| Argv, extension errors/artifacts, presentation, script, navigation transport, wait timeouts, Windows lifecycle | **91 passed, 1 skipped**, 180.3 seconds | Bounded group; POSIX socket-only script fixture skipped |
| Fresh Pi checkout smoke | 4 successful native tool calls; session closed | Example Domain open, interactive snapshot, URL readback, close; `openai-codex/gpt-6.1-sol`, medium reasoning |
| Additional process + managed-restore suites | **36 passed, 27 failed, 7 skipped**, 27.8 seconds | Diagnostic expansion; **not green** |

The checkout smoke used explicit source loading (`--no-extensions -e .`) and persisted its session. Windows had no tmux, so this was a JSON/print-mode smoke, not interactive tmux dogfood or configured-source reload validation. It neither operated an application nor read a personal browser profile.

The diagnostic expansion remains separate from the passing group. Failures include POSIX ownership/socket fixtures on Windows, HOME-only/missing-key restore fixtures, linked-worktree hidden-file mutation, POSIX snapshot-pruning assumptions, literal argv/native-path expectations, close-code expectations after taskkill, and environment/protected-home assertions. The broader 61-file default gate and release/platform matrix were **not** certified. Do not skip security tests wholesale or weaken ownership/encryption/artifact boundaries to make the suite green; remaining platform fixtures need a separate repair pass.

The previously observed upstream navigation EOF is not repaired by this process-tree fix. Successful ordinary navigation is not a reproduction of that daemon defect. Same-session readback guidance remains the appropriate recovery boundary; no blind duplicate navigation was introduced.

## Reproduce

After `npm run build`:

```sh
npx tsx --test --test-concurrency=1 test/agent-browser.argv-descriptor.test.ts test/agent-browser.extension-errors-artifacts.test.ts test/agent-browser.presentation.test.ts test/agent-browser.script.test.ts test/agent-browser.navigation-transport.test.ts test/agent-browser.wait-timeouts.test.ts test/agent-browser.windows-lifecycle.test.ts
```

Historical diagnostic expansion, then non-green on the tested Windows installation:

```sh
npx tsx --test --test-concurrency=1 test/agent-browser.process.test.ts test/agent-browser.managed-session-restore.test.ts
```

Generated-doc regressions run with `npx tsx --test test/playbook-drift-line-endings.test.ts` and are independent of browser tests.

The native lifecycle tests skip outside Windows; they are not simulated Windows evidence. Reload/restart a running configured Pi session before relying on rebuilt extension code. No package publication or upstream EOF repair is implied.
