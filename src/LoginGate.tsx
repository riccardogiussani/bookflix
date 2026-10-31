import {useEffect,useRef,useState,type ReactNode,type FormEvent} from 'react';
import {verifyLogin} from './login';
import {AccessDeniedError} from './isbn';
import {readSavedLogin,forgetAccessCode,type SavedLogin} from './access';
type Session={username:string;accessCode:string;onLogout:()=>void};
export function LoginGate({children}:{children:(session:Session)=>ReactNode}){
 const [saved]=useState(readSavedLogin);
 const [username,setUsername]=useState(saved?.username||''),[password,setPassword]=useState(saved?.accessCode||''),[remember,setRemember]=useState(saved?.remember||false),[session,setSession]=useState<{username:string;accessCode:string}|null>(null),[busy,setBusy]=useState(!!saved),[restoring,setRestoring]=useState(!!saved),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 async function authenticate(login:SavedLogin,controller:AbortController){
  try{const verified=await verifyLogin(login,controller.signal);if(!controller.signal.aborted)setSession(verified);}
  catch(e){if(!controller.signal.aborted){if(e instanceof AccessDeniedError){forgetAccessCode();setPassword('');setRemember(false);}setError(e instanceof Error?e.message:'Accesso non riuscito.');}}
  finally{if(pending.current===controller){pending.current=null;setBusy(false);setRestoring(false);}}
 }
 useEffect(()=>{
  if(saved){const controller=new AbortController();pending.current=controller;void authenticate(saved,controller);}
  return()=>{pending.current?.abort();pending.current=null;};
 },[]);
 function logout(){pending.current?.abort();pending.current=null;forgetAccessCode();setSession(null);setUsername('');setPassword('');setRemember(false);setBusy(false);setRestoring(false);setError('');}
 async function login(event:FormEvent){event.preventDefault();if(busy)return;setError('');setBusy(true);const controller=new AbortController();pending.current=controller;await authenticate({username:username.trim(),accessCode:password,remember},controller);}
 if(session)return children({...session,onLogout:logout});
 if(restoring)return <main className="login-page"><a className="brand" href="#">scaffale<span>●</span></a><section className="login-card" role="status" aria-live="polite"><h2>Ripristino dell’accesso…</h2><p>Verifico la sessione salvata.</p></section></main>;
 return <main className="login-page"><a className="brand" href="#">scaffale<span>●</span></a><section className="login-layout"><div className="login-intro"><p className="eyebrow">LA TUA BIBLIOTECA PERSONALE</p><h1>Le tue storie.<br/><em>Il tuo spazio.</em></h1><p className="lede">Ritrova i libri che ami<br/>e quelli che ti aspettano.</p></div><form className="login-card" onSubmit={login} aria-labelledby="login-title"><p className="eyebrow">BENTORNATO</p><h2 id="login-title">Entra nella tua libreria.</h2><label>Username<input required autoComplete="username" maxLength={80} value={username} onChange={e=>setUsername(e.target.value)} disabled={busy} placeholder="Come ti chiami?"/></label><small>Scegli il nome che preferisci.</small><label>Password<input required type="password" autoComplete="current-password" maxLength={512} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label><label className="remember-code"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} disabled={busy}/>Resta connesso su questo dispositivo</label>{error&&<p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy||!username.trim()}>{busy?'Verifica in corso…':'Accedi'}</button><p className="login-footnote">La password viene verificata online. Lo username è un nome locale: tutti i nomi aprono la stessa raccolta su Koofr.</p></form></section></main>;
}
