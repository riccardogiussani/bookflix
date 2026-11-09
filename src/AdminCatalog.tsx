import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {AdminEditor} from './AdminEditor';
import {adminClient,openAdminSession,type AdminClient,type AdminEdition,type AdminResult,type AdminSession} from './admin-api';
import {CloudError} from './central-api';
import {AccessDeniedError} from './isbn';
import {searchText} from './search';

export function AdminLogin({accessCode,onSession,onLogout,disabled}:{
  accessCode:string;onSession:(session:AdminSession)=>void;onLogout:()=>void;disabled:boolean;
}) {
  const [open,setOpen]=useState(false),[token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>{active.current?.abort();},[]);

  async function login(event:FormEvent){
    event.preventDefault();if(active.current||disabled)return;
    const controller=new AbortController();active.current=controller;setBusy(true);setError('');setToken('');
    try{
      const session=await openAdminSession(accessCode,token,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));
      if(!controller.signal.aborted)onSession(session);
    }catch(failure){
      if(controller.signal.aborted)return;
      if(failure instanceof AccessDeniedError){onLogout();return;}
      setError(failure instanceof CloudError&&failure.status===404?'L’area amministrativa richiede il Worker Bookflix aggiornato.'
        :failure instanceof Error?failure.message:'Accesso amministratore non riuscito.');
    }finally{if(!controller.signal.aborted){active.current=null;setBusy(false);}}
  }

  return <section className="wide admin-access"><h2>Amministrazione</h2>
    {!open?<button type="button" disabled={disabled} onClick={()=>setOpen(true)}>Accedi come amministratore</button>
    :<form onSubmit={event=>void login(event)}>
      <label>Token amministratore<input type="password" value={token} onChange={event=>setToken(event.target.value)} maxLength={1024} required autoComplete="off" disabled={disabled||busy}/></label>
      <button className="primary" disabled={disabled||busy}>{busy?'Verifica in corso…':'Accedi'}</button>
      <button type="button" disabled={busy} onClick={()=>{setOpen(false);setToken('');setError('');}}>Annulla</button>
    </form>}
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}

const sections=[['catalog','Catalogo generale','▤'],['genres','Generi','▦'],['authors','Autori','♙'],['titles','Titoli','Aa'],['covers','Copertina','▧']] as const;
type Section=typeof sections[number][0];

function CatalogueCover({api,id,revision,title}:{api:AdminClient;id:string;revision:string;title:string}) {
  const frame=useRef<HTMLSpanElement>(null);
  const [image,setImage]=useState<{revision:string;url:string}|null>(null);

  useEffect(()=>{
    const controller=new AbortController();
    let url='';
    let observer:IntersectionObserver|undefined;
    let started=false;
    async function load(){
      if(started||controller.signal.aborted)return;
      started=true;
      try{
        const blob=await api.cover(id,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));
        if(controller.signal.aborted)return;
        url=URL.createObjectURL(blob);
        setImage({revision,url});
      }catch{/* The book stays usable when its cover is unavailable. */}
    }
    if(frame.current&&typeof IntersectionObserver!=='undefined'){
      observer=new IntersectionObserver(entries=>{
        if(!entries.some(entry=>entry.isIntersecting)||controller.signal.aborted)return;
        observer?.disconnect();
        void load();
      },{rootMargin:'120px'});
      observer.observe(frame.current);
    }else void load();
    return ()=>{observer?.disconnect();controller.abort();if(url)URL.revokeObjectURL(url);};
  },[api,id,revision]);

  return <span className="admin-catalog-cover" ref={frame} aria-hidden="true">
    {image?.revision===revision?<img src={image.url} alt="" decoding="async" onError={()=>setImage(null)}/>:<span>{title}</span>}
  </span>;
}

export function AdminCatalog({accessCode,session,onExit,onLogout}:{
  accessCode:string;session:AdminSession;onExit:(message?:string)=>void;onLogout:()=>void;
}) {
  const api=useMemo(()=>adminClient(accessCode,session.session),[accessCode,session.session]);
  const [section,setSection]=useState<Section>('catalog');
  const [books,setBooks]=useState<AdminEdition[]>([]),[selected,setSelected]=useState(new Set<string>());
  const [selecting,setSelecting]=useState(false),[editor,setEditor]=useState<AdminEdition[]|null>(null);
  const [query,setQuery]=useState(''),[genre,setGenre]=useState(''),[shown,setShown]=useState(60);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const loading=useRef<AbortController|null>(null);

  function onAccessError(failure:unknown){
    if(failure instanceof AccessDeniedError){onLogout();return true;}
    if(failure instanceof CloudError&&failure.status===403){onExit('Sessione amministratore scaduta o non valida. Accedi di nuovo.');return true;}
    return false;
  }

  async function load(){
    loading.current?.abort();
    const controller=new AbortController();loading.current=controller;setBusy(true);setError('');
    try{
      let token='';const result:AdminEdition[]=[];
      do{
        const page=await api.page(token,AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]));
        result.push(...page.books);token=page.nextPageToken;
      }while(token);
      if(controller.signal.aborted)return;
      setBooks(result);setSelected(previous=>{const ids=new Set(result.map(book=>book.id));return new Set([...previous].filter(id=>ids.has(id)));});
    }catch(failure){
      if(!controller.signal.aborted&&!onAccessError(failure))setError(failure instanceof Error?failure.message:'Catalogo non disponibile.');
    }finally{if(loading.current===controller&&!controller.signal.aborted){loading.current=null;setBusy(false);}}
  }

  useEffect(()=>{void load();return()=>{loading.current?.abort();};},[api]);
  useEffect(()=>{
    const timer=setTimeout(()=>onExit('Sessione amministratore scaduta. Accedi di nuovo.'),Math.max(0,Date.parse(session.expiresAt)-Date.now()));
    return()=>clearTimeout(timer);
  },[session.expiresAt,onExit]);

  const genres=useMemo(()=>[...new Set(books.flatMap(book=>book.metadata.genres??[]))].sort((a,b)=>a.localeCompare(b,'it')),[books]);
  const matches=useMemo(()=>{
    const terms=searchText(query).split(' ').filter(Boolean);
    return books.filter(({metadata})=>{
      if(genre&&!metadata.genres?.includes(genre))return false;
      const search=searchText([metadata.title,...(metadata.authors??[]),metadata.publisher,metadata.isbn,...(metadata.genres??[])].join(' '));
      return terms.every(term=>search.includes(term));
    });
  },[books,query,genre]);

  async function openBooks(ids:string[]){
    if(busy||!ids.length)return;
    if(ids.length>200){setError('Seleziona al massimo 200 libri per modifica.');return;}
    setBusy(true);setError('');
    try{setEditor((await api.editions(ids)).books);}
    catch(failure){if(!onAccessError(failure))setError(failure instanceof Error?failure.message:'Impossibile aprire i libri.');}
    finally{setBusy(false);}
  }

  function saved(result:AdminResult){
    setEditor(null);setSelected(new Set());setSelecting(false);
    setNotice(result.id?'Libro aggiunto al catalogo centrale.':result.books?`Libri aggiornati ${result.books} · copie collegate ${result.references}`:'I libri hanno già i valori richiesti.');
    void load();
  }

  function toggle(id:string){setSelected(previous=>{const next=new Set(previous);if(!next.delete(id))next.add(id);return next;});}
  const title=sections.find(([key])=>key===section)?.[1];

  return <div className="app-shell admin-catalog-shell">
    <header><span className="brand">Bookflix<span>●</span></span><span className="nav-label">AMMINISTRAZIONE</span>
      <button type="button" disabled={editor!==null} onClick={()=>onExit()}>Esci da amministratore</button>
    </header>
    <main className="library-management">
      <div className="management-heading"><div><p className="eyebrow">CATALOGO CENTRALE</p><h1>{title}</h1></div></div>
      {section!=='catalog'?<section className="empty"><h2>In arrivo…</h2></section>
      :editor!==null?<AdminEditor api={api} editions={editor} onCancel={()=>setEditor(null)} onSaved={saved} onAccessError={onAccessError}/>
      :<><div className="admin-catalog-controls">
        <input type="search" value={query} onChange={event=>{setQuery(event.target.value);setShown(60);}} placeholder="Cerca titolo, autore, editore, ISBN…" aria-label="Cerca nel catalogo centrale"/>
        <select value={genre} onChange={event=>{setGenre(event.target.value);setShown(60);}} aria-label="Filtra per genere"><option value="">Tutti i generi</option>{genres.map(value=><option key={value}>{value}</option>)}</select>
        <button type="button" disabled={busy} onClick={()=>void load()}>Aggiorna</button>
        <button type="button" disabled={busy||!books.length} aria-pressed={selecting} onClick={()=>{setSelecting(!selecting);setSelected(new Set());}}>{selecting?'Fine selezione':'Seleziona'}</button>
        <button type="button" disabled={busy||!matches.length} onClick={()=>{setSelecting(true);setSelected(new Set(matches.map(book=>book.id)));}}>Seleziona tutti</button>
        <button type="button" className="primary" disabled={busy} onClick={()=>{if(selected.size)void openBooks([...selected]);else{setError('');setEditor([]);}}}>{selected.size?`Modifica (${selected.size})`:'Aggiungi libro'}</button>
      </div>
      <p role="status">{busy?'Caricamento… ':''}{matches.length} di {books.length} libri{selecting?` · ${selected.size} selezionati`:''}</p>
      {error&&<p role="alert" className="error">{error}</p>}
      {notice&&<p className="notice" role="status">{notice}<button type="button" aria-label="Chiudi messaggio" onClick={()=>setNotice('')}>×</button></p>}
      <ul className="admin-catalog-grid">{matches.slice(0,shown).map(book=>{
        const bookTitle=book.metadata.title||'Senza titolo';
        const isSelected=selected.has(book.id);
        return <li key={book.id}>
          <button className="admin-catalog-book" type="button" disabled={busy} aria-pressed={selecting?isSelected:undefined} onClick={()=>selecting?toggle(book.id):void openBooks([book.id])}>
            <CatalogueCover api={api} id={book.id} revision={book.revision} title={bookTitle}/>
            {selecting&&<span className="admin-catalog-pick" aria-hidden="true">{isSelected?'✓':''}</span>}
            <strong>{bookTitle}</strong>
            <small>{[...(book.metadata.authors??[]),book.metadata.publisher,book.metadata.isbn].filter(Boolean).join(' · ')}</small>
          </button>
        </li>;
      })}</ul>
      {matches.length>shown&&<button type="button" onClick={()=>setShown(shown+60)}>Mostra altri libri</button>}
      </>}
    </main>
    <nav className="app-bottom-nav admin-bottom-nav" aria-label="Sezioni amministratore"><div>{sections.map(([key,label,icon])=>
      <button type="button" key={key} disabled={editor!==null} aria-current={section===key?'page':undefined} onClick={()=>setSection(key)}>
        <span className="admin-nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>
      </button>)}</div></nav>
  </div>;
}
