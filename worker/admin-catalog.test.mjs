import {afterEach,expect,it,vi} from 'vitest';
import worker from './scraper.mjs';
import {harness} from './test-central-env.mjs';
import {tokenFor} from './test-auth.mjs';
import {createAdminSession,requireAdminSession} from './admin-session.mjs';

const secret='mock-admin-token-used-only-in-tests-1234';
const draftId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id='manual_'+draftId;
const otherId='isbn_9788804668237';
const library='libraries/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const item=library+'/items/'+id;

function request(path,code,session,body){
 const headers={...(code?{Authorization:'Bearer '+code}:{}),...(session?{'X-Bookflix-Admin':session}:{})};
 return new Request('https://worker.invalid/v2/admin/'+path,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it('richiede Firebase e il token admin, rifiuta sessioni assenti, contraffatte o di altri account',async()=>{
 const fixture=harness();vi.stubGlobal('fetch',fixture.fetch);
 const code=await tokenFor(),other=await tokenFor('other-user');
 expect((await worker.fetch(request('session',code,null,{token:secret}),fixture.env)).status).toBe(503);
 fixture.env.ADMIN_TOKEN=secret;
 expect((await worker.fetch(request('session',null,null,{token:secret}),fixture.env)).status).toBe(401);
 expect((await worker.fetch(request('session',code,null,{token:'wrong'}),fixture.env)).status).toBe(403);
 expect((await worker.fetch(request('catalog',code),fixture.env)).status).toBe(403);
 const response=await worker.fetch(request('session',code,null,{token:secret}),fixture.env);
 expect(response.status).toBe(200);
 const {session}=await response.json();
 expect(session).not.toContain(secret);
 expect((await worker.fetch(request('catalog',code,session+'x'),fixture.env)).status).toBe(403);
 expect((await worker.fetch(request('catalog',other,session),fixture.env)).status).toBe(403);
 expect((await worker.fetch(request('catalog',code,session),fixture.env)).status).toBe(200);
});

it('fa scadere la sessione amministratore',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
 const env={ADMIN_TOKEN:secret};
 const {session}=await createAdminSession(env,'admin',secret);
 await expect(requireAdminSession(env,'admin',session)).resolves.toBeUndefined();
 vi.setSystemTime(new Date('2026-11-09T10:31:00Z'));
 await expect(requireAdminSession(env,'admin',session)).rejects.toMatchObject({status:403});
});

it('crea, rilegge e modifica il catalogo centrale con audit e propagazione delle sole modifiche',async()=>{
 const fixture=harness();vi.stubGlobal('fetch',fixture.fetch);fixture.env.ADMIN_TOKEN=secret;
 const code=await tokenFor();
 const login=await worker.fetch(request('session',code,null,{token:secret}),fixture.env);
 const {session}=await login.json();
 const call=(path,body)=>worker.fetch(request(path,code,session,body),fixture.env);
 const image=new Uint8Array([137,80,78,71,13,10,26,10]);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',image))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 const upload=await worker.fetch(new Request('https://worker.invalid/v2/admin/covers/'+hash+'.png',{method:'PUT',
  headers:{Authorization:'Bearer '+code,'X-Bookflix-Admin':session,'Content-Type':'image/png'},body:image}),fixture.env);
 expect(upload.status).toBe(200);
 const created=await call('catalog',{draftId,metadata:{title:'Libro',authors:['Autrice']},classification:{primaryGenre:'giallo'},cover:await upload.json()});
 expect(created.status).toBe(201);
 expect((await created.json()).id).toBe(id);
 const download=await call('catalog/'+id+'/cover');
 expect(new Uint8Array(await download.arrayBuffer())).toEqual(image);
 expect((await call('catalog',{draftId,metadata:{title:'Duplicato'}})).status).toBe(409);
 fixture.store.put(library,{name:'Casa',members:{reader:'owner'},memberIds:['reader']});
 fixture.store.put(item,{catalogId:id,location:'Camere',overrides:{title:'Titolo locale',publisher:'Editore locale'}});
 fixture.store.put('catalog/'+otherId,{metadata:{title:'Altro',isbn:'9788804668237'},cover:null});
 const selected=await (await call('catalog/read',{ids:[id,otherId]})).json();
 expect(selected.books).toHaveLength(2);
 expect(selected.books.find(book=>book.id===id).metadata.genres).toEqual(['Giallo']);
 const edits=selected.books.map(({id,revision})=>({id,revision}));
 const saved=await call('catalog/edit',{editions:edits,metadata:{title:'Titolo comune'}});
 expect(saved.status).toBe(200);
 expect(await saved.json()).toEqual({books:2,references:1});
 expect((await fixture.store.get(item)).data).toMatchObject({catalogId:id,location:'Camere',overrides:{publisher:'Editore locale'}});
 expect((await fixture.store.get(item)).data.overrides).not.toHaveProperty('title');
 expect((await fixture.store.get('catalog/'+otherId)).data.metadata.isbn).toBe('9788804668237');
 expect(await fixture.store.list('catalogAdminAudit')).toHaveLength(3);
 expect((await call('catalog/edit',{editions:edits,metadata:{title:'Titolo obsoleto'}})).status).toBe(409);
 expect((await fixture.store.get('catalog/'+id)).data.metadata.title).toBe('Titolo comune');
 const current=await (await call('catalog/'+id)).json();
 expect((await call('catalog/edit',{editions:[{id,revision:current.revision}],metadata:{isbn:'9788804668237'}})).status).toBe(409);
 expect((await fixture.store.get(item)).data.catalogId).toBe(id);
 const newId='isbn_9780140449136';
 expect((await call('catalog/edit',{editions:[{id,revision:current.revision}],metadata:{isbn:'9780140449136'}})).status).toBe(200);
 expect(await fixture.store.get('catalog/'+id)).toBeNull();
 expect((await fixture.store.get(item)).data.catalogId).toBe(newId);
});
