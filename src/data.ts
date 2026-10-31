import Dexie, {type Table} from 'dexie';

export const IDENTITY_EPOCH='firebase-self-service-v1';
export type Review={id:string;author:string;authorId?:string;text:string;createdAt:string;updatedAt:string};
export type Rating={userId:string;author:string;value:number;createdAt:string;updatedAt:string};
export type Book = {
 id:string; revision?:string; title:string; subtitle:string; authors:string[]; publisher:string;
 year:string; pages:number|null; language:string; genres:string[]; description:string;
 isbn:string; ratings:Rating[]; reviews:Review[]; location:string;
 createdAt:string; updatedAt:string; cover?:Blob;
};
export const locations=['Soggiorno','Taverna','Camere','Casa Sara e Dario','Casa Giulia'] as const;
export function checkLocation(location:string|undefined){if(location&&!locations.some(value=>value===location))throw Error('Scegli una posizione tra Soggiorno, Taverna e Camere, oppure lasciala vuota.');}
export function newId():string {
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function blankBook():Book {const now=new Date().toISOString();return {id:newId(),title:'',subtitle:'',authors:[],publisher:'',year:'',pages:null,language:'',genres:[],description:'',isbn:'',ratings:[],reviews:[],location:'',createdAt:now,updatedAt:now};}
export function normalizeISBN(raw:string):string {
 const s=raw.replace(/[\s-]/g,'').toUpperCase(); if(!s)return '';
 if(s.length===10 && /^\d{9}[\dX]$/.test(s)){
  if([...s].reduce((n,c,i)=>n+(c==='X'?10:Number(c))*(10-i),0)%11)throw Error('ISBN-10 non valido: controlla le cifre.');
  const prefix='978'+s.slice(0,9);return prefix+((10-[...prefix].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10)%10);
 }
 if(!/^(978|979)\d{10}$/.test(s)||[...s].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10)throw Error('ISBN non valido: inserisci un ISBN-10 o ISBN-13.');
 return s;
}
export class Library extends Dexie {books!:Table<Book,string>;sync!:Table<{key:string;value:unknown},string>; constructor(name='scaffale-library'){super(name);this.version(1).stores({books:'id,&isbnKey,createdAt,*genres,*authors,status'});this.version(2).stores({sync:'key'});this.version(3).stores({books:'id,&isbnKey,createdAt,*genres,*authors'}).upgrade(async tx=>{await tx.table('books').toCollection().modify(b=>{delete b.notes;delete b.status;b.reviews??=[];});await tx.table('sync').toCollection().modify(row=>{for(const b of row.value?.catalog?.books||[]){delete b.notes;delete b.status;b.reviews??=[];}});});this.version(4).stores({}).upgrade(async tx=>{const clean=(b:any)=>{delete b.rating;delete b.legacyRating;b.ratings??=[];};await tx.table('books').toCollection().modify(clean);await tx.table('sync').toCollection().modify(row=>{for(const b of row.value?.catalog?.books||[])clean(b);});});this.version(5).stores({}).upgrade(async tx=>{await tx.table('books').toCollection().modify(book=>{book.reviews=[];book.ratings=[];delete book.notes;delete book.status;delete book.rating;delete book.legacyRating;});await tx.table('sync').clear();});}}
export let db=new Library('bookflix-koofr-cache');
const libraryDatabases=new Map<string,Library>();
export function useLibraryDatabase(userId:string,libraryId:string){const name='bookflix-v2-'+encodeURIComponent(userId)+'-'+libraryId;db=libraryDatabases.get(name)||new Library(name);libraryDatabases.set(name,db);return db;}

function record(b:Book){const {isbnKey,...clean}=b as Book & {isbnKey?:string};return {...clean,...(b.isbn?{isbnKey:b.isbn}:{})};}
export function validate(b:Book):Book {
 if(!b||typeof b.id!=='string'||!b.id||typeof b.title!=='string'||!b.title.trim())throw Error('Ogni libro deve avere un titolo e un identificativo.');
 for(const k of ['subtitle','publisher','year','language','description','isbn','createdAt','updatedAt'] as const)if(typeof b[k]!=='string')throw Error('Formato dei dati non valido.');
 if(b.location!==undefined&&typeof b.location!=='string')throw Error('La posizione deve essere un testo.');
 for(const arr of [b.authors,b.genres])if(!Array.isArray(arr)||arr.some(v=>typeof v!=='string'))throw Error('Autori o generi non validi.');
 if(b.pages!==null&&(!Number.isInteger(b.pages)||b.pages<1))throw Error('Valutazione o numero di pagine non valido.');
 if(!Number.isFinite(Date.parse(b.createdAt))||!Number.isFinite(Date.parse(b.updatedAt)))throw Error('Date non valide.');
 const rawReviews=b.reviews===undefined?[]:b.reviews;if(!Array.isArray(rawReviews)||rawReviews.length>1000)throw Error('Recensioni non valide.');
 const reviewIds=new Set<string>();const reviews=rawReviews.map(r=>{if(!r||typeof r.id!=='string'||!r.id||reviewIds.has(r.id)||r.authorId!==undefined&&(typeof r.authorId!=='string'||!r.authorId||r.authorId.length>100)||typeof r.author!=='string'||!r.author.trim()||r.author.length>80||typeof r.text!=='string'||!r.text.trim()||r.text.length>10000||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt))||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt)))throw Error('Recensione non valida.');reviewIds.add(r.id);return {id:r.id,...(r.authorId?{authorId:r.authorId}:{}),author:r.author.trim(),text:r.text.trim(),createdAt:r.createdAt,updatedAt:r.updatedAt};});
 const rawRatings=b.ratings===undefined?[]:b.ratings;if(!Array.isArray(rawRatings)||rawRatings.length>100)throw Error('Valutazioni non valide.');const ratingUsers=new Set<string>();const ratings=rawRatings.map(r=>{if(!r||typeof r.userId!=='string'||!r.userId||r.userId.length>100||ratingUsers.has(r.userId)||typeof r.author!=='string'||!r.author.trim()||r.author.length>80||!Number.isInteger(r.value)||r.value<1||r.value>5||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt))||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt)))throw Error('Valutazione non valida.');ratingUsers.add(r.userId);return {userId:r.userId,author:r.author.trim(),value:r.value,createdAt:r.createdAt,updatedAt:r.updatedAt};});
 const {notes:removedNotes,status:removedStatus,rating:removedRating,legacyRating:removedLegacyRating,...clean}=b as Book&{notes?:unknown;status?:unknown;rating?:unknown;legacyRating?:unknown};
 return {...clean,reviews,ratings,location:b.location??'',title:b.title.trim(),isbn:normalizeISBN(b.isbn),genres:[...new Set(b.genres.map(s=>s.trim()).filter(Boolean))],authors:b.authors.map(s=>s.trim()).filter(Boolean)};
}
export async function saveBook(input:Book,database=db){const b=validate({...input,updatedAt:new Date().toISOString()});checkLocation(b.location);await database.transaction('rw',database.books,async()=>{
 if(b.isbn){const existing=await database.books.where('isbnKey').equals(b.isbn).first();if(existing&&existing.id!==b.id)throw Error('Questo ISBN è già presente in libreria.');}
 await database.books.put(record(b));});}
export async function exportLibrary(database=db){const {default:JSZip}=await import('jszip');const zip=new JSZip();const books=await database.books.toArray();const rows=books.map(raw=>{const b=validate(raw);
 const {cover,...rest}=b;const {isbnKey,cloudCoverPath,cloudCoverHash,...clean}=rest as typeof rest & {isbnKey?:string;cloudCoverPath?:string;cloudCoverHash?:string};
 if(cover)zip.file(`covers/${b.id}`,cover.arrayBuffer());
 return {...clean,coverPath:cover?`covers/${b.id}`:null,coverType:cover?.type||null};
 });zip.file('library.json',JSON.stringify({format:'scaffale',version:1,identityEpoch:IDENTITY_EPOCH,exportedAt:new Date().toISOString(),books:rows},null,2));return zip.generateAsync({type:'blob'});}
export async function importLibrary(file:Blob,database=db){
 if(file.size>200*1024*1024)throw Error('Backup troppo grande: limite 200 MB.');
 const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(await file.arrayBuffer());const manifest=zip.file('library.json');if(!manifest)throw Error('Il backup non contiene library.json.');
 const data=JSON.parse(await manifest.async('string'));if(data.format!=='scaffale'||data.version!==1||!Array.isArray(data.books)||data.books.length>20000)throw Error('Formato del backup non supportato.');
 const ids=new Set<string>(),isbns=new Set<string>();let bytes=0;const books:Book[]=[];
 for(const raw of data.books){const {coverPath,coverType,cover:ignored,isbnKey,...fields}=raw;let b=validate(data.identityEpoch===IDENTITY_EPOCH?fields:{...fields,reviews:[],ratings:[]});
  if(ids.has(b.id)||b.isbn&&isbns.has(b.isbn))throw Error('Il backup contiene libri duplicati.');ids.add(b.id);if(b.isbn)isbns.add(b.isbn);
  if(coverPath){if(typeof coverPath!=='string'||!coverPath.startsWith('covers/'))throw Error('Percorso copertina non valido.');const entry=zip.file(coverPath);if(!entry)throw Error('Nel backup manca una copertina.');const buffer=await entry.async('uint8array');bytes+=buffer.byteLength;if(buffer.byteLength>10*1024*1024||bytes>200*1024*1024)throw Error('Le immagini del backup superano il limite.');if(!['image/jpeg','image/png','image/webp'].includes(coverType))throw Error('Formato copertina non supportato.');b={...b,cover:new Blob([buffer as BlobPart],{type:coverType})};}
  books.push(b);
 }
 // All validation precedes the transaction: a broken backup cannot erase the library.
 await database.transaction('rw',database.books,async()=>{await database.books.clear();await database.books.bulkAdd(books.map(record));});return books.length;
}
