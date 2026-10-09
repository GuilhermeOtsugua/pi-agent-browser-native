import { resolveWindowsNativeLauncher } from '../../extensions/agent-browser/lib/windows-native-launcher.js';

/** Keep maintainer checks on the same first PATH install as the native tool. */
export async function resolveAgentBrowserExecutable(platform = process.platform, path = process.env.PATH) {
 if (platform !== 'win32') return 'agent-browser';
 const native = await resolveWindowsNativeLauncher(path);
 if (!native) throw new Error('Cannot resolve the first PATH agent-browser install to its native executable. Use a standard npm install or agent-browser.exe first on PATH; diagnostics must not select a later install.');
 return native;
}
