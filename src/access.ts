const KEY='bookflix-auth-session-v2';
const LEGACY=['bookflix-access-code','bookflix-access-username'];
export type SessionUser={id:string;username:string;displayName:string};
export type SavedLogin={user:SessionUser;accessCode:string;expiresAt:string;remember:boolean};
let memory:SavedLogin|null=null;
export function validSession(value:unknown):value is SavedLogin{const s=value as SavedLogin;return !!s&&typeof s.accessCode==='string'&&s.accessCode.length<2048&&s.accessCode.split('.').length===3&&typeof s.user?.id==='string'&&!!s.user.id&&typeof s.user.username==='string'&&!!s.user.username&&typeof s.user.displayName==='string'&&!!s.user.displayName&&typeof s.expiresAt==='string'&&Date.parse(s.expiresAt)>Date.now();}
function cleanLegacy(){for(const key of LEGACY){try{localStorage.removeItem(key);}catch{}try{sessionStorage.removeItem(key);}catch{}}}
export function readSavedLogin():SavedLogin|null{
 cleanLegacy();for(const kind of ['localStorage','sessionStorage'] as const)try{const storage=globalThis[kind],raw=storage.getItem(KEY);if(!raw)continue;const session=JSON.parse(raw);if(validSession(session))return {...session,remember:kind==='localStorage'};storage.removeItem(KEY);}catch{}
 return validSession(memory)?memory:null;
}
export function storeSession(session:SavedLogin){if(!validSession(session))throw Error('Sessione non valida.');memory=session;cleanLegacy();let stored=false;for(const kind of ['localStorage','sessionStorage'] as const)try{const storage=globalThis[kind];storage.removeItem(KEY);if((kind==='localStorage')===session.remember){storage.setItem(KEY,JSON.stringify(session));stored=true;}}catch{}return stored;}
export function forgetAccessCode(){memory=null;cleanLegacy();try{localStorage.removeItem(KEY);}catch{}try{sessionStorage.removeItem(KEY);}catch{}}
export function readAccessCode(){return readSavedLogin()?.accessCode||'';}
export function rememberedAccess(){return readSavedLogin()?.remember||false;}
