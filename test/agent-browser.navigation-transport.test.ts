import assert from "node:assert/strict";
import test from "node:test";

import { buildErrorPresentation } from "../extensions/agent-browser/lib/results/presentation/errors.js";
import { parseCommandInfo } from "../extensions/agent-browser/lib/runtime.js";

const transportError = "Invalid response: EOF while parsing a value at line 1 column 0 (after 5 retries - daemon may be busy or unresponsive)";

test("incomplete navigation acknowledgement stays failed with same-session readback actions", () => {
	const args = ["--session", "scout-verification", "open", "https://example.test/job"];
	const result = buildErrorPresentation({ args, commandInfo: parseCommandInfo(args), errorText: transportError, sessionName: "scout-verification" });
	assert.equal(result.resultCategory, "failure");
	assert.match(result.summary ?? "", /Navigation may already have happened/);
	assert.deepEqual(result.nextActions?.slice(0, 2).map((action) => action.params?.args), [
		["--session", "scout-verification", "get", "url"],
		["--session", "scout-verification", "snapshot", "-i"],
	]);
	assert.ok(result.nextActions?.slice(0, 2).every((action) => !action.params?.args?.includes("open")));
});

test("other failures do not invent navigation confirmation or trigger retries", () => {
	const args = ["get", "title"];
	const result = buildErrorPresentation({ args, commandInfo: parseCommandInfo(args), errorText: transportError });
	assert.doesNotMatch(result.summary ?? "", /Navigation may already have happened/);
	assert.ok(!result.nextActions?.some((action) => action.id === "inspect-navigation-outcome"));
});
