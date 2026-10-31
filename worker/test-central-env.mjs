import {generateKeyPair,exportPKCS8,decodeJwt} from 'jose';
import {MemoryStore} from './test-firestore.mjs';
import {testEnv,jwksResponse} from './test-auth.mjs';
import worker from './scraper.mjs';
const {privateKey}=await generateKeyPair('RS256',{extractable:true});
const serviceAccount={type:'service_account',project_id:testEnv.FIREBASE_PROJECT_ID,client_email:'worker@bookflix-test.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey)};
export function harness(){const store=new MemoryStore(),calls=[],files=new Map(),env={...testEnv,GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),KOOFR_USERNAME:'fake-user',KOOFR_PASSWORD:'fake-password'};
 const fetch=async(input,options={})=>{const raw=typeof input==='string'?input:input.url||input.href,url=new URL(raw),headers=new Headers(options.headers);calls.push({url:raw,method:options.method||'GET'});const keys=jwksResponse(input);if(keys)return keys;
 if(url.hostname==='bookflix-scraper.riciriccio.workers.dev')return worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:'https://riccardogiussani.github.io','CF-Connecting-IP':crypto.randomUUID()}}),env);
 if(raw==='https://oauth2.googleapis.com/token'){const assertion=decodeJwt(options.body.get('assertion'));if(assertion.iss!==serviceAccount.client_email||assertion.scope!=='https://www.googleapis.com/auth/datastore')throw Error('Invalid service assertion');return Response.json({access_token:'test-service-token',expires_in:3600});}
 if(url.hostname==='firestore.googleapis.com'){if(headers.get('Authorization')!=='Bearer test-service-token')throw Error('Wrong Firestore authorization');return store.rest(input,options);}
 if(url.hostname==='app.koofr.net'){if(headers.get('Authorization')!=='Basic '+btoa('fake-user:fake-password')||options.redirect!=='manual')throw Error('Wrong Koofr authorization');if(options.method==='MKCOL')return new Response(null,{status:201});const old=files.get(raw);if(options.method==='PUT'){if(old&&headers.get('If-None-Match')==='*')return new Response(null,{status:412});files.set(raw,{bytes:new Uint8Array(await new Response(options.body).arrayBuffer()),type:headers.get('Content-Type')});return new Response(null,{status:201});}return old?new Response(old.bytes.slice(),{headers:{'Content-Type':old.type}}):new Response(null,{status:404});}
 throw Error('Unexpected external request: '+url.hostname);
 };return {store,calls,files,env,fetch,serviceAccount};}
