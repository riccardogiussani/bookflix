import 'fake-indexeddb/auto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Worker modules are plain JavaScript and run in the integration test.
import worker from '../worker/scraper.mjs';
import {db,blankBook,exportLibrary,Library,saveBook} from './data';
import {openCloud,refreshCloud,cloudSave,cloudDelete,cloudImport,CloudConflict} from './cloud';
import {AccessDeniedError,WORKER_URL} from './isbn';
const code='test-access-only';
const env={ACCESS_CODE:code,KOOFR_USERNAME:'test@example.invalid',KOOFR_PASSWORD:'not-real-webdav',KOOFR_COLLECTION_ID:'ca91c2ce-b8c7-487e-8f40-99024a354c63'};
const root='https://app.koofr.net/dav/Koofr/.booflix/'+env.KOOFR_COLLECTION_ID;
let files:Map<string,{body:Uint8Array;type:string;etag:string}>,revision:number,offline:boolean,failCatalog:boolean,conflictOnPut:boolean;
let calls:{url:string;method:string;headers:Headers}[];
beforeEach(async()=>{
 await db.books.clear();await db.sync.clear();files=new Map();revision=0;offline=false;failCatalog=false;conflictOnPut=false;calls=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string|Request,options:RequestInit={})=>{
  const url=typeof input==='string'?input:input.url;
  if(url.startsWith(WORKER_URL)){if(offline)throw Error('offline');return worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:'https://riccardogiussani.github.io','CF-Connecting-IP':crypto.randomUUID()}}),env);}
  const headers=new Headers(options.headers),method=options.method||'GET';calls.push({url,method,headers});expect(url.startsWith('https://app.koofr.net/dav/Koofr/.booflix')).toBe(true);expect(headers.get('Authorization')).toBe('Basic '+btoa(env.KOOFR_USERNAME+':'+env.KOOFR_PASSWORD));expect(headers.get('Authorization')).not.toContain(code);expect(options.redirect).toBe('manual');
  if(method==='MKCOL')return new Response(null,{status:201});const old=files.get(url);
  if(method==='GET')return old?new Response(old.body.slice(),{headers:{'Content-Type':old.type,ETag:old.etag}}):new Response(null,{status:404});
  if(method==='PUT'){
   if(failCatalog&&url.endsWith('/books.json'))return new Response(null,{status:503});
   if(conflictOnPut&&url.endsWith('/books.json'))return new Response(null,{status:412});
   if(headers.get('If-None-Match')==='*'&&old||headers.get('If-Match')&&headers.get('If-Match')!==old?.etag)return new Response(null,{status:412});
   const body=new Uint8Array(await new Response(options.body).arrayBuffer()),etag='"r'+(++revision)+'"';files.set(url,{body,type:headers.get('Content-Type')||'',etag});return new Response(null,{status:201,headers:{ETag:etag}});
  }return new Response(null,{status:405});
 }));
});
afterEach(()=>vi.unstubAllGlobals());
it('creates the cloud collection, uploads a cover, reloads it on a fresh device and deletes the book',async()=>{
 expect((await openCloud(code)).books).toEqual([]);
 const input={...blankBook(),title:'Libro condiviso',location:'Soggiorno',isbn:'9780306406157',cover:new Blob(['cover'],{type:'image/png'})};
 const saved=await cloudSave(code,input);expect(saved).toHaveLength(1);expect(files.has(root+'/collection.json')).toBe(true);
 const catalog=JSON.parse(new TextDecoder().decode(files.get(root+'/books.json')!.body));expect(catalog.books[0].coverPath).toMatch(/\.png$/);expect(catalog.books[0].cover).toBeUndefined();
 await db.books.clear();await db.sync.clear();const loaded=await refreshCloud(code);expect(loaded[0].title).toBe(input.title);expect(loaded[0].location).toBe(input.location);expect(await loaded[0].cover?.text()).toBe('cover');
 const n=calls.filter(c=>c.method==='PUT'&&c.url.includes('/covers/')).length;await cloudSave(code,{...loaded[0],notes:'Nuova nota'});expect(calls.filter(c=>c.method==='PUT'&&c.url.includes('/covers/'))).toHaveLength(n);
 const latest=(await db.books.toArray())[0];await cloudDelete(code,latest.id,latest.updatedAt);expect((await refreshCloud(code))).toEqual([]);
});
it('retains local data and draft on failed writes, and consults cached data when offline',async()=>{
 await openCloud(code);const saved=(await cloudSave(code,{...blankBook(),title:'Originale'}))[0];failCatalog=true;
 await expect(cloudSave(code,{...saved,title:'Correzione'})).rejects.toThrow('Koofr non disponibile');expect((await db.books.get(saved.id))?.title).toBe('Originale');
 offline=true;const view=await openCloud(code);expect(view.online).toBe(false);expect(view.books[0].title).toBe('Originale');await expect(cloudSave(code,{...saved,title:'Correzione'})).rejects.toThrow('Connessione');
});
it('rejects a stale snapshot and a race during atomic PUT without changing the cache',async()=>{
 await openCloud(code);const saved=(await cloudSave(code,{...blankBook(),title:'Uno'}))[0];const server=files.get(root+'/books.json')!;server.etag='"another-device"';
 await expect(cloudSave(code,{...saved,notes:'locale'})).rejects.toBeInstanceOf(CloudConflict);expect((await db.books.get(saved.id))?.notes).toBe('');
 await refreshCloud(code);conflictOnPut=true;await expect(cloudSave(code,{...saved,notes:'locale'})).rejects.toBeInstanceOf(CloudConflict);expect((await db.books.get(saved.id))?.notes).toBe('');
});
it('rejects stale edits to the same book even after refreshing the collection',async()=>{
 await openCloud(code);const saved=(await cloudSave(code,{...blankBook(),title:'Uno'}))[0];const server=files.get(root+'/books.json')!;const catalog=JSON.parse(new TextDecoder().decode(server.body));catalog.books[0].updatedAt='2030-01-01T00:00:00.000Z';catalog.books[0].notes='Remoto';server.body=new TextEncoder().encode(JSON.stringify(catalog));server.etag='"new"';await refreshCloud(code);
 await expect(cloudSave(code,{...saved,notes:'Locale'})).rejects.toThrow('riapri');await expect(cloudDelete(code,saved.id,saved.updatedAt)).rejects.toBeInstanceOf(CloudConflict);
});
it('imports a ZIP via staging, preserving the current collection when the backup is invalid',async()=>{
 await openCloud(code);await cloudSave(code,{...blankBook(),title:'Originale'});
 await expect(cloudImport(code,new Blob(['bad zip']))).rejects.toThrow();expect((await db.books.toArray())[0].title).toBe('Originale');
 const staging=new Library('test-export-'+crypto.randomUUID());try{await saveBook({...blankBook(),title:'Importato',cover:new Blob(['img'],{type:'image/png'})},staging);const result=await cloudImport(code,await exportLibrary(staging));expect(result.map(b=>b.title)).toEqual(['Importato']);expect(await result[0].cover?.text()).toBe('img');}finally{await staging.delete();}
});
it('does not replace the cache if a remote cover is missing or corrupt; never masks auth failure',async()=>{
 await openCloud(code);await cloudSave(code,{...blankBook(),title:'Preservato',cover:new Blob(['original'],{type:'image/png'})});const remote=files.get(root+'/books.json')!;const catalog=JSON.parse(new TextDecoder().decode(remote.body));files.get(root+'/covers/'+catalog.books[0].coverPath)!.body=new TextEncoder().encode('corrupt');await db.books.update(catalog.books[0].id,{cloudCoverPath:undefined} as never);
 await expect(refreshCloud(code)).rejects.toThrow('Copertina incompleta');expect((await db.books.toArray())[0].title).toBe('Preservato');await expect(openCloud('wrong')).rejects.toBeInstanceOf(AccessDeniedError);
});
it('keeps the collection unmodified for duplicate ISBNs',async()=>{
 await openCloud(code);await cloudSave(code,{...blankBook(),title:'Uno',isbn:'9780306406157'});await expect(cloudSave(code,{...blankBook(),title:'Due',isbn:'0306406152'})).rejects.toThrow('già presente');expect(await db.books.count()).toBe(1);
});

it('uploads a replacement cover, removes it and keeps backup records independent of cloud paths',async()=>{
 await openCloud(code);let book=(await cloudSave(code,{...blankBook(),title:'Copertina',cover:new Blob(['one'],{type:'image/png'})}))[0];
 const first=JSON.parse(new TextDecoder().decode(files.get(root+'/books.json')!.body)).books[0].coverPath;
 book=(await cloudSave(code,{...book,cover:new Blob(['two'],{type:'image/jpeg'})},true))[0];
 const second=JSON.parse(new TextDecoder().decode(files.get(root+'/books.json')!.body)).books[0].coverPath;expect(second).not.toBe(first);expect(second).toMatch(/\.jpg$/);
 const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(await (await exportLibrary()).arrayBuffer());const backup=JSON.parse(await zip.file('library.json')!.async('string'));expect(backup.books[0].cloudCoverPath).toBeUndefined();expect(backup.books[0].cloudCoverHash).toBeUndefined();
 await cloudSave(code,{...book,cover:undefined},true);expect((await refreshCloud(code))[0].cover).toBeUndefined();
});
it('does not resurrect a book deleted remotely after the user refreshes',async()=>{
 await openCloud(code);const book=(await cloudSave(code,{...blankBook(),title:'Eliminato'}))[0];const server=files.get(root+'/books.json')!;server.body=new TextEncoder().encode(JSON.stringify({format:'bookflix-cloud',version:1,books:[]}));server.etag='"deleted"';await refreshCloud(code);
 await expect(cloudSave(code,{...book,notes:'Vecchia modifica'},true)).rejects.toThrow('eliminato');expect(await db.books.count()).toBe(0);
});

it('normalizza i cataloghi cloud precedenti senza posizione e non mostra banner di successo',async()=>{
 expect((await openCloud(code)).message).toBe('');const book=(await cloudSave(code,{...blankBook(),title:'Precedente'}))[0];const stored=files.get(root+'/books.json')!;const catalog=JSON.parse(new TextDecoder().decode(stored.body));delete catalog.books[0].location;stored.body=new TextEncoder().encode(JSON.stringify(catalog));stored.etag='"legacy"';const loaded=await refreshCloud(code);expect(loaded[0].id).toBe(book.id);expect(loaded[0].location).toBe('');
});

it('rifiuta posizioni non consentite prima di scrivere su Koofr',async()=>{await openCloud(code);await expect(cloudSave(code,{...blankBook(),title:'Posizione',location:'Garage'})).rejects.toThrow('Scegli una posizione');expect(files.has(root+'/books.json')).toBe(false);});
