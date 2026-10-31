# Bookflix: nuovi account Firebase — Worker 0.12.0

La procedura di importazione dei sette utenti è stata annullata. Si riparte con **Crea account** (nome, email e password) oppure **Continua con Google**. I libri e le copertine della raccolta precedente restano; vecchie recensioni e valutazioni vengono eliminate, come confermato.

L’agente prepara il codice. Configurazione del progetto, eventuale cancellazione degli account Firebase, caricamento dei secret e deploy vengono eseguiti personalmente dall’utente.

## 1. Imposta Firebase

Nel progetto che hai già creato:

1. In Authentication abilita **Email/Password**.
2. Abilita anche **Google** fra i provider. Compila nome pubblico del progetto ed email di assistenza richiesti dalla console.
3. Fra i domini autorizzati aggiungi `riccardogiussani.github.io` e, per sviluppo locale, `localhost`. Lascia il dominio Firebase predefinito.
4. Dall’app Web registrata copia `apiKey`, `authDomain`, `projectId` e `appId`.
5. Se vuoi far rispettare anche dal servizio la lunghezza minima, configura una password policy di almeno 12 caratteri. L’interfaccia Bookflix richiede già 12 caratteri per registrarsi.

Il sito resta su GitHub Pages. Per il login non serve Firebase Hosting. Per dati, librerie e ruoli completa anche [FIRESTORE.md](FIRESTORE.md), inclusa la credenziale dedicata al Worker. Mantieni Spark gratuito.

Se **Authentication → Users è vuota**, non devi cancellare nulla. Se avevi già importato i vecchi account, elimina quelli prima di creare il tuo nuovo account. Non eliminare il progetto Firebase. **Non eseguire più `auth:import` e non usare il vecchio `.bookflix-firebase-users.local.json`.**

## 2. Configurazione locale

Nel `.env` servono soltanto:

```dotenv
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
BOOKFLIX_OWNER_UID=
```

I quattro valori Firebase sono quelli pubblici dell’app Web. Per il primo avvio lascia `BOOKFLIX_OWNER_UID` vuoto. I campi precedenti con nomi, email e password dei sette utenti non sono più usati: puoi rimuoverli personalmente dal `.env`.

Non è stata letta né sovrascritta la tua configurazione precedente. È stato aggiunto il campo vuoto del proprietario. `.env.example` contiene la nuova struttura senza elenchi utenti.

Dalla radice del repository:

```powershell
node .\scripts\prepare-firebase.mjs
```

Lo script prepara:

- `public/firebase-config.json`: configurazione Web pubblica, da includere nel commit.
- `.bookflix-firebase-worker.local.json`: progetto e proprietario configurati per il Worker, escluso da Git.

Non importa utenti, non genera password, non legge i vecchi file degli hash e non si collega a Firebase o Cloudflare.

## 3. Pubblica e registra il tuo nuovo account

```powershell
npx wrangler secret bulk .\.bookflix-firebase-worker.local.json --config .\worker\wrangler.jsonc
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Poi fai commit e push dell’app, includendo `public/firebase-config.json`, i nuovi moduli, i test e il file di lock delle dipendenze. Non includere `.env` o i file `.bookflix-*.local.*`. Non servono variabili GitHub Actions.

Il health check deve mostrare `version: "0.12.0"` e `authentication.mode: "firebase"`.

Apri l’app aggiornata, quindi:

- **Crea account:** inserisci nome, email e password con conferma. L’app invia la verifica email. Dopo aver aperto il messaggio premi **Ho verificato l’email**.
- **Continua con Google:** scegli l’account Google. Se il browser blocca il popup, consenti i popup per Bookflix e riprova. L’eventuale errore di verifica email viene gestito dallo stesso pannello.

Il nome è un nome visualizzato. La proprietà di recensioni e voti usa sempre l’UID firmato di Firebase, non il nome o l’indirizzo email scritto nel browser.

Dopo il setup Firestore, al primo accesso puoi **creare una libreria** o aprire quelle condivise con te. Una persona appena registrata non riceve accesso automatico alla raccolta Koofr precedente; nessuno ne diventa proprietario solo perché si registra per primo.

## 4. Associa a te la raccolta conservata

Per importare esplicitamente i libri già presenti nella tua nuova libreria:

1. In Firebase → Authentication → Users apri **il tuo nuovo account** e copia il suo UID.
2. Inseriscilo in `.env` come valore di `BOOKFLIX_OWNER_UID` (non il nome e non l’email).
3. Riesegui:

```powershell
node .\scripts\prepare-firebase.mjs
npx wrangler secret bulk .\.bookflix-firebase-worker.local.json --config .\worker\wrangler.jsonc
```

4. Ricarica l’app, crea/apri la tua nuova libreria e premi **Importa raccolta Koofr precedente**. Il Worker ti riconosce come unico utente autorizzato a leggerne la sorgente; l’originale viene conservato.

Per cambiare solo l’UID nei secret non serve ripubblicare il codice. I secret Koofr esistenti restano invariati.

Questa assegnazione singola riguarda solo l’archivio precedente. Le nuove librerie usano Firestore, con appartenenze e ruoli owner/editor/reviewer/viewer; non dipendono da un elenco di utenti nei secret.

## Reset dei vecchi contributi

Al primo caricamento da parte del proprietario configurato, il Worker aggiorna `books.json` rimuovendo le vecchie recensioni, tutti i vecchi voti e gli eventuali campi personali dismessi. **Titoli, autori, altri metadati, ID dei libri e copertine vengono conservati.**

Il reset usa If-Match per non sovrascrivere cambiamenti concorrenti e salva nel catalogo il marcatore `identityEpoch: "firebase-self-service-v1"`. Una volta completato, non viene ripetuto: le nuove recensioni e i nuovi voti restano. Se il reset fallisce, l’app segnala il problema e consente di riprovare; non conferma una cancellazione parziale della cache.

La cache aggiornata nel browser viene ripulita dagli stessi contributi. I vecchi backup rimangono importabili per ripristinare libri e copertine, ma i loro contributi personali vengono scartati. I nuovi backup contengono il marcatore e conservano i nuovi voti e recensioni. I file di backup già scaricati non vengono modificati.

Non eliminare il marcatore da `books.json`: farlo richiederebbe nuovamente un reset al caricamento successivo. Le vecchie versioni dell’app che inviano cataloghi senza marcatore vengono rifiutate.

## Accesso, sessioni e verifiche

- Email/password e Google sono gestiti dal SDK Firebase. Non ci sono più password utente nei secret Cloudflare o elenchi predefiniti di account autorizzati al login.
- Resta connesso conserva la sessione sul dispositivo; senza la spunta si usa la sessione del browser. I token vengono rinnovati prima delle operazioni. Il rinnovo dello stesso utente non smonta i moduli aperti.
- Il Worker verifica firma Google RS256, progetto, issuer, UID, scadenza, tempo di autenticazione ed email verificata. I nuovi account possono fare login, ma soltanto il proprietario configurato può leggere o modificare la raccolta conservata.
- Una revoca amministrativa Firebase può lasciare valido un ID token già emesso fino alla sua scadenza (normalmente circa un’ora); il SDK non potrà rinnovarlo. Riferimento: https://firebase.google.com/docs/auth/admin/manage-sessions
- Login e salvataggi richiedono rete. L’installazione PWA non introduce un nuovo login offline.

Verifica personalmente dopo il deploy:

1. Registrazione email/password, verifica email, accesso e recupero password.
2. Accesso Google, refresh con Resta connesso e logout.
3. Un secondo nuovo account vede solo il benvenuto e non legge la raccolta conservata.
4. Il proprietario ritrova libri e copertine, senza vecchi commenti o voti.
5. Una nuova recensione e un nuovo voto restano dopo refresh e riapertura.

I test usano account, token, email e WebDAV fittizi. Non sono stati cancellati account reali né modificato il catalogo Koofr dall’agente.

Riferimenti ufficiali: https://firebase.google.com/docs/auth/web/google-signin e https://firebase.google.com/docs/auth/web/password-auth
