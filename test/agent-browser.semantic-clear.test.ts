import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAgentBrowserSemanticAction } from '../extensions/agent-browser/lib/input-modes/semantic-action.js';

for (const target of [{ selector: '#answer' }, { locator: 'label', value: 'Answer' }, { locator: 'role', role: 'textbox', name: 'Answer' }]) {
 test(`semantic fill preserves explicit empty string: ${JSON.stringify(target)}`, () => {
  const result = compileAgentBrowserSemanticAction({ action: 'fill', session: 'pinned', ...target, text: '' });
  assert.equal(result.error, undefined);
  const args = result.compiled!.args;
  assert.equal(args[args.indexOf('fill') + (('selector' in target) ? 2 : 1)], '');
  assert.deepEqual(args.slice(0,2), ['--session', 'pinned']);
 });
 test(`semantic fill still rejects absent/non-string text: ${JSON.stringify(target)}`, () => {
  for (const text of [undefined, null, 123]) assert.ok(compileAgentBrowserSemanticAction({ action: 'fill', ...target, text }).error);
 });
}
