import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {bookflixPWA,publicFiles} from './pwa-build.mjs';
const root=new URL('../',import.meta.url);
function generated(bundle={'assets/app.js':{type:'chunk',code:'console.log(1)'},'assets/app.css':{type:'asset',source:'body{}'}}){const emitFile=vi.fn();bookflixPWA().generateBundle.call({emitFile},{},bundle);return emitFile.mock.calls[0][0].source;}
function worker(){const handlers={},stores=new Map(),deleted=[];const caches={open:async name=>{if(!stores.has(name))stores.set(name,{addAll:vi.fn(async urls=>{}),match:vi.fn(async()=>undefined)});return stores.get(name);},keys:async()=>[...stores.keys()],delete:async name=>{deleted.push(name);return stores.delete(name);}};const fetch=vi.fn().mockResolvedValue(new Response('network'));const self={registration:{scope:'https://example.test/bookflix/'},clients:{claim:vi.fn(async()=>{})},skipWaiting:vi.fn(),addEventListener:(name,handler)=>handlers[name]=handler};vm.runInNewContext(generated(),{self,caches,fetch,URL,Response,Set});return {handlers,stores,deleted,caches,fetch,self};}
async function install(w){let result;w.handlers.install({waitUntil:p=>result=p});await result;return [...w.stores.entries()][0];}
it('fornisce manifest installabile con icone PNG reali e percorsi relativi sotto /bookflix/',()=>{
 const manifest=JSON.parse(readFileSync(new URL('public/manifest.webmanifest',root),'utf8'));expect(manifest.name).toBe('Bookflix');expect(manifest.short_name).toBe('Bookflix');expect(manifest.display).toBe('standalone');expect(new URL(manifest.id,'https://example.test/').href).toBe('https://example.test/bookflix/');for(const key of ['scope','start_url'])expect(new URL(manifest[key],'https://example.test/bookflix/manifest.webmanifest').href).toBe('https://example.test/bookflix/');
 for(const size of [192,512]){const icon=manifest.icons.find(i=>i.sizes===size+'x'+size&&i.purpose==='any');const bytes=readFileSync(new URL('public/'+icon.src,root));expect(bytes.readUInt32BE(16)).toBe(size);expect(bytes.readUInt32BE(20)).toBe(size);expect(bytes.subarray(1,4).toString()).toBe('PNG');}expect(manifest.icons.some(i=>i.purpose==='maskable')).toBe(true);const html=readFileSync(new URL('index.html',root),'utf8');expect(html).toContain('rel="manifest"');expect(html).toContain('rel="icon"');expect(html).toContain('Bookflix —');
});
it('include index, bundle e icone nel precache, cambia versione a ogni build e non include dati o credenziali',()=>{
 const source=generated();expect(source).toContain('assets/app.js');expect(source).toContain('index.html');for(const path of publicFiles)expect(source).toContain(path);expect(source).not.toContain('__BOOKFLIX_');expect(source).not.toContain('.env');expect(source).not.toContain('AUTH_USERS_JSON');expect(generated({'assets/changed.js':{type:'chunk',code:'new'}})).not.toBe(source);
});
it('installa la cache nel solo percorso del progetto e rimuove solo le sue versioni precedenti',async()=>{
 const w=worker(),[name,cache]=await install(w);expect(name).toContain('bookflix-shell:https://example.test/bookflix/:');expect(cache.addAll.mock.calls[0][0].every(url=>url.startsWith('https://example.test/bookflix/'))).toBe(true);
 w.stores.set('bookflix-shell:https://example.test/bookflix/:old',{});w.stores.set('bookflix-shell:https://example.test/other/:old',{});w.stores.set('other-app-cache',{});let done;w.handlers.activate({waitUntil:p=>done=p});await done;expect(w.deleted).toEqual(['bookflix-shell:https://example.test/bookflix/:old']);expect(w.self.clients.claim).toHaveBeenCalledOnce();expect(w.self.skipWaiting).not.toHaveBeenCalled();w.handlers.message({data:{type:'BOOKFLIX_UPDATE'}});expect(w.self.skipWaiting).toHaveBeenCalledOnce();
});
it('non intercetta API, login, upload, altri siti e altri progetti sulla stessa origine',()=>{
 const w=worker();for(const request of [{url:'https://worker.test/auth/login',method:'POST'},{url:'https://example.test/bookflix/private',method:'GET',headers:new Headers({Authorization:'Bearer token'})},{url:'https://example.test/other/',method:'GET'},{url:'https://example.test/bookflix/library',method:'PUT'}]){const respondWith=vi.fn();w.handlers.fetch({request:{mode:'cors',headers:new Headers(),...request},respondWith});expect(respondWith).not.toHaveBeenCalled();}expect(w.fetch).not.toHaveBeenCalled();
});
it('usa la rete per la navigazione e ripiega sull’interfaccia in cache offline',async()=>{
 const w=worker(),[,cache]=await install(w);cache.match.mockResolvedValue(new Response('offline shell'));const request={url:'https://example.test/bookflix/',method:'GET',mode:'navigate',headers:new Headers()};let response;w.handlers.fetch({request,respondWith:p=>response=p});expect(await (await response).text()).toBe('network');w.fetch.mockRejectedValue(new Error('offline'));w.handlers.fetch({request,respondWith:p=>response=p});expect(await (await response).text()).toBe('offline shell');
});
