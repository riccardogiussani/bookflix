import {afterEach,expect,it,vi} from 'vitest';
import worker from './scraper.mjs';
import {authenticate} from './auth.mjs';
import {testEnv,testUsers,testPasswords,tokenFor} from './test-auth.mjs';
const origin='https://riccardogiussani.github.io';
const request=(path='/library',token='',method='GET',body)=>new Request('https://worker.test'+path,{method,headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json','CF-Connecting-IP':crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it.each(testUsers.map(u=>u.username))('autentica %s con password personale e ripristina la sessione',async username=>{
 const r=await worker.fetch(request('/auth/login','','POST',{username:username.toUpperCase(),password:testPasswords[username],remember:true}),testEnv);expect(r.status).toBe(200);const result=await r.json();expect(result.user.username).toBe(username);expect(result.accessToken).not.toContain(testPasswords[username]);const check=await worker.fetch(request('/auth/check',result.accessToken),testEnv);expect((await check.json()).user.id).toBe(result.user.id);
});
it('rifiuta password scambiate, username sconosciuti e vecchia password condivisa',async()=>{
 for(const username of ['riccardo','unknown']){const r=await worker.fetch(request('/auth/login','','POST',{username,password:testPasswords.sara}),testEnv);expect(r.status).toBe(401);expect((await r.json()).error).toBe('Username o password non corretti.');}
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);for(const path of ['/library','/lookup?isbn=9780306406157','/cover?isbn=9780306406157','/auth/check'])expect((await worker.fetch(request(path,'old-shared-code'),{...testEnv,ACCESS_CODE:'old-shared-code'})).status).toBe(401);expect(fetch).not.toHaveBeenCalled();
});
it('rifiuta token alterati, scaduti e firmati con chiavi diverse',async()=>{
 const token=await tokenFor();expect((await worker.fetch(request('/auth/check',token.slice(0,-5)+'AAAAA'),testEnv)).status).toBe(401);expect((await worker.fetch(request('/auth/check',token),{...testEnv,AUTH_SESSION_SECRET:'other-key'.repeat(8)})).status).toBe(401);vi.useFakeTimers();vi.setSystemTime(Date.now()+31*86400000);expect((await worker.fetch(request('/auth/check',token),testEnv)).status).toBe(401);
});
it('revoca subito le sessioni disabilitando un utente o cambiando la sua versione',async()=>{
 const token=await tokenFor();for(const patch of [{disabled:true},{sessionVersion:'test-v2'}]){const users=testUsers.map(u=>u.username==='riccardo'?{...u,...patch}:u);expect((await worker.fetch(request('/auth/check',token),{...testEnv,AUTH_USERS_JSON:JSON.stringify({version:1,users})})).status).toBe(401);}
});
it('limita i tentativi e mantiene chiuso il servizio senza configurazione, senza pubblicare hash o chiavi',async()=>{
 const ip=crypto.randomUUID();for(let i=0;i<12;i++){const req=request('/auth/login','','POST',{username:'riccardo',password:'wrong'});req.headers.set('CF-Connecting-IP',ip);expect((await worker.fetch(req,testEnv)).status).toBe(401);}const req=request('/auth/check',await tokenFor());req.headers.set('CF-Connecting-IP',ip);expect((await worker.fetch(req,testEnv)).status).toBe(429);
 expect((await worker.fetch(request('/auth/check'),{ACCESS_CODE:'old'})).status).toBe(503);const health=await (await worker.fetch(request('/health'),testEnv)).text();expect(health).not.toContain(testEnv.AUTH_SESSION_SECRET);expect(health).not.toContain(testUsers[0].passwordHash);expect(JSON.parse(health).version).toBe('0.8.0');
});
it('gestisce CORS e body di login troppo grandi, senza fare scraping durante il login',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const preflight=await worker.fetch(request('/auth/login','','OPTIONS'),testEnv);expect(preflight.status).toBe(204);expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('POST');const bad=request('/auth/login','','POST',{password:'a'.repeat(3000)});expect((await worker.fetch(bad,testEnv)).status).toBe(413);await tokenFor();expect(fetch).not.toHaveBeenCalled();
});
it('non inoltra ai portali la sessione dell’utente',async()=>{const token=await tokenFor();const fetch=vi.fn().mockResolvedValue(new Response('<html></html>'));vi.stubGlobal('fetch',fetch);expect((await worker.fetch(request('/lookup?isbn=9780306406157',token),testEnv)).status).toBe(200);expect(fetch).toHaveBeenCalledOnce();expect(JSON.stringify(fetch.mock.calls)).not.toContain(token);});
