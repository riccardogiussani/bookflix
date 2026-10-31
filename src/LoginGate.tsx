import {useEffect,useRef,useState,type ReactNode,type FormEvent} from 'react';
import {checkAccess} from './login';
import {readAccessCode,rememberedAccess,storeAccessCode,forgetAccessCode} from './access';
type Session={username:string;accessCode:string;onLogout:()=>void};
export function LoginGate({children}:{children:(session:Session)=>ReactNode}){
 const [username,setUsername]=useState(''),[password,setPassword]=useState(readAccessCode),[remember,setRemember]=useState(rememberedAccess),[session,setSession]=useState<{username:string;accessCode:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>pending.current?.abort(),[]);
 function logout(){pending.current?.abort();forgetAccessCode();setSession(null);setPassword('');setRemember(false);setError('');}
 async function login(event:FormEvent){event.preventDefault();if(busy)return;setError('');setBusy(true);const controller=new AbortController();pending.current=controller;
 try{const code=await checkAccess(password,controller.signal);if(controller.signal.aborted)return;
  // Storage may be unavailable: the verified in-memory session remains usable.
  try{storeAccessCode(code,remember);}catch{}
  setSession({username:username.trim(),accessCode:code});
 }catch(e){if(!controller.signal.aborted){forgetAccessCode();setError(e instanceof Error?e.message:'Accesso non riuscito.');}}
 finally{if(pending.current===controller){setBusy(false);pending.current=null;}}}
 if(session)return children({...session,onLogout:logout});
 return <main className="login-page"><a className="brand" href="#">scaffale<span>●</span></a><section className="login-layout"><div className="login-intro"><p className="eyebrow">LA TUA BIBLIOTECA PERSONALE</p><h1>Le tue storie.<br/><em>Il tuo spazio.</em></h1><p className="lede">Ritrova i libri che ami<br/>e quelli che ti aspettano.</p></div><form className="login-card" onSubmit={login} aria-labelledby="login-title"><p className="eyebrow">BENTORNATO</p><h2 id="login-title">Entra nella tua libreria.</h2><label>Username<input required autoComplete="username" maxLength={80} value={username} onChange={e=>setUsername(e.target.value)} disabled={busy} placeholder="Come ti chiami?"/></label><small>Scegli il nome che preferisci.</small><label>Password<input required type="password" autoComplete="current-password" maxLength={512} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label><label className="remember-code"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} disabled={busy}/>Ricorda la password su questo dispositivo</label>{error&&<p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy||!username.trim()}>{busy?'Verifica in corso…':'Accedi'}</button><p className="login-footnote">La password viene verificata online. Lo username è un nome locale: tutti i nomi aprono la stessa raccolta su Koofr.</p></form></section></main>;
}
