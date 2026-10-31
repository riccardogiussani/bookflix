import {newId,validate,type Book} from './data';
export type ReviewChange={type:'add';text:string}|{type:'edit';id:string;text:string}|{type:'delete';id:string};
export type ReviewIdentity={id:string;name:string};
export function changeReview(book:Book,user:ReviewIdentity,change:ReviewChange):Book{
 const author=user.name.trim();if(!user.id)throw Error('Accedi prima di recensire.');if(!author||author.length>80)throw Error('Accedi con un nome utente valido prima di recensire.');
 const reviews=[...(book.reviews||[])],now=new Date().toISOString();
 if(change.type==='add')reviews.push({id:newId(),author,authorId:user.id,text:change.text,createdAt:now,updatedAt:now});
 else{const index=reviews.findIndex(r=>r.id===change.id);if(index<0)throw Error('La recensione non è più presente. Aggiorna la raccolta.');if(reviews[index].authorId!==user.id)throw Error('Puoi modificare solo le recensioni scritte dal tuo utente.');if(change.type==='delete')reviews.splice(index,1);else reviews[index]={...reviews[index],text:change.text,updatedAt:now};}
 return validate({...book,reviews});
}
