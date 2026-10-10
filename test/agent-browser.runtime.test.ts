/**
 * Purpose: Verify pure runtime planning and policy helpers for the pi-agent-browser extension.
 * Responsibilities: Assert session naming/state, execution-plan argument injection, and redaction helpers.
 * Scope: Unit-style Node test-runner coverage for stable helper behavior; extension entrypoint lifecycle tests live in focused integration suites.
 * Usage: Run with `npx tsx --test test/agent-browser.runtime.test.ts` or via `npm run verify`.
 * Invariants/Assumptions: Tests preserve existing assertions and isolate filesystem/env side effects with temp directories and explicit cleanup.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	canonicalizeAgentBrowserNamespace,
	extractRequestedRestoreKey,
	GLOBAL_BOOLEAN_FLAGS_WITH_OPTIONAL_VALUES,
	GLOBAL_VALUE_FLAGS,
	isBooleanFlagEnabled,
} from "../extensions/agent-browser/lib/argv-grammar.js";
import { isRecord, parsePositiveInteger } from "../extensions/agent-browser/lib/parsing.js";
import { getAgentBrowserSocketDir, getAgentBrowserSocketPathValidationError } from "../extensions/agent-browser/lib/process.js";
import {
	buildExecutionPlan,
	canUseHeadlessCompatibilityUserAgent,
	createFreshSessionName,
	createImplicitSessionName,
	getImplicitSessionCloseTimeoutMs,
	getImplicitSessionIdleTimeoutMs,
	parseArgvDescriptor,
	redactInvocationArgs,
	redactSensitiveText,
	redactSensitiveValue,
	resolveManagedSessionState,
	restoreManagedSessionStateFromBranch,
	validateToolArgs,
} from "../extensions/agent-browser/lib/runtime.js";
import { createToolBranchEntry } from "./helpers/agent-browser-harness.js";

test("buildExecutionPlan rejects ambiguous session identity flags without rejecting command text", () => {
	const options = {
		freshSessionName: "piab-fresh",
		managedSessionActive: true,
		managedSessionName: "piab-managed",
		sessionMode: "auto" as const,
	};
	const duplicate = buildExecutionPlan(
		["--session", "piab-managed", "--session", "caller-owned", "open", "https://example.com"],
		options,
	);
	assert.match(duplicate.validationError ?? "", /Multiple --session flags/);
	const duplicateNamespace = buildExecutionPlan(
		["--namespace", "managed", "--namespace", "caller", "open", "https://example.com"],
		options,
	);
	assert.match(duplicateNamespace.validationError ?? "", /Multiple --namespace flags/);
	const afterSentinel = buildExecutionPlan(
		["--session", "piab-managed", "fill", "#field", "--", "--session", "caller-owned"],
		options,
	);
	assert.match(afterSentinel.validationError ?? "", /Multiple --session flags/);
	const launchArgValue = buildExecutionPlan(
		["--session", "piab-managed", "--args", "--session=browser-flag-value", "open", "https://example.com"],
		{ ...options, managedSessionActive: false },
	);
	assert.doesNotMatch(launchArgValue.validationError ?? "", /Multiple --session flags/);
	assert.equal(launchArgValue.sessionName, "piab-managed");
	const commandFlagSmuggle = buildExecutionPlan(
		["wait", "--text", "Dashboard", "--timeout", "--session", "caller-owned", "5000"],
		options,
	);
	assert.equal(commandFlagSmuggle.validationError, undefined);
	assert.equal(commandFlagSmuggle.sessionName, "caller-owned");
	assert.equal(commandFlagSmuggle.usedImplicitSession, false);
	const helpWithUnsupportedEqualsSession = buildExecutionPlan(["--session=caller-owned", "--help"], options);
	assert.equal(helpWithUnsupportedEqualsSession.validationError, undefined);
	assert.deepEqual(helpWithUnsupportedEqualsSession.effectiveArgs, ["--session=caller-owned", "--help"]);
});

test("createImplicitSessionName is stable for a persisted pi session", () => {
	const sessionId = "12345678-1234-5678-9abc-def012345678";
	const cwd = "/Users/example/Projects/pi-agent-browser";
	const one = createImplicitSessionName(sessionId, cwd, "ignored-a", "linux");
	const two = createImplicitSessionName(sessionId, cwd, "ignored-b", "linux");

	assert.equal(one, two);
	assert.match(one, /^piab-pi-agent-browser-[a-f0-9]{12}-[a-f0-9]{8}$/);
});

test("createImplicitSessionName hashes the full Pi session id", () => {
	const cwd = "/Users/example/Projects/pi-agent-browser";
	const one = createImplicitSessionName("019fe81c-92dd-7000-8000-000000000001", cwd, "ignored", "linux");
	const two = createImplicitSessionName("019fe81c-92dd-7000-8000-000000000002", cwd, "ignored", "linux");

	assert.notEqual(one, two);
});

test("createImplicitSessionName includes cwd isolation for same-named checkouts", () => {
	const sessionId = "12345678-1234-5678-9abc-def012345678";
	const one = createImplicitSessionName(sessionId, "/tmp/foo/app", "ignored-a", "linux");
	const two = createImplicitSessionName(sessionId, "/tmp/bar/app", "ignored-b", "linux");

	assert.notEqual(one, two);
	assert.match(one, /^piab-app-[a-f0-9]{12}-[a-f0-9]{8}$/);
	assert.match(two, /^piab-app-[a-f0-9]{12}-[a-f0-9]{8}$/);
});

test("Android managed session names retain full identity entropy within namespaced socket limits", () => {
	const base = createImplicitSessionName("12345678-1234-5678-9abc-def012345678", "/data/data/com.termux/files/home/project", "ignored", "android");
	const fresh = createFreshSessionName(base, "seed", 1);
	const socketDir = getAgentBrowserSocketDir("android", 10_589, "com.termux");

	assert.match(base, /^piab-[a-f0-9]{20}$/);
	assert.equal(
		getAgentBrowserSocketPathValidationError({ args: ["--namespace", "termux", "--session", fresh, "open", "about:blank"], platform: "android", socketDir: String(socketDir) }),
		undefined,
	);
});

test("getAgentBrowserSocketDir uses a short user-specific unix socket directory and skips windows", () => {
	assert.equal(getAgentBrowserSocketDir("darwin", 501), "/private/tmp/piab-501");
	assert.equal(getAgentBrowserSocketDir("linux", 1000), "/tmp/piab-1000");
	assert.equal(getAgentBrowserSocketDir("android", 10_589, "com.termux"), "/data/data/com.termux/piab");
	assert.equal(getAgentBrowserSocketDir("android", 10_589, "../invalid"), "/tmp/piab-10589");
	assert.equal(getAgentBrowserSocketDir("win32", undefined), undefined);
});

test("shared parsing helpers preserve boundary parsing semantics", () => {
	assert.equal(isRecord({}), true);
	assert.equal(isRecord([]), true);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord("object"), false);

	assert.equal(parsePositiveInteger(undefined), undefined);
	assert.equal(parsePositiveInteger("42"), 42);
	assert.equal(parsePositiveInteger(" 42 "), 42);
	assert.equal(parsePositiveInteger("0"), undefined);
	assert.equal(parsePositiveInteger("-1"), undefined);
	assert.equal(parsePositiveInteger("1.5"), undefined);
	assert.equal(parsePositiveInteger("9007199254740992"), undefined);
	assert.equal(canonicalizeAgentBrowserNamespace("Next Dev Loop: /Users/me/worktree!"), "next-dev-loop-users-me-worktree");
	assert.equal(canonicalizeAgentBrowserNamespace(" --Agent__ "), "agent");
	assert.equal(parseArgvDescriptor(["--hide-scrollbars", "open", "https://example.com"]).commandInfo.command, "open");
	assert.equal(parseArgvDescriptor(["--hide-scrollbars", "false", "open", "https://example.com"]).commandInfo.command, "open");
	assert.deepEqual(parseArgvDescriptor(["pdf", "--json", "demo.pdf"]).upstreamCommandTokens, ["pdf", "demo.pdf"]);
	assert.deepEqual(parseArgvDescriptor(["pdf", "--restore", "demo.pdf"]).upstreamCommandTokens, ["pdf", "demo.pdf"]);
	assert.deepEqual(parseArgvDescriptor(["pdf", "--quick", "true", "demo.pdf"]).upstreamCommandTokens, ["pdf", "demo.pdf"]);
	assert.deepEqual(parseArgvDescriptor(["record", "--json", "start", "demo.webm"]).upstreamCommandTokens, ["record", "start", "demo.webm"]);
	assert.deepEqual(parseArgvDescriptor(["pdf", "--restore=key", "demo.pdf"]).upstreamCommandTokens, ["pdf", "demo.pdf"]);
});

test("extractRequestedRestoreKey mirrors optional values and post-command session fallback", () => {
	assert.equal(extractRequestedRestoreKey(["open", "https://example.com"], "managed", "env-key"), "env-key");
	assert.equal(extractRequestedRestoreKey(["open", "https://example.com"], "managed", ""), null);
	assert.equal(extractRequestedRestoreKey(["--restore", "caller-key", "open", "https://example.com"], "managed", undefined), "caller-key");
	assert.equal(extractRequestedRestoreKey(["open", "https://example.com", "--restore=caller-key"], "managed", undefined), "caller-key");
	assert.equal(extractRequestedRestoreKey(["--restore=", "open", "https://example.com"], "managed", undefined), "managed");
	assert.equal(extractRequestedRestoreKey(["--restore", "open", "https://example.com"], "managed", undefined), "managed");
	assert.equal(extractRequestedRestoreKey(["open", "https://example.com", "--restore", "ignored"], "managed", undefined), "managed");
});

test("implicit session timeout helpers prefer explicit overrides and safe defaults", () => {
	assert.equal(
		getImplicitSessionIdleTimeoutMs({
			AGENT_BROWSER_IDLE_TIMEOUT_MS: "2100",
			PI_AGENT_BROWSER_IMPLICIT_SESSION_IDLE_TIMEOUT_MS: "1200",
		}),
		1200,
	);
	assert.equal(getImplicitSessionIdleTimeoutMs({ AGENT_BROWSER_IDLE_TIMEOUT_MS: "2100" }), 2100);
	assert.equal(getImplicitSessionIdleTimeoutMs({ PI_AGENT_BROWSER_IMPLICIT_SESSION_IDLE_TIMEOUT_MS: "invalid" }), 900000);
	assert.equal(getImplicitSessionCloseTimeoutMs({ PI_AGENT_BROWSER_IMPLICIT_SESSION_CLOSE_TIMEOUT_MS: "250" }), 250);
	assert.equal(getImplicitSessionCloseTimeoutMs({ PI_AGENT_BROWSER_IMPLICIT_SESSION_CLOSE_TIMEOUT_MS: "invalid" }), 5_000);
});

test("resolveManagedSessionState only adopts successful managed sessions and identifies replaced sessions", () => {
	assert.deepEqual(
		resolveManagedSessionState({
			command: "open",
			managedSessionName: "piab-demo-123",
			priorActive: false,
			priorSessionName: "piab-demo-123",
			succeeded: false,
		}),
		{ active: false, sessionName: "piab-demo-123" },
	);
	assert.deepEqual(
		resolveManagedSessionState({
			command: "open",
			managedSessionName: "piab-demo-123",
			priorActive: false,
			priorSessionName: "piab-demo-123",
			succeeded: true,
		}),
		{ active: true, sessionName: "piab-demo-123", replacedSessionName: undefined },
	);
	assert.deepEqual(
		resolveManagedSessionState({
			command: "open",
			managedSessionName: "piab-demo-123-fresh",
			priorActive: true,
			priorSessionName: "piab-demo-123",
			succeeded: true,
		}),
		{ active: true, sessionName: "piab-demo-123-fresh", replacedSessionName: "piab-demo-123" },
	);
	assert.deepEqual(
		resolveManagedSessionState({
			command: "close",
			managedSessionName: "piab-demo-123-fresh",
			priorActive: true,
			priorSessionName: "piab-demo-123-fresh",
			succeeded: true,
		}),
		{ active: false, sessionName: "piab-demo-123-fresh" },
	);
	assert.deepEqual(
		resolveManagedSessionState({
			command: "close",
			managedSessionName: "piab-demo-123-fresh",
			managedSessionNamespace: undefined,
			priorActive: true,
			priorNamespace: "review",
			priorSessionName: "piab-demo-123-fresh",
			succeeded: true,
		}),
		{ active: true, namespace: "review", sessionName: "piab-demo-123-fresh" },
	);
	assert.deepEqual(
		resolveManagedSessionState({
			command: "open",
			managedSessionName: "piab-demo-123-fresh",
			managedSessionNamespace: "review",
			priorActive: true,
			priorSessionName: "piab-demo-123",
			succeeded: true,
		}),
		{ active: true, namespace: "review", sessionName: "piab-demo-123-fresh", replacedSessionName: "piab-demo-123" },
	);
});

test("restoreManagedSessionStateFromBranch ignores inspection entries and reconstructs the latest managed session", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["--version"],
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--profile", "Default", "open", "https://example.com/profile"],
					command: "open",
					exitCode: 0,
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["snapshot", "-i"],
					command: "snapshot",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.deepEqual(restored, {
		active: true,
		freshSessionOrdinal: 1,
		managedSessionRestoreDisabledIdentities: [],
		replacedSessionName: undefined,
		sessionName: "piab-demo-123-fresh-aaa",
	});
});

test("restoreManagedSessionStateFromBranch preserves managed session namespace", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["--namespace", "review", "open", "https://example.com"],
					command: "open",
					exitCode: 0,
					namespace: "review",
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["snapshot", "-i"],
					command: "snapshot",
					exitCode: 0,
					namespace: "review",
					sessionMode: "auto",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, true);
	assert.equal(restored.namespace, "review");
	assert.equal(restored.sessionName, "piab-demo-123-fresh-aaa");

	const afterDefaultNamespaceClose = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["--namespace", "review", "open", "https://example.com"],
					command: "open",
					exitCode: 0,
					namespace: "review",
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--session", "piab-demo-123-fresh-aaa", "close"],
					command: "close",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
			}),
		],
		"piab-demo-123",
	);
	assert.equal(afterDefaultNamespaceClose.active, true);
	assert.equal(afterDefaultNamespaceClose.namespace, "review");
});

test("restoreManagedSessionStateFromBranch honors managedSessionOutcome replacement on wrapper-level failures", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["batch"],
					command: "batch",
					managedSessionOutcome: {
						activeAfter: true,
						activeBefore: true,
						attemptedSessionName: "piab-demo-123-fresh-aaa",
						currentSessionName: "piab-demo-123-fresh-aaa",
						previousSessionName: "piab-demo-123",
						replacedSessionName: "piab-demo-123",
						sessionMode: "fresh",
						status: "replaced",
						succeeded: false,
					},
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
				isError: true,
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, true);
	assert.equal(restored.sessionName, "piab-demo-123-fresh-aaa");
	assert.equal(restored.freshSessionOrdinal, 1);
});

test("restoreManagedSessionStateFromBranch honors a nested close outcome after an active row", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["batch"],
					command: "batch",
					managedSessionOutcome: {
						activeAfter: false,
						activeBefore: true,
						attemptedSessionName: "piab-demo-123",
						previousSessionName: "piab-demo-123",
						sessionMode: "auto",
						status: "closed",
						succeeded: true,
					},
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
				isError: true,
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, false);
	assert.equal(restored.closedSessionName, "piab-demo-123");
});

test("restoreManagedSessionStateFromBranch keeps unknown post-close launches active", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["batch"],
					batchSteps: [
						{ command: ["close"], success: true },
						{ command: ["record", "start", "ghost.webm"], success: true },
					],
					command: "batch",
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, true);
	assert.equal(restored.closedSessionName, undefined);
});

test("restoreManagedSessionStateFromBranch preserves a terminal batch close through a non-launching diagnostic", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["batch"],
					batchSteps: [
						{ command: ["close"], success: true },
						{ command: ["stream", "status"], data: { lifecycle: { effectiveLaunch: { browserLaunched: false } } }, success: true },
					],
					command: "batch",
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, false);
	assert.equal(restored.closedSessionName, "piab-demo-123");
});

test("restoreManagedSessionStateFromBranch keeps a lifecycle-proven post-close record stop active", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["batch"],
					batchSteps: [
						{ command: ["close"], success: true },
						{ command: ["record", "stop"], data: { lifecycle: { effectiveLaunch: { browserLaunched: true } } }, success: true },
					],
					command: "batch",
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, true);
	assert.equal(restored.sessionName, "piab-demo-123");
	assert.equal(restored.closedSessionName, undefined);
});

test("restoreManagedSessionStateFromBranch keeps a first-call failed post-close launch active", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["batch"],
					batchSteps: [
						{ command: ["close"], success: true },
						{ command: ["click", "#missing"], success: false },
					],
					command: "batch",
					managedSessionOutcome: {
						activeAfter: false,
						activeBefore: false,
						attemptedSessionName: "piab-demo-123",
						status: "abandoned",
						succeeded: false,
					},
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
				isError: true,
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, true);
	assert.equal(restored.sessionName, "piab-demo-123");
	assert.equal(restored.closedSessionName, undefined);
});

test("restoreManagedSessionStateFromBranch applies close --all to the active namespace", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--session", "caller-owned", "close", "--all"],
					closeAllApplied: true,
					command: "close",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "caller-owned",
					usedImplicitSession: false,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, false);
	assert.equal(restored.closedSessionName, "piab-demo-123");
});

test("restoreManagedSessionStateFromBranch ignores stale base completions after fresh rotation", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--profile", "Default", "open", "https://example.com/fresh"],
					command: "open",
					exitCode: 0,
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/stale-base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, true);
	assert.equal(restored.sessionName, "piab-demo-123-fresh-aaa");
	assert.equal(restored.freshSessionOrdinal, 1);
});

test("restoreManagedSessionStateFromBranch ignores stale earlier fresh completions after newer fresh rotation", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["--profile", "Default", "open", "https://example.com/first-fresh"],
					command: "open",
					exitCode: 0,
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--profile", "Work", "open", "https://example.com/second-fresh"],
					command: "open",
					exitCode: 0,
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-bbb",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["snapshot", "-i"],
					command: "snapshot",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, true);
	assert.equal(restored.sessionName, "piab-demo-123-fresh-bbb");
	assert.equal(restored.freshSessionOrdinal, 2);
});

test("restoreManagedSessionStateFromBranch ignores stale close entries for superseded managed sessions", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--profile", "Default", "open", "https://example.com/fresh"],
					command: "open",
					exitCode: 0,
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["close"],
					command: "close",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, true);
	assert.equal(restored.sessionName, "piab-demo-123-fresh-aaa");
	assert.equal(restored.freshSessionOrdinal, 1);
});

test("restoreManagedSessionStateFromBranch treats upstream close aliases as managed-session closes", () => {
	for (const command of ["quit", "exit"] as const) {
		const restored = restoreManagedSessionStateFromBranch(
			[
				createToolBranchEntry({
					details: {
						args: ["open", "https://example.com/base"],
						command: "open",
						exitCode: 0,
						sessionMode: "auto",
						sessionName: "piab-demo-123",
						usedImplicitSession: true,
					},
				}),
				createToolBranchEntry({
					details: {
						args: [command],
						command,
						exitCode: 0,
						sessionMode: "auto",
						sessionName: "piab-demo-123",
						usedImplicitSession: true,
					},
				}),
			],
			"piab-demo-123",
		);

		assert.equal(restored.active, false, command);
		assert.equal(restored.sessionName, "piab-demo-123", command);
		assert.equal(restored.closedSessionName, "piab-demo-123", command);
	}
});

test("restoreManagedSessionStateFromBranch honors explicit close rows for restorable sessions", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--session", "piab-demo-123", "close"],
					command: "close",
					exitCode: 0,
					managedSessionOutcome: {
						activeAfter: false,
						activeBefore: true,
						attemptedSessionName: "piab-demo-123",
						currentSessionName: "piab-demo-123-fresh-next",
						previousSessionName: "piab-demo-123",
						sessionMode: "auto",
						status: "closed",
						succeeded: true,
						summary: "Managed session piab-demo-123 was closed.",
					},
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: false,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, false);
	assert.equal(restored.sessionName, "piab-demo-123");
	assert.equal(restored.closedSessionName, "piab-demo-123");
});

test("restoreManagedSessionStateFromBranch reserves auto-used generated fresh names after explicit closes", () => {
	const baseSessionName = "piab-demo-123";
	const firstFreshSessionName = createFreshSessionName(baseSessionName, "seed", 1);
	const secondFreshSessionName = createFreshSessionName(baseSessionName, "seed", 2);
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: baseSessionName,
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--session", baseSessionName, "close"],
					command: "close",
					exitCode: 0,
					managedSessionOutcome: {
						activeAfter: false,
						activeBefore: true,
						attemptedSessionName: baseSessionName,
						currentSessionName: firstFreshSessionName,
						previousSessionName: baseSessionName,
						sessionMode: "auto",
						status: "closed",
						succeeded: true,
						summary: `Managed session ${baseSessionName} was closed.`,
					},
					sessionMode: "auto",
					sessionName: baseSessionName,
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["get", "url"],
					command: "get",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: firstFreshSessionName,
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--session", firstFreshSessionName, "close"],
					command: "close",
					exitCode: 0,
					managedSessionOutcome: {
						activeAfter: false,
						activeBefore: true,
						attemptedSessionName: firstFreshSessionName,
						currentSessionName: secondFreshSessionName,
						previousSessionName: firstFreshSessionName,
						sessionMode: "auto",
						status: "closed",
						succeeded: true,
						summary: `Managed session ${firstFreshSessionName} was closed.`,
					},
					sessionMode: "auto",
					sessionName: firstFreshSessionName,
					usedImplicitSession: false,
				},
			}),
		],
		baseSessionName,
	);

	assert.equal(restored.active, false);
	assert.equal(restored.sessionName, firstFreshSessionName);
	assert.equal(restored.closedSessionName, firstFreshSessionName);
	assert.equal(restored.freshSessionOrdinal, 1);
});

test("restoreManagedSessionStateFromBranch honors namespaced Electron cleanup managed-session steps", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["connect", "9222"],
					command: "connect",
					exitCode: 0,
					managedSessionOutcome: {
						activeAfter: true,
						activeBefore: false,
						attemptedSessionName: "piab-demo-123-fresh-electron",
						currentSessionName: "piab-demo-123-fresh-electron",
						previousSessionName: "piab-demo-123",
						sessionMode: "fresh",
						status: "created",
						succeeded: true,
						summary: "Managed session piab-demo-123-fresh-electron is now current.",
					},
					namespace: "team",
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-electron",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: [],
					electron: {
						action: "cleanup",
						cleanup: {
							partial: true,
							results: [{
								launchId: "electron-demo",
								partial: true,
								record: { cleanupState: "partial", launchId: "electron-demo", namespace: "record-fallback", port: 9222, version: 1 },
								remainingResources: ["process"],
								steps: [
									{ namespace: "team", resource: "managed-session", sessionName: "piab-demo-123-fresh-electron", state: "removed" },
									{ resource: "process", state: "failed" },
								],
								summary: "Electron cleanup was partial.",
							}],
						},
					},
					resultCategory: "failure",
				},
				isError: true,
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, false);
	assert.equal(restored.sessionName, "piab-demo-123-fresh-electron");
	assert.equal(restored.closedSessionName, "piab-demo-123-fresh-electron");
	assert.equal(restored.freshSessionOrdinal, 1);
});

test("restoreManagedSessionStateFromBranch does not resurrect superseded sessions after latest session closes", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["--profile", "Default", "open", "https://example.com/fresh"],
					command: "open",
					exitCode: 0,
					sessionMode: "fresh",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: false,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["close"],
					command: "close",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123-fresh-aaa",
					usedImplicitSession: true,
				},
			}),
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com/stale-base"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-demo-123",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.equal(restored.active, false);
	assert.equal(restored.sessionName, "piab-demo-123-fresh-aaa");
	assert.equal(restored.freshSessionOrdinal, 1);
});

test("restoreManagedSessionStateFromBranch keeps cwd isolation by ignoring sessions from a different base name", () => {
	const restored = restoreManagedSessionStateFromBranch(
		[
			createToolBranchEntry({
				details: {
					args: ["open", "https://example.com"],
					command: "open",
					exitCode: 0,
					sessionMode: "auto",
					sessionName: "piab-other-checkout-123456781234-abcd1234",
					usedImplicitSession: true,
				},
			}),
		],
		"piab-demo-123",
	);

	assert.deepEqual(restored, {
		active: false,
		freshSessionOrdinal: 0,
		managedSessionRestoreDisabledIdentities: [],
		sessionName: "piab-demo-123",
	});
});

test("buildExecutionPlan injects --json and the implicit session when needed", () => {
	const plan = buildExecutionPlan(["open", "https://example.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});

	assert.deepEqual(plan.effectiveArgs, ["--json", "--session", "piab-demo-123", "open", "https://example.com"]);
	assert.equal(plan.managedSessionName, "piab-demo-123");
	assert.equal(plan.sessionName, "piab-demo-123");
	assert.equal(plan.usedImplicitSession, true);
	assert.equal(plan.validationError, undefined);

	const namespaced = buildExecutionPlan(["--namespace", "Review Team!", "open", "https://example.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.deepEqual(namespaced.effectiveArgs, ["--json", "--namespace", "review-team", "--session", "piab-demo-123", "open", "https://example.com"]);
	assert.equal(namespaced.namespace, "review-team");
});

test("buildExecutionPlan treats upstream close aliases as managed-session closes", () => {
	for (const command of ["close", "quit", "exit"] as const) {
		const plan = buildExecutionPlan([command], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		assert.deepEqual(plan.effectiveArgs, ["--json", "--session", "piab-demo-123", command], command);
		assert.equal(plan.managedSessionName, "piab-demo-123", command);
		assert.equal(plan.sessionName, "piab-demo-123", command);
		assert.equal(plan.usedImplicitSession, true, command);
	}
});

test("buildExecutionPlan respects explicit upstream sessions", () => {
	const plan = buildExecutionPlan(["--session", "custom", "snapshot", "-i"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});

	assert.deepEqual(plan.effectiveArgs, ["--json", "--session", "custom", "snapshot", "-i"]);
	assert.equal(plan.managedSessionName, undefined);
	assert.equal(plan.sessionName, "custom");
	assert.equal(plan.usedImplicitSession, false);

	const namespaced = buildExecutionPlan(["--session", "custom", "--namespace", "review", "snapshot", "-i"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.deepEqual(namespaced.effectiveArgs, ["--json", "--namespace", "review", "--session", "custom", "snapshot", "-i"]);
	assert.equal(namespaced.sessionName, "custom");
	assert.equal(namespaced.namespace, "review");

	const defaultNamespace = buildExecutionPlan(["--namespace", "", "--session", "custom", "close"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		managedSessionNamespace: "prod",
		sessionMode: "auto",
	});
	assert.deepEqual(defaultNamespace.effectiveArgs, ["--json", "--namespace", "", "--session", "custom", "close"]);
	assert.equal(defaultNamespace.namespace, "");

	const sameNamespace = buildExecutionPlan(["--namespace", "Review", "snapshot", "-i"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		managedSessionNamespace: "review",
		sessionMode: "auto",
	});
	assert.deepEqual(sameNamespace.effectiveArgs, ["--json", "--namespace", "review", "--session", "piab-demo-123", "snapshot", "-i"]);
	assert.equal(sameNamespace.validationError, undefined);
});

test("buildExecutionPlan resolves caller-owned session namespaces from argv before environment", () => {
	const previousNamespace = process.env.AGENT_BROWSER_NAMESPACE;
	try {
		process.env.AGENT_BROWSER_NAMESPACE = "Review Space";
		const inherited = buildExecutionPlan(["--session", "custom", "snapshot", "-i"], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});
		assert.equal(inherited.namespace, "review-space");
		const explicitDefault = buildExecutionPlan(["--namespace", "", "--session", "custom", "snapshot", "-i"], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});
		assert.equal(explicitDefault.namespace, "");
		const wrapperManaged = buildExecutionPlan(["--session", "piab-demo-123", "close"], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});
		assert.equal(wrapperManaged.namespace, undefined);
		const callerPrefixed = buildExecutionPlan(["--session", "piab-caller-owned", "snapshot", "-i"], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});
		assert.equal(callerPrefixed.namespace, "review-space");
		const wrapperExplicitDefault = buildExecutionPlan(["--namespace", "", "--session", "piab-demo-123", "close"], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});
		assert.deepEqual(wrapperExplicitDefault.effectiveArgs, ["--json", "--namespace", "", "--session", "piab-demo-123", "close"]);
		assert.equal(wrapperExplicitDefault.namespace, "");
	} finally {
		if (previousNamespace === undefined) delete process.env.AGENT_BROWSER_NAMESPACE;
		else process.env.AGENT_BROWSER_NAMESPACE = previousNamespace;
	}
});

test("buildExecutionPlan preserves stored namespace for implicit managed sessions", () => {
	const plan = buildExecutionPlan(["snapshot", "-i"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123-fresh-aaa",
		managedSessionNamespace: "Review",
		sessionMode: "auto",
	});

	assert.deepEqual(plan.effectiveArgs, ["--json", "--namespace", "review", "--session", "piab-demo-123-fresh-aaa", "snapshot", "-i"]);
	assert.equal(plan.namespace, "review");
	assert.equal(plan.managedSessionName, "piab-demo-123-fresh-aaa");
	assert.equal(plan.sessionName, "piab-demo-123-fresh-aaa");
	assert.equal(plan.usedImplicitSession, true);
});

test("buildExecutionPlan keeps inspection commands stateless", () => {
	for (const args of [["--version"], ["--help"], ["snapshot", "--help"]] as const) {
		const plan = buildExecutionPlan([...args], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		assert.equal(plan.plainTextInspection, true);
		assert.deepEqual(plan.effectiveArgs, [...args]);
		assert.equal(plan.managedSessionName, undefined);
		assert.equal(plan.sessionName, undefined);
		assert.equal(plan.usedImplicitSession, false);
		assert.equal(plan.validationError, undefined);
	}
});

test("buildExecutionPlan keeps sessionless commands free of implicit managed sessions while preserving JSON output", () => {
	for (const args of [
		["skills", "list"],
		["skills", "get", "core", "--full"],
		["skills", "path", "core"],
		["profiles"],
		["auth", "save", "demo", "--url", "https://example.test", "--username", "user"],
		["auth", "list"],
		["auth", "list", "--json"],
		["auth", "show", "demo"],
		["auth", "delete", "demo"],
		["auth", "remove", "demo"],
		["dashboard"],
		["dashboard", "--allowed-origins", "https://dashboard.example.com"],
		["dashboard", "start", "--port", "4848", "--allowed-origins", "https://dashboard.example.com"],
		["device", "list"],
		["dashboard", "stop"],
		["dashboard", "stop", "--json"],
		["doctor", "--offline", "--quick"],
		["doctor", "--webgpu"],
		["doctor", "--webgpu", "--headed"],
		["install", "--with-deps"],
		["install", "-d"],
		["upgrade"],
		["profiles", "--json"],
		["session", "id"],
		["session", "id", "--scope", "worktree", "--prefix", "demo"],
		["session", "id", "--json"],
		["session", "info"],
		["session", "info", "--json"],
		["--namespace", "review", "session", "info"],
		["session", "info", "--namespace", "review"],
		["session", "list"],
		["session", "list", "--json"],
		["state", "list"],
		["state", "list", "--json"],
		["state", "show", "auth.json"],
		["state", "clear", "--all"],
		["state", "clear", "-a"],
		["state", "clear", "piab-demo-123"],
		["state", "clean", "--older-than", "7"],
		["state", "rename", "old", "new"],
		["plugin"],
		["plugin", "list"],
		["plugin", "show", "vault"],
		["plugin", "add", "agent-browser-plugin-vault"],
		["plugin", "run", "captcha", "captcha.solve"],
	] as const) {
		const callerArgs = [...args];
		const plan = buildExecutionPlan(callerArgs, {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		const expectedEffectiveArgs = callerArgs.includes("--json") ? callerArgs : ["--json", ...callerArgs];

		assert.equal(plan.plainTextInspection, false);
		assert.deepEqual(plan.effectiveArgs, expectedEffectiveArgs);
		assert.equal(plan.managedSessionName, undefined);
		assert.equal(plan.sessionName, undefined);
		assert.equal(plan.usedImplicitSession, false);
		assert.equal(plan.validationError, undefined);
	}
});

test("validateToolArgs rejects one-shot mcp server calls but preserves --help/-h", () => {
	assert.match(validateToolArgs(["mcp"]) ?? "", /stdio MCP server/);
	assert.match(validateToolArgs(["mcp", "--tools", "core,network"]) ?? "", /external MCP clients/);
	assert.equal(validateToolArgs(["mcp", "--help"]), undefined);
	assert.equal(validateToolArgs(["mcp", "-h"]), undefined);
	assert.match(validateToolArgs(["mcp", "help"]) ?? "", /external MCP clients/);
});

test("buildExecutionPlan still injects managed sessions for browser-backed state and auth commands", () => {
	for (const args of [["state", "save", "./auth.json"], ["state", "load", "./auth.json"], ["auth", "login", "demo"]] as const) {
		const plan = buildExecutionPlan([...args], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		assert.deepEqual(plan.effectiveArgs, ["--json", "--session", "piab-demo-123", ...args]);
		assert.equal(plan.usedImplicitSession, true);
		assert.equal(plan.managedSessionName, "piab-demo-123");
	}
});

test("buildExecutionPlan limits sessionless allowlists to documented subcommands", () => {
	for (const args of [
		["skills", "future-mutating-subcommand"],
		["auth", "future", "demo"],
		["dashboard", "future"],
		["device", "future"],
		["doctor", "future"],
		["install", "future"],
		["profiles", "future"],
		["session"],
		["state", "clear"],
		["state", "clean"],
		["state", "future"],
		["upgrade", "future"],
		["plugin", "future"],
	] as const) {
		const plan = buildExecutionPlan([...args], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		assert.deepEqual(plan.effectiveArgs, ["--json", "--session", "piab-demo-123", ...args], args.join(" "));
		assert.equal(plan.usedImplicitSession, true, args.join(" "));
	}
});

test("buildExecutionPlan rejects unsupported global equals assignments except restore", () => {
	const options = {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto" as const,
	};
	for (const flag of [...GLOBAL_VALUE_FLAGS, ...GLOBAL_BOOLEAN_FLAGS_WITH_OPTIONAL_VALUES]) {
		const args = [`${flag}=demo`, "open", "https://example.com"];
		const plan = buildExecutionPlan(args, options);
		assert.equal(plan.validationError?.includes(`does not support \`${flag}=<value>\``), true, args.join(" "));
		assert.deepEqual(plan.commandInfo, {}, args.join(" "));
		assert.deepEqual(plan.startupScopedFlags, [], args.join(" "));
	}

	const restore = buildExecutionPlan(["open", "https://example.com", "--restore=auth"], options);
	assert.equal(restore.validationError, undefined);
	assert.equal(restore.effectiveArgs.includes("--restore=auth"), true);
});

test("validateToolArgs applies global equals exceptions only at top level", () => {
	assert.equal(validateToolArgs(["--user-agent", "TARS", "batch"]), undefined);
	assert.match(
		validateToolArgs(["screenshot", "page.png", "--user-agent=TARS", "--help"], { batchStep: true }) ?? "",
		/Move `--user-agent` and its value before `batch` as separate top-level args/,
	);
	assert.match(
		validateToolArgs(["screenshot", "page.png", "--restore=auth"], { batchStep: true }) ?? "",
		/`--restore=<key>` belongs before `batch` in top-level args/,
	);
});

test("buildExecutionPlan rejects missing values for global value-taking flags before launching upstream", () => {
	for (const args of [["--session"], ["--namespace"], ["--args", ""], ["--allowed-domains"], ["--ca-cert"], ["--profile"], ["--executable-path"], ["--session-name"], ["--restore-save"], ["--restore-check-url"], ["--restore-check-text"], ["--restore-check-fn"], ["--cdp"], ["--state"], ["--init-script"], ["--enable"], ["--download-path"], ["--model"], ["--idle-timeout"], ["open", "https://example.com", "--profile"]] as const) {
		const plan = buildExecutionPlan([...args], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: false,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		const expectedFlag = [...args].reverse().find((token) => token.startsWith("-"));
		assert.match(plan.validationError ?? "", /requires a value/i);
		assert.equal(plan.invalidValueFlag?.flag, expectedFlag);
		assert.equal(plan.invalidValueFlag?.reason, "missing-value");
		assert.deepEqual(plan.commandInfo, {});
		assert.equal(plan.sessionName, undefined);
		assert.equal(plan.usedImplicitSession, false);
	}
});

test("buildExecutionPlan leaves command-scoped flags and literal text to upstream parsing", () => {
	for (const args of [
		["find", "role", "button", "click", "--name"],
		["network", "route", "**/*.js", "--resource-type"],
		["cookies", "set", "--curl"],
		["wait", "--load"],
		["dashboard", "start", "--port"],
		["auth", "save", "demo", "--password"],
		["fill", "#password", "--password"],
		["keyboard", "type", "--text"],
	] as const) {
		const plan = buildExecutionPlan([...args], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: false,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		assert.equal(plan.validationError, undefined, args.join(" "));
	}
});

test("validateToolArgs rejects press/key commands with selector-like extra args", () => {
	for (const args of [
		["press", "@e1", "Enter"],
		["key", "#todo", "Return"],
		["keydown", "@e1", "Enter"],
		["keyup"],
	] as const) {
		assert.match(validateToolArgs([...args]) ?? "", /accepts exactly one key argument/, args.join(" "));
	}
	assert.equal(validateToolArgs(["press", "Enter"]), undefined);
	assert.equal(validateToolArgs(["key", "Escape"]), undefined);
});

test("buildExecutionPlan rejects value-taking flags followed by another flag", () => {
	const plan = buildExecutionPlan(["--session", "--profile", "Default", "open", "https://example.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});

	assert.match(plan.validationError ?? "", /received `--profile`/i);
	assert.equal(plan.invalidValueFlag?.flag, "--session");
	assert.equal(plan.invalidValueFlag?.reason, "unexpected-flag");
	assert.equal(plan.invalidValueFlag?.receivedToken, "--profile");
	assert.deepEqual(plan.commandInfo, {});
	assert.equal(plan.usedImplicitSession, false);
});

test("buildExecutionPlan allows optional wait download path to be omitted", () => {
	const plan = buildExecutionPlan(["wait", "--download", "--timeout", "25000"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});

	assert.equal(plan.validationError, undefined);
	assert.deepEqual(plan.commandInfo, { command: "wait", subcommand: "--download" });
	assert.deepEqual(plan.effectiveArgs.slice(-4), ["wait", "--download", "--timeout", "25000"]);

	const shortPlan = buildExecutionPlan(["wait", "-d", "report.csv"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(shortPlan.validationError, undefined);
	assert.deepEqual(shortPlan.commandInfo, { command: "wait", subcommand: "-d" });
	assert.deepEqual(parseArgvDescriptor(["wait", "--timeout", "30000", "-d", "report.csv"]).commandInfo, { command: "wait", subcommand: "-d" });
	assert.deepEqual(parseArgvDescriptor(["wait", "--timeout", "1", "--timeout", "--download", "report.csv"]).commandInfo, { command: "wait", subcommand: "--download" });
	assert.deepEqual(parseArgvDescriptor(["wait", "--download", "report.csv", "--url", "**/done"]).commandInfo, { command: "wait", subcommand: "--url" });
	assert.deepEqual(parseArgvDescriptor(["wait", "-d", "report.csv", "-t", "Ready"]).commandInfo, { command: "wait", subcommand: "-t" });

	assert.match(validateToolArgs(["wait", "--download=report.csv"]) ?? "", /does not support `wait --download=<path>`/);
});

test("buildExecutionPlan parses restore and namespace globals before command discovery", () => {
	for (const { args, command, subcommand } of [
		{ args: ["--namespace", "review", "session", "info"], command: "session", subcommand: "info" },
		{ args: ["--session", "work", "--restore", "open", "https://example.com"], command: "open", subcommand: "https://example.com" },
		{ args: ["--session", "work", "--restore", "authstate", "open", "https://example.com"], command: "open", subcommand: "https://example.com" },
		{ args: ["--restore=auth", "open", "https://example.com"], command: "open", subcommand: "https://example.com" },
		{ args: ["--restore", "snapshot", "-i"], command: "snapshot", subcommand: "-i" },
		{ args: ["--restore", "wait", "--url", "**/dashboard"], command: "wait", subcommand: "--url" },
		{ args: ["--restore-save", "never", "open", "https://example.com"], command: "open", subcommand: "https://example.com" },
	] as const) {
		const descriptor = parseArgvDescriptor([...args]);
		assert.equal(descriptor.commandInfo.command, command, args.join(" "));
		assert.equal(descriptor.commandInfo.subcommand, subcommand, args.join(" "));
	}
});

test("buildExecutionPlan only relocates namespace occurrences recognized by upstream global parsing", () => {
	const plan = buildExecutionPlan([
		"--session", "caller",
		"--args", "--namespace",
		"--namespace", "team",
		"open", "https://example.com",
	], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});

	assert.equal(plan.validationError, undefined);
	assert.equal(plan.namespace, "team");
	assert.deepEqual(plan.effectiveArgs, [
		"--json", "--namespace", "team",
		"--session", "caller",
		"--args", "--namespace",
		"open", "https://example.com",
	]);
});

test("buildExecutionPlan allows dash-starting --args values", () => {
	const plan = buildExecutionPlan(["--args", "--disable-gpu,--lang=en-US", "open", "https://example.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});

	assert.equal(plan.validationError, undefined);
	assert.deepEqual(plan.commandInfo, { command: "open", subcommand: "https://example.com" });
	assert.deepEqual(plan.effectiveArgs.slice(-4), ["--args", "--disable-gpu,--lang=en-US", "open", "https://example.com"]);
});

test("buildExecutionPlan blocks startup-scoped flags from silently reusing an active implicit session", () => {
	for (const { args, flag } of [
		{ args: ["--profile", "Default", "open", "https://example.com"], flag: "--profile" },
		{ args: ["--allowed-domains", "example.com", "open", "https://example.com"], flag: "--allowed-domains" },
		{ args: ["--executable-path", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "open", "https://example.com"], flag: "--executable-path" },
		{ args: ["--namespace", "review", "open", "https://example.com"], flag: "--namespace" },
		{ args: ["--session-name", "saved-auth", "open", "https://example.com"], flag: "--session-name" },
		{ args: ["--restore", "open", "https://example.com"], flag: "--restore" },
		{ args: ["--restore=auth", "open", "https://example.com"], flag: "--restore" },
		{ args: ["--restore-save", "never", "open", "https://example.com"], flag: "--restore-save" },
		{ args: ["--restore-check-url", "**/dashboard", "open", "https://example.com"], flag: "--restore-check-url" },
		{ args: ["--restore-check-text", "Dashboard", "open", "https://example.com"], flag: "--restore-check-text" },
		{ args: ["--restore-check-fn", "!!localStorage.length", "open", "https://example.com"], flag: "--restore-check-fn" },
		{ args: ["--cdp", "ws://127.0.0.1:9222/devtools/browser/demo", "open", "https://example.com"], flag: "--cdp" },
		{ args: ["--ca-cert", "/tmp/proxy-ca.pem", "open", "https://example.com"], flag: "--ca-cert" },
		{ args: ["--no-ca-cert", "open", "https://example.com"], flag: "--no-ca-cert" },
		{ args: ["--state", "/tmp/auth.json", "open", "https://example.com"], flag: "--state" },
		{ args: ["--auto-connect", "open", "https://example.com"], flag: "--auto-connect" },
		{ args: ["--auto-connect", "true", "open", "https://example.com"], flag: "--auto-connect" },
		{ args: ["--webgpu", "open", "https://example.com"], flag: "--webgpu" },
		{ args: ["--webgpu", "false", "open", "https://example.com"], flag: "--webgpu" },
		{ args: ["--no-webmcp", "open", "https://example.com"], flag: "--no-webmcp" },
		{ args: ["--no-webmcp", "false", "open", "https://example.com"], flag: "--no-webmcp" },
		{ args: ["open", "--enable", "react-devtools", "https://example.com"], flag: "--enable" },
		{ args: ["open", "--init-script", "/tmp/setup.js", "https://example.com"], flag: "--init-script" },
		{ args: ["--idle-timeout", "5000", "open", "https://example.com"], flag: "--idle-timeout" },
		{ args: ["--args", "--disable-gpu", "open", "https://example.com"], flag: "--args" },
		{ args: ["--user-agent", "Custom/1", "open", "https://example.com"], flag: "--user-agent" },
		{ args: ["--headed", "open", "https://example.com"], flag: "--headed" },
		{ args: ["--headed", "false", "open", "https://example.com"], flag: "--headed" },
	] as const) {
		const plan = buildExecutionPlan([...args], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		assert.match(plan.validationError ?? "", /launch-scoped flags/i);
		assert.equal(plan.startupScopedFlags.length, 1);
		assert.equal(plan.startupScopedFlags[0], flag);
		assert.equal(plan.usedImplicitSession, false);
		assert.equal(plan.recoveryHint?.recommendedSessionMode, "fresh");
		assert.deepEqual(plan.recoveryHint?.exampleParams, { args: [...args], sessionMode: "fresh" });
	}
});

test("buildExecutionPlan treats wait --state as command-scoped after the command", () => {
	const plan = buildExecutionPlan(["wait", "@button", "--state", "hidden"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});

	assert.equal(plan.validationError, undefined);
	assert.deepEqual(plan.startupScopedFlags, []);
	assert.deepEqual(plan.commandInfo, { command: "wait", subcommand: "@button" });
	assert.equal(plan.usedImplicitSession, true);
	assert.deepEqual(plan.effectiveArgs.slice(-4), ["wait", "@button", "--state", "hidden"]);
});

test("buildExecutionPlan only treats the last exact lowercase auto-connect false as disabled", () => {
	assert.equal(isBooleanFlagEnabled(["--args", "--auto-connect", "open", "https://example.com"], "--auto-connect"), false);
	const plan = buildExecutionPlan(["--auto-connect", "false", "open", "https://example.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});

	assert.equal(plan.validationError, undefined);
	assert.deepEqual(plan.startupScopedFlags, []);
	assert.equal(plan.usedImplicitSession, true);
	assert.deepEqual(plan.commandInfo, { command: "open", subcommand: "https://example.com" });

	const uppercaseFalse = buildExecutionPlan(["--auto-connect", "FALSE", "open", "https://example.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.match(uppercaseFalse.validationError ?? "", /launch-scoped flags.*--auto-connect/i);

	const lastEnabled = buildExecutionPlan(["--auto-connect", "false", "--auto-connect", "open", "https://example.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.match(lastEnabled.validationError ?? "", /launch-scoped flags.*--auto-connect/i);

	const lastDisabled = buildExecutionPlan(["--auto-connect", "--auto-connect", "false", "open", "https://example.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(lastDisabled.validationError, undefined);
	assert.deepEqual(lastDisabled.startupScopedFlags, []);
});

test("buildExecutionPlan treats pin-tab as a sticky global boolean, not launch-scoped", () => {
	const options = {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto" as const,
	};
	for (const args of [
		["--pin-tab", "open", "https://example.com"],
		["--pin-tab", "true", "open", "https://example.com"],
		["--pin-tab", "false", "open", "https://example.com"],
		["--no-pin-tab", "open", "https://example.com"],
		["--no-pin-tab", "false", "open", "https://example.com"],
	] as const) {
		const plan = buildExecutionPlan([...args], options);
		assert.equal(plan.validationError, undefined, args.join(" "));
		assert.deepEqual(plan.startupScopedFlags, [], args.join(" "));
		assert.equal(plan.usedImplicitSession, true, args.join(" "));
		assert.deepEqual(plan.commandInfo, { command: "open", subcommand: "https://example.com" }, args.join(" "));
	}
});

test("buildExecutionPlan treats provider and iOS device flags as launch-scoped", () => {
	for (const args of [
		["-p", "ios", "open", "https://example.com"],
		["--provider", "browserbase", "open", "https://example.com"],
		["-p", "ios", "--device", "iPhone 15 Pro", "open", "https://example.com"],
	] as const) {
		const plan = buildExecutionPlan([...args], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: true,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});

		assert.match(plan.validationError ?? "", /launch-scoped flags/i, args.join(" "));
		assert.equal(plan.recoveryHint?.recommendedSessionMode, "fresh", args.join(" "));
	}
});

test("buildExecutionPlan assigns a new managed session for fresh session mode", () => {
	const args = ["--namespace", "review", "--profile", "Default", "open", "https://example.com/profile"];
	const freshSessionName = createFreshSessionName("piab-demo-123", "seed", 1);
	const plan = buildExecutionPlan(args, {
		freshSessionName,
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "fresh",
	});

	assert.equal(plan.validationError, undefined);
	assert.equal(plan.usedImplicitSession, false);
	assert.equal(plan.managedSessionName, freshSessionName);
	assert.deepEqual(plan.effectiveArgs, ["--json", "--namespace", "review", "--session", freshSessionName, "--profile", "Default", "open", "https://example.com/profile"]);
	assert.equal(plan.namespace, "review");
	assert.equal(plan.recoveryHint, undefined);
});

test("buildExecutionPlan injects and retains site-specific headless compatibility user agents", () => {
	for (const [targetUrl, expectedId] of [
		["https://chat.com", "chatgpt-headless-user-agent"],
		["https://chatgpt.com", "chatgpt-headless-user-agent"],
		["https://dash.cloudflare.com", "cloudflare-headless-user-agent"],
	] as const) {
		const plan = buildExecutionPlan(["--profile", "Default", "open", targetUrl], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: false,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});
		assert.equal(plan.compatibilityWorkaround?.id, expectedId);
		const userAgentFlagIndex = plan.effectiveArgs.indexOf("--user-agent");
		assert.ok(userAgentFlagIndex >= 0);
		assert.match(plan.effectiveArgs[userAgentFlagIndex + 1] ?? "", /Chrome\/146\.0\.0\.0/);
		assert.doesNotMatch(plan.effectiveArgs[userAgentFlagIndex + 1] ?? "", /HeadlessChrome/);
	}

	const cloudflarePlan = buildExecutionPlan(["open", "https://dash.cloudflare.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	const cloudflareFollowup = buildExecutionPlan(["snapshot", "-i"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionCompatibilityWorkaround: cloudflarePlan.compatibilityWorkaround,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(cloudflareFollowup.compatibilityWorkaround?.id, "cloudflare-headless-user-agent");
	assert.equal(cloudflareFollowup.effectiveArgs.filter((token) => token === "--user-agent").length, 0);

	const explicitCloudflareFollowup = buildExecutionPlan(["--session", "piab-demo-123", "snapshot", "-i"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionCompatibilityWorkaround: cloudflarePlan.compatibilityWorkaround,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(explicitCloudflareFollowup.compatibilityWorkaround?.id, "cloudflare-headless-user-agent");
	assert.equal(explicitCloudflareFollowup.effectiveArgs.filter((token) => token === "--user-agent").length, 0);

	const explicitUserAgentFollowup = buildExecutionPlan(["--session", "piab-demo-123", "--user-agent", "Custom/1", "snapshot", "-i"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionCompatibilityWorkaround: cloudflarePlan.compatibilityWorkaround,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(explicitUserAgentFollowup.compatibilityWorkaround, undefined);
	assert.match(explicitUserAgentFollowup.validationError ?? "", /launch-scoped flags.*--user-agent/i);
	assert.deepEqual(explicitUserAgentFollowup.recoveryHint?.exampleParams, {
		args: ["--user-agent", "Custom/1", "snapshot", "-i"],
		sessionMode: "fresh",
	});
	assert.equal(explicitUserAgentFollowup.effectiveArgs.filter((token) => token === "--user-agent").length, 1);
	const explicitUserAgentRetry = buildExecutionPlan(explicitUserAgentFollowup.recoveryHint?.exampleArgs ?? [], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 2),
		managedSessionActive: true,
		managedSessionCompatibilityWorkaround: cloudflarePlan.compatibilityWorkaround,
		managedSessionName: "piab-demo-123",
		sessionMode: "fresh",
	});
	assert.equal(explicitUserAgentRetry.validationError, undefined);
	assert.equal(explicitUserAgentRetry.managedSessionName, createFreshSessionName("piab-demo-123", "seed", 2));

	const compatibilityUpgrade = buildExecutionPlan(["open", "https://dash.cloudflare.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.match(compatibilityUpgrade.validationError ?? "", /fresh.*compatibility user agent|compatibility user agent.*fresh/i);
	assert.equal(compatibilityUpgrade.compatibilityWorkaround, undefined);
	assert.equal(compatibilityUpgrade.effectiveArgs.includes("--user-agent"), false);

	const wrongNamespaceFollowup = buildExecutionPlan(["--namespace", "other", "--session", "piab-demo-123", "snapshot", "-i"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: true,
		managedSessionCompatibilityWorkaround: cloudflarePlan.compatibilityWorkaround,
		managedSessionName: "piab-demo-123",
		managedSessionNamespace: "team",
		sessionMode: "auto",
	});
	assert.equal(wrongNamespaceFollowup.compatibilityWorkaround, undefined);

	const rawArgsPlan = buildExecutionPlan(["--args", "--disable-gpu", "open", "https://dash.cloudflare.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(rawArgsPlan.compatibilityWorkaround, undefined);
	assert.equal(rawArgsPlan.effectiveArgs.includes("--user-agent"), false);

	const callerProvidedUserAgentPlan = buildExecutionPlan(
		[
			"--profile",
			"Default",
			"--user-agent",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
			"open",
			"https://chatgpt.com",
		],
		{
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: false,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		},
	);
	assert.equal(callerProvidedUserAgentPlan.compatibilityWorkaround, undefined);
	assert.equal(callerProvidedUserAgentPlan.effectiveArgs.filter((token) => token === "--user-agent").length, 1);

	const headedPlan = buildExecutionPlan(["--profile", "Default", "--headed", "open", "https://chatgpt.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(headedPlan.compatibilityWorkaround, undefined);

	const disabledAutoConnectPlan = buildExecutionPlan(["--auto-connect", "false", "open", "https://chatgpt.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(disabledAutoConnectPlan.compatibilityWorkaround?.id, "chatgpt-headless-user-agent");

	const enabledAutoConnectPlan = buildExecutionPlan(["--auto-connect", "open", "https://chatgpt.com"], {
		freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
		managedSessionActive: false,
		managedSessionName: "piab-demo-123",
		sessionMode: "auto",
	});
	assert.equal(enabledAutoConnectPlan.compatibilityWorkaround, undefined);

	for (const env of [
		{ AGENT_BROWSER_ENGINE: "lightpanda" },
		{ AGENT_BROWSER_PROVIDER: "browserbase" },
		{ AGENT_BROWSER_CDP: "9222" },
		{ AGENT_BROWSER_ARGS: "--disable-gpu" },
		{ AGENT_BROWSER_HEADED: "1" },
		{ AGENT_BROWSER_USER_AGENT: "Custom/1" },
		{ AGENT_BROWSER_AUTO_CONNECT: "true" },
	]) {
		assert.equal(canUseHeadlessCompatibilityUserAgent(["open", "https://dash.cloudflare.com"], env), false);
	}
	assert.equal(canUseHeadlessCompatibilityUserAgent(["--args", "--disable-gpu", "open", "https://dash.cloudflare.com"]), false);
	assert.equal(canUseHeadlessCompatibilityUserAgent(["--engine", "chrome", "open", "https://dash.cloudflare.com"], { AGENT_BROWSER_ENGINE: "lightpanda" }), true);
	assert.equal(canUseHeadlessCompatibilityUserAgent(["--headed", "false", "open", "https://dash.cloudflare.com"], { AGENT_BROWSER_HEADED: "1" }), true);
	assert.equal(canUseHeadlessCompatibilityUserAgent(["--auto-connect", "false", "open", "https://dash.cloudflare.com"], { AGENT_BROWSER_AUTO_CONNECT: "true" }), true);
	assert.equal(canUseHeadlessCompatibilityUserAgent(["--engine", "chrome", "--engine", "lightpanda", "open", "https://dash.cloudflare.com"]), false);
	assert.equal(canUseHeadlessCompatibilityUserAgent(["--engine", "lightpanda", "--engine", "chrome", "open", "https://dash.cloudflare.com"]), true);

	const previousEngine = process.env.AGENT_BROWSER_ENGINE;
	const previousHeaded = process.env.AGENT_BROWSER_HEADED;
	try {
		process.env.AGENT_BROWSER_ENGINE = "lightpanda";
		const lightpandaPlan = buildExecutionPlan(["open", "https://dash.cloudflare.com"], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: false,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});
		assert.equal(lightpandaPlan.compatibilityWorkaround, undefined);
		assert.equal(lightpandaPlan.effectiveArgs.includes("--user-agent"), false);

		delete process.env.AGENT_BROWSER_ENGINE;
		process.env.AGENT_BROWSER_HEADED = "1";
		const explicitHeadlessPlan = buildExecutionPlan(["--headed", "false", "open", "https://dash.cloudflare.com"], {
			freshSessionName: createFreshSessionName("piab-demo-123", "seed", 1),
			managedSessionActive: false,
			managedSessionName: "piab-demo-123",
			sessionMode: "auto",
		});
		assert.equal(explicitHeadlessPlan.compatibilityWorkaround?.id, "cloudflare-headless-user-agent");
	} finally {
		if (previousEngine === undefined) delete process.env.AGENT_BROWSER_ENGINE;
		else process.env.AGENT_BROWSER_ENGINE = previousEngine;
		if (previousHeaded === undefined) delete process.env.AGENT_BROWSER_HEADED;
		else process.env.AGENT_BROWSER_HEADED = previousHeaded;
	}
});

test("redactInvocationArgs masks sensitive flags and auth-bearing urls", () => {
	assert.deepEqual(redactInvocationArgs(["--headers", '{"Authorization":"Bearer demo"}', "open", "https://user:pass@example.com/path?token=abc&ok=1#access_token=xyz"]), [
		"--headers",
		"[REDACTED]",
		"open",
		"https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/path?token=%5BREDACTED%5D&ok=1#access_token=%5BREDACTED%5D",
	]);
	assert.deepEqual(redactInvocationArgs(["open", "https://example.com/?SAMLRequest=request-secret#state=oauth-secret&nonce=oidc-secret"]), [
		"open",
		"https://example.com/?SAMLRequest=%5BREDACTED%5D#state=%5BREDACTED%5D&nonce=%5BREDACTED%5D",
	]);
	assert.deepEqual(redactInvocationArgs(["open", "https://example.com/sso?SAMLRequest=request-secret&RelayState=relay-secret&state=oauth-secret&nonce=oidc-secret&ok=1"]), [
		"open",
		"https://example.com/sso?SAMLRequest=%5BREDACTED%5D&RelayState=%5BREDACTED%5D&state=%5BREDACTED%5D&nonce=%5BREDACTED%5D&ok=1",
	]);
	assert.deepEqual(redactInvocationArgs(["open", "https://example.com/orders?state=open&nonce=7"]), [
		"open",
		"https://example.com/orders?state=open&nonce=7",
	]);
	assert.deepEqual(redactInvocationArgs(["open", "https://example.com/path?apiKey=abc&refreshToken=def&ok=1"]), [
		"open",
		"https://example.com/path?apiKey=%5BREDACTED%5D&refreshToken=%5BREDACTED%5D&ok=1",
	]);
	assert.deepEqual(redactInvocationArgs(["--proxy=http://user:pass@proxy.example:8080", "open", "https://example.com"]), [
		"--proxy=[REDACTED]",
		"open",
		"https://example.com/",
	]);
	assert.deepEqual(redactInvocationArgs(["network", "route", "**/api", "--body", '{"token":"route-secret"}']), [
		"network",
		"route",
		"**/api",
		"--body",
		"[REDACTED]",
	]);
	assert.deepEqual(redactInvocationArgs(["auth", "save", "demo", "--password", "secret-value"]), [
		"auth",
		"save",
		"demo",
		"--password",
		"[REDACTED]",
	]);
	assert.deepEqual(redactInvocationArgs(["auth", "save", "demo", "--password=secret-value"]), [
		"auth",
		"save",
		"demo",
		"--password=[REDACTED]",
	]);
	assert.deepEqual(redactInvocationArgs(["set", "credentials", "user@example.com", "secret-value"]), [
		"set",
		"credentials",
		"[REDACTED]",
		"[REDACTED]",
	]);
	assert.deepEqual(redactInvocationArgs(["--json", "--session", "demo", "cookies", "set", "sid", "cookie-secret", "--url", "https://example.com"]), [
		"--json",
		"--session",
		"demo",
		"cookies",
		"set",
		"sid",
		"[REDACTED]",
		"--url",
		"https://example.com/",
	]);
	assert.deepEqual(redactInvocationArgs(["storage", "local", "set", "authToken", "storage-secret"]), [
		"storage",
		"local",
		"set",
		"authToken",
		"[REDACTED]",
	]);
	assert.deepEqual(redactInvocationArgs(["--json", "--session", "demo", "clipboard", "write", "clipboard-secret", "extra-secret"]), [
		"--json",
		"--session",
		"demo",
		"clipboard",
		"write",
		"[REDACTED]",
		"[REDACTED]",
	]);
	assert.deepEqual(redactInvocationArgs(["chat", "Summarize Authorization: Bearer chat-secret"]), [
		"chat",
		"Summarize Authorization: Bearer [REDACTED]",
	]);
});

test("redactSensitiveText protects complete HTTP and standalone auth credentials containing slashes", () => {
	for (const [input, portions, scheme] of [
		["Authorization: Bearer credentialPrefix/credentialSuffix", ["credentialPrefix", "credentialSuffix"], "Bearer"],
		["Authorization:Basic YWJj/ZGVm", ["YWJj", "ZGVm"], "Basic"],
		["Bearer standalonePrefix/standaloneSuffix", ["standalonePrefix", "standaloneSuffix"], "Bearer"],
		["Basic dXNlcjpw/YXNz", ["dXNlcjpw", "YXNz"], "Basic"],
	] as const) {
		const redacted = redactSensitiveText(input);
		for (const portion of portions) assert.equal(redacted.includes(portion), false);
		assert.ok(redacted.includes(scheme));
		assert.ok(redacted.includes("[REDACTED]"));
		assert.equal(redactSensitiveText(redacted), redacted);
	}
});

test("redactSensitiveText scans repeated public query transitions without recursive reinterpretation", () => {
	const input = "?public=".repeat(4_000) + "ordinary";
	const startedAt = Date.now();
	const redacted = redactSensitiveText(input);
	assert.ok(Date.now() - startedAt < 1_000, "public query transitions should finish within the existing one-second scan budget");
	assert.equal(redacted, input, "public query labels and ordinary payload remain unchanged");
	const nested = redactSensitiveText("?public=https://example.test/?key=[nested-query-secret]&ok=1");
	assert.equal(nested.includes("nested-query-secret"), false);
	assert.ok(nested.includes("example.test"));
	assert.ok(nested.includes("ok=1"));
	const structured = redactSensitiveText('?public={"password":"nested-json-secret","status":"ready"}&ok=1');
	assert.equal(structured.includes("nested-json-secret"), false);
	assert.ok(structured.includes("ready"));
	assert.ok(structured.includes("ok=1"));
	assert.equal(redactSensitiveText(structured), structured);
});

test("redactSensitiveText keeps literal question marks inside complete sensitive query values", () => {
	const urls = [
		"/sso?state=credential-prefix?private-suffix&ok=1",
		"/account?key=credential-prefix?private-suffix&ok=1",
		"/account#access_token=credential-prefix?private-suffix&ok=1",
		"https://example.test/sso?state=credential-prefix?private-suffix&ok=1",
		"https://example.test/account?key=credential-prefix?private-suffix&ok=1",
	];
	for (const url of urls) {
		const redacted = redactSensitiveText(`Redirect ${url}`);
		for (const portion of ["credential-prefix", "private-suffix"]) assert.equal(redacted.includes(portion), false);
		assert.ok(redacted.includes("ok=1"));
		assert.ok(redacted.includes("Redirect "));
		assert.equal(redactSensitiveText(redacted), redacted);
	}
	const structured = redactSensitiveText(JSON.stringify({ urls, status: "ready" }));
	for (const portion of ["credential-prefix", "private-suffix"]) assert.equal(structured.includes(portion), false);
	const parsed: unknown = JSON.parse(structured);
	assert.ok(parsed && typeof parsed === "object" && "status" in parsed && parsed.status === "ready");
	assert.ok("urls" in parsed && Array.isArray(parsed.urls) && parsed.urls.every((url) => typeof url === "string" && url.includes("ok=1")));
	assert.equal(redactSensitiveText(structured), structured);
});

test("redactSensitiveText keeps sensitive relative query and fragment values opaque", () => {
	for (const input of [
		"Redirect /account?key=[123]&ok=1",
		"Redirect /sso?state=[123]&ok=1",
		"Redirect /account#access_token={ \"nested\": [123] }&ok=1",
		"Redirect /oauth#nonce=[123]credential-suffix&ok=1",
		'Redirect /account?token="query-private"&ok=1',
	]) {
		const redacted = redactSensitiveText(input);
		assert.equal(redacted.includes("123"), false);
		assert.equal(redacted.includes("credential-suffix"), false);
		assert.equal(redacted.includes("query-private"), false);
		assert.ok(redacted.includes("ok=1"));
		assert.ok(redacted.includes("Redirect /"));
		assert.equal(redactSensitiveText(redacted), redacted);
	}
});

test("redactSensitiveText recursively masks public URL payloads without hiding ordinary query context", () => {
	const payload = JSON.stringify({
		password: "url-json-private",
		nested: [{ apiKey: "url-nested-private", status: "ready" }],
		path: "/account",
	});
	const urls = [
		`https://example.test/?debug=${payload}&ok=1`,
		`https://example.test/path/${payload}?ok=1`,
		`/account?public=${payload}&ok=1`,
		`/account#public=${payload}&ok=1`,
	];
	for (const url of urls) {
		const redacted = redactSensitiveText(url);
		for (const secret of ["url-json-private", "url-nested-private"]) assert.equal(redacted.includes(secret), false);
		assert.ok(redacted.includes("ok=1"));
		assert.ok(redacted.includes("account") || redacted.includes("example.test"));
		assert.equal(redactSensitiveText(redacted), redacted);
		const args = redactInvocationArgs(["open", url]);
		for (const secret of ["url-json-private", "url-nested-private"]) assert.equal(JSON.stringify(args).includes(secret), false);
	}
	const redacted = redactSensitiveText(urls[0]);
	const payloadText = new URL(redacted).searchParams.get("debug");
	assert.ok(payloadText);
	const parsed: unknown = JSON.parse(payloadText);
	assert.ok(parsed && typeof parsed === "object" && "path" in parsed && parsed.path === "/account");
	assert.ok("nested" in parsed && Array.isArray(parsed.nested));
	const nested = parsed.nested[0];
	assert.ok(nested && typeof nested === "object" && "status" in nested && nested.status === "ready");
	const structured = redactSensitiveText(JSON.stringify({ urls, status: "failed" }));
	for (const secret of ["url-json-private", "url-nested-private"]) assert.equal(structured.includes(secret), false);
	const outer: unknown = JSON.parse(structured);
	assert.ok(outer && typeof outer === "object" && "status" in outer && outer.status === "failed");
	assert.ok("urls" in outer && Array.isArray(outer.urls) && outer.urls.length === urls.length);
	assert.equal(redactSensitiveText(structured), structured);
});

test("redactSensitiveText keeps complete credential lexemes opaque around JSON-like substrings", () => {
	for (const input of [
		"PASSWORD=prefixSecret[123]suffixSecret; status=failed",
		"PASSWORD=[123]suffixSecret; status=failed",
		"PASSWORD=[123, 456]suffixSecret; status=failed",
		'password=prefixSecret{"value":123}suffixSecret; status=failed',
		'password={ "value": [123, 456] }suffixSecret; status=failed',
	]) {
		const redacted = redactSensitiveText(input);
		for (const portion of ["prefixSecret", "suffixSecret", "123", "456"]) assert.equal(redacted.includes(portion), false);
		assert.ok(redacted.includes("status=failed"));
		assert.equal(redactSensitiveText(redacted), redacted);
	}
});

test("redactSensitiveText redacts complete URL userinfo with structured-looking credential substrings", () => {
	for (const password of ["paSecret[123]ssSecret", "paSecret{123}ssSecret"]) {
		const url = `mongodb://usernameSecret:${password}@example.com/db`;
		const input = `Error ${url}; status=failed`;
		const redacted = redactSensitiveText(input);
		for (const portion of ["usernameSecret", "paSecret", "ssSecret", "123"]) assert.equal(redacted.includes(portion), false);
		assert.ok(redacted.includes("example.com/db"));
		assert.ok(redacted.includes("status=failed"));
		assert.equal(redactSensitiveText(redacted), redacted);
		const structured = redactSensitiveText(JSON.stringify({ message: input, path: "/account" }));
		for (const portion of ["usernameSecret", "paSecret", "ssSecret", "123"]) assert.equal(structured.includes(portion), false);
		const parsed: unknown = JSON.parse(structured);
		assert.ok(parsed && typeof parsed === "object" && "path" in parsed && parsed.path === "/account");
		assert.ok("message" in parsed && typeof parsed.message === "string" && parsed.message.includes("example.com/db") && parsed.message.includes("status=failed"));
		assert.equal(redactSensitiveText(structured), structured);
	}
});

test("redactSensitiveText keeps structured assignment values and entire cookie headers opaque", () => {
	for (const [input, credentials] of [
		['API_KEY={"value":"assignment-secret"}; status=failed', ["assignment-secret"]],
		['apiKey={ "nested": [ { "value": "nested assignment secret" }, ["array assignment secret"] ] }; status=failed', ["nested assignment secret", "array assignment secret"]],
		['secret=[ "first array secret", { "value": "second array secret" } ]; status=failed', ["first array secret", "second array secret"]],
		['Cookie: sid={"value":"cookie-secret"}\nstatus=failed', ["cookie-secret"]],
		['sEt-CoOkIe: sid={ "nested": [ { "value": "nested cookie secret" } ] }; Path=/account\nstatus=failed', ["nested cookie secret"]],
	] as const) {
		const redacted = redactSensitiveText(input);
		for (const credential of credentials) assert.equal(redacted.includes(credential), false);
		assert.ok(redacted.includes("status=failed"), "ordinary prose outside the credential remains visible");
		assert.ok(redacted.includes("[REDACTED]"));
		assert.equal(redactSensitiveText(redacted), redacted);
	}
});

test("redactSensitiveText preserves outer JSON while masking structured credential contexts inside strings", () => {
	const input = JSON.stringify({
		message: 'API_KEY={ "nested": ["structured assignment secret"] }; status=failed',
		headers: [
			'Cookie: sid={"value":"structured cookie secret"}\nstatus=failed',
			'Set-Cookie: sid={ "nested": [ "structured set-cookie secret" ] }\nstatus=failed',
			"Authorization: Bearer structured-bearer-secret",
		],
		path: "/account",
	});
	const redacted = redactSensitiveText(input);
	for (const credential of ["structured assignment secret", "structured cookie secret", "structured set-cookie secret", "structured-bearer-secret"]) {
		assert.equal(redacted.includes(credential), false);
	}
	const parsed: unknown = JSON.parse(redacted);
	assert.ok(parsed && typeof parsed === "object" && "path" in parsed && parsed.path === "/account");
	assert.ok("message" in parsed && typeof parsed.message === "string" && parsed.message.includes("status=failed"));
	assert.ok("headers" in parsed && Array.isArray(parsed.headers));
	assert.ok(parsed.headers.slice(0, 2).every((header) => typeof header === "string" && header.includes("status=failed")));
	assert.ok(typeof parsed.headers[2] === "string" && parsed.headers[2].includes("Authorization: Bearer [REDACTED]"));
	assert.equal(redactSensitiveText(redacted), redacted);
});

test("redactSensitiveText treats quoted credential values as opaque even when they contain JSON", () => {
	const redacted = redactSensitiveText(`password='{"value":"opaque-credential"}'; status=failed`);
	assert.equal(redacted.includes("opaque-credential"), false);
	assert.ok(redacted.includes("password="));
	assert.ok(redacted.includes("status=failed"));
	assert.equal(redactSensitiveText(redacted), redacted);
});

test("redactSensitiveText masks embedded JSON recursively without corrupting string boundaries", () => {
	const input = JSON.stringify({ message: "token=abc", apiKey: "key-secret", status: "ready" });
	const redacted = redactSensitiveText(input);
	assert.equal(redacted.includes("abc"), false);
	assert.equal(redacted.includes("key-secret"), false);
	const parsed: unknown = JSON.parse(redacted);
	assert.ok(parsed && typeof parsed === "object" && "status" in parsed && parsed.status === "ready");
	assert.ok("message" in parsed && typeof parsed.message === "string" && parsed.message.includes("token="));
	assert.equal(redactSensitiveText(redacted), redacted);
});

test("redactSensitiveText separates surrounding assignments from nested structured diagnostics", () => {
	const diagnostic = {
		message: 'password="quoted \\"secret\\" value"; status=ready',
		note: 'He said "keep context".',
		nested: [
			"token=nested-token-secret",
			[{ message: "Authorization: Bearer nested-bearer-secret", apiKey: "nested-key-secret", path: "/account" }],
		],
	};
	const input = [
		'prefix password="outside-secret"; status=failed',
		JSON.stringify(diagnostic),
		"suffix secret=after-secret; timeout=5000",
	].join("\n");
	const redacted = redactSensitiveText(input);
	for (const secret of ["quoted", "outside-secret", "after-secret", "nested-token-secret", "nested-bearer-secret", "nested-key-secret"]) {
		assert.equal(redacted.includes(secret), false);
	}
	const lines = redacted.split("\n");
	assert.ok(lines[0].includes("prefix") && lines[0].includes("status=failed"));
	assert.ok(lines[2].includes("suffix") && lines[2].includes("timeout=5000"));
	const parsed: unknown = JSON.parse(lines[1]);
	assert.ok(parsed && typeof parsed === "object" && "note" in parsed && parsed.note === diagnostic.note);
	assert.ok("nested" in parsed && Array.isArray(parsed.nested) && Array.isArray(parsed.nested[1]));
	const nested = parsed.nested[1][0];
	assert.ok(nested && typeof nested === "object" && "path" in nested && nested.path === "/account");
	assert.ok("message" in nested && typeof nested.message === "string" && nested.message.includes("Authorization: Bearer [REDACTED]"));
	assert.equal(redactSensitiveText(redacted), redacted);
});

test("redactSensitiveText retains sanitized HTTP auth schemes without exempting credential assignments", () => {
	const credentials = ["bearer-secret", "basic-secret", "lowercase-token", "password value", "quoted secret", "assignment-secret"];
	const input = [
		"request GET /account",
		"Authorization: Bearer bearer-secret",
		"authorization: bAsIc basic-secret",
		"AUTHORIZATION : bEaReR bearer-secret",
		"Authorization: Basic basic-secret",
		"token=lowercase-token, timeout=5000",
		'password = "password value"; status=failed',
		"secret='quoted secret'; tokenizer=ordinary",
		"authorization=assignment-secret",
		"help (Authorization Bearer token)",
	].join("\n");
	const redacted = redactSensitiveText(input);
	for (const credential of credentials) assert.equal(redacted.includes(credential), false);
	for (const structure of [
		"request GET /account",
		"Authorization: Bearer [REDACTED]",
		"authorization: bAsIc [REDACTED]",
		"AUTHORIZATION : bEaReR [REDACTED]",
		"Authorization: Basic [REDACTED]",
		"token=[REDACTED]",
		"password = [REDACTED]",
		"secret=[REDACTED]",
		"authorization=[REDACTED]",
		"timeout=5000",
		"status=failed",
		"tokenizer=ordinary",
		"help (Authorization Bearer token)",
	]) assert.ok(redacted.includes(structure), `missing nonsecret structure: ${structure}`);
	assert.equal(redactSensitiveText(redacted), redacted, "redaction must be idempotent");
	for (const input of ["authorization=Bearer [REDACTED]", "token: Basic [REDACTED]", 'authorization: "Bearer assignment-secret"']) {
		const redacted = redactSensitiveText(input);
		assert.equal(redacted.includes("assignment-secret"), false);
		assert.doesNotMatch(redacted, /\b(?:Bearer|Basic)\b/i, "only sanitized HTTP header schemes are structural");
	}
});

test("redactSensitiveText preserves help placeholders while redacting bearer credentials", () => {
	const help = redactSensitiveText("Headers help: --headers <json> (e.g., Authorization bearer token)");
	assert.ok(help.includes("--headers <json>"));
	assert.ok(help.includes("Authorization bearer token)"), "documented help placeholder is not a credential");
	for (const [input, credential, structure] of [
		["Error: Authorization: Bearer raw-token)", "raw-token", "Bearer [REDACTED])"],
		["Authorization bearer raw-token.", "raw-token", "bearer [REDACTED]."],
		["Authorization bearer secrettoken", "secrettoken", "bearer [REDACTED]"],
		["Authorization bearer token,", "token", "bearer [REDACTED],"],
		["curl -H 'Bearer secrettoken'", "secrettoken", "Bearer [REDACTED]'"],
		["curl -H 'Bearer abc123'", "abc123", "Bearer [REDACTED]'"],
		["curl -H 'Bearer token.'", "token", "Bearer [REDACTED].'"],
	]) {
		const redacted = redactSensitiveText(input);
		assert.equal(redacted.includes(credential), false);
		assert.ok(redacted.includes(structure), `missing credential structure: ${structure}`);
	}
	const assignments = redactSensitiveText("OPENAI_API_KEY=openai-secret AWS_SECRET_ACCESS_KEY: aws-secret export STRIPE_SECRET_KEY='stripe-secret' PRIVATE_KEY=-----BEGIN_PRIVATE_KEY----- X-Private-Key: prose-header-secret private-key=prose-key API-KEY=prose-api Secret-Key: prose-secret apiKey=camel-api privateKey: camel-private connectionString=camel-connection databaseUrl: camel-db mongodbUri=mongodb://user:pass@example/db MONGODB_URI=mongodb://user:pass@example/db failedChecks=true");
	for (const credential of ["openai-secret", "aws-secret", "stripe-secret", "-----BEGIN_PRIVATE_KEY-----", "prose-header-secret", "prose-key", "prose-api", "prose-secret", "camel-api", "camel-private", "camel-connection", "camel-db", "user:pass"]) {
		assert.equal(assignments.includes(credential), false);
	}
	assert.ok(assignments.includes("failedChecks=true"));
	assert.ok(assignments.includes("X-Private-Key:"));
	assert.ok(assignments.includes("connectionString="));
	assert.ok(assignments.includes("[REDACTED]"));
	assert.equal(
		redactSensitiveText("Redirect /sso?SAMLRequest=request-secret&SAMLResponse=response-secret&RelayState=relay-secret#state=oauth-secret&nonce=oidc-secret"),
		"Redirect /sso?SAMLRequest=[REDACTED]&SAMLResponse=[REDACTED]&RelayState=[REDACTED]#state=[REDACTED]&nonce=[REDACTED]",
	);
	assert.equal(redactSensitiveText("Login help. Status /orders?state=open&nonce=7"), "Login help. Status /orders?state=open&nonce=7");
	assert.equal(
		redactSensitiveText("Redirect /?SAMLRequest=request-secret#state=oauth-secret then /orders?state=open"),
		"Redirect /?SAMLRequest=[REDACTED]#state=[REDACTED] then /orders?state=open",
	);
	assert.equal(
		redactSensitiveText("https://o914390.ingest.sentry.io/api/envelope/?sentry_key=sentry-secret&writeKey=write-secret&ok=1"),
		"https://o914390.ingest.sentry.io/api/envelope/?sentry_key=%5BREDACTED%5D&writeKey=%5BREDACTED%5D&ok=1",
	);
	assert.equal(
		redactSensitiveText("https://example.com/?private_key=url-private-secret&connection_string=db-secret&mongo_uri=mongo-secret&redis_url=redis-secret&database_url=database-secret&ok=1"),
		"https://example.com/?private_key=%5BREDACTED%5D&connection_string=%5BREDACTED%5D&mongo_uri=%5BREDACTED%5D&redis_url=%5BREDACTED%5D&database_url=%5BREDACTED%5D&ok=1",
	);
	for (const [input, scheme, path, credentials] of [
		["mongodb://user:pass@example/db", "mongodb:", "/db", ["user", "pass"]],
		["mongodb+srv://srv-user:srv-pass@example/db", "mongodb+srv:", "/db", ["srv-user", "srv-pass"]],
		["redis://redis-user:redis-pass@example/0", "redis:", "/0", ["redis-user", "redis-pass"]],
		["mongodb://user:pa)ss@example/db?token=secret&ok=1", "mongodb:", "/db", ["user", "pa)ss", "secret"]],
		["mongodb://user:p]ss@example/db?private_key=secret&ok=1", "mongodb:", "/db", ["user", "p]ss", "secret"]],
		["mongodb://user:p>ss@example/db#access_token=secret&ok=1", "mongodb:", "/db", ["user", "p>ss", "secret"]],
		["mongodb://[REDACTED]:[REDACTED]@example/db?token=secret&ok=1", "mongodb:", "/db", ["secret"]],
	] as const) {
		const redacted = redactSensitiveText(input);
		const decoded = decodeURIComponent(redacted);
		for (const credential of credentials) assert.equal(decoded.includes(credential), false);
		const url = new URL(redacted);
		assert.equal(url.protocol, scheme);
		assert.equal(url.hostname, "example");
		assert.equal(url.pathname, path);
		if (input.includes("ok=1")) {
			assert.equal(url.searchParams.get("ok") ?? new URLSearchParams(url.hash.slice(1)).get("ok"), "1");
		}
		assert.equal(redactSensitiveText(redacted), redacted);
	}
});

test("redactSensitiveText scans long tokens without blocking the host", () => {
	const input = "A".repeat(200_000);
	const startedAt = Date.now();
	assert.equal(redactSensitiveText(input), input);
	assert.ok(Date.now() - startedAt < 1_000, "redacting a 200k token should finish in under one second");
});

test("redactSensitiveValue masks obvious secret-bearing object keys", () => {
	assert.deepEqual(redactSensitiveValue({ state: "ready", nonceCount: 3 }), { state: "ready", nonceCount: 3 });
	assert.deepEqual(
		redactSensitiveValue({
			apiKey: "abc",
			openaiApiKey: "openai-secret",
			OPENAI_API_KEY: "openai-env-secret",
			AWS_SECRET_ACCESS_KEY: "aws-env-secret",
			STRIPE_SECRET_KEY: "stripe-env-secret",
			PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
			private_key: "private-key-secret",
			"X-Private-Key": "header-private-key-secret",
			privateKey: "camel-private-key-secret",
			connectionString: "camel-connection-string-secret",
			mongodbUri: "mongodb://user:pass@example/db",
			MONGODB_URI: "mongodb://user:pass@example/db",
			databaseUrl: "postgres://db-secret",
			DATABASE_URL: "postgres://env-db-secret",
			nested: {
				authorization: "Bearer demo",
				ok: "https://example.com/?ok=1&token=abc",
				"set-cookie": "sid=abc",
			},
			status: { code: "ERR_BLOCKED_BY_CLIENT", key: "Enter" },
		}),
		{
			apiKey: "[REDACTED]",
			openaiApiKey: "[REDACTED]",
			OPENAI_API_KEY: "[REDACTED]",
			AWS_SECRET_ACCESS_KEY: "[REDACTED]",
			STRIPE_SECRET_KEY: "[REDACTED]",
			PRIVATE_KEY: "[REDACTED]",
			private_key: "[REDACTED]",
			"X-Private-Key": "[REDACTED]",
			privateKey: "[REDACTED]",
			connectionString: "[REDACTED]",
			mongodbUri: "[REDACTED]",
			MONGODB_URI: "[REDACTED]",
			databaseUrl: "[REDACTED]",
			DATABASE_URL: "[REDACTED]",
			nested: {
				authorization: "[REDACTED]",
				ok: "https://example.com/?ok=1&token=%5BREDACTED%5D",
				"set-cookie": "[REDACTED]",
			},
			status: { code: "ERR_BLOCKED_BY_CLIENT", key: "Enter" },
		},
	);
});

