import {useEffect,useRef,useState} from 'react';
import {AccessDeniedError} from './isbn';
import {searchCatalogueTitle,selectCatalogueEdition,type CatalogueMatch,type CatalogueSelection} from './title-lookup';

type Props = {
  value:string; onChange:(title:string)=>void; libraryId:string; accessCode:string; searchDisabled:boolean;
  onUnauthorized:()=>void; onResult:(selection:CatalogueSelection)=>void; onBusyChange:(busy:boolean)=>void;
};

export function TitleEntry({value,onChange,libraryId,accessCode,searchDisabled,onUnauthorized,onResult,onBusyChange}:Props) {
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [matches,setMatches] = useState<CatalogueMatch[]>([]);
  const request = useRef<AbortController|null>(null);

  useEffect(() => () => {
    request.current?.abort(); request.current = null; onBusyChange(false);
  },[onBusyChange]);
  useEffect(() => { setMatches([]); },[value]);

  async function run(action:(signal:AbortSignal)=>Promise<void>) {
    if (request.current || searchDisabled) return;
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(50000);
    request.current = controller; setBusy(true); onBusyChange(true); setNotice('');
    try { await action(AbortSignal.any([controller.signal,timeout])); }
    catch (failure) {
      if (request.current !== controller) return;
      if (failure instanceof AccessDeniedError) { onUnauthorized(); return; }
      setNotice(controller.signal.aborted?'Ricerca interrotta.':timeout.aborted?'Tempo di attesa scaduto. Riprova.'
        :failure instanceof Error?failure.message:'Ricerca non riuscita.');
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); onBusyChange(false); }
    }
  }

  async function choose(match:CatalogueMatch,signal:AbortSignal) {
    const selection = await selectCatalogueEdition(libraryId,match.id,accessCode,signal);
    signal.throwIfAborted();
    onResult(selection);
    setMatches([]);
    setNotice(['Dati compilati dal catalogo Bookflix. Controllali prima di salvare.',selection.warning].filter(Boolean).join(' '));
  }

  function search() {
    if (!value.trim()) return;
    return run(async signal => {
      setMatches([]);
      const result = await searchCatalogueTitle(libraryId,value.trim(),accessCode,signal);
      signal.throwIfAborted();
      if (result.books.length === 1 && !result.hasMore) { await choose(result.books[0],signal); return; }
      setMatches(result.books);
      setNotice(!result.books.length?'Nessuna corrispondenza nel catalogo Bookflix. Puoi continuare manualmente.'
        :result.hasMore?'Scegli un’edizione tra i primi 20 risultati o cerca un titolo più preciso.':'Scegli l’edizione da usare.');
    });
  }

  return <div className="wide title-lookup">
    <div className="isbn-field-heading"><label htmlFor="manual-title">Titolo *</label>
      <button type="button" disabled={busy||searchDisabled||!value.trim()} onClick={()=>void search()}>Cerca in Bookflix</button>
    </div>
    <input id="manual-title" required maxLength={1000} value={value} disabled={busy} aria-describedby="manual-title-help"
      onChange={event=>{onChange(event.target.value);setMatches([]);setNotice('');}}
      onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void search();}}}/>
    <small id="manual-title-help">Cerca per titolo nel catalogo Bookflix per compilare la scheda.</small>
    {busy&&<div className="isbn-progress" role="status"><span>Consultazione del catalogo Bookflix…</span>
      <button type="button" onClick={()=>request.current?.abort()}>Interrompi</button></div>}
    {notice&&<p role="status" className="lookup-notice">{notice}</p>}
    {!!matches.length&&<ul className="title-matches" aria-label="Edizioni nel catalogo Bookflix">{matches.map(match=>{
      const details=[...(match.authors||[]),match.publisher,match.year,match.isbn?'ISBN '+match.isbn:'Senza ISBN'].filter(Boolean).join(' · ');
      return <li key={match.id}><button type="button" disabled={busy||searchDisabled} onClick={()=>void run(signal=>choose(match,signal))}>
        <strong>{match.title}</strong><small>{details}</small>
      </button></li>;
    })}</ul>}
  </div>;
}
