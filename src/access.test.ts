import {it,expect,vi,afterEach} from 'vitest';
import {forgetAccessCode,validSession} from './access';
afterEach(()=>vi.unstubAllGlobals());
it('rimuove i vecchi token personalizzati senza toccare la persistenza Firebase',()=>{const map=new Map([['bookflix-access-code','password'],['bookflix-access-username','nome'],['bookflix-auth-session-v2','token'],['firebase:authUser','managed']]);const storage={removeItem:(key:string)=>map.delete(key)};vi.stubGlobal('localStorage',storage);vi.stubGlobal('sessionStorage',storage);forgetAccessCode();expect([...map.entries()]).toEqual([['firebase:authUser','managed']]);});
it('accetta solo sessioni confermate con ID e scadenza',()=>{const s={user:{id:'id',displayName:'Riccardo',username:'Riccardo'},accessCode:'signed-token',expiresAt:new Date(Date.now()+3600000).toISOString(),remember:false};expect(validSession(s)).toBe(true);expect(validSession({...s,user:{}})).toBe(false);expect(validSession({...s,expiresAt:'2000-01-01'})).toBe(false);});
