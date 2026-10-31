export type SessionUser={id:string;username:string;displayName:string;email?:string};
export type SavedLogin={user:SessionUser;accessCode:string;expiresAt:string;remember:boolean;libraryAccess?:'owner'|'none'};
const oldKeys=['bookflix-access-code','bookflix-access-username','bookflix-auth-session-v2'];
export function forgetAccessCode(){for(const key of oldKeys){try{localStorage.removeItem(key);}catch{}try{sessionStorage.removeItem(key);}catch{}}}
// Firebase owns token persistence and renewal. Custom tokens are no longer saved here.
export function validSession(value:unknown):value is SavedLogin{const s=value as SavedLogin;return !!s&&typeof s.accessCode==='string'&&s.accessCode.length<=8192&&typeof s.user?.id==='string'&&!!s.user.id&&typeof s.user.displayName==='string'&&typeof s.user.username==='string'&&typeof s.expiresAt==='string'&&Date.parse(s.expiresAt)>Date.now();}
