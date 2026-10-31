import {initialUsers} from './users.mjs';
import {passwordHash,login} from './auth.mjs';
export const testPasswords=Object.fromEntries(initialUsers.map((u,i)=>[u.username,'bf_'+String.fromCharCode(65+i).repeat(32)]));
export const testUsers=await Promise.all(initialUsers.map(async u=>({...u,algorithm:'pbkdf2-sha256-v1',iterations:100000,salt:'A'.repeat(22),passwordHash:await passwordHash(testPasswords[u.username],'A'.repeat(22)),sessionVersion:'test-v1',disabled:false})));
export const testEnv={AUTH_USERS_JSON:JSON.stringify({version:1,users:testUsers}),AUTH_SESSION_SECRET:'test-signing-key-only-not-real-'.repeat(2)};
export async function tokenFor(username='riccardo',env=testEnv,remember=true){return (await login(new Request('https://worker.test/auth/login',{method:'POST',body:JSON.stringify({username,password:testPasswords[username],remember})}),env)).accessToken;}
export const identityFor=(name='Riccardo')=>{const user=testUsers.find(u=>u.username===name.toLowerCase());return {id:user.id,name:user.displayName};};
