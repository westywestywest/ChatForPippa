import http from 'node:http';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {parseSource,connectTwitch,connectYouTube,loadEmotes,loadBadges} from './adapters.js';
import {allowedRequest,securityHeaders,validateSettings} from './security.js';
export async function createChatServer(options={}) {
const port=options.port??(Number(process.env.PORT)||3876);
const adapters=options.adapters||{connectTwitch,connectYouTube,loadEmotes,loadBadges};
const root=new URL('./public/',import.meta.url);
const settingsFile=options.settingsFile||new URL('./settings.json',import.meta.url);
let settings={twitch:'',youtube:'',css:'',theme:'glass',fontSize:22,limit:80,fade:0};
try{settings=validateSettings(JSON.parse(await readFile(settingsFile,'utf8')),{allowEmpty:true});}catch{}
let mutations=Promise.resolve();
function enqueue(fn){const next=mutations.then(fn);mutations=next.catch(()=>{});return next;}
let controller, running=false, messages=[], emotes={}, badges={}, seen=new Set();
let statuses={twitch:{state:'idle',detail:'Ready to connect'},youtube:{state:'idle',detail:'Ready to connect'},emotes:{state:'idle',detail:'Emotes and badges load with Twitch'}};
const clients=new Set();
function broadcast(type,data){const frame=`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;for(const res of clients){if(res.writableLength>1024*1024){res.destroy();clients.delete(res);}else res.write(frame);}}
function emit(e){
  if(e.type==='message'){if(!e.id)e.id=crypto.randomUUID();const key=`${e.platform}:${e.id}`;if(seen.has(key))return;seen.add(key);if(seen.size>10000)seen.delete(seen.values().next().value);messages.push(e);messages=messages.slice(-200);}
  if(e.type==='delete')messages=messages.filter(m=>m.platform!==e.platform||m.id!==e.id);
  if(e.type==='clear')messages=messages.filter(m=>m.platform!==e.platform||(e.userId&&m.userId!==e.userId));
  broadcast(e.type,e);
}
function status(platform,state,detail){statuses[platform]={state,detail};broadcast('status',statuses);}
function stop(){controller?.abort();controller=null;running=false;status('twitch','idle','Stopped');status('youtube','idle','Stopped');broadcast('running',false);}
function start(){
  const twitch=parseSource(settings.twitch,'twitch'),youtube=parseSource(settings.youtube,'youtube');
  stop();controller=new AbortController();const {signal}=controller;running=true;messages=[];seen.clear();emotes={};badges={};broadcast('reset',{});broadcast('emotes',emotes);broadcast('badges',badges);broadcast('running',true);
  let roomId,loading=false;
  const refresh=async(id)=>{roomId=id;if(loading||!id||signal.aborted)return;loading=true;try{
    const [emoteResult,badgeResult]=await Promise.allSettled([adapters.loadEmotes(id,signal),adapters.loadBadges?adapters.loadBadges(id,signal):Promise.reject(Error('Badges unavailable'))]);if(signal.aborted)return;
    const warnings=[];
    if(emoteResult.status==='fulfilled'){const result=emoteResult.value;warnings.push(...result.warnings);if(Object.keys(result.map).length){emotes=result.map;broadcast('emotes',emotes);}}else warnings.push('emotes');
    if(badgeResult.status==='fulfilled'&&Object.keys(badgeResult.value).length){badges=badgeResult.value;broadcast('badges',badges);}else warnings.push('badges');
    const counts=Object.entries(emoteResult.value?.counts||{}).filter(([,n])=>n).map(([k,n])=>`${k} ${n}`).join(' · ');
    status('emotes',warnings.length?'retrying':'connected',`${Object.keys(emotes).length} emotes${counts?` (${counts})`:''} · ${Object.keys(badges).length?'badge images on':'text badges'}${warnings.length?' · some sources unavailable; refreshing in 5 min':''}`);
  }catch{if(!signal.aborted)status('emotes','retrying','Emotes unavailable; retrying in 5 min');}finally{loading=false;}};
  const interval=setInterval(()=>refresh(roomId),300000);signal.addEventListener('abort',()=>clearInterval(interval),{once:true});
  const activeEmit=e=>{if(!signal.aborted)emit(e);};
  const activeStatus=platform=>(s,d)=>{if(!signal.aborted)status(platform,s,d);};
  adapters.connectTwitch(twitch,activeEmit,activeStatus('twitch'),signal,refresh);
  Promise.resolve(adapters.connectYouTube(youtube,activeEmit,activeStatus('youtube'),signal)).catch(()=>{if(!signal.aborted)status('youtube','error','YouTube connection failed; reconnect to try again.');});
}
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>150000)throw Error('Settings are too large.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
function json(res,data,statusCode=200){res.writeHead(statusCode,{'content-type':'application/json'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
  try{
    for(const [key,value]of Object.entries(securityHeaders))res.setHeader(key,value);
    if(!allowedRequest(req,server.address()?.port||port))return json(res,{error:'Local same-origin access only'},403);
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(req.method==='GET'&&url.pathname==='/api/events'){
      if(clients.size>=32)return json(res,{error:'Too many connected overlays'},429);
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive'});clients.add(res);
      res.write(`event: snapshot\ndata: ${JSON.stringify({settings,statuses,running,messages,emotes,badges})}\n\n`);
      const timer=setInterval(()=>{if(res.writableLength>1024*1024)res.destroy();else res.write(': heartbeat\n\n');},15000);res.on('close',()=>{clearInterval(timer);clients.delete(res);});return;
    }
    if(req.method==='POST'){
      if(req.headers['content-type']!=='application/json')return json(res,{error:'JSON required'},415);
      if(url.pathname==='/api/settings'||url.pathname==='/api/start'){
        const next=validateSettings(await body(req),{allowEmpty:url.pathname==='/api/settings'});
        await enqueue(async()=>{
          const temporary=settingsFile instanceof URL?new URL('./settings.tmp',settingsFile):settingsFile+'.tmp';
          await writeFile(temporary,JSON.stringify(next,null,2),{mode:0o600});await rename(temporary,settingsFile);
          settings=next;broadcast('settings',settings);if(url.pathname==='/api/start')start();
        });return json(res,{ok:true});
      }
      if(url.pathname==='/api/stop'){await enqueue(()=>stop());return json(res,{ok:true});}
      if(url.pathname==='/api/clear'){await enqueue(()=>{messages=[];broadcast('reset',{});});return json(res,{ok:true});}
      return json(res,{error:'Not found'},404);
    }
    const paths={'/':'index.html','/overlay':'overlay.html','/style.css':'style.css','/app.js':'app.js','/overlay.js':'overlay.js','/media.js':'media.js'};
    const path=Object.hasOwn(paths,url.pathname)?paths[url.pathname]:null;if(!path||req.method!=='GET')return json(res,{error:'Not found'},404);
    const content=await readFile(new URL(path,root));res.writeHead(200,{'content-type':path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html','cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(content);
  }catch(e){if(!res.headersSent)json(res,{error:e.code?'Unable to save settings. Check folder permissions.':e.message},400);else res.destroy();}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.maxConnections=64;
return {server,close:async()=>{await mutations;stop();for(const res of clients)res.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const {server}=await createChatServer();const port=Number(process.env.PORT)||3876;
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'PippaChat is already running, or its port is in use. Open the existing studio.':'Unable to start local server.');process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log(`PippaChat ready: http://127.0.0.1:${port}\nOBS browser source: http://127.0.0.1:${port}/overlay`));
}
