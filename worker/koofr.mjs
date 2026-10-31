// Fixed Koofr destination: no caller-controlled host, credentials or arbitrary DAV paths.
const ROOT='https://app.koofr.net/dav/Koofr/.booflix';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COVER=/^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const LIMIT=16*1024*1024;
class DavError extends Error {constructor(message,status=502){super(message);this.status=status;}}
async function bytes(response,limit){
 if(Number(response.headers.get('Content-Length'))>limit)throw new DavError('File troppo grande.',413);
 const reader=response.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new DavError('File troppo grande.',413);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
function catalog(data){
 if(data?.format!=='bookflix-cloud'||data.version!==1||!Array.isArray(data.books)||data.books.length>20000)throw new DavError('Catalogo cloud non valido.',400);
 const ids=new Set(),isbns=new Set();
 for(const b of data.books){
  if(!UUID.test(b?.id)||typeof b.title!=='string'||!b.title.trim()||ids.has(b.id)||b.isbn&&isbns.has(b.isbn)||b.coverPath&&(!COVER.test(b.coverPath)||!UUID.test(b.coverPath.split('.')[0])))throw new DavError('Libri o copertine del catalogo non validi.',400);
  ids.add(b.id);if(b.isbn)isbns.add(b.isbn);
 }
 return data;
}
export async function koofr(request,env,headers){
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 try{
  const id=env.KOOFR_COLLECTION_ID;
  if(!UUID.test(id||'')||!env.KOOFR_USERNAME||!env.KOOFR_PASSWORD)return json({error:'Koofr non è ancora configurato sul servizio. Segui la guida Koofr del progetto.'},503);
  const base=ROOT+'/'+id;
  const dav=async(path,method='GET',options={})=>{
   const auth=btoa(unescape(encodeURIComponent(env.KOOFR_USERNAME+':'+env.KOOFR_PASSWORD)));
   return fetch(path,{...options,method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Basic '+auth,...options.headers}});
  };
  const check=async(r)=>{if(!r.ok){await r.body?.cancel();if([401,403].includes(r.status))throw new DavError('Accesso Koofr rifiutato. Controlla email e password WebDAV nei secret del servizio.',502);if(r.status===429)throw new DavError('Koofr limita le richieste. Attendi un minuto e riprova.',429);if(r.status===507)throw new DavError('Lo spazio su Koofr è esaurito.',507);throw new DavError('Koofr non disponibile. Riprova tra poco.');}return r;};
  async function folders(){for(const path of [ROOT,base,base+'/covers']){const r=await dav(path,'MKCOL');if(!r.ok&&r.status!==405)await check(r);else await r.body?.cancel();}
   const r=await dav(base+'/collection.json','PUT',{headers:{'Content-Type':'application/json','If-None-Match':'*'},body:JSON.stringify({format:'bookflix-collection',version:1,id,name:'La mia libreria'})});if(r.status!==412)await check(r);await r.body?.cancel();
  }
  const url=new URL(request.url),path=url.pathname;
  if(path==='/library/info'&&request.method==='GET')return json({id,name:'La mia libreria'});
  if(path==='/library'&&request.method==='GET'){
   const r=await dav(base+'/books.json');if(r.status===404){await r.body?.cancel();return json({id,revision:null,catalog:{format:'bookflix-cloud',version:1,books:[]}});}
   await check(r);const revision=r.headers.get('ETag');if(!revision||revision.startsWith('W/'))throw new DavError('Koofr non restituisce una versione affidabile del catalogo: scrittura disabilitata.');
   const data=catalog(JSON.parse(new TextDecoder().decode(await bytes(r,LIMIT))));return json({id,revision,catalog:data});
  }
  if(path==='/library'&&request.method==='PUT'){
   const revision=request.headers.get('If-Match'),create=request.headers.get('If-None-Match')==='*';
   if(!create&&(!revision||!/^"[^"\r\n]{1,200}"$/.test(revision)))return json({error:'Manca la versione del catalogo. Aggiorna la raccolta prima di salvare.'},428);
   const data=catalog(JSON.parse(new TextDecoder().decode(await bytes(request,LIMIT))));const body=JSON.stringify(data);await folders();
   const r=await dav(base+'/books.json','PUT',{headers:{'Content-Type':'application/json',...(create?{'If-None-Match':'*'}:{'If-Match':revision})},body});
   if(r.status===412){await r.body?.cancel();return json({error:'La raccolta è cambiata su un altro dispositivo. Aggiornala prima di riprovare; le modifiche nel modulo sono conservate.'},409);}
   await check(r);let next=r.headers.get('ETag');await r.body?.cancel();
   if(!next||next.startsWith('W/')){const saved=await check(await dav(base+'/books.json'));next=saved.headers.get('ETag');const actual=new TextDecoder().decode(await bytes(saved,LIMIT));if(actual!==body||!next||next.startsWith('W/'))return json({error:'Salvataggio inviato, ma la raccolta è cambiata o non è verificabile. Aggiornala prima di continuare.'},409);}
   return json({revision:next});
  }
  const file=path.match(/^\/library\/covers\/([^/]+)$/)?.[1];
  if(file&&COVER.test(file)&&UUID.test(file.split('.')[0])){
   if(request.method==='GET'){const r=await dav(base+'/covers/'+file);if(r.status===404)return json({error:'Copertina non trovata su Koofr.'},404);await check(r);const type={'jpg':'image/jpeg','png':'image/png','webp':'image/webp'}[file.split('.')[1]];return new Response(await bytes(r,10*1024*1024),{headers:{...headers,'Content-Type':type}});}
   if(request.method==='PUT'){const type={'jpg':'image/jpeg','png':'image/png','webp':'image/webp'}[file.split('.')[1]];if(request.headers.get('Content-Type')!==type)return json({error:'Formato copertina non valido.'},400);const body=await bytes(request,10*1024*1024);await folders();const r=await dav(base+'/covers/'+file,'PUT',{headers:{'Content-Type':type,'If-None-Match':'*'},body});if(r.status===412){await r.body?.cancel();return json({error:'Identificativo copertina già presente. Riprova.'},409);}await check(r);await r.body?.cancel();return json({ok:true});}
  }
  return json({error:'Percorso o metodo della raccolta non consentito.'},404);
 }catch(e){return json({error:e instanceof DavError?e.message:e instanceof SyntaxError?'Catalogo JSON non valido.':'Connessione a Koofr non riuscita. Riprova; le modifiche nel modulo restano disponibili.'},e instanceof DavError?e.status:502);}
}
