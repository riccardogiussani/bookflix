import {normalizeISBN,type Book} from './data';
export type Metadata=Partial<Pick<Book,'title'|'subtitle'|'authors'|'publisher'|'year'|'pages'|'language'|'genres'|'description'>>;
export type Candidate={source:string;url?:string;data:Metadata;covers:string[]};
export type Lookup={data:Metadata;cover?:Blob;candidates:Candidate[];warnings:string[]};
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
 const url=new URL(raw.url);if(url.protocol!=='https:'||!['www.ibs.it','giuntialpunto.it'].includes(url.hostname))return;
 const data:Metadata={};for(const k of ['title','subtitle','publisher','year','language','description'] as const)if(typeof raw.data[k]==='string')data[k]=raw.data[k];
 for(const k of ['authors','genres'] as const)if(Array.isArray(raw.data[k]))data[k]=raw.data[k].filter((v:unknown)=>typeof v==='string').slice(0,100);
 if(Number.isInteger(raw.data.pages)&&raw.data.pages>0)data.pages=raw.data.pages;
 return {source:raw.source,url:url.href,data,covers:[]};
}
export async function lookupISBN(raw:string,signal:AbortSignal,workerURL='',sourceURL=''):Promise<Lookup>{
 const isbn=normalizeISBN(raw);if(!isbn)throw Error('Inserisci un ISBN.');const base=workerBase(workerURL);
 const url=new URL('/lookup',base);url.searchParams.set('isbn',isbn);if(sourceURL.trim())url.searchParams.set('url',sourceURL.trim());
 const r=await fetch(url,{signal,credentials:'omit'});const response=await r.json();if(!r.ok)throw Error(response.error||'Servizio non disponibile. Puoi continuare manualmente.');
 const warnings:string[]=Array.isArray(response.warnings)?response.warnings.filter((v:unknown)=>typeof v==='string'):[];
 const candidates:Candidate[]=[];for(const entry of (Array.isArray(response.candidates)?response.candidates:[]).slice(0,5)){try{const c=candidate(entry,isbn);if(c)candidates.push(c);}catch{}}
 let cover:Blob|undefined;
 for(const c of candidates){if(!c.url)continue;const coverURL=new URL('/cover',base);coverURL.searchParams.set('isbn',isbn);coverURL.searchParams.set('url',c.url);
 try{const image=await fetch(coverURL,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),credentials:'omit'});if(!image.ok||Number(image.headers.get('Content-Length'))>10*1024*1024)continue;const blob=await image.blob();if(blob.size>0&&blob.size<=10*1024*1024&&['image/jpeg','image/png','image/webp'].includes(blob.type)){cover=blob;break;}}catch{if(signal.aborted)throw signal.reason;}}
 if(!cover)warnings.push('Copertina non recuperata: puoi caricarla dal dispositivo.');
 return {data:mergeCandidates(candidates),cover,candidates,warnings};
}
