import 'fake-indexeddb/auto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Worker modules are plain JavaScript and run in the integration test.
import worker from '../worker/scraper.mjs';
// @ts-expect-error Shared Worker test fixtures run as JavaScript.
import {testEnv,tokenFor,identityFor,jwksResponse} from '../worker/test-auth.mjs';
import {db,blankBook,exportLibrary,Library,saveBook} from './data';
import {openCloud,refreshCloud,cloudSave,cloudDelete,cloudImport,CloudConflict} from './legacy-cloud';
import {AccessDeniedError,WORKER_URL} from './isbn';
const code=await tokenFor();
const env={...testEnv,KOOFR_USERNAME:'test@example.invalid',KOOFR_PASSWORD:'not-real-webdav',KOOFR_COLLECTION_ID:'ca91c2ce-b8c7-487e-8f40-99024a354c63'};
const root='https://app.koofr.net/dav/Koofr/.booflix/'+env.KOOFR_COLLECTION_ID;
let files:Map<string,{body:Uint8Array;type:string;etag:string}>,revision:number,offline:boolean,failCatalog:boolean,conflictOnPut:boolean;
let calls:{url:string;method:string;headers:Headers}[];
beforeEach(async()=>{
 env.BOOKFLIX_OWNER_UID=testEnv.BOOKFLIX_OWNER_UID;await db.books.clear();await db.sync.clear();files=new Map();revision=0;offline=false;failCatalog=false;conflictOnPut=false;calls=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string|Request,options:RequestInit={})=>{
  const keyResponse=jwksResponse(input);if(keyResponse)return keyResponse;const url=typeof input==='string'?input:input.url;
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
 const n=calls.filter(c=>c.method==='PUT'&&c.url.includes('/covers/')).length;await cloudSave(code,{...loaded[0],subtitle:'Nuovo sottotitolo'});expect(calls.filter(c=>c.method==='PUT'&&c.url.includes('/covers/'))).toHaveLength(n);
 const latest=(await db.books.toArray())[0];await cloudDelete(code,latest.id,latest.updatedAt);expect((await refreshCloud(code))).toEqual([]);
});
it('retains local data and draft on failed writes, and consults cached data when offline',async()=>{
 await openCloud(code);const saved=(await cloudSave(code,{...blankBook(),title:'Originale'}))[0];failCatalog=true;
 await expect(cloudSave(code,{...saved,title:'Correzione'})).rejects.toThrow('Koofr non disponibile');expect((await db.books.get(saved.id))?.title).toBe('Originale');
 offline=true;const view=await openCloud(code);expect(view.online).toBe(false);expect(view.books[0].title).toBe('Originale');await expect(cloudSave(code,{...saved,title:'Correzione'})).rejects.toThrow('Connessione');
});
it('rejects a stale snapshot and a race during atomic PUT without changing the cache',async()=>{
 await openCloud(code);const saved=(await cloudSave(code,{...blankBook(),title:'Uno'}))[0];const server=files.get(root+'/books.json')!;server.etag='"another-device"';
 await expect(cloudSave(code,{...saved,subtitle:'locale'})).rejects.toBeInstanceOf(CloudConflict);expect((await db.books.get(saved.id))?.subtitle).toBe('');
 await refreshCloud(code);conflictOnPut=true;await expect(cloudSave(code,{...saved,subtitle:'locale'})).rejects.toBeInstanceOf(CloudConflict);expect((await db.books.get(saved.id))?.subtitle).toBe('');
});
it('rejects stale edits to the same book even after refreshing the collection',async()=>{
 await openCloud(code);const saved=(await cloudSave(code,{...blankBook(),title:'Uno'}))[0];const server=files.get(root+'/books.json')!;const catalog=JSON.parse(new TextDecoder().decode(server.body));catalog.books[0].updatedAt='2030-01-01T00:00:00.000Z';catalog.books[0].subtitle='Remoto';server.body=new TextEncoder().encode(JSON.stringify(catalog));server.etag='"new"';await refreshCloud(code);
 await expect(cloudSave(code,{...saved,subtitle:'Locale'})).rejects.toThrow('riapri');await expect(cloudDelete(code,saved.id,saved.updatedAt)).rejects.toBeInstanceOf(CloudConflict);
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
 await expect(cloudSave(code,{...book,subtitle:'Vecchia modifica'},true)).rejects.toThrow('eliminato');expect(await db.books.count()).toBe(0);
});

it('normalizza i cataloghi cloud precedenti senza posizione e non mostra banner di successo',async()=>{
 expect((await openCloud(code)).message).toBe('');const book=(await cloudSave(code,{...blankBook(),title:'Precedente'}))[0];const stored=files.get(root+'/books.json')!;const catalog=JSON.parse(new TextDecoder().decode(stored.body));delete catalog.books[0].location;stored.body=new TextEncoder().encode(JSON.stringify(catalog));stored.etag='"legacy"';const loaded=await refreshCloud(code);expect(loaded[0].id).toBe(book.id);expect(loaded[0].location).toBe('');
});

it('rifiuta posizioni non consentite prima di scrivere su Koofr',async()=>{await openCloud(code);await expect(cloudSave(code,{...blankBook(),title:'Posizione',location:'Garage'})).rejects.toThrow('Scegli una posizione');expect(files.has(root+'/books.json')).toBe(false);});

it('elimina le vecchie note e lo stato anche dal catalogo Koofr senza generare recensioni',async()=>{
 await openCloud(code);const book=(await cloudSave(code,{...blankBook(),title:'Precedente'}))[0];const stored=files.get(root+'/books.json')!;const catalog=JSON.parse(new TextDecoder().decode(stored.body));catalog.books[0].notes='Nota da eliminare';catalog.books[0].status='Letto';delete catalog.books[0].reviews;stored.body=new TextEncoder().encode(JSON.stringify(catalog));stored.etag='"old-notes"';
 const loaded=await refreshCloud(code);expect(loaded[0].reviews).toEqual([]);expect(loaded[0]).not.toHaveProperty('notes');expect(loaded[0]).not.toHaveProperty('status');const cleaned=JSON.parse(new TextDecoder().decode(files.get(root+'/books.json')!.body));expect(cleaned.books[0]).not.toHaveProperty('notes');expect(cleaned.books[0]).not.toHaveProperty('status');expect(loaded[0].id).toBe(book.id);
});
it('mantiene le recensioni fra dispositivi e non perde commenti in un conflitto',async()=>{
 const {changeReview}=await import('./reviews');await openCloud(code);let book=(await cloudSave(code,{...blankBook(),title:'Recensioni'}))[0];book=(await cloudSave(code,changeReview(book,identityFor('Riccardo'),{type:'add',text:'Un bel libro'}),true))[0];await db.books.clear();await db.sync.clear();const remote=(await refreshCloud(code))[0];expect(remote.reviews[0].author).toBe('Riccardo');expect(remote.reviews[0].text).toBe('Un bel libro');
 const stored=files.get(root+'/books.json')!;stored.etag='"another-review"';await expect(cloudSave(code,changeReview(remote,identityFor('Sara'),{type:'add',text:'Da rileggere'}),true)).rejects.toBeInstanceOf(CloudConflict);expect((await db.books.get(book.id))?.reviews).toHaveLength(1);
});

it('non sostituisce la cache se la pulizia di note e stato incontra un conflitto',async()=>{
 await openCloud(code);const book=(await cloudSave(code,{...blankBook(),title:'Precedente'}))[0];const stored=files.get(root+'/books.json')!;const raw=JSON.parse(new TextDecoder().decode(stored.body));raw.books[0].notes='Nota vecchia';raw.books[0].status='Letto';stored.body=new TextEncoder().encode(JSON.stringify(raw));stored.etag='"legacy-race"';const previous=(await db.sync.get('snapshot'))?.value;conflictOnPut=true;
 await expect(refreshCloud(code)).rejects.toBeInstanceOf(CloudConflict);expect((await db.sync.get('snapshot'))?.value).toEqual(previous);expect((await db.books.get(book.id))?.reviews).toEqual([]);expect(JSON.parse(new TextDecoder().decode(files.get(root+'/books.json')!.body)).books[0].notes).toBe('Nota vecchia');
});

it('il Worker impedisce la falsificazione e la cancellazione delle recensioni altrui anche dal catalogo completo',async()=>{
 const {changeReview}=await import('./reviews');await openCloud(code);let book=(await cloudSave(code,{...blankBook(),title:'Condiviso'}))[0];book=(await cloudSave(code,changeReview(book,identityFor('Riccardo'),{type:'add',text:'Recensione personale'}),true))[0];const sara=await tokenFor('sara');env.BOOKFLIX_OWNER_UID=identityFor('Sara').id;
 await expect(cloudSave(sara,{...book,reviews:[]},true)).rejects.toThrow('recensioni di altri');await expect(cloudSave(sara,{...book,reviews:[{...book.reviews[0],text:'Modificata da Sara'}]},true)).rejects.toThrow('solo le tue');await expect(cloudDelete(sara,book.id,book.updatedAt)).rejects.toThrow('recensioni di altri');expect((await db.books.get(book.id))?.reviews[0].text).toBe('Recensione personale');
});

it('condivide voti personali, ne protegge la proprietà e conferma le date del server',async()=>{
 const {changeRating,ratingSummary}=await import('./ratings');await openCloud(code);let book=(await cloudSave(code,{...blankBook(),title:'Voti'}))[0];book=(await cloudSave(code,changeRating(book,identityFor('Riccardo'),5),true))[0];const sara=await tokenFor('sara');env.BOOKFLIX_OWNER_UID=identityFor('Sara').id;book=(await cloudSave(sara,changeRating(book,identityFor('Sara'),2),true))[0];expect(ratingSummary(book)).toEqual({average:3.5,count:2});await db.books.clear();await db.sync.clear();book=(await refreshCloud(sara))[0];expect(ratingSummary(book)).toEqual({average:3.5,count:2});
 await expect(cloudSave(sara,{...book,ratings:book.ratings.filter(r=>r.userId===identityFor('Sara').id)},true)).rejects.toThrow('rimuovere valutazioni');await expect(cloudDelete(sara,book.id,book.updatedAt)).rejects.toThrow('valutazioni di altri');book=(await cloudSave(sara,changeRating(book,identityFor('Sara'),null),true))[0];expect(ratingSummary(book)).toEqual({average:5,count:1});
});
it('ripulisce i vecchi voti nel catalogo Koofr e nella cache senza assegnarli a nessuno',async()=>{
 await openCloud(code);const book=(await cloudSave(code,{...blankBook(),title:'Vecchio voto'}))[0];const stored=files.get(root+'/books.json')!;const catalog=JSON.parse(new TextDecoder().decode(stored.body));catalog.books[0].rating=4;catalog.books[0].legacyRating=5;delete catalog.books[0].ratings;stored.body=new TextEncoder().encode(JSON.stringify(catalog));stored.etag='"old-rating"';const loaded=await refreshCloud(code);expect(loaded[0].ratings).toEqual([]);expect(loaded[0]).not.toHaveProperty('rating');const clean=JSON.parse(new TextDecoder().decode(files.get(root+'/books.json')!.body));expect(clean.books[0]).not.toHaveProperty('rating');expect(clean.books[0]).not.toHaveProperty('legacyRating');expect((await db.books.get(book.id))?.ratings).toEqual([]);
});

it('esegue il reset una sola volta, mantiene libri e copertine e non cancella i contributi nuovi',async()=>{
 const {changeReview}=await import('./reviews');await openCloud(code);const book=(await cloudSave(code,{...blankBook(),title:'Libro conservato',authors:['Autore'],location:'Soggiorno',cover:new Blob(['original cover'],{type:'image/png'})}))[0];const stored=files.get(root+'/books.json')!;const raw=JSON.parse(new TextDecoder().decode(stored.body));delete raw.identityEpoch;const old=raw.books[0];old.reviews=[{id:'old-review',author:'Vecchio utente',text:'Da rimuovere'}];old.ratings=[{userId:'old-user',value:5}];old.notes='vecchie note';old.rating=4;const path=old.coverPath;stored.body=new TextEncoder().encode(JSON.stringify(raw));stored.etag='"before-account-reset"';
 const loaded=(await refreshCloud(code))[0];expect(loaded.title).toBe(book.title);expect(loaded.authors).toEqual(book.authors);expect(loaded.location).toBe('Soggiorno');expect(await loaded.cover?.text()).toBe('original cover');expect(loaded.reviews).toEqual([]);expect(loaded.ratings).toEqual([]);const cleaned=JSON.parse(new TextDecoder().decode(files.get(root+'/books.json')!.body));expect(cleaned.identityEpoch).toBe('firebase-self-service-v1');expect(cleaned.books[0].coverPath).toBe(path);expect(cleaned.books[0]).not.toHaveProperty('notes');expect(cleaned.books[0]).not.toHaveProperty('rating');
 await cloudSave(code,changeReview(loaded,identityFor('Riccardo'),{type:'add',text:'Nuova recensione'}),true);expect((await refreshCloud(code))[0].reviews[0].text).toBe('Nuova recensione');
});
it('non sovrascrive libri o cache se il reset incontra una modifica concorrente',async()=>{
 await openCloud(code);const book=(await cloudSave(code,{...blankBook(),title:'Da conservare'}))[0];const stored=files.get(root+'/books.json')!;const raw=JSON.parse(new TextDecoder().decode(stored.body));delete raw.identityEpoch;raw.books[0].reviews=[{text:'Vecchio contributo'}];stored.body=new TextEncoder().encode(JSON.stringify(raw));stored.etag='"racing-reset"';const previous=(await db.sync.get('snapshot'))?.value;conflictOnPut=true;await expect(refreshCloud(code)).rejects.toBeInstanceOf(CloudConflict);expect((await db.books.get(book.id))?.title).toBe('Da conservare');expect((await db.sync.get('snapshot'))?.value).toEqual(previous);expect(JSON.parse(new TextDecoder().decode(files.get(root+'/books.json')!.body))).not.toHaveProperty('identityEpoch');
});
it('non permette a un nuovo account di leggere la raccolta o avviare il reset',async()=>{const stranger=await tokenFor('new-person');await expect(openCloud(stranger)).rejects.toThrow('Nessuna libreria associata');expect(calls).toEqual([]);});
