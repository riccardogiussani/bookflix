> **Autenticazione attuale:** Firebase, Worker 0.11.0 con registrazione autonoma e reset. Segui [FIREBASE.md](../FIREBASE.md). Le istruzioni di login con hash nei secret riportate sotto sono storiche e non vanno usate per il nuovo accesso.

# Utenti personali Bookflix — Worker 0.9.0

Utenti predisposti: **Riccardo, Corrado, Alessandra, Sara, Giulia, Dario, Alessia**. Gli username precompilati sono i nomi con iniziale maiuscola; il login ignora le maiuscole nello username, mentre la password è esatta. Non ci sono registrazione, email, recupero password o un nuovo database utenti.

Le password le scegli e le inserisci tu. L’agente non ha generato password utente, non ha eseguito il caricamento dei secret e non ha pubblicato il Worker.

## 1. Compila il .env

Nella cartella del repository `C:\Users\ricca\Repo\web-apps\bookflix` trovi **`.env`**, con i sette username già precompilati e le password vuote. Se il file esisteva già, non è stato sovrascritto: i campi da aggiungere sono in `.env.example`.

Per ogni persona compila il relativo campo `BOOKFLIX_PASSWORD_...`. Le password devono avere da 12 a 512 caratteri. Racchiudile tra virgolette se contengono `#` o spazi. Esempio di sola struttura, da completare con un valore tuo:

```dotenv
BOOKFLIX_USER_RICCARDO=Riccardo
BOOKFLIX_PASSWORD_RICCARDO=""
```

Gli stessi campi sono presenti per CORRADO, ALESSANDRA, SARA, GIULIA, DARIO e ALESSIA. I valori non hanno il prefisso `VITE_`: non entrano nel sito pubblico. `.env` è escluso da Git. `.env.example` contiene solo i campi vuoti e può essere pubblicato.

## 2. Prepara gli hash

Da PowerShell, nella radice del repository, con Node.js 22 o successivo:

```powershell
node .\scripts\configure-users.mjs
```

Il comando legge il tuo `.env`, calcola hash PBKDF2-SHA256 con salt individuale e 100.000 iterazioni, genera la chiave per firmare le sessioni e prepara **`.bookflix-secrets.local.json`**. Non stampa password, hash o chiavi. Non chiede valori nel terminale e non si collega a Cloudflare.

Il JSON contiene solo gli hash delle password, i profili e la chiave di firma. Il `.env` contiene le password in chiaro perché è il file locale che hai scelto di compilare: conservalo privatamente o rimuovilo dopo aver conservato le password nel tuo gestore. Per un reset futuro puoi ricrearlo da `.env.example` e compilare solo il campo interessato se possiedi ancora il JSON degli hash.

I file `.bookflix-*.local.*` sono esclusi da Git. Se la configurazione degli hash esiste già, lo script la conserva e aggiorna solo le password effettivamente cambiate; salva prima una copia `.bookflix-secrets-backup.local.json`. I campi password vuoti, dopo la prima configurazione, mantengono la password esistente. Lo script non va eseguito dall’agente dopo che hai inserito le credenziali.

## 3. Carica i secret e pubblica il Worker

Esegui personalmente:

```powershell
npx wrangler secret bulk .\.bookflix-secrets.local.json --config .\worker\wrangler.jsonc
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Il caricamento imposta `AUTH_USERS_JSON` e `AUTH_SESSION_SECRET`. I secret Koofr esistenti (`KOOFR_USERNAME`, `KOOFR_PASSWORD`) restano invariati. `ACCESS_CODE` non viene più accettato dalla nuova versione: può restare configurato senza effetto oppure essere rimosso in seguito.

Apri https://bookflix-scraper.riciriccio.workers.dev/health e verifica `version: "0.9.0"`, `authentication.mode: "users"` e `authentication.configured: true`. È un controllo della presenza delle impostazioni, non una verifica di ogni password.

## 4. Aggiorna Pages

Fai commit e push delle modifiche dell’app e del Worker, inclusi `scripts/`, `worker/auth.mjs`, `worker/review-policy.mjs`, `worker/users.mjs`, i test e `.env.example`. **Non aggiungere `.env` o i JSON locali dei secret.**

Attendi il workflow Pages. La nuova app e il nuovo Worker vanno aggiornati insieme: la vecchia password condivisa non è più utilizzabile. Al primo accesso ciascuno deve inserire il suo username e la sua password personale; le vecchie credenziali condivise ricordate dal browser vengono scartate.

## Sessioni e recensioni

- Con Resta connesso la sessione dura fino a 30 giorni e viene conservata sul dispositivo. Senza la spunta dura fino a 12 ore ed è conservata nella sessione del browser. La verifica al refresh è automatica e richiede Internet. Il browser conserva un token, non la password.
- Esci rimuove il token da quel browser. Per revocare tutte le sessioni di una persona basta reimpostarne la password o disabilitarla come descritto sotto. La revoca è verificata a ogni richiesta protetta, senza aspettare la scadenza.
- Il Worker determina l’identità dall’ID firmato nella sessione. Non si fida del nome o dell’ID inviati dal browser per attribuire una recensione. I comandi di modifica si basano sull’ID, quindi un cambio nome non trasferisce le recensioni a un altro utente.
- Gli autori delle recensioni precedenti sono collegati a un ID solo quando il nome corrisponde univocamente a uno degli utenti configurati. Questo conserva l’attribuzione storica per nome, senza poter verificare retroattivamente chi l’aveva scritto. Gli autori sconosciuti restano visibili, senza comandi di modifica.
- Ogni utente può aggiungere e modificare i metadati dei libri. Le recensioni altrui non possono essere alterate, spostate o rimosse neppure inviando l’intero catalogo. **Eliminare un libro o importare un backup che rimuove recensioni altrui viene quindi rifiutato.** Un backup che ripristina recensioni altrui non già presenti viene rifiutato: il file aperto non è una prova di attribuzione. I backup restano esportabili e quelli che conservano le recensioni altrui esistenti restano importabili.
- I controlli delle scritture leggono la versione corrente di Koofr e verificano nuovamente If-Match al salvataggio: un conflitto non deve sovrascrivere i commenti di un altro dispositivo.

## Cambiare password o disabilitare un utente

Modifica la password interessata nel tuo `.env`, poi esegui di nuovo preparazione e caricamento:

```powershell
node .\scripts\configure-users.mjs
npx wrangler secret bulk .\.bookflix-secrets.local.json --config .\worker\wrangler.jsonc
```

La modifica della password cambia anche la versione della sessione di quell’utente, revocando i suoi token precedenti. Gli altri utenti restano connessi. Per revocare le sessioni mantenendo la stessa password:

```powershell
node .\scripts\configure-users.mjs --reset riccardo
npx wrangler secret bulk .\.bookflix-secrets.local.json --config .\worker\wrangler.jsonc
```

Per disabilitare un utente:

```powershell
node .\scripts\configure-users.mjs --disable corrado
npx wrangler secret bulk .\.bookflix-secrets.local.json --config .\worker\wrangler.jsonc
```

Per riabilitarlo usa `--reset corrado` con il suo campo password compilato. I nomi passati alle opzioni sono le etichette iniziali dei sette utenti. Non modificare gli ID in `worker/users.mjs` o nel JSON degli hash: sono il collegamento stabile alle recensioni.

## Verifiche da fare tu

1. Accedi con Riccardo e la sua password; prova una password di Sara con Riccardo e uno username inventato: devono essere rifiutati.
2. Con Resta connesso, aggiorna la pagina e riapri il browser: l’accesso deve essere ripristinato senza reinserire la password. Esci deve tornare al login.
3. Pubblica una recensione come Riccardo. Da un secondo browser accedi come Sara: puoi leggerla e aggiungerne una tua, ma non modificarla o eliminarla.
4. Aggiorna la raccolta nell’altro browser. Verifica che i commenti mantengano il loro autore e che una modifica ai dati del libro non li cancelli.
5. Reimposta una password con lo script e ricarica l’app del relativo utente: la sessione precedente deve essere rifiutata.

I test automatici usano password di prova e un servizio WebDAV simulato; nessuna tua credenziale è stata letta o usata. Le prove sul Worker distribuito e sul tuo Koofr restano da fare dopo il tuo deploy.

Riferimenti: https://developers.cloudflare.com/workers/configuration/secrets/ e https://developers.cloudflare.com/workers/runtime-apis/web-crypto/

Per cambiare le maiuscole o il nome dello username modifica `BOOKFLIX_USER_...` nel `.env`, riesegui `node scripts/configure-users.mjs` e ricarica il JSON con `wrangler secret bulk`. Non serve ripubblicare il codice del Worker per il solo aggiornamento dei secret. Gli ID non cambiano e le recensioni restano attribuite allo stesso utente. Il nome visualizzato resta quello del profilo (es. Riccardo), indipendente dalla grafia dello username.

## Valutazioni personali — 0.9.0

Non servono nuovi secret: pubblica il codice aggiornato con `npx wrangler deploy --config .\worker\wrangler.jsonc`, verifica 0.9.0 su health e aggiorna Pages con commit e push. Un voto per utente/libro, da 1 a 5; autore e date sono controllati dal Worker. L’app mostra media e numero dei votanti nel dettaglio e sulle copertine. I vecchi voti condivisi vengono eliminati senza migrazione a utenti. Anche la cancellazione di un libro o il ripristino di un backup non possono eliminare voti altrui.
