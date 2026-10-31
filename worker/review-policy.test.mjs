import {it,expect} from 'vitest';
import {identifyReviews,protectReviews} from './review-policy.mjs';
import {testUsers} from './test-auth.mjs';
const riccardo=testUsers.find(u=>u.username==='riccardo'),sara=testUsers.find(u=>u.username==='sara');
const identity={user:riccardo,users:testUsers};
const review=(user=sara)=>({id:'review-id',authorId:user.id,author:user.displayName,text:'Recensione',createdAt:'2026-10-31T10:00:00.000Z',updatedAt:'2026-10-31T10:00:00.000Z'});
const catalog=(reviews=[review()])=>({format:'bookflix-cloud',version:1,books:[{id:'book-id',title:'Titolo',reviews}]});
it('impedisce modifica, eliminazione, cambio autore e cancellazione del libro con recensioni altrui',()=>{
 const old=catalog();for(const next of [catalog([{...review(),text:'Falso'}]),catalog([]),catalog([{...review(),authorId:riccardo.id,author:'Riccardo'}]),{...old,books:[]}])expect(()=>protectReviews(old,next,identity)).toThrow('recensioni');
});
it('impedisce recensioni nuove impersonando altri e spostamenti fra libri',()=>{
 expect(()=>protectReviews(catalog([]),catalog([review()]),identity)).toThrow('utente autenticato');const old=catalog([review(riccardo)]),next={...old,books:[{id:'another-book',title:'Altro',reviews:[review(riccardo)]}]};expect(()=>protectReviews(old,next,identity)).toThrow('spostare');
});
it('firma con identità e date server, conserva le recensioni altrui e permette i metadati condivisi',()=>{
 const old=catalog(),next=catalog([review(),{...review(riccardo),id:'new-id',createdAt:'2000-01-01',updatedAt:'2000-01-01'}]);next.books[0].title='Titolo corretto';const confirmed=protectReviews(old,next,identity);expect(confirmed.books[0].title).toBe('Titolo corretto');expect(confirmed.books[0].reviews[0]).toEqual(review());expect(confirmed.books[0].reviews[1].authorId).toBe(riccardo.id);expect(confirmed.books[0].reviews[1].createdAt).not.toBe('2000-01-01');
});
it('riconosce gli autori precedenti solo se corrispondono univocamente e usa l’ID anche dopo un cambio nome',()=>{
 const {authorId,...legacy}=review(riccardo);expect(identifyReviews(catalog([legacy]),testUsers).books[0].reviews[0].authorId).toBe(riccardo.id);const unknown={...legacy,author:'Utente non noto'};expect(identifyReviews(catalog([unknown]),testUsers).books[0].reviews[0].authorId).toBeUndefined();expect(()=>protectReviews(catalog([unknown]),catalog([]),identity)).toThrow('eliminare');
 const own=review(riccardo);const next=catalog([{...own,text:'Modifica'}]);expect(protectReviews(catalog([own]),next,{...identity,user:{...riccardo,displayName:'Nuovo nome'}}).books[0].reviews[0].text).toBe('Modifica');
});
it('rifiuta ID duplicati fra libri, convalida le recensioni e ammette la cancellazione di quelle proprie',()=>{
 expect(()=>protectReviews(catalog([]),catalog([review(riccardo),review(riccardo)]),identity)).toThrow('duplicato');expect(()=>identifyReviews(catalog([{...review(),text:''}]),testUsers)).toThrow('non valida');expect(protectReviews(catalog([review(riccardo)]),catalog([]),identity).books[0].reviews).toEqual([]);
});
