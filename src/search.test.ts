import {expect,it} from 'vitest';
import {blankBook,type Book} from './data';
import {indexCatalog,searchCatalog} from './search';
const book=(patch:Partial<Book>):Book=>({...blankBook(),title:'Libro',...patch});
it.each(['title','subtitle','publisher','year','description','language','location'] as const)('cerca nel campo %s',field=>{const b=book({[field]:'Rarità'});expect(searchCatalog(indexCatalog([b]),'rarita')).toEqual([b]);});
it('cerca fra più autori e generi, combinando parole in campi diversi senza duplicare i risultati',()=>{
 const a=book({title:'Il nome della rosa',authors:['Umberto Eco','Altro Autore'],genres:['Narrativa','Giallo'],publisher:'Bompiani',year:'1980'}),b=book({title:'Altro romanzo',authors:['Umberto Eco'],genres:['Saggio']});const index=indexCatalog([a,b]);expect(searchCatalog(index,'eco giallo 1980')).toEqual([a]);expect(searchCatalog(index,'autore narrativa')).toEqual([a]);expect(searchCatalog(index,'eco fantascienza')).toEqual([]);
});
it('ignora accenti, maiuscole e punteggiatura e riconosce parole parziali',()=>{const b=book({title:'Città d’argento',authors:['José Saramago']});expect(searchCatalog(indexCatalog([b]),"  CITTA D'ARG saram  ")).toEqual([b]);});
it('riconosce ISBN formattati ed equivalenti ISBN-10 e ISBN-13',()=>{const b=book({isbn:'9780306406157'}),index=indexCatalog([b]);for(const q of ['9780306406157','978-0-306-40615-7','0-306-40615-2','0306406152'])expect(searchCatalog(index,q)).toEqual([b]);});
it('mantiene ordine e catalogo originali e gestisce query vuote o senza risultati',()=>{const books=[book({title:'Secondo'}),book({title:'Primo'})];const index=indexCatalog(books);expect(searchCatalog(index,'   ')).toEqual(books);expect(searchCatalog(index,'inesistente')).toEqual([]);expect(books.map(b=>b.title)).toEqual(['Secondo','Primo']);});
it('aggiorna i risultati dopo modifica, inserimento ed eliminazione',()=>{const a=book({title:'Prima'}),b=book({title:'Dopo'});expect(searchCatalog(indexCatalog([a]),'dopo')).toEqual([]);expect(searchCatalog(indexCatalog([{...a,title:'Dopo'},b]),'dopo')).toHaveLength(2);expect(searchCatalog(indexCatalog([b]),'prima')).toEqual([]);});
it('cerca anche nei libri senza ISBN o metadati opzionali',()=>{const b=book({title:'Taccuino personale'});expect(searchCatalog(indexCatalog([b]),'taccuino')).toEqual([b]);});
it('gestisce una raccolta di alcune migliaia di libri',()=>{const books=Array.from({length:5000},(_,i)=>book({title:'Romanzo '+i,description:'Una storia di avventure',authors:[i%2?'Autore A':'Autore B']}));const results=searchCatalog(indexCatalog(books),'avventure autore b');expect(results).toHaveLength(2500);expect(results[0]).toBe(books[0]);});

it('cerca nelle recensioni e nei loro autori, ignorando i vecchi campi rimossi',()=>{const b=book({reviews:[{id:'r',author:'Riccardo',text:'Una bellissima avventura',createdAt:'2026-10-31T10:00:00.000Z',updatedAt:'2026-10-31T10:00:00.000Z'}]});expect(searchCatalog(indexCatalog([b]),'riccardo bellissima')).toEqual([b]);const legacy={...b,notes:'segreto',status:'Letto'};expect(searchCatalog(indexCatalog([legacy]),'segreto')).toEqual([]);expect(searchCatalog(indexCatalog([legacy]),'letto')).toEqual([]);});
