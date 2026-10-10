/**
 * Purpose: Verify extension redaction, auth password stdin, and confirmation recovery contracts.
 * Responsibilities: Assert credential privacy with HTTP scheme and diagnostic-context preservation, password stdin, and confirmation recovery.
 * Scope: Integration-style Node test-runner coverage around the extension harness before result presentation and tab lifecycle suites.
 * Usage: Run with `npx tsx --test test/agent-browser.extension-security-redaction.test.ts` or via `npm run verify`.
 * Invariants/Assumptions: Tests use fake agent-browser binaries and isolated env/temp directories to avoid relying on upstream browser behavior.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { redactSensitiveText } from "../extensions/agent-browser/lib/runtime.js";

import {
	createExtensionHarness,
	executeRegisteredTool,
	runExtensionEvent,
	withPatchedEnv,
	writeFakeAgentBrowserBinary,
} from "./helpers/agent-browser-harness.js";

test("agentBrowserExtension redacts sensitive args in updates and persisted details", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-test-"));
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(
		tempDir,
		`process.stdout.write(JSON.stringify({ success: true, data: { title: "ok", url: "https://user:pass@example.com/?token=abc", openaiApiKey: "openai-should-not-leak", unrelatedApiKey: "unrelated-should-not-leak", databaseUrl: "postgres://should-not-leak", OPENAI_API_KEY: "uppercase-openai-should-not-leak", AWS_SECRET_ACCESS_KEY: "uppercase-aws-should-not-leak", STRIPE_SECRET_KEY: "uppercase-stripe-should-not-leak", PRIVATE_KEY: "uppercase-private-key-should-not-leak", private_key: "lower-private-key-should-not-leak", privateKey: "camel-private-key-should-not-leak", connectionString: "camel-connection-string-should-not-leak", mongodbUri: "mongodb://user:pass@example/db", MONGODB_URI: "mongodb://user:pass@example/db", "X-Private-Key": "header-private-key-should-not-leak", message: "Error mongodb://bare-user:bare-pass@example/db and mongodb+srv://srv-user:srv-pass@example/db and mongodb://punct-user:pa)ss@example/db?token=punct-token-secret&ok=1 mongodb://bracket-user:p]ss@example/db?private_key=bracket-key-secret&ok=1 mongodb://angle-user:p>ss@example/db#access_token=angle-token-secret&ok=1", envLine: "OPENAI_API_KEY=prose-openai-should-not-leak AWS_SECRET_ACCESS_KEY: prose-aws-should-not-leak PRIVATE_KEY=prose-private-key-should-not-leak X-Private-Key: prose-header-private-key-should-not-leak API-KEY=prose-api-key-should-not-leak apiKey=prose-camel-api-key-should-not-leak privateKey: prose-camel-private-key-should-not-leak connectionString=prose-camel-connection-string-should-not-leak databaseUrl: prose-camel-db-url-should-not-leak mongodbUri=mongodb://prose-user:prose-pass@example/db MONGODB_URI=mongodb://env-user:env-pass@example/db https://example.com/?private_key=url-private-key-should-not-leak&connection_string=url-connection-string-should-not-leak&ok=1 failedChecks=true" } }));`,
	);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}` }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);

			const updates: unknown[] = [];
			const result = (await harness.tool.execute(
				"test-tool-call",
				{ args: ["--headers", '{"Authorization":"Bearer s3cr3t-demo"}', "open", "https://user:pass@example.com/?token=abc"] },
				new AbortController().signal,
				(update) => updates.push(update),
				harness.ctx,
			)) as { content: Array<{ type: string; text?: string }>; details?: Record<string, unknown>; isError?: boolean };

			assert.equal(result.isError, false, `unexpected fixture execution failure: ${JSON.stringify(result)}`);
			const update = updates[0] as { content?: Array<{ text?: string }>; details?: Record<string, unknown> } | undefined;
			assert.match(update?.content?.[0]?.text ?? "", /\[REDACTED\]/);
			assert.doesNotMatch(update?.content?.[0]?.text ?? "", /s3cr3t-demo/);
			assert.doesNotMatch(update?.content?.[0]?.text ?? "", /user:pass/);
			assert.ok(Array.isArray(result.details?.args) && result.details.args.includes("open"));
			assert.match(JSON.stringify(result.details?.args), /example\.com/);
			assert.equal(JSON.stringify(result).includes("s3cr3t-demo"), false);
			assert.equal(JSON.stringify(result.details?.effectiveArgs).includes("s3cr3t-demo"), false);
			assert.equal(JSON.stringify(result.details?.effectiveArgs).includes("user:pass"), false);
			assert.equal(JSON.stringify(result.details?.data).includes("user:pass"), false);
			assert.equal(JSON.stringify(result.content).includes("user:pass"), false);
			assert.equal(JSON.stringify(result).includes("openai-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("unrelated-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("postgres://should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("uppercase-openai-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("uppercase-aws-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("uppercase-stripe-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("uppercase-private-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("lower-private-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("header-private-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("camel-private-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("camel-connection-string-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("mongodb://user:pass@example/db"), false);
			assert.equal(JSON.stringify(result).includes("mongodb://bare-user:bare-pass@example/db"), false);
			assert.equal(JSON.stringify(result).includes("mongodb+srv://srv-user:srv-pass@example/db"), false);
			assert.equal(JSON.stringify(result).includes("mongodb://punct-user:pa)ss@example/db"), false);
			assert.equal(JSON.stringify(result).includes("mongodb://bracket-user:p]ss@example/db"), false);
			assert.equal(JSON.stringify(result).includes("mongodb://angle-user:p>ss@example/db"), false);
			assert.equal(JSON.stringify(result).includes("punct-token-secret"), false);
			assert.equal(JSON.stringify(result).includes("bracket-key-secret"), false);
			assert.equal(JSON.stringify(result).includes("angle-token-secret"), false);
			assert.equal(JSON.stringify(result).includes("prose-openai-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("prose-aws-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("prose-private-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("prose-header-private-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("prose-api-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("prose-camel-api-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("prose-camel-private-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("prose-camel-connection-string-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("prose-camel-db-url-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("mongodb://prose-user:prose-pass@example/db"), false);
			assert.equal(JSON.stringify(result).includes("mongodb://env-user:env-pass@example/db"), false);
			assert.equal(JSON.stringify(result).includes("url-private-key-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("url-connection-string-should-not-leak"), false);
			assert.equal(JSON.stringify(result).includes("failedChecks"), true);
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("agentBrowserExtension preserves auth schemes in chat updates and persisted results without credentials", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-auth-schemes-"));
	const basePath = process.env.PATH ?? "";
	const message = [
		"inspect GET /account",
		"Authorization: Bearer chat-bearer-secret",
		"authorization: bAsIc chat-basic-secret",
		'token=chat-token-secret; password="chat password"; timeout=5000',
		"help (Authorization Bearer token)",
	].join("\n");
	await writeFakeAgentBrowserBinary(tempDir, `process.stdout.write(JSON.stringify({ success: true, data: { message: ${JSON.stringify(message)} } }));`);
	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}` }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);
			const updates: unknown[] = [];
			const result = await harness.tool.execute("auth-schemes", { args: ["chat", message] }, new AbortController().signal, (update) => updates.push(update), harness.ctx);
			assert.ok(updates.length > 0, "the caller must receive an execution update");
			for (const surface of [JSON.stringify(updates), JSON.stringify(result)]) {
				for (const secret of ["chat-bearer-secret", "chat-basic-secret", "chat-token-secret", "chat password"]) {
					assert.equal(surface.includes(secret), false);
				}
				for (const structure of ["GET /account", "Authorization: Bearer [REDACTED]", "authorization: bAsIc [REDACTED]", "timeout=5000", "help (Authorization Bearer token)"]) {
					assert.ok(surface.includes(structure), `missing nonsecret structure: ${structure}`);
				}
			}
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("agentBrowserExtension redacts bare lowercase credential assignments in subprocess diagnostics without hiding ordinary labels", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-assignment-error-"));
	const basePath = process.env.PATH ?? "";
	const diagnostics = [
		"close rejected for owner-one token=token-value, timeout=5000",
		'owner-two password = "password value"; status=failed',
		"passwd: 'passwd value', reason=denied",
		"secret=secret-value; tokenizer=ordinary",
		'credentials: "credentials value"; secretariat=ordinary',
		"credential='credential value', passwordPolicy=strict",
		"help (Authorization Bearer token)",
		"Authorization: Bearer diagnostic-bearer-secret",
		"authorization: bAsIc diagnostic-basic-secret",
		"Authorization:Bearer diagnostic-prefix/diagnostic-suffix",
		"Authorization:Basic YWJj/ZGVm",
		"Error mongodb://angle-private-user:p>ss@example.com/db#access_token=angle-query-private&ok=1",
		'API_KEY={"value":"json-assignment-secret"}; assignment-context status=failed',
		'secret={ "nested": [ "spaced-assignment-secret" ] }; spaced-context status=failed',
		'Cookie: sid={"value":"json-cookie-secret"}\ncookie-context status=failed',
		'Set-Cookie: sid={ "nested": [ "spaced-cookie-secret" ] }\nset-cookie-context status=failed',
		"PASSWORD=credential-prefix[123]credential-suffix; status=failed",
		"PASSWORD=[123, 456]structured-credential-suffix; status=failed",
		"Error mongodb://private-user:private-prefix[123]private-suffix@example.com/db; status=failed",
		"Redirect /account?key=[query-credential-fragment]&ok=1",
		"Redirect /sso?state=[state-credential-fragment]&ok=1",
		"Redirect /account#access_token={ \"value\": \"fragment-credential\" }&ok=1",
		"Redirect /sso?state=question-private-prefix?question-private-suffix&ok=1",
		"Redirect /account?key=question-private-prefix?question-private-suffix&ok=1",
		"Redirect /account#access_token=question-private-prefix?question-private-suffix&ok=1",
		'https://example.test/?debug={"password":"url-json-private","nested":[{"apiKey":"url-nested-private","status":"ready"}]}&ok=1',
		JSON.stringify({
			message: "token=structured-token-secret",
			apiKey: "structured-key-secret",
			nested: [["secret=nested-structured-secret", { path: "/account" }]],
			headers: ['Cookie: sid={"value":"structured-cookie-secret"}\nheader-context status=failed'],
			urlMessage: "Error mongodb://nested-private-user:nested-private-prefix{123}nested-private-suffix@example.com/db; status=failed",
			urls: [
				'https://example.test/?public={"secret":"outer-url-private","path":"/account"}&ok=1',
				"/sso?state=question-private-prefix?question-private-suffix&ok=1",
				"/account?key=question-private-prefix?question-private-suffix&ok=1",
			],
			note: 'He said "keep diagnostic context".',
		}),
	].join("\n");
	await writeFakeAgentBrowserBinary(
		tempDir,
		`const diagnostics = ${JSON.stringify(diagnostics)};
process.stderr.write(diagnostics);
process.stdout.write(JSON.stringify({ success: false, error: diagnostics }));
process.exitCode = 1;`,
	);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}` }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);
			const result = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["get", "title"] });

			assert.equal(result.isError, true);
			assert.equal(result.details?.failureCategory, "upstream-error");
			const content = result.content.map((entry) => entry.text ?? "").join("\n");
			for (const diagnostic of [String(result.details?.stderr ?? ""), content]) {
				for (const context of ["owner-one", "owner-two", "timeout=5000", "status=failed", "reason=denied", "tokenizer=ordinary", "secretariat=ordinary", "passwordPolicy=strict", "help (Authorization Bearer token)", "Authorization: Bearer [REDACTED]", "authorization: bAsIc [REDACTED]", "assignment-context status=failed", "spaced-context status=failed", "cookie-context status=failed", "set-cookie-context status=failed", "header-context status=failed"]) {
					assert.ok(diagnostic.includes(context), `consumer-visible error must retain diagnostic context: ${context}`);
				}
			}
			const stderr = String(result.details?.stderr ?? "");
			assert.equal(redactSensitiveText(stderr), stderr, "persisted diagnostics remain stable when sanitized again");
			const stderrLines = stderr.split("\n");
			const parsed: unknown = JSON.parse(stderrLines[stderrLines.length - 1]);
			assert.ok(parsed && typeof parsed === "object" && "note" in parsed && parsed.note === 'He said "keep diagnostic context".');
			assert.ok("message" in parsed && typeof parsed.message === "string" && parsed.message.includes("token="));
			assert.ok("nested" in parsed && Array.isArray(parsed.nested) && Array.isArray(parsed.nested[0]));
			assert.ok(JSON.stringify(parsed.nested).includes("/account"));
			assert.ok("headers" in parsed && Array.isArray(parsed.headers) && typeof parsed.headers[0] === "string" && parsed.headers[0].includes("header-context status=failed"));
			assert.ok("urlMessage" in parsed && typeof parsed.urlMessage === "string" && parsed.urlMessage.includes("example.com/db") && parsed.urlMessage.includes("status=failed"));
			assert.ok("urls" in parsed && Array.isArray(parsed.urls) && typeof parsed.urls[0] === "string" && parsed.urls[0].includes("example.test") && parsed.urls[0].includes("ok=1"));
			for (const diagnostic of [String(result.details?.stderr ?? ""), content]) assert.ok(diagnostic.includes("ok=1"));
			for (const credential of ["token-value", "password value", "passwd value", "secret-value", "credentials value", "credential value", "diagnostic-bearer-secret", "diagnostic-basic-secret", "structured-token-secret", "structured-key-secret", "nested-structured-secret", "json-assignment-secret", "spaced-assignment-secret", "json-cookie-secret", "spaced-cookie-secret", "structured-cookie-secret", "credential-prefix", "credential-suffix", "structured-credential-suffix", "private-user", "private-prefix", "private-suffix", "nested-private-user", "nested-private-prefix", "nested-private-suffix"]) {
				assert.equal(JSON.stringify(result).includes(credential), false);
			}
			for (const credential of ["query-credential-fragment", "state-credential-fragment", "fragment-credential", "url-json-private", "url-nested-private", "outer-url-private", "diagnostic-prefix", "diagnostic-suffix", "YWJj", "ZGVm", "angle-private-user", "p>ss", "angle-query-private", "question-private-prefix", "question-private-suffix"]) {
				assert.equal(JSON.stringify(result).includes(credential), false);
			}
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("agentBrowserExtension allows auth password stdin without echoing the secret in tool details", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-auth-stdin-"));
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(
		tempDir,
		`const fs = require("node:fs");
const stdin = fs.readFileSync(0, "utf8");
process.stderr.write("stderr echo: " + stdin);
process.stdout.write(JSON.stringify({ success: true, data: { saved: stdin === "pin", echoed: stdin, nested: { arbitrary: stdin } } }));`,
	);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}` }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);

			const updates: unknown[] = [];
			const result = (await harness.tool.execute(
				"test-tool-call",
				{ args: ["auth", "save", "demo", "--password-stdin"], stdin: "pin" },
				new AbortController().signal,
				(update) => updates.push(update),
				harness.ctx,
			)) as { content: Array<{ type: string; text?: string }>; details?: Record<string, unknown>; isError?: boolean };

			assert.equal(result.isError, false);
			assert.equal(result.details?.sessionName, undefined);
			assert.equal(result.details?.usedImplicitSession, undefined);
			const data = result.details?.data;
			assert.ok(data && typeof data === "object" && "saved" in data && data.saved === true);
			assert.equal(JSON.stringify(updates).includes("pin"), false);
			assert.equal(JSON.stringify(result.details).includes("pin"), false);
			assert.equal(JSON.stringify(result.content).includes("pin"), false);
			assert.equal(JSON.stringify(result.details).includes("[REDACTED]"), true);
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("agentBrowserExtension redacts auth password stdin echoed in upstream failures", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-auth-error-"));
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(
		tempDir,
		`const fs = require("node:fs");
const stdin = fs.readFileSync(0, "utf8");
process.stderr.write("stderr echo: " + stdin);
process.stdout.write(JSON.stringify({ success: false, error: "error echo: " + stdin, data: { arbitrary: stdin } }));
process.exit(1);`,
	);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}` }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);

			const result = await executeRegisteredTool(harness.tool, harness.ctx, {
				args: ["auth", "save", "demo", "--password-stdin"],
				stdin: "super-secret-password",
			});

			assert.equal(result.isError, true);
			assert.equal(JSON.stringify(result.content).includes("super-secret-password"), false);
			assert.equal(JSON.stringify(result.details).includes("super-secret-password"), false);
			assert.match(JSON.stringify(result.content), /\[REDACTED\]/);
			assert.match(JSON.stringify(result.details), /\[REDACTED\]/);
			assert.equal(result.details?.resultCategory, "failure");
			assert.equal(result.details?.failureCategory, "upstream-error");
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("agentBrowserExtension discards auth password parse-failure output", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-auth-parse-"));
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(
		tempDir,
		`const fs = require("node:fs");
const stdin = fs.readFileSync(0, "utf8");
process.stdout.write("invalid-json " + stdin + " " + "x".repeat(600000));`,
	);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}` }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);

			const result = await executeRegisteredTool(harness.tool, harness.ctx, {
				args: ["auth", "save", "demo", "--password-stdin"],
				stdin: "super-secret-password",
			});

			assert.equal(result.isError, true);
			assert.equal(JSON.stringify(result.content).includes("super-secret-password"), false);
			assert.equal(JSON.stringify(result.details).includes("super-secret-password"), false);
			assert.equal(result.details?.fullOutputPath, undefined);
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("agentBrowserExtension renders confirmation recovery and redacts sensitive confirmation context", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-confirm-"));
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(
		tempDir,
		`process.stdout.write(JSON.stringify({ success: false, data: { confirmation_required: true, confirmation_id: "c_sensitive", action: "POST https://user:pass@example.com/delete?token=secret Authorization: Bearer raw-token" } }));
process.exit(1);`,
	);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}` }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);

			const result = await executeRegisteredTool(harness.tool, harness.ctx, {
				args: ["--confirm-actions", "click", "click", "@danger"],
			});

			assert.equal(result.isError, true);
			assert.equal(result.content[0]?.type, "text");
			assert.equal(result.details?.resultCategory, "failure");
			assert.equal(result.details?.failureCategory, "confirmation-required");
			const nextActions = result.details?.nextActions as Array<{ params?: { args: string[] } }> | undefined;
			assert.deepEqual(nextActions?.map((action) => action.params?.args), [
				["--session", result.details?.sessionName, "confirm", "c_sensitive"],
				["--session", result.details?.sessionName, "deny", "c_sensitive"],
			]);
			assert.doesNotMatch(JSON.stringify(result.content), /user:pass|raw-token|token=secret/);
			assert.doesNotMatch(JSON.stringify(result.details), /user:pass|raw-token|token=secret/);
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

