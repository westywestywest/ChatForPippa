import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeMediaURL} from '../public/media.js';
import {validateSettings,allowedRequest} from '../security.js';
import {parseSource,findKey,request,connectTwitch,connectYouTube} from '../adapters.js';

test('chat media rejects local, arbitrary, credentialed and executable URLs',()=>{
 for(const url of ['javascript:alert(1)','data:image/svg+xml,test','https://localhost/a','https://127.0.0.1/a','https://evil.test/tracker','https://media.giphy.com.evil.test/a','https://user:pass@media.giphy.com/a','https://media.giphy.com:9443/a'])assert.equal(safeMediaURL(url),false,url);
 for(const url of ['https://media4.giphy.com/media/abc/giphy.gif?cid=x&ct=g','https://cdn.7tv.app/emote/a/3x.webp','https://yt3.ggpht.com/a','https://static-cdn.jtvnw.net/emoticons/v2/a/default/dark/3.0'])assert.equal(safeMediaURL(url),true,url);
});
test('settings validate shape, finite numbers, CSS limits and credential-free URLs',()=>{
 const base={twitch:'',youtube:'',css:''};assert.equal(validateSettings(base,{allowEmpty:true}).limit,80);
 for(const value of [null,[],{...base,css:{}},{...base,css:'x'.repeat(100001)},{...base,limit:'NaN'},{...base,fade:'Infinity'}])assert.throws(()=>validateSettings(value,{allowEmpty:true}));
 for(const url of ['https://user:pass@twitch.tv/example','https://twitch.tv:9999/example'])assert.throws(()=>parseSource(url,'twitch'));
});
test('host/origin and browser fetch metadata restrict cross-site access',()=>{
 const base={host:'127.0.0.1:3876'};
 assert.equal(allowedRequest({headers:base},3876),true);
 for(const overrides of [{host:'evil.test:3876'},{host:'127.0.0.1:9999'},{origin:'null'},{origin:'https://evil.test'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}])assert.equal(allowedRequest({headers:{...base,...overrides}},3876),false);
});
test('deeply nested platform data does not overflow the call stack',()=>{
 let obj={needle:42};for(let i=0;i<20000;i++)obj={child:obj};assert.equal(findKey(obj,'needle'),42);
});
test('remote responses enforce status, size and redirect policy',async(t)=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 globalThis.fetch=async(_url,opts)=>{assert.equal(opts.redirect,'error');return new Response('ok');};assert.equal(await(await request('https://www.youtube.com')).text(),'ok');
 globalThis.fetch=async()=>new Response('no',{status:429});await assert.rejects(request('https://www.youtube.com'),/HTTP 429/);
 globalThis.fetch=async()=>new Response('large',{headers:{'content-length':9*1024*1024}});await assert.rejects(request('https://www.youtube.com'),/size limit/);
 globalThis.fetch=async()=>new Response(new Uint8Array(8*1024*1024+1));await assert.rejects(request('https://www.youtube.com'),/size limit/);
});
test('Twitch reconnect backs off and abort stops stale messages and pending retries',()=>{
 const sockets=[],scheduled=[],emitted=[];const c=new AbortController();
 class Socket {constructor(){this.readyState=1;this.sent=[];sockets.push(this);}send(s){this.sent.push(s);}close(){this.onclose?.();}}
 connectTwitch('example',e=>emitted.push(e),()=>{},c.signal,()=>{},{WebSocket:Socket,setTimeout:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},clearTimeout:id=>{if(id)scheduled[id-1].cancelled=true;}});
 sockets[0].onopen();sockets[0].onmessage({data:'PING :test\r\n'});assert.ok(sockets[0].sent.includes('PONG :test\r\n'));
 sockets[0].close();assert.equal(scheduled[0].ms,1000);scheduled[0].fn();sockets[1].close();assert.equal(scheduled[1].ms,2000);
 c.abort();assert.equal(scheduled[1].cancelled,true);sockets[1].onmessage({data:':a!b PRIVMSG #example :late\r\n'});assert.equal(emitted.length,0);
});
test('YouTube malformed response reports retry and abort stops recovery',async(t)=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);globalThis.fetch=async()=>new Response('<html>unavailable</html>');
 const c=new AbortController(),states=[];await connectYouTube('abcdefghijk',()=>assert.fail('unexpected message'),(state,detail)=>{states.push(state);if(state==='retrying'){assert.match(detail,/Retrying/);c.abort();}},c.signal);assert.deepEqual(states,['connecting','retrying']);
});
test('YouTube recovers from a transient HTTP failure and delivers messages',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let calls=0;const states=[],messages=[],c=new AbortController();
 globalThis.fetch=async()=>{
  calls++;
  if(calls===1)return new Response('temporarily unavailable',{status:503});
  if(calls===2)return new Response('"INNERTUBE_CONTEXT":{"client":{"clientName":"WEB"}},"INNERTUBE_API_KEY":"fixture";window["ytInitialData"] = {"liveChatRenderer":{"continuations":[{"reloadContinuationData":{"continuation":"fixture"}}]}};');
  return Response.json({continuationContents:{liveChatContinuation:{actions:[{addChatItemAction:{item:{liveChatTextMessageRenderer:{id:'recovered',authorName:{simpleText:'fixture'},message:{runs:[{text:'recovered'}]}}}}}],continuations:[{timedContinuationData:{continuation:'next',timeoutMs:1000}}]}}});
 };
 await connectYouTube('abcdefghijk',e=>{messages.push(e);c.abort();},s=>states.push(s),c.signal);
 assert.ok(states.includes('retrying'));assert.ok(states.includes('connected'));assert.equal(messages[0].id,'recovered');assert.equal(calls,3);
});
test('only a numeric Twitch room-id is used to request 7TV emotes',()=>{
 const sockets=[],rooms=[];class Socket {constructor(){this.readyState=1;sockets.push(this);}send(){}close(){}}
 const c=new AbortController();connectTwitch('example',()=>{},()=>{},c.signal,id=>rooms.push(id),{WebSocket:Socket});
 sockets[0].onmessage({data:'@room-id=../../evil :tmi.twitch.tv ROOMSTATE #example\r\n@room-id=12345 :tmi.twitch.tv ROOMSTATE #example\r\n'});
 c.abort();assert.deepEqual(rooms,['12345']);
});
