import {afterEach,expect,it,vi} from 'vitest';
import worker from './scraper.mjs';
const code='test-only-access-code-not-a-real-secret';
const env={ACCESS_CODE:code};
const request=(path='/lookup?isbn=9788834603000',authorization='',origin='https://riccardogiussani.github.io',method='GET')=>new Request('https://worker.test'+path,{method,headers:{Origin:origin,Authorization:authorization,'CF-Connecting-IP':crypto.randomUUID()}});
afterEach(()=>vi.unstubAllGlobals());
it('rifiuta lookup e copertina senza codice o con codice errato, anche senza Origin',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 for(const path of ['/lookup?isbn=9788834603000','/cover?isbn=9788834603000'])for(const auth of ['', 'Bearer wrong']){const r=await worker.fetch(request(path,auth),env);expect(r.status).toBe(401);expect(r.headers.get('Cache-Control')).toBe('no-store');}
 expect((await worker.fetch(new Request('https://worker.test/lookup?isbn=9788834603000'),env)).status).toBe(401);expect(fetch).not.toHaveBeenCalled();
});
it('resta chiuso quando manca il secret Cloudflare',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect((await worker.fetch(request('/lookup?isbn=9788834603000','Bearer '+code))).status).toBe(503);expect(fetch).not.toHaveBeenCalled();
});
it('non accetta il codice nella query string',async()=>{expect((await worker.fetch(request('/lookup?isbn=9788834603000&access_code='+code),env)).status).toBe(401);});
it('consente il preflight Authorization soltanto all’origine configurata',async()=>{
 const r=await worker.fetch(request('/lookup','','https://riccardogiussani.github.io','OPTIONS'),env);expect(r.status).toBe(204);expect(r.headers.get('Access-Control-Allow-Headers')).toBe('Authorization');expect((await worker.fetch(request('/lookup','','https://other.test','OPTIONS'),env)).status).toBe(403);
});
it('mantiene health pubblico senza esporre il secret',async()=>{const r=await worker.fetch(request('/health'),env);expect(r.status).toBe(200);const body=await r.text();expect(body).not.toContain(code);expect(JSON.parse(body).authentication).toEqual({required:true,configured:true});});
it('con il codice corretto raggiunge il portale, senza inoltrargli il codice',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response('<html></html>'));vi.stubGlobal('fetch',fetch);const r=await worker.fetch(request('/lookup?isbn=9788834603000','Bearer '+code),env);expect(r.status).toBe(200);expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();expect(JSON.stringify(fetch.mock.calls)).not.toContain(code);
});
it('verifica l’accesso senza scraping e richiede la password anche sul controllo di login',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 expect((await worker.fetch(request('/auth/check'),env)).status).toBe(401);
 expect((await worker.fetch(request('/auth/check','Bearer wrong'),env)).status).toBe(401);
 const r=await worker.fetch(request('/auth/check','Bearer '+code),env);expect(r.status).toBe(200);expect(await r.json()).toEqual({authenticated:true});expect(fetch).not.toHaveBeenCalled();
});
it('limita i tentativi di password errata anche alternando login e metadati',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const ip=crypto.randomUUID();
 for(let i=0;i<12;i++){const path=i%2?'/auth/check':'/lookup?isbn=9788834603000';const r=await worker.fetch(new Request('https://worker.test'+path,{headers:{Authorization:'Bearer wrong','CF-Connecting-IP':ip}}),env);expect(r.status).toBe(401);}
 const r=await worker.fetch(new Request('https://worker.test/cover?isbn=9788834603000',{headers:{Authorization:'Bearer wrong','CF-Connecting-IP':ip}}),env);expect(r.status).toBe(429);expect(fetch).not.toHaveBeenCalled();
});
