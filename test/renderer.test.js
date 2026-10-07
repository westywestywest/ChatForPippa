import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {safeMediaURL} from '../public/media.js';
// Small DOM model checks application operations; browser smoke checks are separate.
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.textContent='';}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
 replaceWith(node){const i=this.parent.children.indexOf(this);this.parent.children[i]=node;node.parent=this.parent;}
}
async function renderer(){
 const nodes={'log':new Element('div'),'custom-css':new Element('style')},handlers={};
 const document={getElementById:id=>nodes[id],createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})};
 const source=(await readFile(new URL('../public/overlay.js',import.meta.url),'utf8')).replace("import {safeMediaURL} from './media.js';",'');
 class Events {addEventListener(type,fn){handlers[type]=fn;}}
 vm.runInNewContext(source,{safeMediaURL,document,EventSource:Events,location:{origin:'http://localhost',search:''},window:{addEventListener(){}},parent:{postMessage(){}},setInterval(){},URLSearchParams,URL,Date});
 const send=(type,data)=>handlers[type]({data:JSON.stringify(data)});
 const settings={theme:'glass',limit:80,fontSize:22,fade:0,css:''};
 send('snapshot',{settings,emotes:{},messages:[]});
 return {log:nodes.log,send,settings};
}
const message=(id,parts)=>({id,platform:'twitch',author:'<img onerror=alert(1)>',parts,timestamp:Date.now(),badges:[]});
const flatten=node=>[node,...node.children.flatMap(flatten)];
test('hostile chat stays text; inherited object properties are not treated as emotes',async()=>{
 const r=await renderer();r.send('message',message('1',[{type:'text',text:'<script>alert(1)</script> constructor __proto__ toString'}]));
 const nodes=flatten(r.log);assert.ok(nodes.some(n=>n.textContent==='<script>alert(1)</script>'));assert.ok(nodes.some(n=>n.textContent==='constructor'));assert.equal(nodes.filter(n=>['script','img'].includes(n.tag)).length,0);
});
test('unsupported image URLs become text, GIF URLs retain attribution and large-image class',async()=>{
 const r=await renderer(),url='https://media4.giphy.com/media/example/giphy.gif?cid=x&ct=g';
 r.send('message',message('1',[{type:'gif',url:'https://evil.test/tracker',text:'blocked'},{type:'gif',url,text:'GIF'}]));
 const nodes=flatten(r.log),img=nodes.find(n=>n.tag==='img');assert.equal(img.src,url);assert.equal(img.className,'chat-gif');assert.ok(nodes.some(n=>n.textContent==='blocked'));img.onerror();assert.equal(flatten(r.log).filter(n=>n.tag==='img').length,0);
});
test('new messages preserve animation nodes; reconnect snapshot replaces stale content',async()=>{
 const r=await renderer();const m=message('1',[{type:'gif',url:'https://media.giphy.com/media/example/giphy.gif',text:'GIF'}]);r.send('message',m);const original=flatten(r.log).find(n=>n.tag==='img');
 r.send('message',message('2',[{type:'text',text:'next'}]));assert.equal(flatten(r.log).find(n=>n.tag==='img'),original);
 r.send('snapshot',{settings:r.settings,emotes:{},messages:[message('1',[{type:'text',text:'updated'}])]});assert.equal(flatten(r.log).filter(n=>n.tag==='img').length,0);assert.ok(flatten(r.log).some(n=>n.textContent==='updated'));
});
test('renderer history is bounded and deletion removes images',async()=>{
 const r=await renderer();for(let i=0;i<1000;i++)r.send('message',message(String(i),[{type:'text',text:'sample'}]));assert.equal(r.log.children.length,80);r.send('delete',{platform:'twitch',id:'999'});assert.equal(r.log.children.length,79);r.send('clear',{platform:'twitch'});assert.equal(r.log.children.length,0);
});
test('malformed badge data cannot break rendering of the message',async()=>{
 const r=await renderer();r.send('message',{...message('b',[{type:'text',text:'still here'}]),badges:[{},null,7]});
 assert.ok(flatten(r.log).some(n=>n.textContent==='still'));
});
test('badges render as images when known, otherwise as readable text',async()=>{
 const r=await renderer();
 r.send('badges',{'subscriber/12':{url:'https://static-cdn.jtvnw.net/badges/v1/sub/2',title:'1-Year Subscriber'}});
 r.send('message',{...message('badges',[{type:'text',text:'hi'}]),badges:[{id:'subscriber/12',text:'subscriber'},{id:'unknown/1',text:'unknown'},{text:'Member',url:'https://yt3.ggpht.com/m'},{text:'Bad',url:'https://evil.test/b.png'},{text:'Moderator',icon:'moderator'}]});
 const nodes=flatten(r.log),imgs=nodes.filter(n=>n.tag==='img');
 assert.deepEqual(imgs.map(n=>[n.src,n.alt]),[['https://static-cdn.jtvnw.net/badges/v1/sub/2','1-Year Subscriber'],['https://yt3.ggpht.com/m','Member']]);
 for(const text of ['unknown','Bad','MOD'])assert.ok(nodes.some(n=>n.tag==='span'&&n.textContent===text),text);
});
