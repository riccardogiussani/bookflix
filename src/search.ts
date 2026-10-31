import {normalizeISBN,type Book} from './data';
export function searchText(value:string){return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function indexCatalog(books:Book[]){return books.map(book=>({book,text:searchText([book.title,book.subtitle,...book.authors,book.publisher,...book.genres,book.isbn,book.year,book.description,book.language,book.status,book.notes,book.location].join(' '))}));}
export function searchCatalog(index:ReturnType<typeof indexCatalog>,query:string){
 let text=query.trim();if(text)try{const isbn=normalizeISBN(text);if(isbn)text=isbn;}catch{/* A free-text query need not be an ISBN. */}
 const terms=searchText(text).split(/\s+/).filter(Boolean);return index.filter(row=>terms.every(term=>row.text.includes(term))).map(row=>row.book);
}
