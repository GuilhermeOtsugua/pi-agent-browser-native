// Opt-in smoke: only disposable targets on an explicitly supplied loopback CDP browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { runAgentBrowserProcess } from '../extensions/agent-browser/lib/process.js';
import { compileAgentBrowserSemanticAction } from '../extensions/agent-browser/lib/input-modes/semantic-action.js';

const endpoint=process.env.PI_BROWSER_SMOKE_CDP;
if(!endpoint)throw Error('Set PI_BROWSER_SMOKE_CDP to the authorized loopback CDP endpoint.');
const u=new URL(endpoint);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));
const checks:string[]=[];
const fallback = process.env.PI_BROWSER_SMOKE_FALLBACK ? await import(pathToFileURL(process.env.PI_BROWSER_SMOKE_FALLBACK).href) : undefined;
async function connect(url:string){
 const ws=new WebSocket(url);await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(Error('WebSocket open timeout')),5000);ws.onopen=()=>{clearTimeout(t);resolve()};ws.onerror=()=>{clearTimeout(t);reject(Error('WebSocket error'))}});
 let id=0;const pending=new Map<number,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();
 ws.onmessage=e=>{const m=JSON.parse(String(e.data));const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 return {close:()=>ws.close(),send:(method:string,params:object={})=>new Promise<any>((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method))},7000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id:n,method,params}))})};
}
const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';function App(){const[value,setValue]=useState('prefilled');const[stage,setStage]=useState('Editing');const[choice,setChoice]=useState('');return React.createElement('main',{},React.createElement('h1',{},stage),React.createElement('label',{},'Answer',React.createElement('input',{id:'answer',value,onChange:e=>setValue(e.target.value)})),React.createElement('label',{},'Source',React.createElement('input',{id:'source',role:'combobox',value:choice,onChange:e=>setChoice(e.target.value)})),React.createElement('button',{id:'option',onClick:()=>setChoice('Other')},'Other'),React.createElement('output',{id:'state'},value),React.createElement('button',{id:'continue',onClick:()=>setStage('Review '+value+' '+choice)},'Continue'),React.createElement('button',{id:'submit',onClick:()=>document.body.dataset.submitted='true'},'Submit'));}createRoot(document.getElementById('root')).render(React.createElement(App));`,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'iife'});
const html=`<!doctype html><title>Attached regression fixture</title><div id="root"></div><script>${bundle.outputFiles![0]!.text}</script>`;
const server=createServer((_,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(html)});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=(server.address() as {port:number}).port;
const url=`http://127.0.0.1:${port}/fixture`;
const session=`pin-smoke-${Date.now()}`;
const targets:string[]=[];
let root:Awaited<ReturnType<typeof connect>>|undefined,page:Awaited<ReturnType<typeof connect>>|undefined;
const rpcStart=Date.now();
async function native(args:string[],stdin?:string){const r=await runAgentBrowserProcess({args:['--json','--session',session,...args],cwd:process.cwd(),stdin,timeoutMs:15000,preserveAttachedBrowserSession:true});assert.equal(r.timedOut,false,`timeout ${args[0]}`);assert.equal(r.spawnError,undefined);const data=JSON.parse(r.stdout);return {r,data};}
try{
 const ver=await(await fetch(endpoint+'/json/version')).json();root=await connect(ver.webSocketDebuggerUrl);
 const t=await root.send('Target.createTarget',{url,newWindow:true});targets.push(t.targetId);
 const list=await(await fetch(endpoint+'/json/list')).json();page=await connect(list.find((x:any)=>x.id===t.targetId).webSocketDebuggerUrl);
 const evaluate=async(expression:string)=>(await page!.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
 for(let i=0;i<30 && !await evaluate('!!document.querySelector("#answer")');i++)await new Promise(r=>setTimeout(r,100));
 assert.equal((await native(['--cdp',endpoint,'--pin-tab','tab',t.targetId])).data.success,true);checks.push('cold attach returns without inherited-pipe hang');
 assert.equal((await native(['fill','#answer','replacement ação'])).data.success,true);
 assert.equal(await evaluate('document.querySelector("#state").textContent'),'replacement ação');checks.push('React controlled replacement + Unicode');
 for(const target of [{selector:'#answer'},{locator:'label',value:'Answer'},{locator:'role',role:'textbox',name:'Answer'}]){
  const plan=compileAgentBrowserSemanticAction({action:'fill',...target,text:''});assert.equal(plan.error,undefined);
  assert.equal((await native(plan.compiled!.args)).data.success,true);
  assert.equal(await evaluate('document.querySelector("#answer").value'),'');
  // Empty native fill may clear only the DOM in a controlled React input.
  // Verify the exact-target trusted CDP fallback, never synthetic click replay.
  await native(['fill','#answer','replacement']);
  if (fallback) {
    await fallback.run({endpoint,targetId:t.targetId,url,heading:'Editing',action:'fill',selector:'#answer',text:''});
  } else {
    await page.send('Page.bringToFront');
    await evaluate('document.querySelector("#answer").focus();document.querySelector("#answer").select()');
    await page.send('Input.insertText',{text:''});
  }
  let state = await evaluate('({value:document.querySelector("#answer").value,state:document.querySelector("#state").textContent,active:document.activeElement.id})');
  for(let i=0;i<20 && state.state!=='';i++){await new Promise(r=>setTimeout(r,100));state=await evaluate('({value:document.querySelector("#answer").value,state:document.querySelector("#state").textContent,active:document.activeElement.id})');}
  assert.equal(state.state,'',JSON.stringify(state));
  await native(['fill','#answer','replacement']);
 }
 checks.push('semantic empty argv accepted; controlled React clear via exact-target trusted CDP fallback');
 await native(['fill','#source','O']);await native(['click','#option']);assert.equal(await evaluate('document.querySelector("#source").value'),'Other');checks.push('controlled custom combobox choice');
 const decoy=await root.send('Target.createTarget',{url});targets.push(decoy.targetId);await root.send('Target.activateTarget',{targetId:decoy.targetId});
 await native(['click','#continue']);assert.equal(await evaluate('document.querySelector("h1").textContent'),'Review replacement Other');checks.push('same-URL decoy does not steal pinned click');
 assert.equal(await evaluate('document.body.dataset.submitted'),undefined);checks.push('submit untouched');
 if(fallback){
  await assert.rejects(fallback.run({endpoint,targetId:t.targetId,url,heading:'Wrong stage',action:'fill',selector:'#answer',text:'must not write'}));
  assert.equal(await evaluate('document.querySelector("#answer").value'),'replacement');
  const captured=await fallback.run({endpoint,targetId:t.targetId,url,heading:'Review replacement Other',action:'screenshot',path:join(process.cwd(),'.fallback-smoke.png')});
  assert.ok(captured.bytes>0);assert.match(captured.sha256,/^[a-f0-9]{64}$/);await rm('.fallback-smoke.png');
  checks.push('maintained fallback rejects wrong stage and verifies screenshot');
 }
 const shot=await native(['screenshot',join(process.cwd(),'.attached-smoke.png')]);assert.equal(shot.data.success,true);const png=await readFile('.attached-smoke.png');assert.equal(png.subarray(1,4).toString(),'PNG');checks.push('screenshot file verified');await rm('.attached-smoke.png');
 await root.send('Target.closeTarget',{targetId:t.targetId});targets.splice(targets.indexOf(t.targetId),1);
 const gone=await native(['get','url']);assert.equal(gone.data.success,false);assert.match(JSON.stringify(gone.data),/tab_gone/);checks.push('closed pinned target fails rather than retargeting');
 console.log(JSON.stringify({checks,passed:checks.length,elapsedMs:Date.now()-rpcStart},null,2));
}finally{
 page?.close();if(root){for(const targetId of targets)await root.send('Target.closeTarget',{targetId}).catch(()=>{});root.close()}
 server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
 await rm('.attached-smoke.png',{force:true});
 await rm('.fallback-smoke.png',{force:true});
 // Stop only this uniquely named test daemon; never send browser-wide close on an attachment.
 const pidFile=join(homedir(),'.agent-browser',session+'.pid');
 try{const pid=Number((await readFile(pidFile,'utf8')).trim());if(Number.isInteger(pid)&&pid>0)process.kill(pid);}catch{}
 for(const suffix of ['pid','port','config','target','stream','version'])await rm(join(homedir(),'.agent-browser',session+'.'+suffix),{force:true});
}
