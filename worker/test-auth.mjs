import {initialUsers} from './users.mjs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
export const testUsers=initialUsers;
export const testEnv={FIREBASE_PROJECT_ID:'bookflix-test',BOOKFLIX_OWNER_UID:initialUsers[0].id};
const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});const jwk={...await exportJWK(publicKey),kid:'firebase-test-key',alg:'RS256',use:'sig'};
export function jwksResponse(input){const url=typeof input==='string'?input:input.url||input.href;if(url==='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=3600'}});return null;}
export const withJWKS=handler=>async(...args)=>jwksResponse(args[0])||handler(...args);
export async function tokenFor(username='riccardo',env=testEnv,overrides={}){const profile=testUsers.find(u=>u.username===username.toLowerCase());const now=Math.floor(Date.now()/1000);return new SignJWT({name:profile?.displayName||username,email:username+'@example.invalid',email_verified:true,auth_time:now,iat:now,exp:now+3600,sub:profile?.id||username,iss:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,aud:env.FIREBASE_PROJECT_ID,...overrides}).setProtectedHeader({alg:'RS256',kid:'firebase-test-key'}).sign(privateKey);}
export const identityFor=(name='Riccardo')=>{const user=testUsers.find(u=>u.username===name.toLowerCase());return {id:user.id,name:user.displayName};};
