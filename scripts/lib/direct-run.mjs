import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Canonical module/argv identity; importing a CLI must remain silent. */
export function isDirectRun(metaUrl, argv1 = process.argv[1]) {
 if (!argv1) return false;
 try { return pathToFileURL(realpathSync(argv1)).href === metaUrl; }
 catch { return false; }
}
