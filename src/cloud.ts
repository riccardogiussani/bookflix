import {db,Library,validate,checkLocation,newId,importLibrary,type Book} from './data';
import {WORKER_URL,AccessDeniedError} from './isbn';
type CachedBook=Book&{cloudCoverPath?:string;cloudCoverHash?:string};
type Row=Omit<Book,'cover'>&{coverPath:string|null;coverHash:string|null};
type Manifest={format:'bookflix-cloud';version:1;books:Row[]};
type Snapshot={id:string;revision:string|null;catalog:Manifest};
export class CloudConflict extends Error {}
class CloudError extends Error {constructor(message:string,public status:number){super(message);}}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let active=false;
async function api(path:string,code:string,options:RequestInit={}){
 let r:Response;try{r=await fetch(WORKER_URL+path,{...options,cache:'no-store',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+code,...options.headers}});}catch{throw new CloudError('Connessione a Koofr non riuscita. Le modifiche non sono state confermate: riprova quando sei online.',0);}
 if(!r.ok){let message='Il servizio Koofr non è disponibile.';try{message=(await r.json()).error||message;}catch{}if(r.status===401)throw new AccessDeniedError(message);if(r.status===409)throw new CloudConflict(message);throw new CloudError(message,r.status);}return r;
}
async function parallel<T,R>(items:T[],fn:(item:T)=>Promise<R>):Promise<R[]>{const result:R[]=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await fn(items[i]);}}));return result;}
function checked(raw:Snapshot):Snapshot {
 if(!raw||!UUID.test(raw.id)||raw.revision!==null&&typeof raw.revision!=='string'||raw.catalog?.format!=='bookflix-cloud'||raw.catalog.version!==1||!Array.isArray(raw.catalog.books)||raw.catalog.books.length>20000)throw Error('Il catalogo su Koofr non è valido. Nessun dato locale è stato sostituito.');
 const ids=new Set(),isbns=new Set();
 const books=raw.catalog.books.map(row=>{const {coverPath,coverHash,cover:ignored,...fields}=row as Row&{cover?:unknown};const b=validate(fields);if(!UUID.test(b.id)||ids.has(b.id)||b.isbn&&isbns.has(b.isbn))throw Error('Il catalogo contiene identificativi o ISBN duplicati.');ids.add(b.id);if(b.isbn)isbns.add(b.isbn);
 if(coverPath!==null&&(typeof coverPath!=='string'||!UUID.test(coverPath.split('.')[0])||!/^[-a-f0-9]{36}\.(jpg|png|webp)$/.test(coverPath)))throw Error('Percorso copertina non valido.');
 if(coverPath&&(!coverHash||!/^[a-f0-9]{64}$/.test(coverHash)))throw Error('Impronta copertina non valida.');return {...b,coverPath,coverHash};});return {...raw,catalog:{...raw.catalog,books}};
}
async function snapshot():Promise<Snapshot|undefined>{return (await db.sync.get('snapshot'))?.value as Snapshot|undefined;}
async function cache(s:Snapshot,books:CachedBook[]){await db.transaction('rw',[db.books,db.sync],async()=>{await db.books.clear();await db.books.bulkPut(books.map(b=>({...b,...(b.isbn?{isbnKey:b.isbn}:{})})));await db.sync.put({key:'snapshot',value:s});});}
export async function refreshCloud(code:string){
 const raw=await (await api('/library',code)).json();const remote=checked(raw);const legacy=raw.catalog.books.some((b:Record<string,unknown>)=>'notes' in b||'status' in b);const previous=await snapshot();const cached=previous?.id===remote.id?await db.books.toArray() as CachedBook[]:[];const byId=new Map(cached.map(b=>[b.id,b]));
 const books=await parallel(remote.catalog.books,async row=>{const {coverPath,coverHash,...fields}=row;const prior=byId.get(row.id);let cover:Blob|undefined;
 if(coverPath){cover=prior?.cloudCoverPath===coverPath&&prior.cloudCoverHash===coverHash?prior.cover:undefined;if(!cover){cover=await (await api('/library/covers/'+coverPath,code)).blob();if(cover.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(cover.type))throw Error('Copertina cloud non valida.');const digest=await hash(cover);if(digest!==coverHash)throw Error('Copertina incompleta o diversa dal catalogo: riprova ad aggiornare.');}}
 return {...fields,cover,cloudCoverPath:coverPath||undefined,cloudCoverHash:coverHash||undefined};});
 // Remove retired fields from Koofr once, using the same atomic revision check as normal saves.
 if(legacy){const result=await (await api('/library',code,{method:'PUT',headers:{'Content-Type':'application/json',...(remote.revision?{'If-Match':remote.revision}:{'If-None-Match':'*'})},body:JSON.stringify(remote.catalog)})).json();remote.revision=result.revision;}
 await cache(remote,books);return books;
}
export async function openCloud(code:string){try{return {books:await refreshCloud(code),online:true,message:''};}catch(e){if(e instanceof AccessDeniedError)throw e;const s=await snapshot();if(!s)throw e;return {books:(await db.books.toArray()).map(validate),online:false,message:(e instanceof Error?e.message:'Koofr non disponibile.')+' Stai consultando la copia su questo dispositivo. Premi Aggiorna raccolta per riprovare.'};}}
async function hash(blob:Blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function state(){return db.transaction('r',[db.books,db.sync],async()=>({base:await snapshot(),books:await db.books.toArray() as CachedBook[]}));}
async function push(code:string,books:CachedBook[],base:Snapshot|undefined,changed?:string){
 if(navigator.onLine===false)throw Error('Sei offline. Ricollegati prima di salvare; il modulo conserva le modifiche.');
 if(!base)throw Error('Aggiorna la raccolta prima di salvare.');
 // Check before uploading images, then rely on DAV If-Match for the atomic write.
 const current=checked(await (await api('/library',code)).json());if(current.id!==base.id||current.revision!==base.revision)throw new CloudConflict('La raccolta è cambiata su un altro dispositivo. Premi Aggiorna raccolta, poi riprova a salvare. Il modulo resta aperto.');
 const rows=await parallel(books,async b=>{const {cover,cloudCoverPath,cloudCoverHash,isbnKey,...fields}=b as CachedBook&{isbnKey?:string};let coverPath=cloudCoverPath||null,coverHash=cloudCoverHash||null;
 if(!cover){coverPath=null;coverHash=null;}else if(!coverPath||!coverHash||b.id===changed){const digest=await hash(cover);if(digest!==coverHash||!coverPath){const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as Record<string,string>)[cover.type];if(!ext||cover.size>10*1024*1024)throw Error('Scegli una copertina JPG, PNG o WebP fino a 10 MB.');coverPath=newId()+'.'+ext;await api('/library/covers/'+coverPath,code,{method:'PUT',headers:{'Content-Type':cover.type},body:cover});}coverHash=digest;}
 return {...validate(fields),coverPath,coverHash};});
 const catalog:Manifest={format:'bookflix-cloud',version:1,books:rows};checked({id:base.id,revision:base.revision,catalog});
 const result=await (await api('/library',code,{method:'PUT',headers:{'Content-Type':'application/json',...(base.revision?{'If-Match':base.revision}:{'If-None-Match':'*'})},body:JSON.stringify(catalog)})).json();
 const confirmed=checked({id:base.id,revision:result.revision,catalog:result.catalog}).catalog;const byId=new Map(books.map(b=>[b.id,b]));const saved=confirmed.books.map(row=>{const {coverPath,coverHash,...fields}=row;return {...fields,cover:byId.get(row.id)?.cover,cloudCoverPath:coverPath||undefined,cloudCoverHash:coverHash||undefined};});
 try{await cache({id:base.id,revision:result.revision,catalog:confirmed},saved);}catch{throw Error('Salvato su Koofr, ma la copia locale non è stata aggiornata. Premi Aggiorna raccolta prima di continuare.');}return saved;
}
async function exclusive<T>(action:()=>Promise<T>){if(active)throw Error('Attendi la fine dell’operazione in corso.');active=true;try{return await action();}finally{active=false;}}
export function cloudSave(code:string,input:Book,expectedExisting=false){return exclusive(async()=>{const b=validate({...input,updatedAt:new Date().toISOString()});checkLocation(b.location);const {base,books}=await state();const prior=books.find(x=>x.id===input.id);if(expectedExisting&&!prior)throw new CloudConflict('Questo libro è stato eliminato su un altro dispositivo. Puoi conservarne le modifiche e inserirlo di nuovo manualmente.');if(prior&&prior.updatedAt!==input.updatedAt)throw new CloudConflict('Questo libro è stato modificato su un altro dispositivo. Conserva le tue correzioni e riapri il libro aggiornato prima di salvarlo.');const existing=books.find(x=>x.isbn&&x.isbn===b.isbn&&x.id!==b.id);if(existing)throw Error('Questo ISBN è già presente in libreria.');return push(code,[...books.filter(x=>x.id!==b.id),b],base,b.id);});}
export function cloudDelete(code:string,id:string,expectedUpdatedAt:string){return exclusive(async()=>{const {base,books}=await state();if(books.find(b=>b.id===id)?.updatedAt!==expectedUpdatedAt)throw new CloudConflict('Il libro è cambiato: riaprilo prima di eliminarlo.');return push(code,books.filter(b=>b.id!==id),base);});}
export function cloudImport(code:string,file:Blob){return exclusive(async()=>{const staging=new Library('bookflix-import-'+newId());try{await importLibrary(file,staging);const books=(await staging.books.toArray()).map(b=>{const {cloudCoverPath,cloudCoverHash,...clean}=b as CachedBook;return clean;});return await push(code,books,await snapshot());}finally{await staging.delete();}});}
