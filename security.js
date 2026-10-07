import {parseSource} from './adapters.js';
export function validateSettings(value,{allowEmpty=false}={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Settings must be an object.');
  const out={};
  for(const platform of ['twitch','youtube']){
    const url=value[platform];
    if(typeof url!=='string'||url.length>2048)throw Error('Invalid stream URL.');
    out[platform]=url.trim();
    if(!allowEmpty||out[platform])parseSource(out[platform],platform);
  }
  if(value.css!==undefined&&(typeof value.css!=='string'||value.css.length>100000))throw Error('CSS must be text under 100,000 characters.');
  out.css=value.css||'';
  out.theme=['glass','minimal','bubble'].includes(value.theme)?value.theme:'glass';
  for(const [key,min,max,fallback] of [['fontSize',12,48,22],['limit',10,200,80],['fade',0,3600,0]]){
    const n=value[key]===undefined?fallback:Number(value[key]);
    if(!Number.isFinite(n))throw Error(`Invalid ${key}.`);
    out[key]=Math.max(min,Math.min(max,Math.round(n)));
  }
  return out;
}
export function allowedRequest(req,port) {
  const origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
  if(!origins.includes(`http://${req.headers.host}`))return false;
  if(req.headers.origin&&!origins.includes(req.headers.origin))return false;
  // Reject embedding/requests from other sites even when Origin is absent.
  if(['cross-site','same-site'].includes(req.headers['sec-fetch-site']))return false;
  return true;
}
export const securityHeaders={
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-frame-options':'SAMEORIGIN',
  'cross-origin-resource-policy':'same-origin',
  'cache-control':'no-store',
  'content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline' https:; img-src https: data:; font-src 'self' https: data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'"
};
