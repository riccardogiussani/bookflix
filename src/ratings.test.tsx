import {it,expect} from 'vitest';
import {renderToString} from 'react-dom/server';
import {blankBook,validate} from './data';
import {changeRating,ratingSummary} from './ratings';
import {BookRatings,RatingAverage} from './BookRatings';
const riccardo={id:'riccardo-id',name:'Riccardo'},sara={id:'sara-id',name:'Sara'};
const initial=()=>({...blankBook(),title:'Libro'});
it('calcola la media dei soli voti personali, un voto per utente anche dopo modifica e rimozione',()=>{
 expect(ratingSummary(initial())).toEqual({average:null,count:0});const a=changeRating(initial(),riccardo,5),b=changeRating(a,sara,2);expect(ratingSummary(b)).toEqual({average:3.5,count:2});const edited=changeRating(b,riccardo,4);expect(edited.ratings).toHaveLength(2);expect(edited.ratings.find(r=>r.userId===sara.id)?.value).toBe(2);expect(ratingSummary(edited)).toEqual({average:3,count:2});expect(ratingSummary(changeRating(edited,sara,null))).toEqual({average:4,count:1});expect(a.ratings[0].author).toBe('Riccardo');
});
it('rifiuta voti fuori scala e duplicati per lo stesso utente',()=>{for(const value of [0,6,1.5,NaN])expect(()=>changeRating(initial(),riccardo,value)).toThrow('1 a 5');const b=changeRating(initial(),riccardo,4);expect(()=>validate({...b,ratings:[...b.ratings,...b.ratings]})).toThrow('Valutazione');});
it('scarta i vecchi voti senza assegnarli e conserva i nuovi voti personali',()=>{const b=validate({...changeRating(initial(),riccardo,3),rating:5,legacyRating:4} as ReturnType<typeof initial>);expect(b).not.toHaveProperty('rating');expect(b).not.toHaveProperty('legacyRating');expect(ratingSummary(b)).toEqual({average:3,count:1});});
it('mostra media con numero di voti e seleziona solo il voto dell’utente corrente',()=>{const b=changeRating(changeRating(initial(),riccardo,5),sara,2);const average=renderToString(<RatingAverage book={b}/>);expect(average).toContain('3,5');expect(average).toContain('2');expect(average).toContain('valutazioni');const own=renderToString(<BookRatings book={b} userId={sara.id} username="Sara" disabled={false} onChange={async()=>{}}/>);expect(own).toContain('value="2" selected');expect(own).not.toContain('value="5" selected');expect(renderToString(<RatingAverage book={initial()}/>)).toContain('Nessuna valutazione');});
