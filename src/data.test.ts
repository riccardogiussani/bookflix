import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import JSZip from 'jszip';
import Dexie from 'dexie';
import {Library,blankBook,normalizeISBN,saveBook,exportLibrary,importLibrary,validate} from './data';
const databases:Library[]=[];
function database(){const d=new Library(crypto.randomUUID());databases.push(d);return d;}
afterEach(async()=>{for(const d of databases)await d.delete();databases.length=0;});
it('normalizza ISBN equivalenti e rifiuta cifre di controllo errate',()=>{
 expect(normalizeISBN('0-306-40615-2')).toBe('9780306406157');
 expect(()=>normalizeISBN('9780306406158')).toThrow();
 expect(normalizeISBN('')).toBe('');
});
it('impedisce duplicati anche quando ISBN-10 e ISBN-13 differiscono',async()=>{
 const d=database();await saveBook({...blankBook(),title:'Uno',isbn:'0306406152'},d);
 await expect(saveBook({...blankBook(),title:'Due',isbn:'9780306406157'},d)).rejects.toThrow('già presente');
 await saveBook({...blankBook(),title:'Senza ISBN'},d);await saveBook({...blankBook(),title:'Altro senza ISBN'},d);
 expect(await d.books.count()).toBe(3);
});
it('conserva metadati, recensioni, generi multipli e copertine nel backup',async()=>{
 const source=database(),target=database();const book={...blankBook(),title:'Titolo',authors:['Autore'],genres:['Narrativa','Avventura'],reviews:[{id:'review-one',author:'Riccardo',text:'Una recensione',createdAt:'2026-10-31T10:00:00.000Z',updatedAt:'2026-10-31T10:00:00.000Z'}],location:'Taverna',ratings:[{userId:'riccardo-id',author:'Riccardo',value:4,createdAt:'2026-10-31T10:00:00.000Z',updatedAt:'2026-10-31T10:00:00.000Z'}],cover:new Blob(['image bytes'],{type:'image/png'})};
 await saveBook(book,source);await importLibrary(await exportLibrary(source),target);
 const restored=await target.books.get(book.id);expect(restored?.reviews).toEqual(book.reviews);expect(restored?.location).toBe('Taverna');expect(restored?.genres).toEqual(book.genres);expect(restored?.ratings).toEqual(book.ratings);expect(await restored?.cover?.text()).toBe('image bytes');
});
it('un backup incompleto non cancella i dati esistenti',async()=>{
 const d=database();await saveBook({...blankBook(),title:'Da conservare'},d);
 const zip=new JSZip();zip.file('library.json',JSON.stringify({format:'scaffale',version:1,books:[{...blankBook(),title:'Importato',coverPath:'covers/missing',coverType:'image/png'}]}));
 await expect(importLibrary(await zip.generateAsync({type:'blob'}),d)).rejects.toThrow('manca una copertina');
 expect((await d.books.toArray())[0].title).toBe('Da conservare');
});
it('libera l’ISBN quando viene rimosso da un libro',async()=>{
 const d=database();const original={...blankBook(),title:'Primo',isbn:'9780306406157'};await saveBook(original,d);
 const loaded=(await d.books.get(original.id))!;await saveBook({...loaded,isbn:''},d);
 await saveBook({...blankBook(),title:'Secondo',isbn:original.isbn},d);expect(await d.books.count()).toBe(2);
});

it('accetta cataloghi e backup precedenti senza posizione, lasciandola vuota',async()=>{
 const {location,...legacy}=blankBook();const row={...legacy,title:'Libro precedente'};expect(validate(row as ReturnType<typeof blankBook>).location).toBe('');
 const d=database(),zip=new JSZip();zip.file('library.json',JSON.stringify({format:'scaffale',version:1,books:[row]}));await importLibrary(await zip.generateAsync({type:'blob'}),d);expect((await d.books.get(row.id))?.location).toBe('');
 expect(()=>validate({...blankBook(),title:'Errore',location:42} as unknown as ReturnType<typeof blankBook>)).toThrow('posizione');
});

it.each(['Soggiorno','Taverna','Camere',''])('salva la posizione consentita "%s"',async location=>{const d=database(),book={...blankBook(),title:'Posizione',location};await saveBook(book,d);expect((await d.books.get(book.id))?.location).toBe(location);});
it('rifiuta nuove posizioni libere senza cancellare il valore salvato e mantiene leggibili i dati precedenti',async()=>{const d=database(),book={...blankBook(),title:'Posizione',location:'Camere'};await saveBook(book,d);await expect(saveBook({...book,location:'Garage'},d)).rejects.toThrow('Scegli una posizione');expect((await d.books.get(book.id))?.location).toBe('Camere');expect(validate({...book,location:'Studio'}).location).toBe('Studio');});

it('rimuove note e stato dai backup precedenti senza convertirli in recensioni',async()=>{
 const d=database(),row={...blankBook(),title:'Precedente',notes:'Nota da rimuovere',status:'Letto',rating:5,legacyRating:4};const zip=new JSZip();zip.file('library.json',JSON.stringify({format:'scaffale',version:1,books:[row]}));await importLibrary(await zip.generateAsync({type:'blob'}),d);
 const loaded=await d.books.get(row.id);expect(loaded).not.toHaveProperty('notes');expect(loaded).not.toHaveProperty('status');expect(loaded?.reviews).toEqual([]);expect(loaded?.ratings).toEqual([]);expect(loaded).not.toHaveProperty('rating');expect(loaded).not.toHaveProperty('legacyRating');const backup=await JSZip.loadAsync(await (await exportLibrary(d)).arrayBuffer());const raw=JSON.parse(await backup.file('library.json')!.async('string'));expect(raw.books[0]).not.toHaveProperty('notes');expect(raw.books[0]).not.toHaveProperty('status');
});
it('ripulisce il vecchio database e lo snapshot locale durante l’aggiornamento dello schema',async()=>{
 const name=crypto.randomUUID(),old=new Dexie(name);old.version(1).stores({books:'id,&isbnKey,createdAt,*genres,*authors,status'});old.version(2).stores({sync:'key'});
 const {reviews,...fields}=blankBook();const legacy={...fields,title:'Precedente',notes:'Vecchia nota',status:'Da leggere',rating:5,legacyRating:3};await old.table('books').put(legacy);await old.table('sync').put({key:'snapshot',value:{catalog:{books:[legacy]}}});old.close();
 const updated=new Library(name);databases.push(updated);const restored=await updated.books.get(legacy.id);expect(restored?.reviews).toEqual([]);expect(restored).not.toHaveProperty('notes');expect(restored).not.toHaveProperty('status');expect(restored).not.toHaveProperty('rating');expect(restored).not.toHaveProperty('legacyRating');expect(restored?.ratings).toEqual([]);const snapshot=(await updated.sync.get('snapshot'))?.value as {catalog:{books:unknown[]}};expect(snapshot.catalog.books[0]).not.toHaveProperty('notes');expect(snapshot.catalog.books[0]).not.toHaveProperty('status');expect(snapshot.catalog.books[0]).not.toHaveProperty('rating');expect(snapshot.catalog.books[0]).not.toHaveProperty('legacyRating');
});
