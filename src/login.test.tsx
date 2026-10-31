import {afterEach,expect,it,vi} from 'vitest';
import {renderToString} from 'react-dom/server';
import {LoginGate} from './LoginGate';
import {checkAccess,verifyLogin} from './login';
import {storeAccessCode,readSavedLogin,forgetAccessCode} from './access';
import {WORKER_URL} from './isbn';
afterEach(()=>{forgetAccessCode();vi.unstubAllGlobals();});
it('non mostra e non monta la libreria prima della verifica',()=>{const library=vi.fn(()=> <p>Catalogo riservato</p>);const html=renderToString(<LoginGate>{library}</LoginGate>);expect(html).toContain('Username');expect(html).toContain('Password');expect(html).not.toContain('Catalogo riservato');expect(library).not.toHaveBeenCalled();});
it('verifica solo la password via header su un endpoint senza scraping',async()=>{const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({authenticated:true})));vi.stubGlobal('fetch',fetch);expect(await checkAccess('test-only-password',new AbortController().signal)).toBe('test-only-password');expect(fetch.mock.calls[0][0]).toBe(`${WORKER_URL}/auth/check`);expect(fetch.mock.calls[0][1].headers).toEqual({Authorization:'Bearer test-only-password'});expect(fetch.mock.calls[0][1].cache).toBe('no-store');});
it('non accetta il solo health pubblico come conferma di accesso',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true}))));await expect(checkAccess('test-only-password',new AbortController().signal)).rejects.toThrow('non ha confermato');});
it.each([[401,'Password non corretta'],[404,'aggiornato'],[429,'Troppi tentativi'],[503,'non è ancora configurata']])('gestisce HTTP %i senza aprire la libreria',async(status,message)=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status})));await expect(checkAccess('test-only-password',new AbortController().signal)).rejects.toThrow(message);});
it('gestisce la rete assente e consente di riprovare',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')));await expect(checkAccess('test-only-password',new AbortController().signal)).rejects.toThrow('connessione');});

function browserStorage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};}
it('ripristina un login ricordato solo dopo averlo verificato col servizio',async()=>{
 vi.stubGlobal('localStorage',browserStorage());vi.stubGlobal('sessionStorage',browserStorage());storeAccessCode('test-password',true,'Riccardo');
 const library=vi.fn(()=> <p>Catalogo riservato</p>);const html=renderToString(<LoginGate>{library}</LoginGate>);expect(html).toContain('Ripristino dell’accesso');expect(html).not.toContain('type="password"');expect(library).not.toHaveBeenCalled();
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({authenticated:true})));vi.stubGlobal('fetch',fetch);expect(await verifyLogin(readSavedLogin()!,new AbortController().signal)).toEqual({username:'Riccardo',accessCode:'test-password'});expect(fetch).toHaveBeenCalledOnce();expect(readSavedLogin()?.remember).toBe(true);
});
it('conserva il login ricordato dopo un errore temporaneo e consente il successivo ripristino',async()=>{
 vi.stubGlobal('localStorage',browserStorage());vi.stubGlobal('sessionStorage',browserStorage());storeAccessCode('test-password',true,'Riccardo');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')));
 await expect(verifyLogin(readSavedLogin()!,new AbortController().signal)).rejects.toThrow('connessione');expect(readSavedLogin()?.username).toBe('Riccardo');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({authenticated:true}))));expect((await verifyLogin(readSavedLogin()!,new AbortController().signal)).username).toBe('Riccardo');
});
it('dimentica le credenziali revocate e un nuovo logout non può ripristinarle',async()=>{
 vi.stubGlobal('localStorage',browserStorage());vi.stubGlobal('sessionStorage',browserStorage());storeAccessCode('test-password',true,'Riccardo');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
 await expect(verifyLogin(readSavedLogin()!,new AbortController().signal)).rejects.toThrow('Password non corretta');expect(readSavedLogin()).toBeNull();storeAccessCode('new-test-password',true,'Riccardo');forgetAccessCode();expect(readSavedLogin()).toBeNull();
});
it('un ripristino annullato non apre né risalva una sessione',async()=>{
 vi.stubGlobal('localStorage',browserStorage());vi.stubGlobal('sessionStorage',browserStorage());const controller=new AbortController();vi.stubGlobal('fetch',vi.fn(async()=>{controller.abort();return new Response(JSON.stringify({authenticated:true}));}));
 await expect(verifyLogin({username:'Nome',accessCode:'test-password',remember:true},controller.signal)).rejects.toThrow();expect(readSavedLogin()).toBeNull();
});
