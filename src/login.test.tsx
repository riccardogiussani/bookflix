import {afterEach,expect,it,vi} from 'vitest';
import {renderToString} from 'react-dom/server';
import {LoginGate} from './LoginGate';
import {signIn,verifyLogin} from './login';
import {storeSession,readSavedLogin,forgetAccessCode,type SavedLogin} from './access';
import {WORKER_URL} from './isbn';
const user={id:'verified-id',username:'riccardo',displayName:'Riccardo'};
const expiresAt=()=>new Date(Date.now()+3600000).toISOString();
const saved=():SavedLogin=>({user,accessCode:'header.payload.signature',expiresAt:expiresAt(),remember:true});
function storage(){const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)||null,setItem:(k:string,v:string)=>m.set(k,v),removeItem:(k:string)=>m.delete(k)};}
afterEach(()=>{forgetAccessCode();vi.unstubAllGlobals();});
it('non monta il catalogo prima della verifica',()=>{const library=vi.fn(()=> <p>Catalogo riservato</p>);const html=renderToString(<LoginGate>{library}</LoginGate>);expect(html).toContain('Username');expect(library).not.toHaveBeenCalled();expect(html).not.toContain('Catalogo riservato');});
it('invia le credenziali solo via POST e conserva il token invece della password',async()=>{
 vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({authenticated:true,user,accessToken:'header.payload.signature',expiresAt:expiresAt()})));vi.stubGlobal('fetch',fetch);const result=await signIn('Riccardo','test-password-only',true,new AbortController().signal);expect(result.user.id).toBe(user.id);expect(fetch.mock.calls[0][0]).toBe(WORKER_URL+'/auth/login');expect(fetch.mock.calls[0][1].method).toBe('POST');expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({username:'Riccardo',password:'test-password-only'});expect(JSON.stringify(readSavedLogin())).not.toContain('test-password-only');expect(readSavedLogin()?.accessCode).toBe('header.payload.signature');
});
it('ripristina automaticamente il login e usa l’identità confermata dal Worker',async()=>{
 vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());storeSession({...saved(),user:{id:'forged-id',username:'sara',displayName:'Sara'}});const library=vi.fn(()=> <p>Riservato</p>);expect(renderToString(<LoginGate>{library}</LoginGate>)).toContain('Ripristino dell’accesso');expect(library).not.toHaveBeenCalled();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({authenticated:true,user,expiresAt:expiresAt()}))));expect((await verifyLogin(readSavedLogin()!,new AbortController().signal)).user).toEqual(user);
});
it('conserva la sessione in caso di rete assente ma la dimentica se revocata',async()=>{
 vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());storeSession(saved());vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('offline')));await expect(verifyLogin(saved(),new AbortController().signal)).rejects.toThrow('connessione');expect(readSavedLogin()).not.toBeNull();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));await expect(verifyLogin(saved(),new AbortController().signal)).rejects.toThrow('Sessione scaduta');expect(readSavedLogin()).toBeNull();
});
it.each([[401,'Username o password'],[404,'Aggiorna il Worker'],[429,'Troppi tentativi'],[503,'non sono ancora configurati']])('gestisce HTTP %i al login',async(status,message)=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status})));await expect(signIn('riccardo','test-password-only',true,new AbortController().signal)).rejects.toThrow(message);});
it('rifiuta health pubblico o risposte senza identità e non salva un login annullato',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true}))));await expect(signIn('riccardo','test-password-only',true,new AbortController().signal)).rejects.toThrow('non ha confermato');const controller=new AbortController();vi.stubGlobal('fetch',vi.fn(async()=>{controller.abort();return new Response(JSON.stringify({authenticated:true,user,accessToken:'header.payload.signature',expiresAt:expiresAt()}));}));await expect(signIn('riccardo','test-password-only',true,controller.signal)).rejects.toThrow();expect(readSavedLogin()).toBeNull();
});
