import Dexie, {type Table} from 'dexie';
import JSZip from 'jszip';

export type Book = {
 id:string; title:string; subtitle:string; authors:string[]; publisher:string;
 year:string; pages:number|null; language:string; genres:string[]; description:string;
 isbn:string; status:'Da leggere'|'In lettura'|'Letto'; rating:number|null; notes:string;
 createdAt:string; updatedAt:string; cover?:Blob;
};
export const statuses = ['Da leggere','In lettura','Letto'] as const;
export function blankBook():Book {const now=new Date().toISOString();return {id:crypto.randomUUID(),title:'',subtitle:'',authors:[],publisher:'',year:'',pages:null,language:'',genres:[],description:'',isbn:'',status:'Da leggere',rating:null,notes:'',createdAt:now,updatedAt:now};}
export function normalizeISBN(raw:string):string {
 const s=raw.replace(/[\s-]/g,'').toUpperCase(); if(!s)return '';
 if(s.length===10 && /^\d{9}[\dX]$/.test(s)){
  if([...s].reduce((n,c,i)=>n+(c==='X'?10:Number(c))*(10-i),0)%11)throw Error('ISBN-10 non valido: controlla le cifre.');
  const prefix='978'+s.slice(0,9);return prefix+((10-[...prefix].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10)%10);
 }
 if(!/^(978|979)\d{10}$/.test(s)||[...s].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10)throw Error('ISBN non valido: inserisci un ISBN-10 o ISBN-13.');
 return s;
}
export class Library extends Dexie {books!:Table<Book,string>; constructor(name='scaffale-library'){super(name);this.version(1).stores({books:'id,&isbnKey,createdAt,*genres,*authors,status'});}}
export const db=new Library();
function record(b:Book){return {...b,...(b.isbn?{isbnKey:b.isbn}:{})};}
export function validate(b:Book):Book {
 if(!b||typeof b.id!=='string'||!b.id||typeof b.title!=='string'||!b.title.trim())throw Error('Ogni libro deve avere un titolo e un identificativo.');
 for(const k of ['subtitle','publisher','year','language','description','isbn','notes','createdAt','updatedAt'] as const)if(typeof b[k]!=='string')throw Error('Formato dei dati non valido.');
 for(const arr of [b.authors,b.genres])if(!Array.isArray(arr)||arr.some(v=>typeof v!=='string'))throw Error('Autori o generi non validi.');
 if(!statuses.includes(b.status)||b.rating!==null&&(!Number.isInteger(b.rating)||b.rating<1||b.rating>5)||b.pages!==null&&(!Number.isInteger(b.pages)||b.pages<1))throw Error('Stato, valutazione o numero di pagine non valido.');
 if(!Number.isFinite(Date.parse(b.createdAt))||!Number.isFinite(Date.parse(b.updatedAt)))throw Error('Date non valide.');
 return {...b,title:b.title.trim(),isbn:normalizeISBN(b.isbn),genres:[...new Set(b.genres.map(s=>s.trim()).filter(Boolean))],authors:b.authors.map(s=>s.trim()).filter(Boolean)};
}
export async function saveBook(input:Book,database=db){const b=validate({...input,updatedAt:new Date().toISOString()});await database.transaction('rw',database.books,async()=>{
 if(b.isbn){const existing=await database.books.where('isbnKey').equals(b.isbn).first();if(existing&&existing.id!==b.id)throw Error('Questo ISBN è già presente in libreria.');}
 await database.books.put(record(b));});}
export async function exportLibrary(database=db){const zip=new JSZip();const books=await database.books.toArray();const rows=books.map(b=>{
 const {cover,...rest}=b;const {isbnKey,...clean}=rest as typeof rest & {isbnKey?:string};
 if(cover)zip.file(`covers/${b.id}`,cover.arrayBuffer());
 return {...clean,coverPath:cover?`covers/${b.id}`:null,coverType:cover?.type||null};
 });zip.file('library.json',JSON.stringify({format:'scaffale',version:1,exportedAt:new Date().toISOString(),books:rows},null,2));return zip.generateAsync({type:'blob'});}
export async function importLibrary(file:Blob,database=db){
 if(file.size>200*1024*1024)throw Error('Backup troppo grande: limite 200 MB.');
 const zip=await JSZip.loadAsync(await file.arrayBuffer());const manifest=zip.file('library.json');if(!manifest)throw Error('Il backup non contiene library.json.');
 const data=JSON.parse(await manifest.async('string'));if(data.format!=='scaffale'||data.version!==1||!Array.isArray(data.books)||data.books.length>20000)throw Error('Formato del backup non supportato.');
 const ids=new Set<string>(),isbns=new Set<string>();let bytes=0;const books:Book[]=[];
 for(const raw of data.books){const {coverPath,coverType,cover:ignored,isbnKey,...fields}=raw;let b=validate(fields);
  if(ids.has(b.id)||b.isbn&&isbns.has(b.isbn))throw Error('Il backup contiene libri duplicati.');ids.add(b.id);if(b.isbn)isbns.add(b.isbn);
  if(coverPath){if(typeof coverPath!=='string'||!coverPath.startsWith('covers/'))throw Error('Percorso copertina non valido.');const entry=zip.file(coverPath);if(!entry)throw Error('Nel backup manca una copertina.');const buffer=await entry.async('uint8array');bytes+=buffer.byteLength;if(buffer.byteLength>10*1024*1024||bytes>200*1024*1024)throw Error('Le immagini del backup superano il limite.');if(!['image/jpeg','image/png','image/webp'].includes(coverType))throw Error('Formato copertina non supportato.');b={...b,cover:new Blob([buffer as BlobPart],{type:coverType})};}
  books.push(b);
 }
 // All validation precedes the transaction: a broken backup cannot erase the library.
 await database.transaction('rw',database.books,async()=>{await database.books.clear();await database.books.bulkAdd(books.map(record));});return books.length;
}
