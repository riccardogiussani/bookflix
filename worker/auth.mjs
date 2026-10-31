import {createRemoteJWKSet,customFetch,jwtVerify} from 'jose';
export const normalizedName=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('it');
export class AuthError extends Error{constructor(message,status=401){super(message);this.status=status;}}
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),{timeoutDuration:10000,[customFetch]:(...args)=>fetch(...args)});
export function authConfig(env){if(typeof env.FIREBASE_PROJECT_ID!=='string'||!/^[a-z][a-z0-9-]{4,29}$/.test(env.FIREBASE_PROJECT_ID))throw new AuthError('Firebase non è ancora configurato sul servizio.',503);return {projectId:env.FIREBASE_PROJECT_ID};}
export async function login(){throw new AuthError('Usa l’accesso Firebase con email e password nell’app aggiornata.',410);}
export async function authenticate(request,env){
 const {projectId}=authConfig(env),authorization=request.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer ')||authorization.length>8192)throw new AuthError('Sessione scaduta o non valida. Accedi di nuovo.');
 let payload;try{({payload}=await jwtVerify(authorization.slice(7),keys,{algorithms:['RS256'],issuer:'https://securetoken.google.com/'+projectId,audience:projectId,requiredClaims:['sub','iat','exp','auth_time'],clockTolerance:0}));}
 catch(e){if(['ERR_JWKS_TIMEOUT'].includes(e?.code)||e instanceof TypeError)throw new AuthError('Verifica Firebase non disponibile. Riprova tra poco.',503);throw new AuthError('Sessione scaduta o non valida. Accedi di nuovo.');}
 const now=Math.floor(Date.now()/1000);if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>128||!Number.isInteger(payload.iat)||payload.iat>now||!Number.isInteger(payload.auth_time)||payload.auth_time>now||payload.auth_time>payload.iat||!Number.isInteger(payload.exp)||payload.exp<=payload.iat)throw new AuthError('Sessione Firebase non valida. Accedi di nuovo.');
 if(payload.email_verified!==true||typeof payload.email!=='string'||!payload.email.includes('@'))throw new AuthError('Verifica la tua email prima di entrare nella libreria.',403);
 const name=typeof payload.name==='string'?payload.name.trim().slice(0,80):'';const displayName=name||payload.email.split('@')[0].slice(0,80)||'Utente';
 return {user:{id:payload.sub,username:displayName,displayName,email:payload.email},users:[],libraryAccess:typeof env.BOOKFLIX_OWNER_UID==='string'&&env.BOOKFLIX_OWNER_UID!=='__BOOKFLIX_UNASSIGNED__'&&env.BOOKFLIX_OWNER_UID===payload.sub?'owner':'none',expiresAt:new Date(payload.exp*1000).toISOString()};
}
