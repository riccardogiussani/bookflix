import {it,expect} from 'vitest';
import {identifyRatings,protectRatings} from './rating-policy.mjs';
import {ReviewError} from './review-policy.mjs';
import {testUsers} from './test-auth.mjs';
const user=testUsers[0],other=testUsers[3],identity={user,users:testUsers};
const vote=(u=user,value=4)=>({userId:u.id,author:u.displayName,value,createdAt:'2026-10-31T10:00:00.000Z',updatedAt:'2026-10-31T10:00:00.000Z'});
const catalog=(ratings=[])=>({format:'bookflix-cloud',version:1,books:[{id:'book-id',ratings}]});
it('impedisce falsificazione, modifica, rimozione e perdita di voti altrui tramite il catalogo completo',()=>{
 const old=catalog([vote(other)]);for(const next of [catalog([{...vote(other),value:1}]),catalog([]),{...old,books:[]}])expect(()=>protectRatings(old,next,identity)).toThrow(ReviewError);expect(()=>protectRatings(catalog(),catalog([vote(other)]),identity)).toThrow('solo la tua');
});
it('assegna identità e date server, aggiorna o rimuove il proprio voto e conserva gli altri',()=>{
 const added=protectRatings(catalog([vote(other)]),catalog([vote(other),vote(user,5)]),identity);expect(added.books[0].ratings[1].createdAt).not.toBe(vote().createdAt);const edited=structuredClone(added);edited.books[0].ratings[1].value=2;const result=protectRatings(added,edited,identity);expect(result.books[0].ratings[0]).toEqual(vote(other));expect(result.books[0].ratings[1].value).toBe(2);expect(protectRatings(result,catalog([vote(other)]),identity).books[0].ratings).toHaveLength(1);
});
it('rifiuta voti duplicati, fuori scala e cambio autore',()=>{expect(()=>identifyRatings(catalog([vote(),vote()]))).toThrow('non valida');expect(()=>identifyRatings(catalog([vote(user,6)]))).toThrow('non valida');expect(()=>protectRatings(catalog([vote()]),catalog([{...vote(),author:'Sara'}]),identity)).toThrow('autore');});
it('elimina le vecchie valutazioni condivise senza generare voti personali',()=>{const data=catalog();data.books[0].rating=5;data.books[0].legacyRating=3;const clean=identifyRatings(data);expect(clean.books[0]).not.toHaveProperty('rating');expect(clean.books[0]).not.toHaveProperty('legacyRating');expect(clean.books[0].ratings).toEqual([]);});
