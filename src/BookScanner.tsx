import {useEffect,useRef,useState} from 'react';
import {db,type Book} from './data';
import {startISBNScanner} from './camera';
import {lookupISBN,WORKER_URL,AccessDeniedError,type Lookup} from './isbn';
type Props={accessCode:string;onClose:()=>void;onManual:(isbn?:string)=>void;onResult:(isbn:string,result:Lookup)=>void;onDuplicate:(book:Book)=>void;onUnauthorized:()=>void};
export function BookScanner(props:Props){
 const handlers=useRef(props);handlers.current=props;
 const dialog=useRef<HTMLDialogElement>(null),video=useRef<HTMLVideoElement>(null),frame=useRef<HTMLDivElement>(null),stop=useRef<(()=>void)|null>(null),request=useRef<AbortController|null>(null);
 const [phase,setPhase]=useState<'starting'|'scanning'|'searching'|'error'>('starting'),[error,setError]=useState(''),[found,setFound]=useState(''),[attempt,setAttempt]=useState(0);
 function cancel(){stop.current?.();request.current?.abort();}
 async function detected(isbn:string){
  stop.current?.();request.current?.abort();setFound(isbn);setPhase('searching');setError('');const controller=new AbortController();request.current=controller;const timeout=setTimeout(()=>controller.abort(),50000);
  try{const existing=await db.books.where('isbnKey').equals(isbn).first();if(controller.signal.aborted)return;
   if(existing){handlers.current.onDuplicate(existing);return;}
   const result=await lookupISBN(isbn,controller.signal,WORKER_URL,'',handlers.current.accessCode);if(!controller.signal.aborted)handlers.current.onResult(isbn,result);
  }catch(e){if(request.current!==controller)return;if(e instanceof AccessDeniedError){handlers.current.onUnauthorized();return;}setPhase('error');setError(controller.signal.aborted?'La ricerca sta impiegando troppo tempo. Riprova oppure completa il libro manualmente.':e instanceof Error?e.message:'Ricerca non riuscita. Puoi continuare manualmente.');}
  finally{clearTimeout(timeout);if(request.current===controller)request.current=null;}
 }
 useEffect(()=>{const target=dialog.current;target?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{target?.close();document.body.style.overflow=overflow;};},[]);
 useEffect(()=>{
  setPhase('starting');setError('');setFound('');stop.current=startISBNScanner(video.current!,frame.current!,isbn=>void detected(isbn),()=>setPhase('scanning'),message=>{setError(message);setPhase('error');});
  return()=>{stop.current?.();request.current?.abort();request.current=null;};
 },[attempt]);
 const searching=phase==='searching';
 return <dialog className="fullscreen-scanner" ref={dialog} aria-labelledby="scanner-title" onCancel={event=>{event.preventDefault();cancel();handlers.current.onClose();}}>
  <video className="scanner-feed" ref={video} muted playsInline autoPlay aria-hidden="true"/>
  <div className="scanner-shade" aria-hidden="true"/>
  <button type="button" className="scanner-close" aria-label="Chiudi scanner" onClick={()=>{cancel();handlers.current.onClose();}}>×</button>
  <div className="scanner-heading"><p className="eyebrow">AGGIUNGI ALLA TUA LIBRERIA</p><h2 id="scanner-title">{searching?'Cerco il tuo libro…':'Inquadra il codice ISBN'}</h2><p>{searching?'Recupero i dati e la copertina dalle fonti disponibili.':'Posiziona il codice a barre sul retro del libro nel riquadro.'}</p></div>
  <div className="scanner-middle"><div ref={frame} className={`scan-frame ${searching?'scan-frame-loading':''}`} aria-hidden="true"><span className="scan-corner tl"/><span className="scan-corner tr"/><span className="scan-corner bl"/><span className="scan-corner br"/>{searching?<span className="scan-spinner"/>:phase==='starting'?<span className="scan-spinner small"/>:phase==='scanning'?<span className="scan-line"/>:<span className="scan-error-icon">!</span>}</div><div className="scanner-status" role="status" aria-live="polite">{searching?<><strong>ISBN {found}</strong><span>Ancora un momento, preparo l’anteprima.</span></>:phase==='starting'?<span>Avvio della fotocamera…</span>:error?<p role="alert">{error}</p>:<span>Tieni il libro fermo e assicurati che ci sia abbastanza luce.</span>}</div>{phase==='error'&&<button type="button" className="scanner-retry" onClick={()=>found?void detected(found):setAttempt(n=>n+1)}>{found?'Riprova ricerca':'Riprova fotocamera'}</button>}</div>
  <div className="scanner-bottom"><button type="button" className="manual-pill" onClick={()=>{cancel();handlers.current.onManual(found||undefined);}}>Inserimento manuale <span aria-hidden="true">↗</span></button><small>{searching?'Puoi continuare manualmente anche durante la ricerca.':'Oppure digita l’ISBN e aggiungi il libro a mano.'}</small></div>
 </dialog>;
}
