// Standalone Cloudflare Worker: paste this file in the dashboard editor.
const DEFAULT_ORIGIN = 'https://riccardogiussani.github.io';
const UA = 'BookflixMetadata/0.1 (personal library; low-volume metadata lookup)';
const MAX_HTML = 2 * 1024 * 1024;
const windows = new Map();
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export function plain(value) {
 if (typeof value !== 'string' && typeof value !== 'number') return '';
 return String(value).replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, e) => {
  if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
  return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[e.toLowerCase()]||'';
 }).replace(/\s+/g, ' ').trim();
}
export function isbn13(raw) {
 const s=String(raw||'').replace(/[\s-]/g,'').toUpperCase();
 if (/^\d{9}[\dX]$/.test(s) && [...s].reduce((n,c,i)=>n+(c==='X'?10:+c)*(10-i),0)%11===0) {
  const p='978'+s.slice(0,9);return p+(10-[...p].reduce((n,c,i)=>n+(+c)*(i%2?3:1),0)%10)%10;
 }
 if (/^(978|979)\d{10}$/.test(s)&&[...s].reduce((n,c,i)=>n+(+c)*(i%2?3:1),0)%10===0) return s;
 throw Error('ISBN non valido.');
}
export function sourceURL(raw) {
 const u=new URL(raw);u.hash='';u.search='';
 if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('Usa un link HTTPS di una scheda supportata.');
 const ibs=u.hostname==='www.ibs.it'&&/^\/[^/]+\/e\/(978|979)\d{10}\/?$/.test(u.pathname);
 const giunti=u.hostname==='giuntialpunto.it'&&/^\/products\/[a-z0-9-]+$/.test(u.pathname);
 if(!ibs&&!giunti)throw Error('Sono supportate schede libro IBS e Giunti al Punto.');return u.href;
}
function imageURL(raw,base){try{const u=new URL(typeof raw==='object'?raw.url:raw,base);if(u.protocol!=='https:'||u.port||u.username||u.password)return '';if(u.hostname==='www.ibs.it'&&u.pathname.startsWith('/images/'))return u.href;if(u.hostname==='giuntialpunto.it'&&u.pathname.startsWith('/cdn/shop/'))return u.href;}catch{}return '';}
function named(x){return array(x).map(v=>plain(typeof v==='object'?v?.name:v)).filter(Boolean);}
function typed(node,type){return array(node?.['@type']).includes(type);}
function nodesIn(html){const result=[];for(const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){try{const parsed=JSON.parse(match[1]);for(const node of array(parsed)){result.push(node,...array(node?.['@graph']));}}catch{}}return result.filter(n=>n&&typeof n==='object');}
function identifiers(node){return [node.isbn,node.gtin13,...array(node.additionalProperty).filter(p=>/^(ISBN|EAN)$/i.test(p.name)).map(p=>p.value),...array(node.offers).flatMap(o=>[o.gtin13,o.isbn])].filter(Boolean).map(v=>{try{return isbn13(v);}catch{return '';}});}
export function extract(html,url,isbn){
 const nodes=nodesIn(html);const matched=nodes.filter(n=>(typed(n,'Book')||typed(n,'Product'))&&identifiers(n).includes(isbn));
 if(!matched.length)throw Error('La pagina non dichiara l’ISBN richiesto: nessun dato importato.');
 if(/-(ebook|audiolibro)-|\/ebook\//i.test(url)||matched.some(n=>array(n.additionalProperty).some(p=>p.name==='isPhysical'&&p.value===false)))throw Error('La scheda riguarda un formato digitale: cerca l’edizione cartacea.');
 matched.sort((a,b)=>Number(typed(b,'Book'))-Number(typed(a,'Book')));
 const properties={};for(const n of matched)for(const p of array(n.additionalProperty))properties[plain(p.name).toLowerCase()]=plain(p.value);
 // Read only the book-details table; never use recommendations or reader reviews.
 const details=html.match(/<table\b[^>]*class=["'][^"']*details-accordion__table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1]||'';
 for(const row of details.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];if(cells.length===2)properties[plain(cells[0][1]).toLowerCase()]=plain(cells[1][1]);}
 const data={};const fields={title:n=>plain(n.name||n.headline),subtitle:n=>plain(n.alternativeHeadline),authors:n=>named(n.author),publisher:n=>named(n.publisher).join('; '),year:n=>plain(n.datePublished).match(/\b\d{4}\b/)?.[0]||'',pages:n=>Number(n.numberOfPages)||null,language:n=>plain(typeof n.inLanguage==='object'?n.inLanguage?.name:n.inLanguage),genres:n=>named(n.genre),description:n=>plain(n.description)};
 for(const [key,read] of Object.entries(fields))for(const n of matched){const value=read(n);if(value&&(Array.isArray(value)?value.length:true)){data[key]=value;break;}}
 data.publisher ||= properties.editore||'';data.year ||= (properties.anno||properties['data di uscita']||'').match(/\b\d{4}\b/)?.[0]||'';data.pages ||= Number(properties.pagine)||null;data.language ||= properties.lingua||'';
 if(!Number.isInteger(data.pages)||data.pages<1)data.pages=null;
 if(!data.genres?.length){const breadcrumb=nodes.find(n=>typed(n,'BreadcrumbList'));data.genres=array(breadcrumb?.itemListElement).slice(2,-1).map(v=>plain(v.name)).filter(Boolean);}
 if(!data.authors?.length){const author=html.match(/<p\b[^>]*class=["'][^"']*author__name[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];if(author){const name=plain(author).replace(/^di\s+/i,'');if(name)data.authors=[...new Set(name.split(',').map(v=>v.trim()).filter(Boolean))];}}
 if(new URL(url).hostname==='www.ibs.it'){
  const authors=[];for(const span of html.matchAll(/<span\b[^>]*class=["']cc-item-value["'][^>]*>([\s\S]*?)<\/span>/gi))for(const a of span[1].matchAll(/<a\b[^>]*href=["']\/libri\/autori\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)){const name=plain(a[1]).replace(/,$/,'').trim();if(name)authors.push(name);}
  if(authors.length)data.authors=[...new Set(authors)];
 }
 if(!data.title)throw Error('Titolo assente: la struttura della scheda potrebbe essere cambiata.');
 const covers=[...new Set(matched.flatMap(n=>array(n.image)).map(v=>imageURL(v,url)).filter(Boolean))];
 return {source:new URL(url).hostname==='www.ibs.it'?'IBS':'Giunti al Punto',url,isbn,data,covers,retrievedAt:new Date().toISOString()};
}
async function bounded(response,limit){if(!response.ok)throw Error(response.status===429?'Il portale limita le richieste. Riprova tra qualche minuto.':`Portale non disponibile (HTTP ${response.status}).`);if(Number(response.headers.get('Content-Length'))>limit)throw Error('Risposta troppo grande.');const reader=response.body?.getReader();if(!reader)throw Error('Risposta vuota.');let size=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Risposta troppo grande.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}return bytes;}
async function upstream(url,limit=MAX_HTML){const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':UA,Accept:'text/html,application/xhtml+xml'}});return {response,bytes:await bounded(response,limit)};}
async function page(url,isbn){const {bytes}=await upstream(sourceURL(url));return extract(new TextDecoder().decode(bytes),url,isbn);}
async function cachedPage(url,isbn,context){const key=new Request(`https://bookflix-cache.invalid/v2/page?isbn=${isbn}&url=${encodeURIComponent(url)}`);const cache=globalThis.caches?.default;const hit=await cache?.match(key);if(hit)return hit.json();const result=await page(url,isbn);if(cache)context.waitUntil(cache.put(key,new Response(JSON.stringify(result),{headers:{'Cache-Control':'public, max-age=86400','Content-Type':'application/json'}})));return result;}
async function discover(isbn){
 const url=`https://giuntialpunto.it/search?q=${isbn}&type=product`;const {bytes}=await upstream(url);const html=new TextDecoder().decode(bytes);
 const links=[...html.matchAll(/href\s*=\s*["']([^"']*\/products\/[^"']+)["']/gi)].map(m=>m[1]).filter(v=>v.includes(isbn)).map(v=>{try{return sourceURL(new URL(v,'https://giuntialpunto.it').href);}catch{return '';}}).filter(Boolean);
 return [...new Set(links)].slice(0,2);
}
export default {async fetch(request,env={},context={waitUntil:()=>{}}){
 const origin=request.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||DEFAULT_ORIGIN).split(',').map(s=>s.trim());
 const headers={'Content-Type':'application/json; charset=utf-8',Vary:'Origin','X-Content-Type-Options':'nosniff'};
 if(origin&&allowed.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, OPTIONS'});
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!allowed.includes(origin))return json({error:'Origine non autorizzata.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='GET')return json({error:'Metodo non consentito.'},405);
 const url=new URL(request.url);if(url.pathname==='/health')return json({ok:true,version:'0.3.1',sources:['Giunti al Punto (ricerca ISBN)','IBS (link scheda)']});
 if(!['/lookup','/cover'].includes(url.pathname))return json({error:'Percorso non trovato.'},404);
 const ip=request.headers.get('CF-Connecting-IP')||'local';const now=Date.now();if(windows.size>2000)for(const [k,v] of windows)if(v.until<now)windows.delete(k);const window=windows.get(ip)||{until:now+60000,count:0};if(window.until<now){window.until=now+60000;window.count=0;}window.count++;windows.set(ip,window);if(window.count>12)return json({error:'Troppe richieste. Attendi un minuto.'},429);
 try{
  const isbn=isbn13(url.searchParams.get('isbn'));const supplied=url.searchParams.get('url');let links=supplied?[sourceURL(supplied)]:await discover(isbn);
  if(url.pathname==='/cover'){
   if(!supplied)throw Error('Serve la scheda sorgente della copertina.');const candidate=await cachedPage(links[0],isbn,context);let lastError;
   for(const image of candidate.covers){try{const {response,bytes}=await upstream(image,10*1024*1024);const type=(response.headers.get('Content-Type')||'').split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(type))continue;return new Response(bytes,{headers:{...headers,'Content-Type':type,'Cache-Control':'private, max-age=86400'}});}catch(e){lastError=e;}}throw lastError||Error('Copertina non disponibile.');
  }
  const candidates=[],warnings=[];for(const link of links)try{candidates.push(await cachedPage(link,isbn,context));}catch(e){warnings.push(e.message);}
  if(!candidates.length)warnings.push('Nessuna scheda esatta trovata. Incolla un link IBS o Giunti al Punto oppure completa il libro manualmente.');
  return json({isbn,candidates,warnings});
 }catch(e){return json({error:e.name==='TimeoutError'?'Il portale non risponde in tempo. Riprova o usa un link diretto.':e.message||'Recupero non riuscito.'},400);}
}};
