import {it,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {prepareFirestore} from './firestore-setup.mjs';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});
const service={type:'service_account',project_id:'bookflix-test',client_email:'worker@bookflix-test.iam.gserviceaccount.com',private_key:privateKey};
it('prepara soltanto il secret privato del Worker e conserva i newline PEM',()=>{const result=prepareFirestore(service,'bookflix-test');expect(Object.keys(result)).toEqual(['GOOGLE_SERVICE_ACCOUNT_JSON']);expect(JSON.parse(result.GOOGLE_SERVICE_ACCOUNT_JSON).private_key).toBe(privateKey);});
it('rifiuta un progetto diverso e chiavi malformate senza esporne il contenuto',()=>{expect(()=>prepareFirestore(service,'another-project')).toThrow('del tuo progetto');expect(()=>prepareFirestore({...service,private_key:'private-value-do-not-print'},'bookflix-test')).toThrow('non è valida');try{prepareFirestore({...service,private_key:'private-value-do-not-print'},'bookflix-test');}catch(e){expect(e.message).not.toContain('private-value');}});
