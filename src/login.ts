import {WORKER_URL,AccessDeniedError} from './isbn';
import {storeAccessCode,forgetAccessCode,type SavedLogin} from './access';
export async function checkAccess(password:string,signal:AbortSignal){
 const code=password.trim();
 if(!/^[\x21-\x7E]{1,512}$/.test(code))throw Error('Inserisci la password del servizio, senza spazi.');
 let response:Response;
 try{response=await fetch(`${WORKER_URL}/auth/check`,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),headers:{Authorization:`Bearer ${code}`},credentials:'omit',cache:'no-store'});}
 catch{if(signal.aborted)throw signal.reason;throw Error('Servizio non raggiungibile. Controlla la connessione e riprova.');}
 if(response.status===401)throw new AccessDeniedError('Password non corretta. Riprova.');
 if(response.status===404)throw Error('Il servizio deve essere aggiornato alla versione con login.');
 if(response.status===429)throw Error('Troppi tentativi. Attendi un minuto e riprova.');
 if(response.status===503)throw Error('La password non è ancora configurata sul servizio.');
 if(!response.ok)throw Error('Verifica dell’accesso non disponibile. Riprova tra poco.');
 const result=await response.json().catch(()=>null);
 if(result?.authenticated!==true)throw Error('Il servizio non ha confermato l’accesso.');
 return code;
}

export async function verifyLogin(saved:SavedLogin,signal:AbortSignal){
 let accessCode:string;try{accessCode=await checkAccess(saved.accessCode,signal);}catch(e){if(e instanceof AccessDeniedError&&!signal.aborted)forgetAccessCode();throw e;}signal.throwIfAborted();
 // A blocked browser store must not prevent a verified in-memory session.
 try{storeAccessCode(accessCode,saved.remember,saved.username);}catch{}
 return {username:saved.username.trim()||'Lettore',accessCode};
}
