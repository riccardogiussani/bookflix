import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import worker from './scraper.mjs';
import {testEnv,tokenFor,withJWKS} from './test-auth.mjs';
const code=await tokenFor();const env={...testEnv,KOOFR_USERNAME:'test@example.invalid',KOOFR_PASSWORD:'test-webdav',KOOFR_COLLECTION_ID:'ca91c2ce-b8c7-487e-8f40-99024a354c63'};
const request=(path,method='GET',auth=code,headers={},body)=>new Request('https://worker.test'+path,{method,headers:{Origin:'https://riccardogiussani.github.io',Authorization:'Bearer '+auth,'CF-Connecting-IP':crypto.randomUUID(),...headers},body});
beforeEach(()=>vi.stubGlobal('fetch',withJWKS(vi.fn(()=>{throw Error('Unexpected upstream');}))));afterEach(()=>vi.unstubAllGlobals());
it('authenticates every library endpoint before contacting Koofr',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',withJWKS(fetch));for(const [path,method] of [['/library','GET'],['/library','PUT'],['/library/info','GET'],['/library/covers/ca91c2ce-b8c7-487e-8f40-99024a354c63.png','PUT']])expect((await worker.fetch(request(path,method,'wrong'),env)).status).toBe(401);expect(fetch).not.toHaveBeenCalled();
});
it('reports configuration missing, allows preflight and does not disclose WebDAV secrets',async()=>{
 const r=await worker.fetch(request('/library'),testEnv);expect(r.status).toBe(503);
 const preflight=await worker.fetch(request('/library','OPTIONS'),env);expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('PUT');expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('If-Match');
 const health=await (await worker.fetch(request('/health'),env)).text();expect(health).not.toContain(env.KOOFR_PASSWORD);expect(health).not.toContain(env.KOOFR_USERNAME);
});
it('refuses an unversioned overwrite, traversal and invalid cover types before DAV calls',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',withJWKS(fetch));
 expect((await worker.fetch(request('/library','PUT',code,{},'{}'),env)).status).toBe(428);
 expect((await worker.fetch(request('/library/covers/not-a-cover','PUT'),env)).status).toBe(404);
 expect((await worker.fetch(request('/library/covers/ca91c2ce-b8c7-487e-8f40-99024a354c63.png','PUT',code,{'Content-Type':'text/html'},'<script>'),env)).status).toBe(400);
 expect(fetch).not.toHaveBeenCalled();
});
it('rejects weak or absent catalog ETags and oversized files without exposing upstream responses',async()=>{
 vi.stubGlobal('fetch',withJWKS(vi.fn().mockResolvedValue(new Response('{}',{headers:{ETag:'W/"weak"'}}))));expect((await worker.fetch(request('/library'),env)).status).toBe(502);
 vi.stubGlobal('fetch',withJWKS(vi.fn().mockResolvedValue(new Response('private error',{status:401}))));const r=await worker.fetch(request('/library'),env);expect(r.status).toBe(502);expect(await r.text()).not.toContain('private error');
 vi.stubGlobal('fetch',withJWKS(vi.fn().mockResolvedValue(new Response('{}',{headers:{ETag:'"valid"','Content-Length':String(17*1024*1024)}}))));expect((await worker.fetch(request('/library'),env)).status).toBe(413);
});
it('rejects non-UUID record IDs and cover paths before writing',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',withJWKS(fetch));const body=JSON.stringify({format:'bookflix-cloud',version:1,books:[{id:'../../oops',title:'Bad'}]});expect((await worker.fetch(request('/library','PUT',code,{'If-None-Match':'*'},body),env)).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
});
