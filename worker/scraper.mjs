import {normalizeMetadata,selectMetadata} from '../shared/metadata-selection.mjs';
import {authenticate,login,AuthError} from './auth.mjs';
import {koofr} from './koofr.mjs';
import {central,service} from './central.mjs';
// Cloudflare Worker entry point. Deploy with worker/wrangler.jsonc (includes koofr.mjs).
const DEFAULT_ORIGIN = 'https://riccardogiussani.github.io';
const UA = 'BookflixMetadata/0.1 (personal library; low-volume metadata lookup)';
const MAX_HTML = 4 * 1024 * 1024;
export const SOURCE_NAMES={'www.ibs.it':'IBS','giuntialpunto.it':'Giunti al Punto','www.lafeltrinelli.it':'Feltrinelli','www.hoepli.it':'Hoepli','www.mondadoristore.it':'Mondadori Store','www.amazon.it':'Amazon (sperimentale)'};
const sourceName=url=>SOURCE_NAMES[new URL(url).hostname];
const nextRequest=new Map();
const windows = new Map();
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export function plain(value) {
 if (typeof value !== 'string' && typeof value !== 'number') return '';
 return String(value).replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|lrm|rlm|rsquo|lsquo|egrave|eacute|agrave|ograve|ugrave|igrave);/gi, (_, e) => {
  if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
  return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',lrm:'',rlm:'',rsquo:'’',lsquo:'‘',egrave:'è',eacute:'é',agrave:'à',ograve:'ò',ugrave:'ù',igrave:'ì'})[e.toLowerCase()]||'';
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
 const host=u.hostname,path=u.pathname;
 const book=/^\/[^/]+\/e\/(978|979)\d{10}\/?$/.test(path)&&['www.ibs.it','www.lafeltrinelli.it'].includes(host);
 const giunti=host==='giuntialpunto.it'&&/^\/products\/[a-z0-9-]+$/.test(path);
 const hoepli=host==='www.hoepli.it'&&/^\/libro\/[^/]+\/(978|979)\d{10}\.html$/i.test(path);
 const mondadori=host==='www.mondadoristore.it'&&/^\/[^/]+\/p\/(978|979)\d{10}\/?$/.test(path);
 const amazon=host==='www.amazon.it'&&/^\/(?:[^/]+\/)?dp\/[A-Z0-9]{10}\/?$/i.test(path);
 if(!book&&!giunti&&!hoepli&&!mondadori&&!amazon)throw Error('Usa una scheda IBS, Giunti, Feltrinelli, Hoepli, Mondadori Store o Amazon.it.');
 if(amazon)u.pathname='/dp/'+path.match(/\/dp\/([A-Z0-9]{10})/i)[1].toUpperCase();
 return u.href;
}
export function imageURL(raw,base){try{const u=new URL(typeof raw==='object'?raw.url:raw,base);if(u.protocol!=='https:'||u.port||u.username||u.password)return '';
 if(u.hostname==='copertine.hoepli.it'&&/\/(nd[^/]*|placeholder[^/]*)\.(png|jpe?g)$/i.test(u.pathname))return '';
 const paths={'www.ibs.it':['/images/'],'www.lafeltrinelli.it':['/images/'],'giuntialpunto.it':['/cdn/shop/'],'copertine.hoepli.it':['/hoepli/','/archivio/'],'media.mondadoristore.it':['/picture/'],'m.media-amazon.com':['/images/'],'images-eu.ssl-images-amazon.com':['/images/']};
 return paths[u.hostname]?.some(p=>u.pathname.startsWith(p))?u.href:'';
 }catch{return '';}}
// Extract a bounded element region without parsing or executing remote scripts.
function element(html,id,limit=30000){
 const pattern=new RegExp('<([a-z][a-z0-9]*)\\b[^>]*\\sid=["\']'+id+'["\'][^>]*>','i');const match=pattern.exec(html);if(!match)return '';
 const start=match.index+match[0].length;const region=html.slice(start,start+limit);const tags=new RegExp('<(/?)'+match[1]+'\\b[^>]*>','gi');let depth=1;for(const tag of region.matchAll(tags)){depth+=tag[1]?-1:1;if(!depth)return region.slice(0,tag.index);}return '';
}
function attribute(tag,name){return tag.match(new RegExp('\\s'+name+'=["\']([^"\']*)["\']','i'))?.[1]||'';}
export function isbn10(isbn){if(!isbn.startsWith('978'))return '';const p=isbn.slice(3,12);const digit=(11-[...p].reduce((n,c,i)=>n+(+c)*(10-i),0)%11)%11;return p+(digit===10?'X':digit);}
function amazonBook(html,url,isbn){
 const details=element(html,'detailBulletsWrapper_feature_div')||element(html,'detailBullets_feature_div')||element(html,'productDetails_detailBullets_sections1');
 const properties={};for(const row of details.matchAll(/<(li|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi)){const value=plain(row[2]).replace(/[\u200e\u200f]/g,'');const i=value.indexOf(':');if(i>0)properties[value.slice(0,i).trim().toLowerCase()]=value.slice(i+1).trim();}
 let actual='';try{actual=isbn13(properties['isbn-13']||properties['isbn-10']);}catch{}
 if(actual!==isbn)throw Error('Amazon: nessuna corrispondenza ISBN nei dettagli del libro.');
 const byline=element(html,'bylineInfo',10000);if(/Formato:\s*(?:Edizione\s+)?(Kindle|Audiolibro|eBook)/i.test(plain(byline)))throw Error('La scheda riguarda un formato digitale.');
 const authors=[...byline.matchAll(/<span\b[^>]*class=["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].flatMap(m=>[...m[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(v=>plain(v[1]))).filter(Boolean);
 const tag=html.match(/<img\b[^>]*\sid=["']landingImage["'][^>]*>/i)?.[0]||'';const images=[];
 for(const key of ['data-old-hires','src']){const value=attribute(tag,key);if(value)images.push(plain(value));}
 try{const dynamic=JSON.parse(plain(attribute(tag,'data-a-dynamic-image')));images.push(...Object.entries(dynamic).sort((a,b)=>(b[1][0]*b[1][1])-(a[1][0]*a[1][1])).map(([u])=>u));}catch{}
 const description=element(html,'bookDescription_feature_div').match(/<div\b[^>]*class=["'][^"']*a-expander-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||element(html,'productDescription');
 const data={title:plain(element(html,'productTitle',2000)),authors:[...new Set(authors)],publisher:properties.editore||'',year:(properties['data di pubblicazione']||'').match(/\b\d{4}\b/)?.[0]||'',pages:parseInt(properties['lunghezza stampa']||properties['copertina flessibile']||properties['copertina rigida'])||null,language:properties.lingua||'',genres:[],description:plain(description)};
 if(!data.title)throw Error('Amazon: titolo non disponibile.');
 return {source:sourceName(url),url,isbn,data:normalizeMetadata(data),covers:[...new Set(images.map(v=>imageURL(v,url)).filter(Boolean))],retrievedAt:new Date().toISOString()};
}
function named(x){return array(x).map(v=>plain(typeof v==='object'?v?.name:v)).filter(Boolean);}
function typed(node,type){return array(node?.['@type']).includes(type);}
function nodesIn(html){const result=[];const visit=node=>{for(const item of array(node))if(item&&typeof item==='object'){result.push(item);if(item['@graph'])visit(item['@graph']);if(item.mainEntity)visit(item.mainEntity);if(item.breadcrumb)visit(item.breadcrumb);}};for(const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){try{visit(JSON.parse(match[1]));}catch{}}return result;}
function identifiers(node){return [node.isbn,node.gtin13,...array(node.additionalProperty).filter(p=>/^(ISBN|EAN)$/i.test(p.name)).map(p=>p.value),...array(node.offers).flatMap(o=>[o.gtin13,o.isbn])].filter(Boolean).map(v=>{try{return isbn13(v);}catch{return '';}});}
export function extract(html,url,isbn){
 if(new URL(url).hostname==='www.amazon.it')return amazonBook(html,url,isbn);
 const nodes=nodesIn(html);const matched=nodes.filter(n=>(typed(n,'Book')||typed(n,'Product'))&&identifiers(n).includes(isbn));
 if(!matched.length)throw Error('La pagina non dichiara l’ISBN richiesto: nessun dato importato.');
 if(/-(ebook|audiolibro)-|\/ebook\//i.test(url)||matched.some(n=>/EBook|Audiobook/i.test(String(n.bookFormat||'')))||matched.some(n=>array(n.additionalProperty).some(p=>p.name==='isPhysical'&&p.value===false)))throw Error('La scheda riguarda un formato digitale: cerca l’edizione cartacea.');
 matched.sort((a,b)=>Number(typed(b,'Book'))-Number(typed(a,'Book')));
 const properties={};for(const n of matched)for(const p of array(n.additionalProperty))properties[plain(p.name).toLowerCase()]=plain(p.value);
 // Read only the book-details table; never use recommendations or reader reviews.
 const details=html.match(/<table\b[^>]*class=["'][^"']*details-accordion__table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1]||'';
 for(const row of details.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];if(cells.length===2)properties[plain(cells[0][1]).toLowerCase()]=plain(cells[1][1]);}
 const data={};const fields={title:n=>plain(n.name||n.headline),subtitle:n=>plain(n.alternativeHeadline),authors:n=>named(n.author),publisher:n=>named(n.publisher).join('; '),year:n=>plain(n.datePublished).match(/\b\d{4}\b/)?.[0]||'',pages:n=>Number(n.numberOfPages)||null,language:n=>plain(typeof n.inLanguage==='object'?n.inLanguage?.name:n.inLanguage),genres:n=>named(n.genre),description:n=>plain(n.description)};
 for(const [key,read] of Object.entries(fields))for(const n of matched){const value=read(n);if(value&&(Array.isArray(value)?value.length:true)){data[key]=value;break;}}
 data.description=selectMetadata(matched.map(n=>({source:sourceName(url),data:{description:plain(n.description)}}))).data.description||'';
 data.publisher ||= properties.editore||'';data.year ||= (properties.anno||properties['data di uscita']||'').match(/\b\d{4}\b/)?.[0]||'';data.pages ||= Number(properties.pagine)||null;data.language ||= properties.lingua||properties.lingue||'';
 if(!Number.isInteger(data.pages)||data.pages<1)data.pages=null;
 data.genres=(data.genres||[]).filter(v=>!/^(libro|book)$/i.test(v));
 if(!data.genres.length){const breadcrumb=nodes.find(n=>typed(n,'BreadcrumbList'));data.genres=array(breadcrumb?.itemListElement).map(v=>plain(v.name||v.item?.name)).filter(v=>v&&!/^(Home|Libri|Books|Mondadoristore)$/i.test(v)&&v.toLowerCase()!==data.title?.toLowerCase());}

 if(!data.authors?.length){const author=html.match(/<p\b[^>]*class=["'][^"']*author__name[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];if(author){const name=plain(author).replace(/^di\s+/i,'');if(name)data.authors=[...new Set(name.split(',').map(v=>v.trim()).filter(Boolean))];}}
 if(['www.ibs.it','www.lafeltrinelli.it'].includes(new URL(url).hostname)){
  const authors=[];for(const span of html.matchAll(/<span\b[^>]*class=["']cc-item-value["'][^>]*>([\s\S]*?)<\/span>/gi))for(const a of span[1].matchAll(/<a\b[^>]*href=["']\/libri\/autori\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)){const name=plain(a[1]).replace(/,$/,'').trim();if(name)authors.push(name);}
  if(authors.length)data.authors=[...new Set(authors)];
 }
 if(new URL(url).hostname==='www.hoepli.it'){
  const title=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];if(title)data.title=plain(title);
  const author=html.match(/<h2\b[^>]*class=["']prodotto["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1]||'';const authors=[...author.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>plain(m[1]));if(authors.length)data.authors=authors;
  const plot=html.match(/<h2\b[^>]*>Trama<\/h2>[\s\S]{0,500}?<div\b[^>]*class=["'][^"']*lh22[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];if(plot)data.description=plain(plot);
 }
 if(!data.title)throw Error('Titolo assente: la struttura della scheda potrebbe essere cambiata.');
 const covers=[...new Set(matched.flatMap(n=>array(n.image)).map(v=>imageURL(v,url)).filter(Boolean))];
 return {source:sourceName(url),url,isbn,data:normalizeMetadata(data),covers,retrievedAt:new Date().toISOString()};
}
async function bounded(response,limit){if(!response.ok){await response.body?.cancel();throw Error(response.status===429?'Il portale limita le richieste. Riprova tra qualche minuto.':`Portale non disponibile (HTTP ${response.status}).`);}if(Number(response.headers.get('Content-Length'))>limit){await response.body?.cancel();throw Error('Risposta troppo grande.');}const reader=response.body?.getReader();if(!reader)throw Error('Risposta vuota.');let size=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Risposta troppo grande.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}return bytes;}
async function pause(ms,signal){if(ms<=0)return;await new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);reject(signal.reason);}if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});}
async function upstream(url,limit=MAX_HTML,kind='page',signal=AbortSignal.timeout(24000)){
 const original=new URL(url);let current=url;
 for(let redirects=0;redirects<=2;redirects++){
  if(new URL(current).hostname==='www.hoepli.it'){
   const now=Date.now();const due=Math.max(now,nextRequest.get('hoepli')||0);nextRequest.set('hoepli',due+10000);await pause(due-now,signal);
  }
  const response=await fetch(current,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),headers:{'User-Agent':UA,Accept:kind==='image'?'image/jpeg,image/png,image/webp':'text/html,application/xhtml+xml'}});
  if([301,302,303,307,308].includes(response.status)){
   await response.body?.cancel();const location=response.headers.get('Location');if(!location||redirects===2)throw Error('Troppi reindirizzamenti o destinazione assente.');
   const next=new URL(location,current);if(next.hostname!==original.hostname)throw Error('Reindirizzamento verso un dominio non consentito.');
   if(kind==='page')current=sourceURL(next.href);else if(kind==='image'){current=imageURL(next.href,current);if(!current)throw Error('Reindirizzamento immagine non consentito.');}else throw Error('Ricerca reindirizzata: usa il link diretto della scheda.');
   continue;
  }
  return {response,bytes:await bounded(response,limit),url:current};
 }
 throw Error('Reindirizzamento non supportato.');
}
async function page(url,isbn){const result=await upstream(sourceURL(url));return extract(new TextDecoder().decode(result.bytes),result.url,isbn);}
async function cachedPage(url,isbn,context){
 const keyFor=value=>new Request(`https://bookflix-cache.invalid/v4/page?isbn=${isbn}&url=${encodeURIComponent(value)}`);const key=keyFor(url);const cache=globalThis.caches?.default;const hit=await cache?.match(key);if(hit)return hit.json();
 const result=await page(url,isbn);if(cache){const response=()=>new Response(JSON.stringify(result),{headers:{'Cache-Control':'public, max-age=86400','Content-Type':'application/json'}});context.waitUntil(cache.put(key,response()));if(result.url!==url)context.waitUntil(cache.put(keyFor(result.url),response()));}return result;
}
async function discover(isbn){
 const url=`https://giuntialpunto.it/search?q=${isbn}&type=product`;const {bytes}=await upstream(url,MAX_HTML,'discovery');const html=new TextDecoder().decode(bytes);
 const links=[...html.matchAll(/href\s*=\s*["']([^"']*\/products\/[^"']+)["']/gi)].map(m=>m[1]).filter(v=>v.includes(isbn)).map(v=>{try{return sourceURL(new URL(v,'https://giuntialpunto.it').href);}catch{return '';}}).filter(Boolean);
 return [...new Set(links)].slice(0,1);
}
export function automaticURL(source,isbn){
 const paths={ibs:`https://www.ibs.it/libro/e/${isbn}`,feltrinelli:`https://www.lafeltrinelli.it/libro/e/${isbn}`,hoepli:`https://www.hoepli.it/libro/libro/${isbn}.html`,mondadori:`https://www.mondadoristore.it/libro/p/${isbn}`,amazon:isbn10(isbn)?`https://www.amazon.it/dp/${isbn10(isbn)}`:''};
 if(!(source in paths))throw Error('Fonte non supportata.');return paths[source];
}
export default {async fetch(request,env={},context={waitUntil:()=>{}}){
 const origin=request.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||DEFAULT_ORIGIN).split(',').map(s=>s.trim());
 const headers={'Content-Type':'application/json; charset=utf-8',Vary:'Origin','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'};
 if(origin&&allowed.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, PUT, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, If-Match, If-None-Match'});
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!allowed.includes(origin))return json({error:'Origine non autorizzata.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!['GET','PUT','POST'].includes(request.method))return json({error:'Metodo non consentito.'},405);
 const url=new URL(request.url);if(url.pathname==='/health')return json({ok:true,version:'0.12.0',capabilities:{catalogueTitleSearch:true},storage:{provider:'Firestore + Koofr',configured:!!(env.GOOGLE_SERVICE_ACCOUNT_JSON&&env.KOOFR_USERNAME&&env.KOOFR_PASSWORD)},authentication:{required:true,configured:!!env.FIREBASE_PROJECT_ID,mode:'firebase'},sources:Object.values(SOURCE_NAMES),automatic:['ibs','feltrinelli','hoepli','mondadori','giunti','amazon (ISBN 978)']});
 const v2=url.pathname.startsWith('/v2/');const library=v2||url.pathname==='/library'||url.pathname.startsWith('/library/');
 if(!library&&!(url.pathname==='/auth/login'&&request.method==='POST')&&request.method!=='GET')return json({error:'Metodo non consentito.'},405);
 if(!library&&!['/lookup','/cover','/auth/check','/auth/login'].includes(url.pathname))return json({error:'Percorso non trovato.'},404);
 const ip=request.headers.get('CF-Connecting-IP')||'local';const now=Date.now();if(windows.size>2000)for(const [k,v] of windows)if(v.until<now)windows.delete(k);const bucket=ip+(library?':library':url.pathname.startsWith('/auth/')?':login':':metadata');const window=windows.get(bucket)||{until:now+60000,count:0};if(window.until<now){window.until=now+60000;window.count=0;}window.count++;windows.set(bucket,window);if(window.count>(library?30000:url.pathname.startsWith('/auth/')?12:60))return json({error:'Troppe richieste. Attendi un minuto.'},429);
 const failureKey=ip+':failed-password';const failures=windows.get(failureKey);if(failures&&failures.until>now&&failures.count>=12)return json({error:'Troppi tentativi. Attendi un minuto.'},429);
 let identity;try{
  if(url.pathname==='/auth/login'){if(request.method!=='POST')return json({error:'Metodo non consentito.'},405);return json(await login(request,env));}
  identity=await authenticate(request,env);
 }catch(e){if(e instanceof AuthError&&e.status===401){const failed=failures&&failures.until>now?failures:{until:now+60000,count:0};failed.count++;windows.set(failureKey,failed);}return json({error:e instanceof AuthError?e.message:'Verifica accesso non disponibile.'},e instanceof AuthError?e.status:503);}
 if(url.pathname==='/auth/check')return json({authenticated:true,user:identity.user,expiresAt:identity.expiresAt,libraryAccess:identity.libraryAccess,capabilities:{selfServiceAccounts:true,centralCatalog:true}});
 if(v2)return central(request,env,headers,identity);
 const libraryId=url.searchParams.get('libraryId');if(!library&&libraryId){try{await service(env,identity).sourcePermission(libraryId);}catch(e){return json({error:e.message},e.status||503);}}
 if((library||!libraryId)&&identity.libraryAccess!=='owner')return json({error:'Nessuna libreria associata al tuo account. Non hai accesso alla raccolta precedente.'},403);
 if(library)return koofr(request,env,headers,identity);
 try{
  const isbn=isbn13(url.searchParams.get('isbn'));const supplied=url.searchParams.get('url');
  if(url.pathname==='/cover'){
   if(!supplied)throw Error('Serve la scheda sorgente della copertina.');const candidate=await cachedPage(sourceURL(supplied),isbn,context);let lastError;
   for(const image of candidate.covers.slice(0,3)){try{const {response,bytes}=await upstream(image,10*1024*1024,'image');const type=(response.headers.get('Content-Type')||'').split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(type))continue;return new Response(bytes,{headers:{...headers,'Content-Type':type,'Cache-Control':'private, max-age=86400'}});}catch(e){lastError=e;}}throw lastError||Error('Copertina non disponibile.');
  }
  const source=url.searchParams.get('source')||'giunti';
  let links=supplied?[sourceURL(supplied)]:source==='giunti'?await discover(isbn):[automaticURL(source,isbn)].filter(Boolean);
  const candidates=[],warnings=[];for(const link of links)try{candidates.push(await cachedPage(link,isbn,context));}catch(e){warnings.push(e.message);}
  if(!candidates.length)warnings.push('Nessuna scheda esatta trovata. Incolla il link di una scheda supportata oppure completa il libro manualmente.');
  return json({isbn,candidates,warnings});
 }catch(e){return json({error:e.name==='TimeoutError'?'Il portale non risponde in tempo. Riprova o usa un link diretto.':e.message==='fetch failed'?'Connessione al portale non riuscita. Prova un’altra fonte.':e.message||'Recupero non riuscito.'},400);}
}};
