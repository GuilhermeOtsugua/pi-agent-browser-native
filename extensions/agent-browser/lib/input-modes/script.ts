import { randomUUID } from "node:crypto";

import { parseArgvDescriptor } from "../argv-descriptor.js";
import { getFlagName } from "../argv-grammar.js";
import { needsManagedSession } from "../command-policy.js";
import { isCloseCommand } from "../command-taxonomy.js";
import { LAUNCH_SCOPED_FLAGS, MANAGED_RESTORE_INCOMPATIBLE_FLAGS } from "../launch-scoped-flags.js";
import { isRecord } from "../parsing.js";
import { validateToolArgs } from "../runtime.js";
import type { AgentBrowserFailureCategory, AgentBrowserNextAction, AgentBrowserResultCategory, AgentBrowserSuccessCategory } from "../results/contracts.js";

export const AGENT_BROWSER_SCRIPT_CODE_MAX_BYTES = 64 * 1_024;
export const AGENT_BROWSER_SCRIPT_DEFAULT_TIMEOUT_MS = 120_000;
export const AGENT_BROWSER_SCRIPT_NAMESPACE = "";
export const AGENT_BROWSER_SCRIPT_MAX_TIMEOUT_MS = 300_000;
export const AGENT_BROWSER_SCRIPT_MAX_CALLS = 25;
export const AGENT_BROWSER_SCRIPT_FINAL_OUTPUT_MAX_BYTES = 64 * 1_024;
export const AGENT_BROWSER_SCRIPT_IPC_MESSAGE_MAX_BYTES = 1 * 1_024 * 1_024;
export const AGENT_BROWSER_SCRIPT_IPC_CUMULATIVE_MAX_BYTES = 8 * 1_024 * 1_024;
export const AGENT_BROWSER_SCRIPT_SPILL_MAX_BYTES = 512 * 1_024;

const SCRIPT_SESSION_NAME_PATTERN = /^piab-script-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCRIPT_ALLOWED_LAUNCH_FLAG = "--allowed-domains";
const SCRIPT_FORBIDDEN_COMMANDS = new Set(["attach", "auth", "batch", "connect", "script", "session", "state"]);
const SCRIPT_FORBIDDEN_FLAGS = new Set<string>([
	...LAUNCH_SCOPED_FLAGS.filter((flag) => flag !== SCRIPT_ALLOWED_LAUNCH_FLAG),
	...MANAGED_RESTORE_INCOMPATIBLE_FLAGS.filter((flag) => flag !== SCRIPT_ALLOWED_LAUNCH_FLAG),
	"--namespace",
	"--session",
]);

export interface CompiledAgentBrowserScript {
	code: string;
}

export interface AgentBrowserScriptBrowserParams {
	args: string[];
	stdin?: string;
	timeoutMs?: number;
}

export interface AgentBrowserScriptBrowserEnvelope {
	data: unknown;
	details?: Record<string, unknown>;
	error?: string;
	failureCategory?: AgentBrowserFailureCategory;
	nextActions?: AgentBrowserNextAction[];
	ok: boolean;
	resultCategory: AgentBrowserResultCategory;
	successCategory?: AgentBrowserSuccessCategory;
	summary: string;
	text: string;
}

export interface AgentBrowserScriptStepSummary {
	failureCategory?: AgentBrowserFailureCategory;
	index: number;
	ok: boolean;
	resultCategory: AgentBrowserResultCategory;
	successCategory?: AgentBrowserSuccessCategory;
	summary: string;
}

export interface AgentBrowserScriptRunResult {
	aborted?: boolean;
	callCount: number;
	data?: unknown;
	emitCount: number;
	error?: string;
	failureCategory?: AgentBrowserFailureCategory;
	ok: boolean;
	rejectedCallCount: number;
	steps: AgentBrowserScriptStepSummary[];
	timedOut?: boolean;
}

export interface RunAgentBrowserScriptOptions {
	beforeFirstCall?: () => void;
	code: string;
	dispatch: (params: AgentBrowserScriptBrowserParams, signal: AbortSignal) => Promise<AgentBrowserScriptBrowserEnvelope>;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export function compileAgentBrowserScript(input: unknown): { compiled?: CompiledAgentBrowserScript; error?: string } {
	if (typeof input !== "string") return { error: "script must be a string." };
	const bytes = Buffer.byteLength(input, "utf8");
	return bytes > AGENT_BROWSER_SCRIPT_CODE_MAX_BYTES
		? { error: `script must be ${AGENT_BROWSER_SCRIPT_CODE_MAX_BYTES} bytes or less.` }
		: { compiled: { code: input } };
}

export function createAgentBrowserScriptSessionName(): string {
	return `piab-script-${randomUUID()}`;
}

export function createAgentBrowserScriptCloseArgs(sessionName: string): string[] {
	return ["--namespace", AGENT_BROWSER_SCRIPT_NAMESPACE, "--session", sessionName, "close"];
}

export function isAgentBrowserScriptSessionName(value: unknown): value is string {
	return typeof value === "string" && SCRIPT_SESSION_NAME_PATTERN.test(value);
}

function getScriptCallPolicyError(args: string[]): string | undefined {
	const descriptor = parseArgvDescriptor(args);
	const command = descriptor.commandInfo.command;
	if (!command) return "script browser call args must contain an agent-browser command.";
	if (isCloseCommand(command)) return "script browser calls cannot close, quit, or exit their isolated session.";
	if (SCRIPT_FORBIDDEN_COMMANDS.has(command)) return `script browser calls cannot use ${command}.`;
	if (!needsManagedSession(descriptor)) return `script browser calls cannot use sessionless/local command ${command}.`;
	for (const token of args) {
		const flag = getFlagName(token);
		if (SCRIPT_FORBIDDEN_FLAGS.has(flag)) {
			return `script browser calls cannot use ${flag}; the parent owns the isolated session identity and launch policy.`;
		}
	}
	return undefined;
}

export function validateAgentBrowserScriptBrowserParams(input: unknown): { params?: AgentBrowserScriptBrowserParams; error?: string; policyBlocked?: boolean } {
	if (!isRecord(input)) return { error: "script browser(params) requires an object." };
	const unsupportedField = Object.keys(input).find((field) => !["args", "stdin", "timeoutMs"].includes(field));
	if (unsupportedField) return { error: `script browser(params) does not support ${unsupportedField}; use only args, stdin, and timeoutMs.` };
	if (!Array.isArray(input.args) || input.args.length === 0 || input.args.some((arg) => typeof arg !== "string")) {
		return { error: "script browser(params).args must be a non-empty string array." };
	}
	if (input.stdin !== undefined && typeof input.stdin !== "string") {
		return { error: "script browser(params).stdin must be a string when provided." };
	}
	if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== "number" || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0)) {
		return { error: "script browser(params).timeoutMs must be a positive integer when provided." };
	}
	const params: AgentBrowserScriptBrowserParams = {
		args: input.args,
		stdin: input.stdin as string | undefined,
		timeoutMs: input.timeoutMs as number | undefined,
	};
	const policyError = getScriptCallPolicyError(params.args);
	if (policyError) return { error: policyError, policyBlocked: true };
	const validationError = validateToolArgs(params.args);
	return validationError ? { error: validationError } : { params };
}
