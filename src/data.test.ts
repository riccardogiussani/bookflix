import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import JSZip from 'jszip';
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
it('conserva metadati, note, generi multipli e copertine nel backup',async()=>{
 const source=database(),target=database();const book={...blankBook(),title:'Titolo',authors:['Autore'],genres:['Narrativa','Avventura'],notes:'Una nota',location:'Taverna',rating:4,cover:new Blob(['image bytes'],{type:'image/png'})};
 await saveBook(book,source);await importLibrary(await exportLibrary(source),target);
 const restored=await target.books.get(book.id);expect(restored?.notes).toBe('Una nota');expect(restored?.location).toBe('Taverna');expect(restored?.genres).toEqual(book.genres);expect(restored?.rating).toBe(4);expect(await restored?.cover?.text()).toBe('image bytes');
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
