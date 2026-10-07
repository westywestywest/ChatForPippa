import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSource,extractJSON,parseIRC,twitchParts,youtubeEvents,loadEmotes,loadBadges} from '../adapters.js';
test('only valid platform URLs are accepted',()=>{
 assert.equal(parseSource('https://www.twitch.tv/Pippa','twitch'),'pippa');
 assert.equal(parseSource('https://youtu.be/tUNA4QeziCw','youtube'),'tUNA4QeziCw');
 assert.equal(parseSource('https://www.youtube.com/live/tUNA4QeziCw','youtube'),'tUNA4QeziCw');
 for(const url of ['https://evil.com/watch?v=tUNA4QeziCw','http://youtube.com/watch?v=tUNA4QeziCw','https://youtube.com/watch?v=../bad'])assert.throws(()=>parseSource(url,'youtube'));
 assert.throws(()=>parseSource('https://twitch.tv/pippa/chat','twitch'));
});
test('JSON extraction handles nested objects and braces inside strings',()=>{assert.deepEqual(extractJSON('prefix marker {"a":{"b":"}\\\"{"},"c":3};suffix','marker'),{a:{b:'}"{'},c:3});assert.throws(()=>extractJSON('missing','marker'));});
test('IRC tags, deletion IDs and escaped names survive parsing',()=>{const p=parseIRC('@display-name=Some\\sName;target-msg-id=abc :tmi.twitch.tv CLEARMSG #pippa :removed');assert.equal(p.command,'CLEARMSG');assert.equal(p.tags['display-name'],'Some Name');assert.equal(p.tags['target-msg-id'],'abc');assert.equal(p.body,'removed');});
test('Twitch emote offsets use Unicode codepoints',()=>{const p=twitchParts('😀 Kappa hi','25:2-6');assert.equal(p[0].text,'😀 ');assert.equal(p[1].text,'Kappa');assert.equal(p[1].type,'image');assert.equal(p[2].text,' hi');});
test('GIF Keyboard tags preserve full URL and render as large GIF parts',()=>{
 const url='https://media4.giphy.com/media/joSNxeswxuc74Juo8X/giphy.gif?cid=example&ep=v1_gifs_trending&rid=giphy.gif&ct=g';
 const parsed=parseIRC(`@gifs=0-33|joSNxeswxuc74Juo8X|${url};emotes=;id=gif-test :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #pippa :[Y A Y Yes GIF by Djemilah Birnie]`);
 const parts=twitchParts(parsed.body,parsed.tags.emotes,parsed.tags.gifs);
 assert.equal(parts.length,1);assert.equal(parts[0].type,'gif');assert.equal(parts[0].url,url);assert.equal(parts[0].text,parsed.body);
});
test('GIFs can coexist with text, Unicode, native emotes and multiple GIFs',()=>{
 const a='https://media.giphy.com/media/a/giphy.gif?x=a=b', b='https://media.giphy.com/media/b/giphy.gif';
 const parts=twitchParts('😀 Kappa [one] hi [two]','25:2-6',`8-12|a|${a},17-21|b|${b}`);
 assert.deepEqual(parts.map(p=>p.type),['text','image','text','gif','text','gif']);assert.equal(parts[3].url,a);assert.equal(parts[5].url,b);assert.equal(parts.map(p=>p.text).join(''),'😀 Kappa [one] hi [two]');
});
test('bad GIF metadata leaves readable text and cannot supply executable URLs',()=>{
 for(const tag of ['bad','9-1|a|https://example.com/a.gif','0-4|a|javascript:alert(1)','0-4|a|http://example.com/a.gif'])assert.deepEqual(twitchParts('[gif]','',tag),[{type:'text',text:'[gif]'}]);
});
test('YouTube emoji, stickers, donations and moderation normalize',()=>{
 const renderer={id:'a',authorName:{simpleText:'Viewer'},authorExternalChannelId:'u',purchaseAmountText:{simpleText:'$5'},sticker:{thumbnails:[{url:'https://example.com/sticker.png'}]},message:{runs:[{text:'Hi '},{emoji:{emojiId:':wave:',image:{thumbnails:[{url:'https://example.com/emote.png'}]}}}]}};
 const events=youtubeEvents([{addChatItemAction:{item:{liveChatPaidStickerRenderer:renderer}}},{markChatItemAsDeletedAction:{targetItemId:'a'}},{markChatItemsByAuthorAsDeletedAction:{externalChannelId:'u'}}]);
 assert.equal(events[0].amount,'$5');assert.deepEqual(events[0].parts.map(p=>p.type),['text','image','sticker']);assert.equal(events[1].id,'a');assert.equal(events[2].userId,'u');
});
test('YouTube member badges keep their image; mod/owner badges keep their icon type',()=>{
 const authorBadges=[{liveChatAuthorBadgeRenderer:{tooltip:'Member (6 months)',customThumbnail:{thumbnails:[{url:'https://yt3.ggpht.com/small'},{url:'https://yt3.ggpht.com/large'}]}}},{liveChatAuthorBadgeRenderer:{tooltip:'Moderator',icon:{iconType:'MODERATOR'}}},null,{}];
 const [e]=youtubeEvents([{addChatItemAction:{item:{liveChatTextMessageRenderer:{id:'m',authorName:{simpleText:'Viewer'},message:{runs:[{text:'hi'}]},authorBadges}}}}]);
 assert.deepEqual(e.badges,[{text:'Member (6 months)',url:'https://yt3.ggpht.com/large',icon:undefined},{text:'Moderator',url:undefined,icon:'moderator'}]);
});
function mockFetch(t,routes){
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 globalThis.fetch=async url=>{const hit=Object.entries(routes).find(([k])=>String(url).includes(k));return hit?Response.json(hit[1]):new Response('missing',{status:404});};
}
test('7TV, BTTV and FFZ emotes merge with channel and 7TV taking priority; bad data is skipped',async t=>{
 const seven=(name,id)=>({name,data:{flags:0,host:{url:`//cdn.7tv.app/emote/${id}`,files:[{name:'3x.webp',format:'WEBP'}]}}});
 mockFetch(t,{
  'frankerfacez/emotes/global':[{code:'Shared',images:{'1x':'https://cdn.frankerfacez.com/a/1','4x':'https://cdn.frankerfacez.com/a/4'}},{code:'Evil',images:{'4x':'https://evil.test/x.png'}}],
  'cached/emotes/global':[{id:'0123456789abcdef01234567',code:'Shared'},{id:'../../bad',code:'BadId'}],
  'emote-sets/global':{emotes:[seven('SevenOnly','g1')]},
  'frankerfacez/users/twitch/1':[{code:'FfzChannel',images:{'2x':'https://cdn.betterttv.net/frankerfacez_emote/5/2'}}],
  'cached/users/twitch/1':{channelEmotes:[{id:'abcdefabcdefabcdefabcdef',code:'BttvChannel'}],sharedEmotes:[{id:'111111111111111111111111',code:'SevenOnly'}]}
  // 7TV channel deliberately 404s: a channel without a 7TV set is not an error.
 });
 const {map,warnings,counts}=await loadEmotes('1');
 assert.equal(map.Shared.url,'https://cdn.betterttv.net/emote/0123456789abcdef01234567/3x');
 assert.equal(map.SevenOnly.source,'BTTV','channel emotes override global emotes');
 assert.equal(map.FfzChannel.url,'https://cdn.betterttv.net/frankerfacez_emote/5/2');
 assert.equal(map.Evil,undefined);assert.equal(map.BadId,undefined);
 assert.deepEqual(warnings,[]);assert.deepEqual(counts,{'7TV':0,BTTV:3,FFZ:1});
});
test('Twitch badge images load from the global and channel sets with channel overriding',async t=>{
 mockFetch(t,{
  'badges/global':[{set_id:'moderator',versions:[{id:'1',title:'Moderator',image_url_2x:'https://static-cdn.jtvnw.net/badges/v1/mod/2'}]},{set_id:'subscriber',versions:[{id:'0',image_url_2x:'https://static-cdn.jtvnw.net/badges/v1/default/2'}]},{set_id:'evil',versions:[{id:'1',image_url_2x:'https://evil.test/b.png'}]}],
  'badges/channel':[{set_id:'subscriber',versions:[{id:'0',title:'Subscriber',image_url_2x:'https://static-cdn.jtvnw.net/badges/v1/custom/2'}]}]
 });
 const map=await loadBadges('1');
 assert.equal(map['moderator/1'].title,'Moderator');assert.equal(map['subscriber/0'].url,'https://static-cdn.jtvnw.net/badges/v1/custom/2');assert.equal(map['evil/1'],undefined);
});
