import {ReviewError} from './review-policy.mjs';
export function identifyRatings(catalog){return {...catalog,books:catalog.books.map(b=>{
 if(b.ratings!==undefined&&!Array.isArray(b.ratings)||b.ratings?.length>100)throw new ReviewError('Valutazioni non valide.',400);const seen=new Set();const ratings=(b.ratings||[]).map(r=>{if(!r||typeof r.userId!=='string'||!r.userId||r.userId.length>100||seen.has(r.userId)||typeof r.author!=='string'||!r.author.trim()||r.author.length>80||!Number.isInteger(r.value)||r.value<1||r.value>5||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt))||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt)))throw new ReviewError('Valutazione non valida.',400);seen.add(r.userId);return {userId:r.userId,author:r.author.trim(),value:r.value,createdAt:r.createdAt,updatedAt:r.updatedAt};});
 const {rating,legacyRating,...fields}=b;return {...fields,ratings};
 })};}
export function protectRatings(previous,next,identity){const old=identifyRatings(previous),incoming=identifyRatings(next),actor=identity.user,oldBooks=new Map(old.books.map(b=>[b.id,b])),now=new Date().toISOString();
 const books=incoming.books.map(b=>{const previousBook=oldBooks.get(b.id),prior=new Map((previousBook?.ratings||[]).map(r=>[r.userId,r]));const ratings=b.ratings.map(r=>{const existing=prior.get(r.userId);
  if(r.userId!==actor.id){if(!existing||JSON.stringify(existing)!==JSON.stringify(r))throw new ReviewError('Puoi modificare solo la tua valutazione.');return existing;}
  if(existing){if(r.author!==existing.author||r.createdAt!==existing.createdAt)throw new ReviewError('Non puoi cambiare l’autore o la data del voto.');return {...existing,value:r.value,updatedAt:existing.value===r.value?existing.updatedAt:now};}
  if(r.author!==actor.displayName)throw new ReviewError('La valutazione deve appartenere all’utente autenticato.');return {...r,userId:actor.id,author:actor.displayName,createdAt:now,updatedAt:now};
 });for(const r of prior.values())if(r.userId!==actor.id&&!ratings.some(next=>next.userId===r.userId))throw new ReviewError('Non puoi rimuovere valutazioni di altri utenti.');return {...b,ratings};});
 const nextIds=new Set(books.map(b=>b.id));for(const b of old.books)if(!nextIds.has(b.id)&&b.ratings.some(r=>r.userId!==actor.id))throw new ReviewError('Non puoi eliminare un libro o ripristinare un backup cancellando valutazioni di altri utenti.');return {...next,books};
}
