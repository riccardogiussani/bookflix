import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {initialUsers} from '../worker/users.mjs';
const derive=(password,salt)=>pbkdf2Sync(password,Buffer.from(salt,'base64url'),100000,32,'sha256').toString('base64url');
export function credentials(previous,values,action={}){
 const target=action.username?.trim().toLowerCase();if(target&&!initialUsers.some(u=>u.username===target))throw Error('Username non presente nell’elenco.');
 const old=previous?JSON.parse(previous.AUTH_USERS_JSON):{users:[]};let changed=0;
 const users=initialUsers.map(profile=>{const existing=old.users.find(u=>u.id===profile.id),suffix=profile.username.toUpperCase();const user={...profile,username:(values['BOOKFLIX_USER_'+suffix]||profile.displayName).trim()};
 if(target&&target!==profile.username&&existing)return existing;
 if(action.type==='disable'&&target===profile.username){if(!existing)throw Error('Configura prima gli utenti.');changed++;return {...existing,...user,disabled:true,sessionVersion:randomBytes(16).toString('base64url')};}
 const password=values['BOOKFLIX_PASSWORD_'+suffix];if(!password){if(existing&&!target)return {...existing,...user};throw Error('Compila BOOKFLIX_PASSWORD_'+suffix+' nel file .env.');}if(password.length<12||password.length>512)throw Error('La password per '+profile.displayName+' deve avere da 12 a 512 caratteri.');
 if(existing&&action.type!=='reset'&&derive(password,existing.salt)===existing.passwordHash)return {...existing,...user};
 const salt=randomBytes(16).toString('base64url');changed++;return {...user,algorithm:'pbkdf2-sha256-v1',iterations:100000,salt,passwordHash:derive(password,salt),sessionVersion:randomBytes(16).toString('base64url'),disabled:false};});
 return {secrets:{AUTH_USERS_JSON:JSON.stringify({version:1,users}),AUTH_SESSION_SECRET:previous?.AUTH_SESSION_SECRET||randomBytes(32).toString('base64url')},changed};
}
