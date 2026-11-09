import {useState,type ReactNode} from 'react';
import type {Book} from './data';
const PAGE_SIZE=60;
export function CatalogSearch({query,onChange,ready,browsing,onBrowse}:{query:string;onChange:(query:string)=>void;ready:boolean;browsing:boolean;onBrowse:()=>void}){
 return <section className="catalog-search" aria-label="Ricerca e consultazione della libreria">
  <div className="catalog-search-heading"><label htmlFor="catalog-query">Cerca nella tua libreria</label>
   <button type="button" disabled={!ready} onClick={onBrowse}>{browsing?'Torna alla libreria':'Sfoglia catalogo completo'}</button>
  </div>
  <div className="catalog-search-input"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="catalog-query" type="search" value={query} onChange={e=>onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();onChange('');}}} placeholder="Titolo, autore, genere, ISBN…" autoComplete="off" spellCheck={false} disabled={!ready} aria-describedby="catalog-search-help"/>{query&&<button type="button" aria-label="Cancella ricerca" onClick={()=>{onChange('');document.getElementById('catalog-query')?.focus();}}>×</button>}</div>
  <p id="catalog-search-help">Cerca anche per editore, anno, lingua, trama, posizione e recensioni. Puoi combinare più parole.</p>
 </section>;
}
export function CatalogResults({query,books,pending,onClear,renderBook}:{query?:string;books:Book[];pending:boolean;onClear:()=>void;renderBook:(book:Book)=>ReactNode}){
 const [page,setPage]=useState({query,limit:PAGE_SIZE});const limit=page.query===query?page.limit:PAGE_SIZE;const visible=books.slice(0,limit),remaining=books.length-visible.length;
 const searching=query!==undefined;
 const count=books.length===1?'libro':'libri';
 const more=Math.min(PAGE_SIZE,remaining);
 return <section className="catalog-results" aria-labelledby="catalog-results-title" aria-busy={pending}>
  <div className="shelf-title"><h2 id="catalog-results-title">{searching?'Risultati della ricerca':'Catalogo completo'}</h2>
   <span role="status" aria-live="polite" aria-atomic="true">{pending?'Ricerca…':`${books.length} ${count}${searching?(books.length===1?' trovato':' trovati'):''}`}</span>
  </div>
  {books.length?<><div className="catalog-grid">{visible.map(renderBook)}</div>
   {remaining>0&&<button type="button" className="search-more" onClick={()=>setPage({query,limit:limit+PAGE_SIZE})}>{more===1?'Mostra un altro libro':`Mostra altri ${more} libri`} <span>({remaining} rimanenti)</span></button>}
  </>:<div className="empty search-empty"><h3>{searching?'Nessun libro trovato.':'Questa libreria è ancora vuota.'}</h3>
   {searching&&<p>Prova con altre parole o con una parte del titolo o del nome dell’autore.</p>}
   <button type="button" onClick={onClear}>{searching?'Cancella ricerca':'Torna alla libreria'}</button>
  </div>}
 </section>;
}
