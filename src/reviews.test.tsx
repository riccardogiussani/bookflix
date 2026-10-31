import {expect,it} from 'vitest';
import {renderToString} from 'react-dom/server';
import {blankBook,validate} from './data';
import {changeReview} from './reviews';
import {BookReviews} from './BookReviews';
it('firma automaticamente la recensione e consente modifica ed eliminazione allo stesso username',()=>{
 const source={...blankBook(),title:'Libro'};const added=changeReview(source,{id:'riccardo-id',name:'Riccardo'},{type:'add',text:' Bello! '});expect(source.reviews).toEqual([]);expect(added.reviews[0]).toMatchObject({author:'Riccardo',text:'Bello!'});const review=added.reviews[0];const edited=changeReview(added,{id:'riccardo-id',name:'Riccardo'},{type:'edit',id:review.id,text:'Bellissimo'});expect(edited.reviews[0]).toMatchObject({id:review.id,author:review.author,createdAt:review.createdAt,text:'Bellissimo'});expect(changeReview(edited,{id:'riccardo-id',name:'Riccardo'},{type:'delete',id:review.id}).reviews).toEqual([]);
});
it('rifiuta commenti vuoti, recensioni troppo lunghe e interventi su autori diversi',()=>{
 const book=changeReview({...blankBook(),title:'Libro'},{id:'anna-id',name:'Anna'},{type:'add',text:'Una recensione'}),id=book.reviews[0].id;
 expect(()=>changeReview(book,{id:'riccardo-id',name:'Riccardo'},{type:'edit',id,text:'Altro'})).toThrow('tuo utente');expect(()=>changeReview(book,{id:'riccardo-id',name:'Riccardo'},{type:'delete',id})).toThrow('tuo utente');expect(()=>changeReview(book,{id:'riccardo-id',name:'Riccardo'},{type:'add',text:'  '})).toThrow('Recensione');expect(()=>changeReview(book,{id:'riccardo-id',name:'Riccardo'},{type:'add',text:'a'.repeat(10001)})).toThrow('Recensione');expect(()=>changeReview(book,{id:'-id',name:''},{type:'add',text:'Testo'})).toThrow('nome utente');expect(()=>changeReview(book,{id:'anna-id',name:'Anna'},{type:'delete',id:'missing'})).toThrow('non è più presente');
});
it('rifiuta ID recensione duplicati e date non valide nei backup',()=>{const book=changeReview({...blankBook(),title:'Libro'},{id:'anna-id',name:'Anna'},{type:'add',text:'Recensione'});expect(()=>validate({...book,reviews:[...book.reviews,...book.reviews]})).toThrow('Recensione');expect(()=>validate({...book,reviews:[{...book.reviews[0],createdAt:'invalid'}]})).toThrow('Recensione');});
it('mostra bubble, autore e data ed espone i comandi solo per lo username corrente',()=>{
 const book=changeReview({...blankBook(),title:'Libro'},{id:'anna-id',name:'Anna'},{type:'add',text:'<script>alert(1)</script>'});const own=renderToString(<BookReviews book={book} username="Anna" userId="anna-id" disabled={false} onChange={async()=>{}}/>);expect(own).toContain('review-bubble');expect(own).toContain('Anna');expect(own).toContain('<time');expect(own).toContain('Modifica');expect(own).toContain('Elimina');expect(own).not.toContain('<script>');const other=renderToString(<BookReviews book={book} username="Riccardo" userId="riccardo-id" disabled={false} onChange={async()=>{}}/>);expect(other).not.toContain('review-actions');expect(other).toContain('Pubblica recensione');
});
