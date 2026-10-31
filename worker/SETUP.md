# Worker Bookflix 0.8.0 — utenti personali e Koofr

Per configurare i sette utenti e le loro password segui **[USERS.md](USERS.md)**. Il `.env` precompilato è nella radice del repository; le password vengono scelte dall’utente. Lo script locale prepara hash e chiave di sessione senza pubblicare nulla. Secret e deploy vengono gestiti personalmente dall’utente.

Il sito resta su GitHub Pages. Il Worker protegge metadati e libreria con sessioni firmate, autentica username e password personali e verifica la proprietà delle recensioni sul server. La vecchia password condivisa `ACCESS_CODE` non viene più accettata.

Per collegare Koofr da zero segui anche **[KOOFR.md](KOOFR.md)**: i secret `KOOFR_USERNAME` e `KOOFR_PASSWORD` restano invariati se già configurati. Per le fonti metadati consulta **[SOURCES.md](SOURCES.md)**.

## Deploy

Dalla radice del repository, dopo aver preparato e caricato i secret come nella guida utenti:

```powershell
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Non usare il deploy automatico Vite senza `--config`. Il Worker importa i moduli locali: pubblicalo con Wrangler, non copiando solo `scraper.mjs` nel dashboard.

Poi fai commit e push dell’app per aggiornare Pages. L’agente non imposta password o secret e non esegue il deploy.

## Prove locali opzionali

Per il Worker locale le impostazioni possono essere in `worker/.dev.vars`, escluso da Git. Non copiarle nei file pubblici. Per usare il servizio online da Vite, aggiungi l’origine locale a `ALLOWED_ORIGINS` nel file di configurazione del Worker, per esempio `https://riccardogiussani.github.io,http://localhost:5173`, e ripubblica.

Le origini CORS non sostituiscono l’autenticazione: anche richieste senza Origin richiedono una sessione valida. Il limite dei tentativi è best effort per istanza, non una quota globale distribuita. Il token ha durata limitata e la versione della sessione viene controllata a ogni richiesta: reimpostare una password o disabilitare una persona revoca i suoi token.

## Errori comuni

- **401:** sessione scaduta o revocata, oppure username/password errati. Accedi di nuovo.
- **403 al salvataggio:** la richiesta modifica o cancella recensioni altrui. Conserva quei commenti.
- **409:** catalogo aggiornato da un altro dispositivo; aggiorna la raccolta e riprova.
- **429:** attendi un minuto prima di riprovare.
- **503 al login:** mancano `AUTH_USERS_JSON` e/o `AUTH_SESSION_SECRET`, oppure la configurazione non è valida.
- **Errore Koofr:** verifica i due secret WebDAV e la guida Koofr.
- **Origine non autorizzata:** inserisci il dominio senza il percorso `/bookflix/` in `ALLOWED_ORIGINS`.
