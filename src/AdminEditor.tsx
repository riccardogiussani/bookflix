import {useEffect,useState,type FormEvent} from 'react';
import {taxonomy} from './classification';
import {newId} from './data';
import type {AdminClassificationField,AdminClient,AdminEdition,AdminMetadata,AdminPatch,AdminResult} from './admin-api';
import type {CloudCover} from './central-api';

const fields = [
  ['title','Titolo'],['subtitle','Sottotitolo'],['authors','Autori'],['publisher','Editore'],['year','Anno'],
  ['pages','Pagine'],['language','Lingua'],['isbn','ISBN'],['physicalFormat','Formato fisico','physicalFormats'],
  ['primaryGenre','Genere primario','genres'],['secondary1','Genere secondario','genres'],['secondary2','Altro secondario','genres'],
  ['workForm','Forma dell’opera','workForms'],['audience','Pubblico','audiences'],['genres','Generi liberi'],['description','Trama'],
] as const;
type Field = typeof fields[number][0];
const structured = new Set<Field>(['primaryGenre','secondary1','secondary2','workForm','audience']);
const genreList = new Set<Field>(['authors','genres']);

function fieldValue(edition:AdminEdition,field:Field):string {
  if(field==='secondary1'||field==='secondary2')return edition.classification?.secondaryGenres?.[field==='secondary1'?0:1]??'';
  if(field==='primaryGenre'||field==='workForm'||field==='audience')return edition.classification?.[field]??'';
  const value=edition.metadata[field];
  return Array.isArray(value)?value.join('; '):String(value??'');
}

function fieldState(editions:AdminEdition[],field:Field) {
  const values=editions.map(edition=>fieldValue(edition,field));
  return {value:values[0]??'',mixed:values.some(value=>value!==values[0])};
}

type CoverChoice = {kind:'keep'|'remove'}|{kind:'replace';file:File;uploaded?:CloudCover};

export function AdminEditor({api,editions,onCancel,onSaved,onAccessError}:{
  api:AdminClient;editions:AdminEdition[];onCancel:()=>void;onSaved:(result:AdminResult)=>void;onAccessError:(error:unknown)=>boolean;
}) {
  const creating=editions.length===0,bulk=editions.length>1;
  const [draftId]=useState(newId);
  const [initial]=useState(()=>Object.fromEntries(fields.map(([field])=>[field,fieldState(editions,field)])) as Record<Field,{value:string;mixed:boolean}>);
  const [values,setValues]=useState(()=>Object.fromEntries(fields.map(([field,,group])=>[field,initial[field].mixed?(group?'__mixed__':''):initial[field].value])) as Record<Field,string>);
  const [selected,setSelected]=useState(new Set<Field>());
  const [choice,setChoice]=useState<CoverChoice>({kind:'keep'});
  const [preview,setPreview]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const commonCover=editions[0]?.cover?.path;
  const mixedCover=editions.some(edition=>edition.cover?.path!==commonCover);
  const coverEdition=commonCover&&!mixedCover?editions[0].id:undefined;
  const replacement=choice.kind==='replace'?choice.file:undefined;
  const keep=choice.kind==='keep';
  const dirty=selected.size>0||!keep;

  useEffect(()=>{
    const controller=new AbortController();
    let url='';
    setPreview('');
    const show=(blob:Blob)=>{if(!controller.signal.aborted){url=URL.createObjectURL(blob);setPreview(url);}};
    if(replacement)show(replacement);
    else if(keep&&coverEdition)void api.cover(coverEdition,controller.signal).then(show).catch(()=>{});
    return ()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
  },[api,coverEdition,keep,replacement]);

  useEffect(()=>{
    if(!dirty)return;
    const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',prevent);
    return ()=>window.removeEventListener('beforeunload',prevent);
  },[dirty]);

  function select(field:Field,enabled:boolean) {
    setSelected(previous=>{const next=new Set(previous);if(enabled)next.add(field);else next.delete(field);return next;});
  }

  function change(field:Field,value:string) {
    setValues(previous=>({...previous,[field]:value}));
    select(field,bulk||initial[field].value!==value);
  }

  async function save(event:FormEvent) {
    event.preventDefault();if(busy||(!creating&&!dirty))return;
    const patch:AdminPatch={metadata:{},classification:{}};
    const metadataEntries:[string,string|string[]|number|null][]=[];
    setError('');
    for(const field of selected){
      const value=values[field];
      if(value==='__mixed__'){setError('Scegli un valore per ogni campo che vuoi applicare.');return;}
      if(structured.has(field))patch.classification[field as AdminClassificationField]=value||null;
      else metadataEntries.push([field,genreList.has(field)?value.split(';').map(part=>part.trim()).filter(Boolean):field==='pages'?(value?Number(value):null):value]);
    }
    patch.metadata=Object.fromEntries(metadataEntries);
    setBusy(true);
    try{
      if(choice.kind==='remove')patch.cover=null;
      if(choice.kind==='replace'){
        patch.cover=choice.uploaded??await api.upload(choice.file);
        setChoice({...choice,uploaded:patch.cover});
      }
      const result=creating?await api.create(draftId,patch):await api.edit(editions.map(({id,revision})=>({id,revision})),patch);
      onSaved(result);
    }catch(failure){if(!onAccessError(failure))setError(failure instanceof Error?failure.message:'Salvataggio non riuscito.');}
    finally{setBusy(false);}
  }

  return <section className="admin-editor" aria-labelledby="admin-editor-title">
    <h2 id="admin-editor-title">{creating?'Aggiungi libro':bulk?`Modifica ${editions.length} libri`:'Modifica libro'}</h2>
    <p>{creating?'Il libro verrà aggiunto al catalogo centrale.':bulk?'Il trattino indica valori diversi. Applica solo i campi che vuoi aggiornare per tutti i libri.':'Le modifiche aggiornano i campi condivisi del libro e delle copie collegate.'}</p>
    <form onSubmit={event=>void save(event)}>
      <fieldset disabled={busy} className="admin-editor-fields">
        <div className="admin-cover-edit">
          {preview?<img className="admin-cover" src={preview} alt="Anteprima copertina"/>:<div className="admin-cover">{keep&&mixedCover?'— Copertine diverse':'Nessuna copertina'}</div>}
          <div><label>Copertina<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{
            const file=event.target.files?.[0];
            if(file)setChoice({kind:'replace',file});
            event.target.value='';
          }}/></label>
          <button type="button" onClick={()=>setChoice({kind:'remove'})}>Rimuovi copertina</button>{!keep&&<button type="button" onClick={()=>setChoice({kind:'keep'})}>Annulla cambio copertina</button>}</div>
        </div>
        <div className="fields">{fields.map(([field,label,group])=>{
          const id='admin-field-'+field,readOnly=bulk&&field==='isbn';
          const props={id,value:values[field],onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>change(field,event.target.value)};
          return <div key={field} className={field==='description'||genreList.has(field)?'wide':''}>
            <div className="admin-field-heading"><label htmlFor={id}>{label}</label>
              {bulk&&!readOnly&&<label className="admin-apply"><input type="checkbox" checked={selected.has(field)} aria-label={'Applica '+label} onChange={event=>select(field,event.target.checked)}/>Applica</label>}
            </div>
            {group?<select {...props}>{initial[field].mixed&&<option value="__mixed__" disabled>—</option>}<option value="">Non indicato</option>{taxonomy[group].map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>
            :field==='description'?<textarea {...props} rows={4} maxLength={50000} placeholder={initial[field].mixed?'—':undefined}/>
            :<input {...props} readOnly={readOnly} required={field==='title'&&(creating||!bulk||selected.has(field))}
              type={field==='pages'?'number':'text'} min={field==='pages'?1:undefined} maxLength={field==='isbn'?40:1000} placeholder={initial[field].mixed?'—':undefined}/>}
            {readOnly&&<small>L’ISBN si modifica dalla scheda singola.</small>}
            {field==='authors'&&<small>Separa i valori con punto e virgola.</small>}
            {field==='genres'&&<small>Separa i valori con punto e virgola. Puoi modificare i generi liberi o quelli strutturati in un passaggio.</small>}
          </div>;
        })}</div>
      </fieldset>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="form-actions"><button type="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Abbandonare le modifiche non salvate?'))onCancel();}}>Annulla</button>
        <button className="primary" disabled={busy||(!creating&&!dirty)}>{busy?'Salvataggio…':creating?'Aggiungi al catalogo':'Salva per tutti'}</button></div>
    </form>
  </section>;
}
