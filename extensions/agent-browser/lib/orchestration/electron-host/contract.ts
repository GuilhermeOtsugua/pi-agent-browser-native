import type { ElectronLaunchRecord } from "../../electron/launch.js";
import { isRecord } from "../../parsing.js";

export type { ElectronLaunchRecord } from "../../electron/launch.js";

// Registration and branch replay need only this pure contract, not host execution.
export const ELECTRON_PROFILE_ISOLATION_NOTE = "Profile note: electron.launch starts an isolated temporary profile; it does not reuse the app's normal signed-in profile or attach to an already-running authenticated app.";
export const ELECTRON_EXISTING_AUTH_GUIDANCE = "For already-authenticated desktop app content, do not stop here: if host tools are allowed and the app is not running, launch the normal app with --remote-debugging-port=<port>, verify the port, then run agent_browser connect <port>; if it is already running without a debug port, ask before relaunching it.";
export const ELECTRON_PROFILE_ISOLATION_DETAILS = {
	attachesToAlreadyRunningApp: false,
	existingAuthenticatedAppGuidance: ELECTRON_EXISTING_AUTH_GUIDANCE,
	hostDebugLaunchExample: "macOS: open -a <App Name> --args --remote-debugging-port=9222 --remote-allow-origins='*'; then agent_browser connect 9222 with sessionMode=fresh",
	isolatedLaunch: true,
	note: ELECTRON_PROFILE_ISOLATION_NOTE,
	reusesExistingSignedInProfile: false,
} as const;
export const ELECTRON_POST_COMMAND_STATUS_SETTLE_MS = 250;

function isElectronLaunchRecord(value: unknown): value is ElectronLaunchRecord {
	if (!isRecord(value)) return false;
	return value.version === 1 &&
		value.launchedByWrapper === true &&
		(value.namespace === undefined || typeof value.namespace === "string") &&
		typeof value.launchId === "string" &&
		typeof value.appName === "string" &&
		typeof value.executablePath === "string" &&
		typeof value.userDataDir === "string" &&
		typeof value.port === "number" &&
		typeof value.createdAtMs === "number";
}

export function restoreElectronLaunchRecordsFromBranch(branch: unknown[]): Map<string, ElectronLaunchRecord> {
	const records = new Map<string, ElectronLaunchRecord>();
	for (const entry of branch) {
		if (!isRecord(entry) || entry.type !== "message") continue;
		const message = isRecord(entry.message) ? entry.message : undefined;
		if (!message || message.toolName !== "agent_browser") continue;
		const details = isRecord(message.details) ? message.details : undefined;
		const electron = isRecord(details?.electron) ? details.electron : undefined;
		if (!electron) continue;
		const namespace = typeof details?.namespace === "string" ? details.namespace : undefined;
		const launch = isElectronLaunchRecord(electron.launch) ? electron.launch : undefined;
		if (launch) records.set(launch.launchId, { ...launch, namespace: launch.namespace ?? namespace });
		const cleanupRecords = isRecord(electron.cleanup) && Array.isArray(electron.cleanup.records) ? electron.cleanup.records : [];
		for (const cleanupRecord of cleanupRecords) {
			if (isElectronLaunchRecord(cleanupRecord)) records.set(cleanupRecord.launchId, { ...cleanupRecord, namespace: cleanupRecord.namespace ?? namespace });
		}
	}
	return records;
}
