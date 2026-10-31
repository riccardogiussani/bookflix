import {useEffect,useState} from 'react';
import {registerBookflix} from './pwa';
type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
export function PWAControls(){
 const [prompt,setPrompt]=useState<InstallPrompt|null>(null),[update,setUpdate]=useState<(()=>void)|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{const install=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt);};const installed=()=>setPrompt(null);window.addEventListener('beforeinstallprompt',install);window.addEventListener('appinstalled',installed);const cleanup=import.meta.env.PROD?registerBookflix(activate=>setUpdate(()=>activate)):()=>{};return()=>{cleanup();window.removeEventListener('beforeinstallprompt',install);window.removeEventListener('appinstalled',installed);};},[]);
 async function install(){if(!prompt||busy)return;setBusy(true);try{await prompt.prompt();await prompt.userChoice;}catch{/* Installation is also available from the browser menu. */}finally{setPrompt(null);setBusy(false);}}
 if(!prompt&&!update)return null;
 return <aside className="pwa-controls" aria-label="App Bookflix">{update?<><p>È disponibile una nuova versione di Bookflix.<small>Salva eventuali modifiche prima di aggiornare.</small></p><button type="button" className="primary" onClick={update}>Aggiorna Bookflix</button><button type="button" aria-label="Rimanda aggiornamento" onClick={()=>setUpdate(null)}>Più tardi</button></>:<button type="button" className="primary" disabled={busy} onClick={()=>void install()}>↓ Installa Bookflix</button>}</aside>;
}
