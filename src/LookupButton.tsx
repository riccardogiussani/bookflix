export function LookupButton({busy,disabled,label,busyLabel,onClick}:{
  busy:boolean; disabled:boolean; label:string; busyLabel:string; onClick:()=>void;
}) {
  return <button type="button" className={`isbn-refresh${busy?' is-loading':''}`} disabled={busy||disabled}
    onClick={onClick} aria-label={busy?busyLabel:label} title={label} aria-busy={busy}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"/>
    </svg>
  </button>;
}
