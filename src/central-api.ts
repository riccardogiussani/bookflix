import {currentAccessToken} from './firebaseClient';
import {WORKER_URL,AccessDeniedError} from './isbn';
export class CloudConflict extends Error {}
export class CloudError extends Error {constructor(message:string,public status:number){super(message);}}
export async function centralApi(path:string,code:string,options:RequestInit={}){const token=await currentAccessToken(code);let response:Response;try{response=await fetch(WORKER_URL+path,{...options,cache:'no-store',signal:options.signal||AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,...options.headers}});}catch(e){if(options.signal?.aborted)throw e;throw new CloudError('Connessione non riuscita. Il modulo conserva le modifiche: riprova quando sei online.',0);}if(!response.ok){const data=await response.json().catch(()=>({})),message=data.error||'Servizio non disponibile.';if(response.status===401)throw new AccessDeniedError(message);if(response.status===409)throw new CloudConflict(message);throw new CloudError(message,response.status);}return response;}
export async function jsonApi(path:string,code:string,body?:unknown,signal?:AbortSignal){return (await centralApi(path,code,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal})).json();}
export async function hashBlob(blob:Blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export type CloudCover={path:string;hash:string;type:string};
export async function readCatalogueCover(path:string,id:string,image:Pick<CloudCover,'hash'>,code:string,signal:AbortSignal){
 const cover=await (await centralApi(path+'/catalogue-cover/'+id,code,{signal})).blob();
 if(cover.size>10*1024*1024||await hashBlob(cover)!==image.hash)throw Error('Copertina non valida.');
 return cover;
}
export async function uploadImage(libraryId:string,blob:Blob,code:string):Promise<CloudCover>{const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[blob.type];if(!ext||blob.size===0||blob.size>10*1024*1024)throw Error('Scegli una copertina JPG, PNG o WebP fino a 10 MB.');const hash=await hashBlob(blob);return (await centralApi('/v2/libraries/'+libraryId+'/covers/'+hash+'.'+ext,code,{method:'PUT',headers:{'Content-Type':blob.type},body:blob})).json();}
