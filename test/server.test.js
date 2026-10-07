import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createChatServer} from '../server.js';
import http from 'node:http';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'pippachat-test-')),connections=[];
 const adapters={connectTwitch:(channel,emit,status,signal)=>{connections.push({emit,signal});status('connected','fixture');},connectYouTube:async()=>{},loadEmotes:async()=>({map:{},warnings:[]})};
 const settingsFile=join(dir,'settings.json');const app=await createChatServer({port:0,settingsFile,adapters});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`;
 const post=(path,value)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 const snapshot=async()=>{const r=await fetch(base+'/api/events');const reader=r.body.getReader();let text='';while(!text.includes('\n\n')){const {value}=await reader.read();text+=new TextDecoder().decode(value);}await reader.cancel();return JSON.parse(text.split('data: ')[1].split('\n')[0]);};
 return {base,post,snapshot,connections,settingsFile,app};
}
const settings={twitch:'https://www.twitch.tv/example',youtube:'https://www.youtube.com/watch?v=abcdefghijk',css:'',limit:80,fade:0,fontSize:22,theme:'glass'};
test('HTTP server blocks hostile origins, traversal, private files and unexpected methods',async t=>{
 const f=await fixture(t);
 for(const headers of [{origin:'https://evil.test'},{'sec-fetch-site':'cross-site'}])assert.equal((await fetch(f.base+'/api/events',{headers})).status,403,JSON.stringify(headers));
 const hostileHost=await new Promise((resolve,reject)=>{http.get(f.base+'/',{headers:{host:'evil.test'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(hostileHost,403);
 for(const path of ['/settings.json','/.env','/server.js','/../settings.json','/%2e%2e%2fsettings.json','/constructor','/__proto__'])assert.equal((await fetch(f.base+path)).status,404,path);
 assert.equal((await fetch(f.base+'/api/start',{method:'POST',body:'{}'})).status,415);
 assert.equal((await fetch(f.base+'/',{method:'PUT'})).status,404);
 const page=await fetch(f.base+'/');assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(page.headers.get('x-frame-options'),'SAMEORIGIN');assert.equal(page.headers.get('referrer-policy'),'no-referrer');
 assert.match((await fetch(f.base+'/media.js')).headers.get('content-type'),/javascript/);
});
test('invalid or oversized requests do not modify settings or crash the server',async t=>{
 const f=await fixture(t);
 for(const value of [null,[],{...settings,limit:'Infinity'},{...settings,css:'x'.repeat(160000)}])assert.equal((await f.post('/api/settings',value)).status,400);
 assert.equal((await fetch(f.base+'/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'})).status,400);
 assert.equal((await fetch(f.base+'/')).status,200);assert.equal((await f.snapshot()).settings.twitch,'');
});
test('concurrent saves remain valid JSON and match the latest shared state',async t=>{
 const f=await fixture(t);const responses=await Promise.all(Array.from({length:20},(_,i)=>f.post('/api/settings',{...settings,fontSize:12+i,css:`/* ${i} */`})));assert.ok(responses.every(r=>r.ok));
 const disk=JSON.parse(await readFile(f.settingsFile,'utf8'));assert.deepEqual((await f.snapshot()).settings,disk);
});
test('appearance saves before streams are entered, then start/stop/restart cancels old sources',async t=>{
 const f=await fixture(t);assert.equal((await f.post('/api/settings',{...settings,twitch:'',youtube:'',fontSize:30})).status,200);
 assert.equal((await f.post('/api/start',{...settings,twitch:''})).status,400);
 await f.post('/api/start',settings);await f.post('/api/start',settings);assert.equal(f.connections[0].signal.aborted,true);
 f.connections[0].emit({type:'message',id:'stale',platform:'twitch',parts:[]});assert.equal((await f.snapshot()).messages.length,0);
 await f.post('/api/stop');assert.equal(f.connections[1].signal.aborted,true);assert.equal((await f.snapshot()).running,false);
});
test('10,000-message burst is bounded, deduplicated, and moderation clears shared history',async t=>{
 const f=await fixture(t);await f.post('/api/start',settings);const emit=f.connections[0].emit;
 for(let i=0;i<10000;i++)emit({type:'message',platform:'twitch',id:String(i),userId:'u',author:'fixture',parts:[{type:'text',text:'<script>alert(1)</script>'}],timestamp:Date.now()});
 emit({type:'message',platform:'twitch',id:'9999',parts:[]});let s=await f.snapshot();assert.equal(s.messages.length,200);assert.equal(s.messages.at(-1).id,'9999');
 emit({type:'delete',platform:'twitch',id:'9999'});assert.equal((await f.snapshot()).messages.length,199);
 emit({type:'clear',platform:'twitch',userId:'u'});assert.equal((await f.snapshot()).messages.length,0);
});
test('corrupt saved settings fall back to safe defaults',async t=>{
 const f=await fixture(t);await writeFile(f.settingsFile,'{"limit":"Infinity"}');const app=await createChatServer({port:0,settingsFile:f.settingsFile});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/`)).status,200);
});
test('overlay connection limit rejects excess clients and frees slots on disconnect',async t=>{
 const f=await fixture(t),responses=[];
 try{
  for(let i=0;i<32;i++){const r=await fetch(f.base+'/api/events');assert.equal(r.status,200);responses.push(r);}
  assert.equal((await fetch(f.base+'/api/events')).status,429);
  await responses.pop().body.cancel();await new Promise(r=>setTimeout(r,30));
  const replacement=await fetch(f.base+'/api/events');assert.equal(replacement.status,200);responses.push(replacement);
 }finally{await Promise.all(responses.map(r=>r.body.cancel()));}
});
