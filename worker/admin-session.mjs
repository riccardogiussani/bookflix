import {SignJWT,jwtVerify} from 'jose';
import {StoreError} from './firestore.mjs';

const encoder=new TextEncoder();
const issuer='bookflix-admin';
const audience='bookflix-catalog';
const duration=30*60;

function configuredToken(env){
 if(typeof env.ADMIN_TOKEN!=='string'||env.ADMIN_TOKEN.length<32||env.ADMIN_TOKEN.length>1024)throw new StoreError('Configura ADMIN_TOKEN nel Worker con un token da 32 a 1024 caratteri.',503);
 return env.ADMIN_TOKEN;
}

async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
const sessionKey=secret=>digest('bookflix-admin-session\0'+secret);

export async function createAdminSession(env,userId,token){
 const expected=configuredToken(env);
 if(typeof token!=='string'||token.length>1024)throw new StoreError('Token amministratore non valido.',403);
 const [provided,stored]=await Promise.all([digest(token),digest(expected)]);
 let difference=0;
 for(let index=0;index<stored.length;index++)difference|=stored[index]^provided[index];
 if(difference)throw new StoreError('Token amministratore non valido.',403);
 const now=Math.floor(Date.now()/1000),expiresAt=now+duration;
 const session=await new SignJWT({}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer(issuer).setAudience(audience)
  .setSubject(userId).setIssuedAt(now).setExpirationTime(expiresAt).sign(await sessionKey(expected));
 return {session,expiresAt:new Date(expiresAt*1000).toISOString()};
}

export async function requireAdminSession(env,userId,session){
 const secret=configuredToken(env);
 if(!session||session.length>2048)throw new StoreError('Accesso amministratore richiesto.',403);
 try{
  await jwtVerify(session,await sessionKey(secret),{algorithms:['HS256'],issuer,audience,subject:userId,requiredClaims:['exp','iat']});
 }catch{throw new StoreError('Sessione amministratore non valida o scaduta.',403);}
}
