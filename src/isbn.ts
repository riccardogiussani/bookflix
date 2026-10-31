import {normalizeISBN,type Book} from './data';
export class AccessDeniedError extends Error {}
export const WORKER_URL='https://bookflix-scraper.riciriccio.workers.dev';
export type Metadata=Partial<Pick<Book,'title'|'subtitle'|'authors'|'publisher'|'year'|'pages'|'language'|'genres'|'description'>>;
export type Candidate={source:string;url?:string;data:Metadata;covers:string[]};
export type Lookup={data:Metadata;cover?:Blob;candidates:Candidate[];warnings:string[];conflicts?:string[];fieldSources?:Record<string,string>};
export function mergeCandidates(candidates:Candidate[]):Metadata{
 const data:Record<string,unknown>={};for(const c of candidates)for(const [key,value] of Object.entries(c.data))if((data[key]===undefined||data[key]===null||data[key]===''||Array.isArray(data[key])&&!data[key].length)&&value!==undefined&&value!==null&&value!==''&&(!Array.isArray(value)||value.length))data[key]=value;
 return data as Metadata;
}
export function workerBase(raw:string){
 if(!raw.trim())throw Error('Configura l’indirizzo del tuo Worker nella sezione Servizio di recupero.');
 const url=new URL(raw.trim());if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Il servizio deve usare HTTPS.');
 if(url.username||url.password||url.search||url.hash)throw Error('Inserisci solo l’indirizzo base del Worker.');return url.origin;
}
function candidate(raw:any,isbn:string):Candidate|undefined{
 if(!raw||normalizeISBN(raw.isbn)!==isbn||!raw.data||typeof raw.source!=='string')return;
 const url=new URL(raw.url);if(url.protocol!=='https:'||!['www.ibs.it','giuntialpunto.it','www.lafeltrinelli.it','www.hoepli.it','www.mondadoristore.it','www.amazon.it'].includes(url.hostname))return;
 const data:Metadata={};for(const k of ['title','subtitle','publisher','year','language','description'] as const)if(typeof raw.data[k]==='string')data[k]=raw.data[k];
 for(const k of ['authors','genres'] as const)if(Array.isArray(raw.data[k]))data[k]=raw.data[k].filter((v:unknown)=>typeof v==='string').slice(0,100);
 if(Number.isInteger(raw.data.pages)&&raw.data.pages>0)data.pages=raw.data.pages;
 return {source:raw.source,url:url.href,data,covers:[]};
}
export const SOURCES=[{id:'amazon',name:'Amazon (sperimentale)',host:'www.amazon.it'},{id:'ibs',name:'IBS',host:'www.ibs.it'},{id:'feltrinelli',name:'Feltrinelli',host:'www.lafeltrinelli.it'},{id:'hoepli',name:'Hoepli',host:'www.hoepli.it'},{id:'mondadori',name:'Mondadori Store',host:'www.mondadoristore.it'},{id:'giunti',name:'Giunti al Punto',host:'giuntialpunto.it'}];
export const FIELD_LABELS:Record<string,string>={title:'Titolo',subtitle:'Sottotitolo',authors:'Autori',publisher:'Editore',year:'Anno',pages:'Pagine',language:'Lingua',genres:'Generi',description:'Trama'};
function comparable(key:string,value:unknown):string{
 if(Array.isArray(value))return value.map(v=>comparable(key,v)).sort().join('|');
 let text=String(value??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 if(key==='language'){const languages:Record<string,string>={'it':'it','it it':'it',ita:'it',italiano:'it',italian:'it',en:'en','en gb':'en','en us':'en',eng:'en',inglese:'en',english:'en'};text=languages[text]||text;}
 return text;
}
export function compareCandidates(candidates:Candidate[]){
 const fieldSources:Record<string,string>={},values=new Map<string,Set<string>>();
 for(const c of candidates)for(const [key,value] of Object.entries(c.data)){if(value===null||value===undefined||value===''||Array.isArray(value)&&!value.length)continue;fieldSources[key] ||= c.source;if(!values.has(key))values.set(key,new Set());values.get(key)!.add(comparable(key,value));}
 const conflicts=[...values].filter(([,v])=>v.size>1).map(([key])=>FIELD_LABELS[key]||key);return {fieldSources,conflicts};
}
export async function lookupISBN(raw:string,signal:AbortSignal,workerURL=WORKER_URL,sourceURL='',accessCode=''):Promise<Lookup>{
 const isbn=normalizeISBN(raw);if(!isbn)throw Error('Inserisci un ISBN.');const base=workerBase(workerURL);
 if(!accessCode.trim())throw Error('Inserisci il codice di accesso al servizio.');
 const headers={Authorization:`Bearer ${accessCode.trim()}`};const warnings:string[]=[];
 const primaryHost=sourceURL.trim()?new URL(sourceURL.trim()).hostname:'';if(primaryHost&&!SOURCES.some(s=>s.host===primaryHost))throw Error('Il link non appartiene a una fonte supportata.');
 const tasks=[...(primaryHost?[{name:SOURCES.find(s=>s.host===primaryHost)!.name,host:primaryHost,link:sourceURL.trim(),id:''}]:[]),...SOURCES.filter(s=>s.host!==primaryHost).map(s=>({...s,link:''}))];
 const batch=new AbortController();
 const results=await Promise.allSettled(tasks.map(async task=>{
  const url=new URL('/lookup',base);url.searchParams.set('isbn',isbn);if(task.link)url.searchParams.set('url',task.link);else url.searchParams.set('source',task.id);
  const r=await fetch(url,{signal:AbortSignal.any([signal,batch.signal,AbortSignal.timeout(26000)]),credentials:'omit',headers});
  if(r.status===401){batch.abort();throw new AccessDeniedError('Password non valida o modificata. Accedi di nuovo.');}
  const response=await r.json();if(!r.ok)throw Error(response.error||'Fonte non disponibile.');
  const notes:string[]=Array.isArray(response.warnings)?response.warnings.filter((v:unknown)=>typeof v==='string'):[];
  const books:Candidate[]=[];for(const entry of (Array.isArray(response.candidates)?response.candidates:[]).slice(0,2)){try{const c=candidate(entry,isbn);if(c&&new URL(c.url!).hostname===task.host)books.push(c);}catch{}}
  if(!books.length&&!notes.length)notes.push('Nessuna corrispondenza esatta.');return {books,notes};
 }));
 if(signal.aborted)throw signal.reason;
 const candidates:Candidate[]=[];
 results.forEach((result,i)=>{if(result.status==='rejected'){if(result.reason instanceof AccessDeniedError)throw result.reason;warnings.push(`${tasks[i].name}: ${result.reason?.name==='TimeoutError'?'tempo di attesa scaduto':result.reason?.name==='TypeError'?'connessione al servizio non riuscita':result.reason?.name==='SyntaxError'?'risposta del servizio non valida':result.reason?.message||'fonte non disponibile'}`);}else{candidates.push(...result.value.books);warnings.push(...result.value.notes.map(n=>`${tasks[i].name}: ${n}`));}});
 let cover:Blob|undefined;
 for(const c of candidates){if(!c.url)continue;const coverURL=new URL('/cover',base);coverURL.searchParams.set('isbn',isbn);coverURL.searchParams.set('url',c.url);
 try{const image=await fetch(coverURL,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),credentials:'omit',headers});if(image.status===401)throw new AccessDeniedError('Password non valida o modificata. Accedi di nuovo.');if(!image.ok||Number(image.headers.get('Content-Length'))>10*1024*1024)continue;const blob=await image.blob();if(blob.size>0&&blob.size<=10*1024*1024&&['image/jpeg','image/png','image/webp'].includes(blob.type)){cover=blob;break;}}catch(e){if(e instanceof AccessDeniedError)throw e;if(signal.aborted)throw signal.reason;}}
 if(!cover)warnings.push('Copertina non recuperata: puoi caricarla dal dispositivo.');
 return {data:mergeCandidates(candidates),cover,candidates,warnings,...compareCandidates(candidates)};
}
