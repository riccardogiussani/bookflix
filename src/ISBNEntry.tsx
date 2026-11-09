import {useEffect,useRef,useState} from 'react';
import {LookupButton} from './LookupButton';
import {db,normalizeISBN,type Book} from './data';
import {lookupISBN,WORKER_URL,AccessDeniedError,type Lookup} from './isbn';
type Props={searchDisabled?:boolean;value:string;onChange:(isbn:string)=>void;accessCode:string;onUnauthorized:()=>void;onResult:(isbn:string,result:Lookup)=>void;onDuplicate:(book:Book)=>void;onBusyChange:(busy:boolean)=>void};
export function ISBNEntry({searchDisabled,value,onChange,onResult,onDuplicate,accessCode,onUnauthorized,onBusyChange}:Props){
 const [sourceURL,setSourceURL]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>{abort.current?.abort();abort.current=null;onBusyChange(false);},[onBusyChange]);
 async function search(){if(searchDisabled||abort.current)return;setBusy(true);onBusyChange(true);setNotice('');const controller=new AbortController();abort.current=controller;const timer=setTimeout(()=>controller.abort(),50000);
 try{const canonical=normalizeISBN(value);if(!canonical)throw Error('Inserisci un ISBN.');onChange(canonical);const existing=await db.books.where('isbnKey').equals(canonical).first();if(controller.signal.aborted)return;
  if(existing){onDuplicate(existing);return;}const result=await lookupISBN(canonical,controller.signal,WORKER_URL,sourceURL,accessCode);if(controller.signal.aborted||abort.current!==controller)return;
  onResult(canonical,result);setNotice(result.candidates.length?'Dati aggiornati. Controllali prima di salvare.':'ISBN non trovato. Puoi compilare i dati manualmente.');
 }catch(e){if(abort.current!==controller)return;if(e instanceof AccessDeniedError){onUnauthorized();return;}setNotice(controller.signal.aborted?'Ricerca interrotta. Puoi riprovare o continuare manualmente.':e instanceof Error?e.message:'Ricerca non riuscita. Puoi continuare manualmente.');}
 finally{clearTimeout(timer);if(abort.current===controller){setBusy(false);onBusyChange(false);abort.current=null;}}}
 return <div className="wide isbn-field"><div className="isbn-field-heading"><label htmlFor="manual-isbn">ISBN</label><LookupButton busy={busy} disabled={!!searchDisabled||!value.trim()} onClick={()=>void search()} label="Recupera i dati del libro da ISBN" busyLabel="Ricerca dei dati del libro in corso"/></div><small id="manual-isbn-help">Facoltativo per i libri che non lo hanno. ↻ recupera i dati e aggiorna l’anteprima.</small><input id="manual-isbn" value={value} disabled={busy} onChange={e=>{onChange(e.target.value);setNotice('');}} placeholder="978…" inputMode="text" aria-describedby="manual-isbn-help" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!busy)void search();}}}/>{busy&&<div className="isbn-progress" role="status"><span>Ricerca dei dati in corso…</span><button type="button" onClick={()=>abort.current?.abort()}>Interrompi</button></div>}{notice&&<p role="status" className="lookup-notice">{notice}</p>}<details className="isbn-source"><summary>Specifica una scheda (facoltativo)</summary><label>Link della scheda<input type="url" value={sourceURL} onChange={e=>setSourceURL(e.target.value)} placeholder="https://www.ibs.it/…/e/978…" disabled={busy}/></label></details></div>;
}
