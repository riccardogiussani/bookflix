import {afterEach,expect,it,vi} from 'vitest';
import {forgetAccessCode,readAccessCode,rememberedAccess,readSavedLogin,storeAccessCode} from './access';
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)};}
afterEach(()=>{forgetAccessCode();vi.unstubAllGlobals();});
it('ricorda il codice solo nella sessione per impostazione predefinita',()=>{const local=storage(),session=storage();vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);storeAccessCode('test-only-code',false);expect(local.getItem('bookflix-access-code')).toBeNull();expect(readAccessCode()).toBe('test-only-code');expect(rememberedAccess()).toBe(false);});
it('salva sul dispositivo soltanto su scelta esplicita e permette di dimenticare',()=>{const local=storage(),session=storage();vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);storeAccessCode('test-only-code',true);expect(rememberedAccess()).toBe(true);storeAccessCode('session-only',false);expect(local.getItem('bookflix-access-code')).toBeNull();forgetAccessCode();expect(readAccessCode()).toBe('');});

it('ripristina nome e password persistenti anche dopo il ricaricamento dei moduli',async()=>{
 const local=storage(),session=storage();vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);storeAccessCode('test-only-code',true,'Riccardo');
 vi.resetModules();const reloaded=await import('./access');expect(reloaded.readSavedLogin()).toEqual({username:'Riccardo',accessCode:'test-only-code',remember:true});
});
it('mantiene il login non persistente nei refresh della stessa sessione senza salvarlo sul dispositivo',()=>{
 const local=storage(),session=storage();vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);storeAccessCode('session-code',false,'Riccardo');expect(readSavedLogin()).toEqual({username:'Riccardo',accessCode:'session-code',remember:false});expect(local.getItem('bookflix-access-username')).toBeNull();expect(session.getItem('bookflix-access-username')).toBe('Riccardo');forgetAccessCode();expect(readSavedLogin()).toBeNull();expect(session.getItem('bookflix-access-username')).toBeNull();
});
it('recupera le password salvate dalla versione precedente anche senza username',()=>{
 const local=storage();vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',storage());local.setItem('bookflix-access-code','legacy-test-code');expect(readSavedLogin()).toEqual({username:'Lettore',accessCode:'legacy-test-code',remember:true});
});
it('ripristina la sessione anche quando localStorage è bloccato',()=>{
 const session=storage();session.setItem('bookflix-access-code','session-code');session.setItem('bookflix-access-username','Nome');vi.stubGlobal('localStorage',{getItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}});vi.stubGlobal('sessionStorage',session);expect(readSavedLogin()).toEqual({username:'Nome',accessCode:'session-code',remember:false});
});
