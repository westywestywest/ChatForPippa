const $=id=>document.getElementById(id), form=$('setup');let initialized=false;
$('overlayUrl').value=location.origin+'/overlay';
function values(){return Object.fromEntries(new FormData(form));}
async function post(path,data={}){const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const result=await res.json();if(!res.ok)throw Error(result.error);return result;}
async function action(fn){try{await fn();}catch(e){$('notice').textContent=e.message;}}
form.onsubmit=e=>{e.preventDefault();action(async()=>{await post('/api/start',values());$('notice').textContent='Connecting your community…';$('preview').contentWindow.postMessage({type:'end-demo'},location.origin);});};
$('stop').onclick=()=>action(()=>post('/api/stop'));
$('save').onclick=()=>action(async()=>{await post('/api/settings',values());$('notice').textContent='Appearance saved. Your OBS overlay updates automatically.';});
$('clear').onclick=()=>action(()=>post('/api/clear'));
$('demo').onclick=()=>{$('preview').contentWindow.postMessage({type:'demo'},location.origin);$('empty').classList.add('hidden');$('notice').textContent='Demo messages appear only in this preview.';};
$('copy').onclick=()=>action(async()=>{await navigator.clipboard.writeText($('overlayUrl').value);$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy',1800);});
function statuses(data){$('statuses').replaceChildren(...Object.entries(data).map(([name,s])=>{const row=document.createElement('div');row.className='status';const dot=document.createElement('span');dot.className='dot '+s.state;const label=document.createElement('span');label.textContent=`${name==='emotes'?'Emotes':name==='twitch'?'Twitch':'YouTube'} · ${s.detail}`;row.append(dot,label);return row;}));}
const events=new EventSource('/api/events');events.addEventListener('snapshot',e=>{const s=JSON.parse(e.data);if(!initialized){for(const [k,v]of Object.entries(s.settings)){if($(k))$(k).value=v;}initialized=true;}statuses(s.statuses);$('start').textContent=s.running?'↻ Reconnect streams':'▶ Start merging';if(s.messages.length)$('empty').classList.add('hidden');});events.addEventListener('status',e=>statuses(JSON.parse(e.data)));events.addEventListener('running',e=>$('start').textContent=JSON.parse(e.data)?'↻ Reconnect streams':'▶ Start merging');events.addEventListener('message',()=>$('empty').classList.add('hidden'));events.addEventListener('reset',()=>$('empty').classList.remove('hidden'));events.onerror=()=>{$('notice').textContent='Local server disconnected. Keep PippaChat running; reconnecting automatically.';};
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===$('preview').contentWindow&&e.data.type==='count')$('empty').classList.toggle('hidden',e.data.count>0);});
events.onopen=()=>{if($('notice').textContent.startsWith('Local server disconnected.'))$('notice').textContent='Local connection restored.';};
