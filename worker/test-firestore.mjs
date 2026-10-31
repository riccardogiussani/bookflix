import {fields,record,StoreError} from './firestore.mjs';
export class MemoryStore{
 constructor(){this.docs=new Map();this.sequence=0;this.beforeCommit=null;this.reads=0;}
 async get(path){this.reads++;return structuredClone(this.docs.get(path)||null);}
 async query(collection,field,op,value){return (await this.list(collection)).filter(d=>op==='ARRAY_CONTAINS'?d.data[field]?.includes(value):d.data[field]===value);}
 async list(collection){this.reads++;return [...this.docs.values()].filter(d=>d.path.slice(0,d.path.lastIndexOf('/'))===collection).map(d=>structuredClone(d));}
 async batchGet(paths){return (await Promise.all(paths.map(p=>this.get(p)))).filter(Boolean);}
 put(path,data){const version=new Date(Date.UTC(2026,0,1)+ ++this.sequence).toISOString();this.docs.set(path,{path,data:structuredClone(data),version});return this.docs.get(path);}
 async commit(writes){if(this.beforeCommit){const fn=this.beforeCommit;this.beforeCommit=null;await fn();}for(const w of writes){const d=this.docs.get(w.path||w.delete);if(w.version&&d?.version!==w.version||w.create&&d)throw new StoreError('Conflitto di test.',409);}for(const w of writes){if(w.delete)this.docs.delete(w.delete);else this.put(w.path,w.data);}return {writeResults:[]};}
 async rest(input,options={}){const url=new URL(typeof input==='string'?input:input.url),method=options.method||'GET',prefix=url.pathname.split('/documents')[0]+'/documents',name=prefix.slice(4)+'/',rawPath=decodeURIComponent(url.pathname.slice(prefix.length)),body=options.body?JSON.parse(options.body):{},json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}),document=d=>({name:name+d.path,fields:fields(d.data),updateTime:d.version});try{
 if(rawPath.endsWith(':runQuery')){const parent=rawPath.slice(1,-9),q=body.structuredQuery,f=q.where.fieldFilter,value=record({name:'x/documents/test',fields:{value:f.value},updateTime:''}).data.value;const docs=await this.query((parent?parent+'/':'')+q.from[0].collectionId,f.field.fieldPath,f.op,value);return json(docs.map(d=>({document:document(d)})));}
 if(rawPath===':batchGet')return json(await Promise.all(body.documents.map(async n=>{const d=await this.get(n.split('/documents/')[1]);return d?{found:document(d)}:{missing:n};})));
 if(rawPath===':commit'){await this.commit(body.writes.map(w=>w.delete?{delete:w.delete.split('/documents/')[1],version:w.currentDocument?.updateTime}:{path:w.update.name.split('/documents/')[1],data:record({...w.update,updateTime:''}).data,version:w.currentDocument?.updateTime,create:w.currentDocument?.exists===false}));return json({writeResults:[]});}
 const path=rawPath.slice(1);if(method==='GET'&&url.searchParams.has('pageSize'))return json({documents:(await this.list(path)).map(document)});const d=await this.get(path);return d?json(document(d)):new Response(JSON.stringify({error:{status:'NOT_FOUND'}}),{status:404});
 }catch(e){return new Response(JSON.stringify({error:{status:e.status===409?'ABORTED':'INTERNAL'}}),{status:e.status||500});}}
}
