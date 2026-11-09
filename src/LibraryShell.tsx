import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {CloudConflict, jsonApi} from './central-api';
import {clearLibrary, mayEdit, selectLibrary, type LibraryInfo, type Role} from './libraryContext';
import {AccessDeniedError} from './isbn';
import type {Session} from './LoginGate';
import {AdminCatalog,AdminLogin} from './AdminCatalog';
import type {AdminSession} from './admin-api';

type Friend = {id:string; user:{id:string;name:string}; status:'pending'|'accepted'; incoming:boolean};
type Member = {id:string;name:string;role:Role};
type Membership = {libraryId:string; revision:string; members:Member[]};
type Profile = {name:string;email:string;friendCode:string};
type Section = 'home'|'libraries'|'friends'|'account';
type View = {kind:Section|'create'} | {kind:'read'|'manage';libraryId:string};
const roleNames:Record<Role,string> = {owner:'Owner',editor:'Editor',reviewer:'Reviewer',viewer:'Viewer'};
const sections = [
  ['home','La mia libreria','M3 10l9-7 9 7v10h-6v-7H9v7H3z'],
  ['libraries','Altre librerie','M4 4h4v16H4zM10 4h4v16h-4zM15 5l4-1 4 15-4 1z'],
  ['friends','Amici','M16 21v-2a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM17 3a4 4 0 0 1 0 8m2 3a5 5 0 0 1 3 5v2'],
  ['account','Impostazioni e account','M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
] as const;

function roleOptions() {
  return Object.entries(roleNames).map(([role,label]) => <option key={role} value={role}>{label}</option>);
}

function primaryLibrary(libraries:LibraryInfo[]) {
  if (libraries.some(library=>library.primary!==undefined)) return libraries.find(library=>library.primary);
  // Compatibility with Workers that still return the original library shape.
  return libraries.filter(library=>library.role==='owner').sort((a,b)=>a.id.localeCompare(b.id))[0];
}

function ManagementPage({title, back, backDisabled, children}:{title:string;back?:()=>void;backDisabled?:boolean;children:ReactNode}) {
  return <main className="library-management">
    <div className="management-heading"><div><p className="eyebrow">BOOKFLIX</p><h1>{title}</h1></div>
      {back&&<button type="button" disabled={backDisabled} onClick={back}>← Altre librerie</button>}
    </div>
    <div className="management-grid">{children}</div>
  </main>;
}

export function LibraryShell({session,children}:{session:Session;children:(library:LibraryInfo,onLockChange:(value:boolean)=>void,onBack?:()=>void)=>ReactNode}) {
  const [view,setView] = useState<View>({kind:'home'});
  const [libraries,setLibraries] = useState<LibraryInfo[]>([]);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [adminSession,setAdminSession] = useState<AdminSession|null>(null);
  const [ready,setReady] = useState(false);
  const [locked,setLocked] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [name,setName] = useState('');
  const [rename,setRename] = useState('');
  const [target,setTarget] = useState('');
  const [friends,setFriends] = useState<Friend[]>([]);
  const [friendsReady,setFriendsReady] = useState(false);
  const [membership,setMembership] = useState<Membership|null>(null);
  const [friendAccess,setFriendAccess] = useState<{friendId:string;libraryId:string}|null>(null);
  const working = useRef(false);
  const {userId,accessCode} = session;
  const primary = primaryLibrary(libraries);
  const chosen = 'libraryId' in view ? libraries.find(library => library.id === view.libraryId) : undefined;
  const active = view.kind === 'home' ? primary : view.kind === 'read' ? chosen : undefined;
  const section = view.kind === 'read' || view.kind === 'manage' || view.kind === 'create' ? 'libraries' : view.kind;
  const manageable = libraries.filter(library => mayEdit(library.role));
  const disabled = busy || locked;

  useLayoutEffect(() => {
    if (active) selectLibrary(active,userId);
    else clearLibrary();
    return clearLibrary;
  },[active,userId]);

  async function list(signal?:AbortSignal) {
    const rows:LibraryInfo[] = await jsonApi('/v2/libraries',accessCode,undefined,signal);
    if (!signal?.aborted) setLibraries(rows);
    return rows;
  }

  async function bootstrap(signal?:AbortSignal) {
    const account:Profile = await jsonApi('/v2/profile',accessCode,undefined,signal);
    if (!signal?.aborted) setProfile(account);
    await list(signal);
    if (!signal?.aborted) setReady(true);
  }

  async function run(action:()=>Promise<void>, signal?:AbortSignal) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (failure) {
      if (signal?.aborted) return;
      if (failure instanceof AccessDeniedError) session.onLogout();
      else setError(failure instanceof Error ? failure.message : 'Operazione non riuscita.');
    } finally {
      if (!signal?.aborted) { working.current = false; setBusy(false); }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void run(() => bootstrap(controller.signal),controller.signal);
    return () => { controller.abort(); working.current = false; };
  },[userId]);

  async function loadFriends() {
    const [people,rows]:[Friend[],LibraryInfo[]] = await Promise.all([
      jsonApi('/v2/friends',accessCode), jsonApi('/v2/libraries',accessCode),
    ]);
    setLibraries(rows); setFriends(people); setFriendsReady(true);
    if (friendAccess && !people.some(friend => friend.user.id === friendAccess.friendId && friend.status === 'accepted')) {
      setFriendAccess(null); setMembership(null);
    }
  }

  async function loadMembers(library:LibraryInfo) {
    const snapshot:{members:Member[];revision?:string} = await jsonApi('/v2/libraries/'+library.id+'/members',accessCode);
    setMembership({libraryId:library.id,revision:snapshot.revision ?? library.revision,members:snapshot.members});
  }

  function navigate(next:Section) {
    if (disabled) return;
    setView({kind:next}); setError(''); setMembership(null); setFriendAccess(null);
    if (next === 'friends') void run(loadFriends);
    if (next === 'libraries') void run(async () => { await list(); });
  }

  function backToLibraries() {
    if (disabled) return;
    setView({kind:'libraries'}); setMembership(null); setError('');
  }

  function beginCreate() {
    setName(''); setError(''); setView({kind:'create'});
  }

  function beginManage(library:LibraryInfo) {
    setView({kind:'manage',libraryId:library.id}); setRename(library.name); setMembership(null);
    void run(() => loadMembers(library));
  }

  function openFriendAccess(friend:Friend) {
    if (friendAccess?.friendId === friend.user.id) { setFriendAccess(null); setMembership(null); return; }
    const library = manageable.find(row=>row.id===primary?.id) ?? manageable[0];
    setFriendAccess({friendId:friend.user.id,libraryId:library?.id ?? ''}); setMembership(null);
    if (library) void run(() => loadMembers(library));
  }

  async function changeMember(library:LibraryInfo, memberId:string, role:Role|null) {
    if (membership?.libraryId !== library.id) return;
    try {
      await jsonApi('/v2/libraries/'+library.id+'/members',accessCode,{userId:memberId,role,revision:membership.revision});
    } catch (failure) {
      if (failure instanceof CloudConflict) await loadMembers(library);
      throw failure;
    }
    setMembership(null);
    if (memberId === userId && role === null) {
      setLibraries(previous=>previous.filter(row=>row.id!==library.id));
      setView({kind:'libraries'});
      await list(); return;
    }
    const rows = await list();
    const current = rows.find(row => row.id === library.id);
    if (current) await loadMembers(current);
    else { setMembership(null); setView({kind:'libraries'}); }
  }

  async function saveLibrary(library:LibraryInfo, archived:boolean) {
    if (membership?.libraryId !== library.id) return;
    try {
      await jsonApi('/v2/libraries/'+library.id+'/manage',accessCode,{name:archived?library.name:rename,revision:membership.revision,archived});
    } catch (failure) {
      if (failure instanceof CloudConflict) await loadMembers(library);
      throw failure;
    }
    setMembership(null);
    if (archived) {
      setLibraries(previous=>previous.filter(row=>row.id!==library.id));
      setView({kind:'libraries'});
      await list(); return;
    }
    const rows = await list();
    const current = rows.find(row => row.id === library.id);
    if (current) { setRename(current.name); await loadMembers(current); }
    else { setMembership(null); setView({kind:'libraries'}); }
  }

  const selectedAccess = manageable.find(library => library.id === friendAccess?.libraryId);
  const members = membership?.libraryId === chosen?.id ? membership?.members ?? [] : [];
  const managedReady = !!chosen && membership?.libraryId === chosen.id;
  const canManage = !!chosen && mayEdit(chosen.role);
  let content:ReactNode;

  if (view.kind === 'account') {
    content = <ManagementPage title="Impostazioni e account"><section className="wide"><h2>Il tuo account</h2>
      <dl className="account-details"><div><dt>Nome</dt><dd>{profile?.name || session.username}</dd></div>
        {profile?.email&&<div><dt>Email</dt><dd>{profile.email}</dd></div>}
        {profile?.friendCode&&<div><dt>Codice amico</dt><dd className="friend-code">{profile.friendCode}</dd></div>}
      </dl><button type="button" onClick={session.onLogout}>Esci dall’account</button>
      {!profile&&<button type="button" disabled={busy} onClick={()=>void run(()=>bootstrap())}>Ricarica account</button>}
    </section><AdminLogin accessCode={accessCode} onSession={setAdminSession} onLogout={session.onLogout} disabled={busy}/></ManagementPage>;
  } else if (!ready) {
    content = <main className="library-management"><p role="status">{busy?'Apertura delle tue librerie…':'Librerie da caricare'}</p>
      {!busy&&<button type="button" onClick={()=>void run(()=>bootstrap())}>Riprova</button>}
    </main>;
  } else if (active) {
    content = children(active,setLocked,view.kind === 'read' ? backToLibraries : undefined);
  } else if (view.kind === 'home') {
    content = <ManagementPage title="La mia libreria"><section className="wide"><h2>Il tuo primo scaffale</h2>
      <p>Crea una libreria personale per iniziare a raccogliere i tuoi libri.</p>
      <button type="button" className="primary" disabled={busy} onClick={beginCreate}>Crea la mia libreria</button>
    </section></ManagementPage>;
  } else if (view.kind === 'create') {
    content = <ManagementPage title="Crea nuova libreria" back={backToLibraries} backDisabled={disabled}><section className="wide">
      <p>Ogni libreria ha i propri libri, posizioni, voti e recensioni. I tuoi amici vengono aggiunti come viewer.</p>
      <form onSubmit={event=>{event.preventDefault();void run(async()=>{
        const created:LibraryInfo = await jsonApi('/v2/libraries',accessCode,{name});
        setName(''); setLibraries(previous=>[...previous,created]); setView({kind:'read',libraryId:created.id});
        const rows = await list();
        if (primaryLibrary(rows)?.id===created.id) setView({kind:'home'});
      });}}><label>Nome della libreria<input required maxLength={120} disabled={busy} value={name} onChange={event=>setName(event.target.value)} /></label>
        <button className="primary" disabled={busy}>Crea libreria</button>
      </form>
    </section></ManagementPage>;
  } else if (view.kind === 'manage' && chosen) {
    content = <ManagementPage title={chosen.name} back={backToLibraries} backDisabled={disabled}><section className="wide"><h2>Gestione libreria</h2>
      <p>Owner ed editor gestiscono libri e permessi. I reviewer possono votare e recensire. I viewer possono consultare.</p>
      {!managedReady&&!busy&&<button type="button" onClick={()=>void run(()=>loadMembers(chosen))}>Ricarica permessi</button>}
      {canManage&&<form onSubmit={event=>{event.preventDefault();void run(()=>saveLibrary(chosen,false));}}>
        <label>Nome<input required maxLength={120} value={rename} disabled={busy} onChange={event=>setRename(event.target.value)} /></label>
        <button disabled={busy||!managedReady}>Salva nome</button>
      </form>}
      <ul className="member-list">{members.map(member=><li key={member.id}><span>{member.name}{member.id===userId?' (tu)':''}</span>
        {canManage?<div><select aria-label={'Ruolo di '+member.name} value={member.role} disabled={busy} onChange={event=>void run(()=>changeMember(chosen,member.id,event.target.value as Role))}>{roleOptions()}</select>
          <button type="button" disabled={busy} onClick={()=>{if(window.confirm('Rimuovere '+member.name+' da questa libreria?'))void run(()=>changeMember(chosen,member.id,null));}}>Rimuovi</button>
        </div>:<span>{roleNames[member.role]}</span>}
      </li>)}</ul>
      <div className="archive-actions">
        <button type="button" disabled={busy||!managedReady} onClick={()=>{if(window.confirm('Lasciare questa libreria? Per rientrare servirà un nuovo invito.'))void run(()=>changeMember(chosen,userId,null));}}>Lascia libreria</button>
        {canManage&&<button type="button" className="danger" disabled={busy||!managedReady} onClick={()=>{if(window.confirm('Archiviare questa libreria per tutti i membri?'))void run(()=>saveLibrary(chosen,true));}}>Archivia libreria</button>}
      </div>
    </section></ManagementPage>;
  } else if (view.kind === 'friends') {
    content = <ManagementPage title="Amici"><section className="wide"><h2>I tuoi amici</h2>
      <p>Quando accettate l’amicizia, condividete le vostre librerie come viewer. Puoi cambiare i ruoli nelle librerie che gestisci.</p>
      {profile?.friendCode&&<p>Il tuo codice amico <strong className="friend-code">{profile.friendCode}</strong></p>}
      <form onSubmit={event=>{event.preventDefault();void run(async()=>{await jsonApi('/v2/friends',accessCode,{target});setTarget('');await loadFriends();});}}>
        <label>Email o codice amico<input required maxLength={254} value={target} disabled={busy} onChange={event=>setTarget(event.target.value)} /></label>
        <button disabled={busy}>Invia richiesta</button>
      </form>
      {!friendsReady&&<p role="status">{busy?'Caricamento amici…':'Elenco amici da caricare'}</p>}
      {friendsReady&&!friends.length&&<p>Non hai ancora amici su Bookflix.</p>}
      <button type="button" disabled={busy} onClick={()=>void run(loadFriends)}>Aggiorna amici</button>
      <ul className="member-list">{friends.map(friend=>{
        const expanded = friendAccess?.friendId === friend.user.id;
        const loaded = !!selectedAccess && membership?.libraryId === selectedAccess.id;
        const role = loaded ? membership.members.find(member=>member.id===friend.user.id)?.role ?? '' : '';
        return <li className="friend-row" key={friend.id}><div className="friend-summary"><span>{friend.user.name}<small>{friend.status==='accepted'?'Amico':friend.incoming?'Richiesta ricevuta':'Richiesta inviata'}</small></span>
          <div className="friend-actions">
            {friend.status==='accepted'&&<button type="button" aria-expanded={expanded} disabled={busy} onClick={()=>openFriendAccess(friend)}>Permessi librerie</button>}
            {friend.status==='pending'&&friend.incoming&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{await jsonApi('/v2/friends/'+friend.id,accessCode,{accept:true});await loadFriends();})}>Accetta</button>}
            <button type="button" disabled={busy} onClick={()=>void run(async()=>{await jsonApi('/v2/friends/'+friend.id,accessCode,{accept:false});await loadFriends();})}>{friend.status==='accepted'?'Rimuovi amico':friend.incoming?'Rifiuta':'Annulla richiesta'}</button>
          </div></div>
          {expanded&&<div className="friend-permissions">
            {manageable.length?<><label>Libreria<select value={selectedAccess?.id ?? ''} disabled={busy} onChange={event=>{
              const library = manageable.find(row=>row.id===event.target.value);
              if (!library) return;
              setFriendAccess({friendId:friend.user.id,libraryId:library.id});setMembership(null);void run(()=>loadMembers(library));
            }}><option value="" disabled>Scegli una libreria</option>{manageable.map(library=><option value={library.id} key={library.id}>{library.name}</option>)}</select></label>
            <label>Ruolo<select value={loaded?role:'loading'} disabled={busy||!loaded} onChange={event=>{
              const role = event.target.value as Role|'';
              if (selectedAccess) void run(()=>changeMember(selectedAccess,friend.user.id,role||null));
            }}><option value="loading" disabled>{busy?'Caricamento…':'Da caricare'}</option><option value="">Nessun accesso</option>{roleOptions()}</select></label>
            {!loaded&&selectedAccess&&!busy&&<button type="button" onClick={()=>void run(()=>loadMembers(selectedAccess))}>Ricarica permessi</button>}</>:<p>Puoi assegnare permessi nelle librerie in cui sei owner o editor.</p>}
          </div>}
        </li>;
      })}</ul>
      <small>Se rimuovi un amico, i suoi permessi nelle librerie restano attivi. Puoi revocarli dalla gestione della singola libreria.</small>
    </section></ManagementPage>;
  } else {
    content = <ManagementPage title="Altre librerie"><section className="wide">
      <ul className="library-list">{libraries.map(library=><li key={library.id}>
        <button className="library-entry" type="button" disabled={busy} onClick={()=>{
          setError('');setView(library.id===primary?.id?{kind:'home'}:{kind:'read',libraryId:library.id});
        }}><span>{library.name}<small>{roleNames[library.role]}{library.id===primary?.id?' · Principale':''}</small></span><span aria-hidden="true">›</span></button>
        <button type="button" aria-label={'Gestisci '+library.name} disabled={busy} onClick={()=>beginManage(library)}>Gestisci</button>
      </li>)}<li><button type="button" className="library-entry new-library" disabled={busy} onClick={beginCreate}>＋ Crea nuova libreria</button></li></ul>
    </section></ManagementPage>;
  }

  if(adminSession)return <AdminCatalog accessCode={accessCode} session={adminSession} onLogout={session.onLogout} onExit={message=>{
    setAdminSession(null);setError(message??'');
  }}/>;

  return <div className="app-shell">
    {error&&<p className="error library-error" role="alert">{error}</p>}
    {content}
    <nav className="app-bottom-nav" aria-label="Sezioni Bookflix"><div>
      {sections.map(([key,label,path])=><button type="button" key={key} aria-current={section===key?'page':undefined}
        disabled={disabled||!ready&&key!=='account'} onClick={()=>navigate(key)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path}/></svg><span>{label}</span>
      </button>)}
    </div></nav>
  </div>;
}
