import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
const run=promisify(execFile);

test('live extension harness imports without installing Node test-runner hooks',async()=>{
 const script=`
 import { registerHooks } from 'node:module';
 const hooks=registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='node:test')throw new Error('live harness must not import Node test runner');
  return nextResolve(specifier,context);
 }});
 const harness=await import('./test/helpers/agent-browser-harness.ts');
 if(typeof harness.createExtensionHarness!=='function')throw new Error('missing live harness');
 hooks.deregister();
 console.log('LIVE_HARNESS_IMPORT_OK');
 `;
 const result=await run(process.execPath,['--import','tsx','--input-type=module','-e',script],{timeout:10000,env:{...process.env,NODE_TEST_CONTEXT:undefined}});
 assert.match(result.stdout,/LIVE_HARNESS_IMPORT_OK/);
});
