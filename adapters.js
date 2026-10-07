import {setTimeout as sleep} from 'node:timers/promises';
import {safeMediaURL} from './public/media.js';

export function parseSource(value, platform) {
  const u = new URL(value);
  if (u.protocol !== 'https:'||u.username||u.password||(u.port&&u.port!=='443')) throw Error('Use an https stream URL without credentials or custom ports.');
  if (platform === 'twitch' && /^(www\.)?twitch\.tv$/.test(u.hostname) && /^\/[a-zA-Z0-9_]+\/?$/.test(u.pathname)) return u.pathname.split('/')[1].toLowerCase();
  if (platform === 'youtube' && ['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname)) {
    const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') || u.pathname.match(/^\/live\/([^/]+)/)?.[1];
    if (/^[\w-]{11}$/.test(id || '')) return id;
  }
  throw Error(`Enter a valid ${platform === 'twitch' ? 'Twitch channel' : 'YouTube video'} URL.`);
}
export function extractJSON(html, marker) {
  let start = html.indexOf(marker);
  if (start < 0) throw Error(`YouTube page changed: missing ${marker}.`);
  start = html.indexOf('{', start + marker.length);
  let depth = 0, quoted = false, escape = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw Error('Incomplete YouTube page.');
}
export function findKey(obj, key) {
  const stack=[obj];let visited=0;
  while(stack.length&&visited++<100000){const item=stack.pop();if(!item||typeof item!=='object')continue;if(Object.hasOwn(item,key))return item[key];const values=Object.values(item);for(let i=values.length-1;i>=0;i--)if(values[i]&&typeof values[i]==='object')stack.push(values[i]);}
}
const list = x => Array.isArray(x) ? x : [];
const text = x => x?.simpleText || x?.runs?.map(r => r.text || '').join('') || '';
const thumb = x => x?.thumbnails?.at(-1)?.url;
export function youtubeEvents(actions = []) {
  const events = [];
  for (const a of (Array.isArray(actions)?actions:[])) {
    if(!a||typeof a!=='object')continue;
    if (a.removeChatItemAction) { events.push({type:'delete', id:a.removeChatItemAction.targetItemId}); continue; }
    if (a.markChatItemsByAuthorAsDeletedAction) { events.push({type:'clear', userId:a.markChatItemsByAuthorAsDeletedAction.externalChannelId}); continue; }
    if (a.markChatItemAsDeletedAction) { events.push({type:'delete', id:a.markChatItemAsDeletedAction.targetItemId}); continue; }
    const item = a.addChatItemAction?.item || a.replaceChatItemAction?.replacementItem;
    if (!item) continue;
    const pair = Object.entries(item).find(([k]) => /^liveChat(TextMessage|PaidMessage|PaidSticker|MembershipItem|SponsorshipsGiftPurchaseAnnouncement|SponsorshipsGiftRedemptionAnnouncement)Renderer$/.test(k));
    if (!pair) continue;
    const [kind,r] = pair;
    const parts = (r.message?.runs || r.headerSubtext?.runs || r.primaryText?.runs || []).map(run => run.emoji ? {type:'image', url:thumb(run.emoji.image), text:run.emoji.shortcuts?.[0] || run.emoji.emojiId || 'emote'} : {type:'text', text:run.text || ''});
    if (r.sticker) parts.push({type:'sticker',url:thumb(r.sticker),text:r.sticker.accessibility?.accessibilityData?.label || 'Super Sticker'});
    events.push({type:'message', platform:'youtube', id:r.id, userId:r.authorExternalChannelId, author:text(r.authorName), color:'#ff9c9c', parts, amount:text(r.purchaseAmountText), kind, badges:list(r.authorBadges).map(b=>b?.liveChatAuthorBadgeRenderer).filter(Boolean).map(b=>({text:typeof b.tooltip==='string'?b.tooltip:'',url:thumb(b.customThumbnail),icon:b.icon?.iconType?.toLowerCase()})).filter(b=>b.text||b.url), timestamp:Number(r.timestampUsec)/1000 || Date.now()});
  }
  return events;
}
const unescapeTag = s => s.replace(/\\([s:nr\\])/g, (_,c)=>({s:' ',':':';',n:'\n',r:'\r','\\':'\\'}[c]));
export function parseIRC(line) {
  let tags = {};
  if (line.startsWith('@')) { const end = line.indexOf(' '); tags = Object.fromEntries(line.slice(1,end).split(';').map(v=>{const i=v.indexOf('=');return [v.slice(0,i),unescapeTag(v.slice(i+1))]})); line=line.slice(end+1); }
  const match = line.match(/^(?::([^ ]+) )?([^ ]+)(?: ([^:]*))?(?: :(.*))?$/);
  return match ? {tags,prefix:match[1],command:match[2],params:(match[3]||'').trim().split(' '),body:match[4]||''} : null;
}
export function twitchParts(body, emotes = '', gifs = '') {
  const chars=Array.from(body), spans=[];
  // GIF Keyboard messages have their own IRC tag; they are not emotes.
  // Keep the exact supplied URL, including GIPHY attribution parameters.
  for (const entry of gifs.split(',')) {
    const match=entry.match(/^(\d+)-(\d+)\|([^|]+)\|(.+)$/);
    if(!match)continue;
    const [,start,end,id,url]=match;
    if(!safeMediaURL(url))continue;
    const a=Number(start),b=Math.min(Number(end),chars.length-1);
    if(a>b||a>=chars.length)continue;
    spans.push({a,b,id,url,type:'gif'});
  }
  for (const e of emotes.split('/')) { const [id,ranges]=e.split(':'); if (!ranges) continue; for(const range of ranges.split(',')){const [a,b]=range.split('-').map(Number);spans.push({a,b,id});} }
  spans.sort((a,b)=>a.a-b.a);
  let cursor=0;const parts=[];
  for(const {a,b,id,url,type} of spans){if(!Number.isInteger(a)||!Number.isInteger(b)||a<cursor||b<a||b>=chars.length)continue;if(a>cursor)parts.push({type:'text',text:chars.slice(cursor,a).join('')});parts.push({type:type||'image',text:chars.slice(a,b+1).join(''),url:url||`https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/3.0`});cursor=b+1;}
  if(cursor<chars.length)parts.push({type:'text',text:chars.slice(cursor).join('')});return parts;
}
export async function request(url, options={}) {
  const signal=options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
  const r=await fetch(url,{...options,redirect:'error',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36','accept-language':'en-US,en;q=0.9',...options.headers},signal});
  if(!r.ok){await r.body?.cancel();throw Error(`Remote service returned HTTP ${r.status}`);}
  const max=8*1024*1024;
  if(Number(r.headers.get('content-length'))>max){await r.body?.cancel();throw Error('Remote response exceeds size limit.');}
  const chunks=[];let size=0;
  for await(const chunk of r.body){size+=chunk.length;if(size>max)throw Error('Remote response exceeds size limit.');chunks.push(chunk);}
  const text=Buffer.concat(chunks).toString('utf8');
  return {text:async()=>text,json:async()=>JSON.parse(text)};
}
export function connectTwitch(channel, emit, status, signal, room, runtime={}) {
  const Socket=runtime.WebSocket||WebSocket;
  const schedule=runtime.setTimeout||setTimeout, cancel=runtime.clearTimeout||clearTimeout;
  let ws, retry=0, timer, heartbeat;
  const connect=()=>{
    if(signal.aborted)return;
    status('connecting','Connecting anonymously…');
    ws=new Socket('wss://irc-ws.chat.twitch.tv:443');
    let last=Date.now();
    ws.onopen=()=>{ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');ws.send(`NICK justinfan${Math.floor(Math.random()*900000)+100000}\r\n`);ws.send(`JOIN #${channel}\r\n`);};
    heartbeat=setInterval(()=>{if(Date.now()-last>90000)ws.close();else if(ws.readyState===1)ws.send('PING :pippachat\r\n');},30000);
    ws.onmessage=({data})=>{
      if(signal.aborted)return;
      if(String(data).length>1024*1024){ws.close();return;}
      last=Date.now();
      for(const line of String(data).split('\r\n')){
        if(line.startsWith('PING')){ws.send(line.replace('PING','PONG')+'\r\n');continue;}
        const p=parseIRC(line);if(!p)continue;
        if(p.command==='ROOMSTATE'){retry=0;status('connected',`Connected to ${channel}`);if(/^\d{1,20}$/.test(p.tags['room-id']||''))room(p.tags['room-id']);}
        if(p.command==='RECONNECT')ws.close();
        if(p.command==='NOTICE')status('error',p.body);
        if(p.command==='CLEARMSG')emit({type:'delete',platform:'twitch',id:p.tags['target-msg-id']});
        if(p.command==='CLEARCHAT')emit({type:'clear',platform:'twitch',userId:p.tags['target-user-id']});
        if(p.command==='PRIVMSG')emit({type:'message',platform:'twitch',id:p.tags.id,userId:p.tags['user-id'],author:p.tags['display-name']||p.prefix?.split('!')[0],color:p.tags.color||'#bda5ff',parts:twitchParts(p.body,p.tags.emotes,p.tags.gifs),badges:(p.tags.badges||'').split(',').filter(Boolean).map(id=>({id,text:id.split('/')[0]})),timestamp:Number(p.tags['tmi-sent-ts'])||Date.now()});
      }
    };
    ws.onerror=()=>ws.close();
    ws.onclose=()=>{clearInterval(heartbeat);if(!signal.aborted){const delay=Math.min(30000,1000*2**Math.min(retry++,5));status('retrying',`Connection lost; retrying in ${delay/1000}s`);timer=schedule(connect,delay);}};
  };
  signal.addEventListener('abort',()=>{cancel(timer);clearInterval(heartbeat);ws?.close();},{once:true});connect();
}
export async function connectYouTube(videoId, emit, status, signal) {
  let failures=0;
  while(!signal.aborted){
    try{
      status('connecting','Opening public live chat…');
      const html=await (await request(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`,{signal})).text();
      const config={INNERTUBE_CONTEXT:extractJSON(html,'"INNERTUBE_CONTEXT":'),INNERTUBE_API_KEY:html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]};
      const initial=extractJSON(html,html.includes('window["ytInitialData"] =')?'window["ytInitialData"] =':'var ytInitialData =');
      let chat=findKey(initial,'liveChatRenderer');
      if(!chat)throw Error('Live chat is unavailable, ended, or requires sign-in.');
      // Select Live chat instead of the default filtered Top chat.
      const menu=chat.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems;
      let token=menu?.find(x=>/live chat/i.test(x.title))?.continuation?.reloadContinuationData?.continuation;
      token ||= findKey(chat.continuations,'continuation');
      if(!token)throw Error('YouTube did not supply a live chat continuation.');
      const context=config.INNERTUBE_CONTEXT;
      if(!context?.client || !config.INNERTUBE_API_KEY)throw Error('YouTube page format changed; adapter needs updating.');
      while(!signal.aborted){
        const data=await (await request(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(config.INNERTUBE_API_KEY)}`,{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({context,continuation:token})})).json();
        chat=data.continuationContents?.liveChatContinuation;
        if(!chat)throw Error('Live chat ended or YouTube changed its response.');
        failures=0;status('connected','Connected to YouTube Live chat');
        for(const e of youtubeEvents(chat.actions))emit({...e,platform:'youtube'});
        const next=chat.continuations?.map(c=>c.timedContinuationData||c.invalidationContinuationData||c.reloadContinuationData).find(Boolean);
        if(!next?.continuation)throw Error('Live chat ended; waiting for it to return.');
        token=next.continuation;
        await sleep(Math.max(1000,Math.min(15000,next.timeoutMs||3000)),null,{signal});
      }
    }catch(e){if(signal.aborted)return;const delay=Math.min(60000,2000*2**Math.min(failures++,5));status('retrying',`${e.message} Retrying in ${delay/1000}s.`);try{await sleep(delay,null,{signal});}catch{return;}}
  }
}
const sevenTV = data => list(data.emote_set?.emotes||data.emotes).map(e=>{const host=e?.data?.host;const file=host?.files?.find(f=>f.name==='3x.webp')||host?.files?.find(f=>f.format==='WEBP');return file&&{name:e.name,url:`https:${host.url}/${file.name}`,zeroWidth:!!(e.data.flags&256)};});
const bttv = emotes => list(emotes).map(e=>/^[a-f\d]{24}$/.test(e?.id)&&{name:e.code,url:`https://cdn.betterttv.net/emote/${e.id}/3x`});
const ffz = emotes => list(emotes).map(e=>({name:e?.code,url:e?.images?.['4x']||e?.images?.['2x']||e?.images?.['1x']}));
// Later sources win name conflicts: channel over global, then 7TV over BTTV over FFZ.
export async function loadEmotes(roomId, signal) {
  const map=Object.create(null), warnings=[], counts={'7TV':0,BTTV:0,FFZ:0};
  const sources=[
    ['FFZ','https://api.betterttv.net/3/cached/frankerfacez/emotes/global',ffz],
    ['BTTV','https://api.betterttv.net/3/cached/emotes/global',bttv],
    ['7TV','https://7tv.io/v3/emote-sets/global',sevenTV],
    ['FFZ',`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${roomId}`,ffz],
    ['BTTV',`https://api.betterttv.net/3/cached/users/twitch/${roomId}`,d=>[...bttv(d.channelEmotes),...bttv(d.sharedEmotes)]],
    ['7TV',`https://7tv.io/v3/users/twitch/${roomId}`,sevenTV]
  ];
  const results=await Promise.allSettled(sources.map(([,url])=>request(url,{signal}).then(r=>r.json())));
  results.forEach((result,i)=>{
    const [name,,parse]=sources[i];
    // A channel without BTTV/FFZ/7TV emotes answers 404; that is not a failure.
    if(result.status==='rejected'){if(!/HTTP 404/.test(result.reason?.message))warnings.push(`${name}: ${result.reason?.message}`);return;}
    try{for(const e of parse(result.value||{}))if(e&&typeof e.name==='string'&&e.name.length<=100&&safeMediaURL(e.url)){map[e.name]={url:e.url,zeroWidth:!!e.zeroWidth,source:name};}}catch(e){warnings.push(`${name}: ${e.message}`);}
  });
  for(const e of Object.values(map))counts[e.source]++;
  return {map,warnings,counts};
}
// Twitch's official badge API requires an app token, so badge images come from
// the public ivr.fi mirror. If it is unavailable, badges fall back to text.
export async function loadBadges(roomId, signal) {
  const map=Object.create(null);
  for(const url of ['https://api.ivr.fi/v2/twitch/badges/global',`https://api.ivr.fi/v2/twitch/badges/channel?id=${roomId}`]){
    const sets=await(await request(url,{signal})).json();
    for(const set of list(sets))for(const v of list(set?.versions)){
      const image=v?.image_url_2x||v?.image_url_1x;
      if(typeof set.set_id==='string'&&typeof v.id==='string'&&safeMediaURL(image))map[`${set.set_id}/${v.id}`]={url:image,title:typeof v.title==='string'?v.title:set.set_id};
    }
  }
  return map;
}
