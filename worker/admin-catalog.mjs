import taxonomy from '../shared/genre-taxonomy.json' with {type:'json'};
import {META,UUID,cover,isBookKey,metadata,same} from './catalog-model.mjs';
import {downloadCover,uploadCover} from './central-covers.mjs';
import {firestore,StoreError} from './firestore.mjs';
import {createAdminSession,requireAdminSession} from './admin-session.mjs';

const defaults={title:'Titolo',subtitle:'',authors:[],publisher:'',year:'',pages:null,language:'',genres:[],description:'',isbn:'',physicalFormat:''};
const structured={primaryGenre:'genres',secondary1:'genres',secondary2:'genres',workForm:'workForms',audience:'audiences'};
const genreKeys=['primaryGenre','secondary1','secondary2'];
const summaryFields=['title','authors','publisher','isbn','genres'];
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const now=()=>new Date().toISOString();
const fail=(message,status=400)=>{throw new StoreError(message,status);};
const idOf=doc=>doc.path.split('/').pop();
const present=doc=>({id:idOf(doc),revision:doc.version,metadata:doc.data.metadata||{},classification:doc.data.classification??null,cover:doc.data.cover??null});

function changes(body,creating=false){
 const raw=body.metadata??{};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!META.includes(key)))fail('Metadati non validi.');
 const normalized=metadata({...defaults,...(creating?{title:''}:{}),...raw});
 if(normalized.year&&!/^\d{4}$/.test(normalized.year))fail('L’anno deve avere quattro cifre.');
 if(normalized.pages!==null&&normalized.pages>100000)fail('Numero di pagine non valido.');
 const patch=creating?normalized:Object.fromEntries(Object.keys(raw).map(key=>[key,normalized[key]]));
 const classification=body.classification??{};
 if(!classification||typeof classification!=='object'||Array.isArray(classification)||Object.entries(classification).some(([key,value])=>
  !Object.hasOwn(structured,key)||value!==null&&!taxonomy[structured[key]].some(item=>item.id===value)))fail('Classificazione non valida.');
 if(!creating&&Object.hasOwn(patch,'genres')&&genreKeys.some(key=>Object.hasOwn(classification,key)))fail('Applica i generi liberi o quelli strutturati in un solo passaggio.');
 return {patch,classification,...(Object.hasOwn(body,'cover')?{cover:cover(body.cover)}:{})};
}

function editionChanges(old,requested){
 const previous=old.metadata||{};
 const changed=Object.fromEntries(Object.entries(requested.patch).filter(([key,value])=>!same(previous[key]??(key==='title'?'':defaults[key]),value)));
 const data={...old,metadata:{...previous,...changed}};
 const coverChanged=Object.hasOwn(requested,'cover')&&!same(old.cover??null,requested.cover);
 if(coverChanged)data.cover=requested.cover;
 const selected=requested.classification,prior=old.classification||{};
 if(Object.keys(selected).length||(Object.hasOwn(changed,'genres')&&old.classification)){
  const primary=Object.hasOwn(selected,'primaryGenre')?selected.primaryGenre:prior.primaryGenre??null;
  const secondary=['secondary1','secondary2'].map((key,index)=>Object.hasOwn(selected,key)?selected[key]:prior.secondaryGenres?.[index]).filter(Boolean);
  const clearing=(Object.hasOwn(changed,'genres')&&!genreKeys.some(key=>Object.hasOwn(selected,key)))||(Object.hasOwn(selected,'primaryGenre')&&primary===null);
  if(clearing&&['secondary1','secondary2'].some(key=>selected[key]))fail('Scegli il genere primario prima dei secondari.');
  const genres=clearing?[]:secondary;
  const genre=clearing?null:primary;
  if((!genre&&genres.length)||new Set(genres).size!==genres.length||genres.includes(genre))fail('Scegli secondari distinti e diversi dal genere primario.');
  const values={primaryGenre:genre,secondaryGenres:genres,
   workForm:Object.hasOwn(selected,'workForm')?selected.workForm:prior.workForm??null,
   audience:Object.hasOwn(selected,'audience')?selected.audience:prior.audience??null};
  const before={primaryGenre:prior.primaryGenre??null,secondaryGenres:prior.secondaryGenres??[],workForm:prior.workForm??null,audience:prior.audience??null};
  if(!same(values,before)){
   data.classification={...values,genreVersion:taxonomy.version,genreStatus:genre?'classified':'needs_review',source:'manual',updatedAt:now()};
   if(genre&&genreKeys.some(key=>Object.hasOwn(selected,key))){
    const labels=[genre,...genres].map(id=>taxonomy.genres.find(row=>row.id===id)?.label).filter(Boolean);
    if(!same(labels,previous.genres||[]))data.metadata.genres=changed.genres=labels;
   }
  }
 }
 if(Object.hasOwn(changed,'authors'))data.authorNormalization={authorsVersion:'1.0',source:'manual',authors:changed.authors,updatedAt:now()};
 return {data,changedFields:Object.keys(changed),coverChanged};
}

const catalogVersion=()=>({path:'system/catalogState',data:{adminRevision:crypto.randomUUID()},mask:['adminRevision']});
function auditWrite(data){
 if(bytes(data)>750000)fail('Registro troppo grande. Seleziona meno libri o aggiorna meno dati.',413);
 return {path:'catalogAdminAudit/'+crypto.randomUUID(),data,create:true};
}

export function adminCatalog(store,actor){
 async function page(token){
  if(token.length>8192)fail('Pagina non valida.');
  const result=await store.page('catalog',{token,limit:250,mask:summaryFields.map(field=>'metadata.'+field)});
  return {books:result.documents.map(doc=>({id:idOf(doc),revision:doc.version,metadata:doc.data.metadata||{}})),nextPageToken:result.nextPageToken};
 }
 async function read(id){
  if(!isBookKey(id))fail('Edizione non valida.');
  const doc=await store.get('catalog/'+id);
  if(!doc)fail('Edizione non trovata.',404);
  return present(doc);
 }
 async function readMany(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>!isBookKey(id))||new Set(ids).size!==ids.length)fail('Seleziona da 1 a 200 libri validi.');
  const docs=await store.batchGet(ids.map(id=>'catalog/'+id));
  if(docs.length!==ids.length)fail('Uno dei libri non è più nel catalogo. Aggiorna la lista.',409);
  return {books:docs.map(present)};
 }
 async function create(body){
  if(typeof body.draftId!=='string'||!UUID.test(body.draftId))fail('Bozza non valida.');
  const request=changes(body,true);
  const id=request.patch.isbn?'isbn_'+request.patch.isbn:'manual_'+body.draftId;
  const edit=editionChanges({},request);
  const data={...edit.data,metadata:{...request.patch,...edit.data.metadata},cover:edit.data.cover??null,createdAt:now()};
  const audit={editionId:id,targetId:id,changedFields:edit.changedFields,coverChanged:edit.coverChanged,before:null,after:data,
   references:0,libraryChanges:[],createdAt:now(),actor};
  try{await store.commit([{path:'catalog/'+id,data,create:true},catalogVersion(),auditWrite(audit)]);}
  catch(error){if(error.status===409)fail(request.patch.isbn?'ISBN già presente nel catalogo.':'Questa bozza risulta già salvata.',409);throw error;}
  return {id,books:1,references:0};
 }
 async function edit(body){
  if(!Array.isArray(body.editions)||!body.editions.length||body.editions.length>200)fail('Seleziona da 1 a 200 libri.');
  const editions=new Map();
  for(const row of body.editions){
   if(!row||!isBookKey(row.id)||editions.has(row.id)||typeof row.revision!=='string'||!row.revision)fail('Selezione non valida.');
   editions.set(row.id,row.revision);
  }
  const request=changes(body);
  if(editions.size>1&&Object.hasOwn(request.patch,'isbn'))fail('Modifica l’ISBN dalla scheda singola.');
  return store.transaction(async tx=>{
   const current=await tx.batchGet([...editions.keys()].map(id=>'catalog/'+id));
   if(current.length!==editions.size||current.some(doc=>editions.get(idOf(doc))!==doc.version))fail('Uno dei libri è cambiato. Riapri la scheda e riprova.',409);
   const plans=new Map();
   for(const doc of current){
    const result=editionChanges(doc.data,request),id=idOf(doc);
    if(!result.changedFields.length&&!result.coverChanged&&same(result.data.classification,doc.data.classification))continue;
    const isbn=result.data.metadata.isbn;
    const target=result.changedFields.includes('isbn')?(isbn?'isbn_'+isbn:id.startsWith('manual_')?id:'manual_'+crypto.randomUUID()):id;
    plans.set(id,{...result,target,doc,links:[]});
   }
   if(!plans.size)return {books:0,references:0};
   const ids=[...plans.keys()],writes=[catalogVersion()];
   let references=0;
   const libraries=await tx.query('libraries');
   if(libraries.length+plans.size*2>=450)fail('Troppe librerie o libri per un salvataggio atomico.',413);
   for(const library of libraries){
    writes.push({verify:library.path,version:library.version});
    for(let index=0;index<ids.length;index+=30){
     const group=ids.slice(index,index+30);
     const refs=await tx.query(library.path+'/items','catalogId',group.length===1?'EQUAL':'IN',group.length===1?group[0]:group);
     for(const ref of refs){
      const old=ref.data,plan=plans.get(old.catalogId),overrides={...old.overrides};
      const data={...old,overrides,catalogId:plan.target,updatedAt:now()};
      for(const field of plan.changedFields)delete overrides[field];
      if(plan.coverChanged)delete data.coverOverride;
      plan.links.push({path:ref.path,overrides:old.overrides||{},catalogId:old.catalogId,hadCoverOverride:Object.hasOwn(old,'coverOverride'),coverOverride:old.coverOverride??null});
      writes.push({path:ref.path,data,version:ref.version});references++;
      if(writes.length>450)fail('Troppe copie collegate. Seleziona meno libri e riprova.',413);
     }
    }
   }
   for(const [id,plan] of plans){
    if(id===plan.target)writes.push({path:plan.doc.path,data:plan.data,version:plan.doc.version});
    else writes.push({path:'catalog/'+plan.target,data:plan.data,create:true},{delete:plan.doc.path,version:plan.doc.version});
    writes.push(auditWrite({editionId:id,targetId:plan.target,changedFields:plan.changedFields,coverChanged:plan.coverChanged,
     before:plan.doc.data,after:plan.data,references:plan.links.length,libraryChanges:plan.links,createdAt:now(),actor}));
   }
   if(writes.length>450||bytes(writes)>5000000)fail('Aggiornamento troppo grande. Seleziona meno libri e riprova.',413);
   await tx.commit(writes);
   return {books:plans.size,references};
  });
 }
 return {page,read,readMany,create,edit};
}

export async function handleAdmin(request,env,headers,identity,parts,url,readBody){
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 const actor=identity.user.id,method=request.method;
 if(parts.length===3&&parts[2]==='session'&&method==='POST'){
  return json(await createAdminSession(env,actor,(await readBody(request)).token));
 }
 await requireAdminSession(env,actor,request.headers.get('X-Bookflix-Admin'));
 const admin=adminCatalog(firestore(env),actor);
 if(parts[2]==='covers'&&parts.length===4&&method==='PUT')return json(await uploadCover(env,parts[3],request));
 if(parts[2]!=='catalog')fail('Percorso non trovato.',404);
 if(parts.length===3&&method==='GET')return json(await admin.page(url.searchParams.get('pageToken')||''));
 if(parts.length===3&&method==='POST')return json(await admin.create(await readBody(request)),201);
 if(parts.length===4&&parts[3]==='read'&&method==='POST')return json(await admin.readMany((await readBody(request)).ids));
 if(parts.length===4&&parts[3]==='edit'&&method==='POST')return json(await admin.edit(await readBody(request)));
 if(parts.length===4&&method==='GET')return json(await admin.read(parts[3]));
 if(parts.length===5&&parts[4]==='cover'&&method==='GET'){
  const book=await admin.read(parts[3]);
  if(!book.cover)fail('Copertina non disponibile.',404);
  return downloadCover(env,book.cover.path,headers);
 }
 fail('Percorso non trovato.',404);
}
