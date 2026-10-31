import {afterEach,expect,it,vi} from 'vitest';
import {forgetAccessCode,readAccessCode,rememberedAccess,storeAccessCode} from './access';
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)};}
afterEach(()=>{forgetAccessCode();vi.unstubAllGlobals();});
it('ricorda il codice solo nella sessione per impostazione predefinita',()=>{const local=storage(),session=storage();vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);storeAccessCode('test-only-code',false);expect(local.getItem('bookflix-access-code')).toBeNull();expect(readAccessCode()).toBe('test-only-code');expect(rememberedAccess()).toBe(false);});
it('salva sul dispositivo soltanto su scelta esplicita e permette di dimenticare',()=>{const local=storage(),session=storage();vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);storeAccessCode('test-only-code',true);expect(rememberedAccess()).toBe(true);storeAccessCode('session-only',false);expect(local.getItem('bookflix-access-code')).toBeNull();forgetAccessCode();expect(readAccessCode()).toBe('');});
