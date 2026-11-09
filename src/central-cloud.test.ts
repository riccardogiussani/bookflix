import 'fake-indexeddb/auto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
// @ts-expect-error Plain JavaScript fixture for the complete Worker/Firestore REST boundary.
import {harness} from '../worker/test-central-env.mjs';
// @ts-expect-error Signed Firebase JWT test fixture.
import {tokenFor,identityFor} from '../worker/test-auth.mjs';
import {jsonApi,CloudError,CloudConflict} from './central-api';
import {selectLibrary,clearLibrary,libraryContext,type LibraryInfo} from './libraryContext';
import {db,blankBook,Library,saveBook,exportLibrary,newId,type Book} from './data';
import {openCloud,refreshCloud,cloudSave,cloudDelete,cloudImport} from './cloud';
import {lookupISBN} from './isbn';
import {fillFromCatalogue,searchCatalogueTitle,selectCatalogueEdition} from './title-lookup';
vi.mock('./firebaseClient',()=>({currentAccessToken:async(code:string)=>code}));
const code=await tokenFor(),uid=identityFor().id;
let fixture:ReturnType<typeof harness>,library:LibraryInfo;
const input=()=>({...blankBook(),title:'Edizione comune',authors:['Autore'],isbn:'9788804668237'});
beforeEach(async()=>{fixture=harness();vi.stubGlobal('fetch',vi.fn(fixture.fetch));await jsonApi('/v2/profile',code);library=await jsonApi('/v2/libraries',code,{name:'Casa'});selectLibrary(library,uid);await db.books.clear();await db.sync.clear();});
afterEach(()=>{clearLibrary();vi.unstubAllGlobals();});
it('JWT Firebase → Worker → OAuth servizio → Firestore: crea una libreria e salva/riapre un libro',async()=>{expect((await openCloud(code)).books).toEqual([]);const rows=await cloudSave(code,input());expect(rows[0].id).toBe('isbn_9788804668237');expect((await refreshCloud(code))[0].title).toBe('Edizione comune');expect((await fixture.store.list('catalog')).length).toBe(1);expect(fixture.calls.some((c:{url:string})=>c.url.includes('firestore.googleapis.com'))).toBe(true);});
it('un refresh invariato legge solo le revisioni di libreria e catalogo e usa la cache',async()=>{await cloudSave(code,input());await refreshCloud(code);const reads=fixture.store.reads;await refreshCloud(code);expect(fixture.store.reads-reads).toBe(2);});
it('persistenza e deduplica delle copertine: un unico file per due librerie',async()=>{const cover=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});await cloudSave(code,{...input(),cover});const second=await jsonApi('/v2/libraries',code,{name:'Altra casa'});selectLibrary(second,uid);await cloudSave(code,{...input(),cover});expect(fixture.files.size).toBe(1);expect((await refreshCloud(code))[0].cover?.size).toBe(8);});
it('la ricerca ISBN riusa il catalogo centrale senza contattare nessun portale',async()=>{await cloudSave(code,input());const second=await jsonApi('/v2/libraries',code,{name:'Altra casa'});selectLibrary(second,uid);const result=await lookupISBN('9788804668237',new AbortController().signal,undefined,'',code);expect(result.data.title).toBe('Edizione comune');expect(result.candidates[0].source).toBe('Catalogo Bookflix');expect(fixture.calls.some((c:{url:string})=>new URL(c.url).pathname==='/lookup')).toBe(false);expect(await db.books.count()).toBe(0);});
it('cerca per titolo nel solo catalogo, distingue le edizioni e compila i campi della scheda scelta',async()=>{
 const cover=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});
 await cloudSave(code,{...input(),title:'Città d’ombra',subtitle:'Cronache',publisher:'Primo editore',year:'2020',pages:100,language:'it',genres:['Giallo'],description:'Trama',physicalFormat:'brossura',location:'Camere',cover});
 await cloudSave(code,{...input(),title:'Città d’ombra',publisher:'Secondo editore',isbn:'9780140449136'});
 const path='catalog/isbn_9788804668237',central=await fixture.store.get(path);
 fixture.store.put(path,{...central.data,classification:{primaryGenre:'giallo',secondaryGenres:[],genreVersion:'2.0',genreStatus:'classified'}});
 const second:LibraryInfo=await jsonApi('/v2/libraries',code,{name:'Altra casa'});selectLibrary(second,uid);
 const signal=new AbortController().signal;
 const result=await searchCatalogueTitle(second.id,"CITTA D'OMBRA",code,signal);
 expect(result.books.map(book=>book.publisher)).toEqual(expect.arrayContaining(['Primo editore','Secondo editore']));
 expect(result.books).toHaveLength(2);
 const chosen=await selectCatalogueEdition(second.id,'isbn_9788804668237',code,signal);
 const draft=fillFromCatalogue({...blankBook(),location:'Taverna'},chosen);
 expect(draft).toMatchObject({title:'Città d’ombra',subtitle:'Cronache',authors:['Autore'],publisher:'Primo editore',year:'2020',pages:100,language:'it',genres:['Giallo'],description:'Trama',isbn:'9788804668237',physicalFormat:'brossura',classification:{primaryGenre:'giallo'},location:'Taverna'});
 expect(draft.cover?.size).toBe(cover.size);
 expect((await searchCatalogueTitle(second.id,'Titolo inesistente',code,signal)).books).toEqual([]);
 expect(fixture.calls.some((c:{url:string})=>new URL(c.url).pathname==='/lookup')).toBe(false);
 expect(fixture.calls.some((c:{url:string})=>new URL(c.url).searchParams.getAll('mask.fieldPaths').includes('metadata.title'))).toBe(true);
});
it('l’aggiunta per titolo riusa l’edizione senza ISBN e riconosce un collegamento già presente',async()=>{
 const [original]=await cloudSave(code,{...blankBook(),title:'Edizione senza codice'});
 const second:LibraryInfo=await jsonApi('/v2/libraries',code,{name:'Altra casa'});selectLibrary(second,uid);
 const signal=new AbortController().signal;
 const {books}=await searchCatalogueTitle(second.id,'senza codice',code,signal);
 expect(books.map(book=>book.id)).toEqual([original.id]);
 const selected=await selectCatalogueEdition(second.id,books[0].id,code,signal);
 const [saved]=await cloudSave(code,fillFromCatalogue(blankBook(),selected));
 expect(saved.id).toBe(original.id);
 expect(await fixture.store.list('catalog')).toHaveLength(1);
 expect((await selectCatalogueEdition(second.id,original.id,code,signal)).linkedBookId).toBe(saved.id);
});
it('una modifica concorrente non viene sovrascritta e il modulo conserva la sua bozza',async()=>{const [book]=await cloudSave(code,input());await jsonApi('/v2/libraries/'+library.id+'/books',code,{book:{...book,title:'Aggiornato altrove',cover:null},revision:(book as Book&{revision:string}).revision});await expect(cloudSave(code,{...book,title:'Bozza locale'},true)).rejects.toBeInstanceOf(CloudConflict);expect((await db.books.get(book.id))?.title).toBe('Edizione comune');expect((await refreshCloud(code))[0].title).toBe('Aggiornato altrove');});
it('rimozione da una libreria conserva l’edizione centrale',async()=>{const [book]=await cloudSave(code,input());await cloudDelete(code,book.id,book.updatedAt,book.revision);expect(await db.books.count()).toBe(0);expect((await fixture.store.list('catalog')).length).toBe(1);});
it('cache separata per libreria e per utente, anche dopo un salvataggio',async()=>{await cloudSave(code,input());const firstDatabase=libraryContext().database,second=await jsonApi('/v2/libraries',code,{name:'Separata'});selectLibrary(second,uid);expect(await db.books.count()).toBe(0);await cloudSave(code,{...blankBook(),title:'Solo qui'});expect((await firstDatabase.books.toArray())[0].title).toBe('Edizione comune');selectLibrary(library,'another-user');expect(await db.books.count()).toBe(0);});
it('una risposta di refresh tardiva non contamina la libreria appena selezionata',async()=>{await cloudSave(code,input());const firstDatabase=db,second=await jsonApi('/v2/libraries',code,{name:'Separata'});let release:()=>void=()=>{},started:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});vi.stubGlobal('fetch',vi.fn(async(input:string|Request,options:RequestInit={})=>{const url=typeof input==='string'?input:input.url;if(url.includes('/v2/libraries/'+library.id+'/books')){started();await gate;}return fixture.fetch(input,options);}));const pending=refreshCloud(code);await entered;selectLibrary(second,uid);await openCloud(code);release();await pending;expect(await db.books.count()).toBe(0);expect(await firstDatabase.books.count()).toBe(1);});
it('se i permessi sono revocati non mostra la copia cache come ripiego',async()=>{await cloudSave(code,input());await refreshCloud(code);const path='libraries/'+library.id,doc=await fixture.store.get(path);fixture.store.put(path,{...doc.data,members:{},memberIds:[]});await expect(openCloud(code)).rejects.toBeInstanceOf(CloudError);});
it('una cache aggiornata resta consultabile offline anche subito dopo un salvataggio',async()=>{await cloudSave(code,input());vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('offline');}));const result=await openCloud(code);expect(result.online).toBe(false);expect(result.books[0].title).toBe('Edizione comune');});

it('confronta la revisione anche se due modifiche hanno la stessa data visualizzata',async()=>{const [book]=await cloudSave(code,input());const newer={...book,revision:'new-version'};await db.books.put(newer);await expect(cloudSave(code,{...book,title:'Bozza obsoleta'},true)).rejects.toBeInstanceOf(CloudConflict);await expect(cloudDelete(code,book.id,book.updatedAt,book.revision)).rejects.toBeInstanceOf(CloudConflict);});

it('importa un backup aggiungendo libri senza cancellare quelli presenti',async()=>{await cloudSave(code,input());const staging=new Library('test-import-'+newId());try{await saveBook({...blankBook(),title:'Dal backup'},staging);const zip=await exportLibrary(staging);const imported=await cloudImport(code,zip);expect(imported.map(b=>b.title).sort()).toEqual(['Dal backup','Edizione comune']);expect((await fixture.store.list('catalog')).length).toBe(2);}finally{await staging.delete();}});
it('una correzione ISBN conserva ID e contributi e non crea duplicati nella cache',async()=>{const [book]=await cloudSave(code,input());const changed=await cloudSave(code,{...book,isbn:'9780140449136'},true);expect(changed).toHaveLength(1);expect(changed[0].id).toBe(book.id);expect(changed[0].isbn).toBe('9780140449136');const all=await cloudSave(code,input());expect(all).toHaveLength(2);expect(new Set(all.map(b=>b.id)).size).toBe(2);expect((await refreshCloud(code)).map(b=>b.isbn).sort()).toEqual(['9780140449136','9788804668237']);});

it('una copertina mancante non blocca i libri né cancella il riferimento salvando altri metadati',async()=>{const cover=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});await cloudSave(code,{...input(),cover});fixture.files.clear();await db.books.clear();await db.sync.clear();const result=await openCloud(code);expect(result.online).toBe(true);expect(result.books[0].title).toBe('Edizione comune');expect(result.books[0].cover).toBeUndefined();expect(result.message).toContain('copertine');await cloudSave(code,{...result.books[0],title:'Corretto'},true);const item=await fixture.store.get('libraries/'+library.id+'/items/'+result.books[0].id);expect(item.data.coverOverride).toBeUndefined();});
