const encoder=new TextEncoder();
const HEADER='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const normalizedName=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('it');
export class AuthError extends Error{constructor(message,status=401){super(message);this.status=status;}}
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
let cached;
export function authConfig(env){
 if(cached&&cached.raw===env.AUTH_USERS_JSON&&cached.secret===env.AUTH_SESSION_SECRET)return cached;
 try{const data=JSON.parse(env.AUTH_USERS_JSON);if(data.version!==1||!Array.isArray(data.users)||!data.users.length||data.users.length>100||typeof env.AUTH_SESSION_SECRET!=='string'||env.AUTH_SESSION_SECRET.length<32)throw Error();
 const ids=new Set(),names=new Set();for(const u of data.users){if(!UUID.test(u.id)||typeof u.username!=='string'||!u.username.trim()||u.username.length>80||typeof u.displayName!=='string'||!u.displayName.trim()||u.displayName.length>80||u.algorithm!=='pbkdf2-sha256-v1'||u.iterations!==100000||!/^[-_A-Za-z0-9]{22}$/.test(u.salt)||!/^[-_A-Za-z0-9]{43}$/.test(u.passwordHash)||typeof u.sessionVersion!=='string'||!u.sessionVersion||u.sessionVersion.length>80||ids.has(u.id)||names.has(normalizedName(u.username)))throw Error();ids.add(u.id);names.add(normalizedName(u.username));}
 return cached={raw:env.AUTH_USERS_JSON,secret:env.AUTH_SESSION_SECRET,users:data.users};
 }catch{throw new AuthError('Gli utenti non sono ancora configurati correttamente sul servizio.',503);}
}
const publicUser=u=>({id:u.id,username:u.username,displayName:u.displayName});
async function key(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return encode(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:decode(salt),iterations:100000},key,256)));}
async function bodyJSON(request){if(Number(request.headers.get('Content-Length'))>2048)throw new AuthError('Richiesta di accesso troppo grande.',413);const reader=request.body?.getReader();let text='',size=0;const decoder=new TextDecoder();try{if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048)throw new AuthError('Richiesta di accesso troppo grande.',413);text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader?.cancel().catch(()=>{});}try{return JSON.parse(text);}catch{throw new AuthError('Richiesta di accesso non valida.',400);}}
export async function login(request,env){
 const config=authConfig(env),data=await bodyJSON(request);if(!data||typeof data!=='object')throw new AuthError('Richiesta di accesso non valida.',400);if(typeof data.username!=='string'||data.username.length>80||typeof data.password!=='string'||data.password.length>512)throw new AuthError('Username o password non corretti.');
 const user=config.users.find(u=>normalizedName(u.username)===normalizedName(data.username));const salt=user?.salt||'AAAAAAAAAAAAAAAAAAAAAA';const actual=await passwordHash(data.password,salt),expected=user?.passwordHash||'A'.repeat(43);let diff=0;for(let i=0;i<43;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
 if(!user||user.disabled===true||diff||data.password.length<12)throw new AuthError('Username o password non corretti.');
 const now=Math.floor(Date.now()/1000),exp=now+(data.remember===true?30*86400:12*3600);const payload={v:1,sub:user.id,ver:user.sessionVersion,iat:now,exp};const message=HEADER+'.'+encode(encoder.encode(JSON.stringify(payload)));const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(config.secret),encoder.encode(message))));
 return {authenticated:true,user:publicUser(user),accessToken:message+'.'+signature,expiresAt:new Date(exp*1000).toISOString()};
}
export async function authenticate(request,env){
 const config=authConfig(env);const authorization=request.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer ')||authorization.length>2048)throw new AuthError('Sessione scaduta o non valida. Accedi di nuovo.');
 try{const [header,payload,signature,...rest]=authorization.slice(7).split('.');if(header!==HEADER||rest.length||!payload||!signature)throw Error();if(!await crypto.subtle.verify('HMAC',await key(config.secret),decode(signature),encoder.encode(header+'.'+payload)))throw Error();
 const data=JSON.parse(new TextDecoder().decode(decode(payload))),now=Math.floor(Date.now()/1000);if(data.v!==1||!Number.isInteger(data.iat)||!Number.isInteger(data.exp)||data.iat>now+30||data.exp<=now||data.exp<=data.iat||data.exp-data.iat>30*86400)throw Error();const user=config.users.find(u=>u.id===data.sub);if(!user||user.disabled===true||data.ver!==user.sessionVersion)throw Error();return {user:publicUser(user),users:config.users,expiresAt:new Date(data.exp*1000).toISOString()};
 }catch{throw new AuthError('Sessione scaduta o non valida. Accedi di nuovo.');}
}
