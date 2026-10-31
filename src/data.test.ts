import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import JSZip from 'jszip';
import {Library,blankBook,normalizeISBN,saveBook,exportLibrary,importLibrary} from './data';
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
 const source=database(),target=database();const book={...blankBook(),title:'Titolo',authors:['Autore'],genres:['Narrativa','Avventura'],notes:'Una nota',rating:4,cover:new Blob(['image bytes'],{type:'image/png'})};
 await saveBook(book,source);await importLibrary(await exportLibrary(source),target);
 const restored=await target.books.get(book.id);expect(restored?.notes).toBe('Una nota');expect(restored?.genres).toEqual(book.genres);expect(restored?.rating).toBe(4);expect(await restored?.cover?.text()).toBe('image bytes');
});
it('un backup incompleto non cancella i dati esistenti',async()=>{
 const d=database();await saveBook({...blankBook(),title:'Da conservare'},d);
 const zip=new JSZip();zip.file('library.json',JSON.stringify({format:'scaffale',version:1,books:[{...blankBook(),title:'Importato',coverPath:'covers/missing',coverType:'image/png'}]}));
 await expect(importLibrary(await zip.generateAsync({type:'blob'}),d)).rejects.toThrow('manca una copertina');
 expect((await d.books.toArray())[0].title).toBe('Da conservare');
});
