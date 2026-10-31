import {normalizedName} from './auth.mjs';
export class ReviewError extends Error{constructor(message,status=403){super(message);this.status=status;}}
function review(r,users){
 if(!r||typeof r.id!=='string'||!r.id||r.id.length>100||typeof r.author!=='string'||!r.author.trim()||r.author.length>80||typeof r.text!=='string'||!r.text.trim()||r.text.length>10000||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt))||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt))||r.authorId!==undefined&&(typeof r.authorId!=='string'||!r.authorId||r.authorId.length>100))throw new ReviewError('Recensione non valida.',400);
 let authorId=r.authorId;if(!authorId){const matches=users.filter(u=>[u.username,u.displayName].some(name=>normalizedName(name)===normalizedName(r.author)));if(matches.length===1)authorId=matches[0].id;}
 return {id:r.id,...(authorId?{authorId}:{}),author:r.author.trim(),text:r.text.trim(),createdAt:r.createdAt,updatedAt:r.updatedAt};
}
export function identifyReviews(catalog,users){return {...catalog,books:catalog.books.map(b=>{if(b.reviews!==undefined&&!Array.isArray(b.reviews)||b.reviews?.length>1000)throw new ReviewError('Recensioni non valide.',400);return {...b,reviews:(b.reviews||[]).map(r=>review(r,users))};})};}
export function protectReviews(previous,next,identity){
 const old=identifyReviews(previous,identity.users),incoming=identifyReviews(next,identity.users),actor=identity.user;
 const oldReviews=new Map(),newReviews=new Map();for(const b of old.books)for(const r of b.reviews){if(oldReviews.has(r.id))throw new ReviewError('ID recensione duplicato nel catalogo.',400);oldReviews.set(r.id,{book:b.id,review:r});}
 const now=new Date().toISOString();const books=incoming.books.map(b=>{const reviews=b.reviews.map(r=>{
  if(newReviews.has(r.id))throw new ReviewError('ID recensione duplicato.',400);newReviews.set(r.id,b.id);const prior=oldReviews.get(r.id);
  if(prior){if(prior.book!==b.id)throw new ReviewError('Non puoi spostare recensioni fra libri.');const stored=prior.review;
   if(stored.authorId!==actor.id){if(JSON.stringify(r)!==JSON.stringify(stored))throw new ReviewError('Puoi modificare solo le tue recensioni.');return stored;}
   if(r.authorId!==stored.authorId||r.author!==stored.author||r.createdAt!==stored.createdAt)throw new ReviewError('Autore e data di creazione della recensione non possono essere cambiati.');
   return {...stored,text:r.text.trim(),updatedAt:r.text.trim()!==stored.text?now:stored.updatedAt};
  }
  if(r.authorId!==actor.id||r.author!==actor.displayName)throw new ReviewError('Le nuove recensioni devono appartenere all’utente autenticato.');
  return {...r,authorId:actor.id,author:actor.displayName,text:r.text.trim(),createdAt:now,updatedAt:now};
 });const {notes,status,...fields}=b;return {...fields,reviews};});
 for(const [id,{review:r}] of oldReviews)if(!newReviews.has(id)&&r.authorId!==actor.id)throw new ReviewError('Non puoi eliminare recensioni di altri utenti, anche eliminando un libro o importando un backup.');
 return {...next,books};
}
