# Bookflix: catalogo centrale e librerie — Worker 0.12.0

Questa versione usa Firebase Authentication per gli account, **Firestore Standard** per i dati, Koofr per le immagini condivise e GitHub Pages per il sito. Non usa Firebase Storage, Cloud Functions o D1.

Esegui personalmente i passaggi seguenti dalla radice di `bookflix`. Non serve cambiare password agli utenti, generare account manualmente o condividere credenziali in chat. Non è stato eseguito alcun deploy né modificato il tuo account cloud.

## 1. Crea il database

Nel progetto Firebase già usato per il login:

1. Apri **Build → Firestore Database → Crea database**.
2. Scegli **Standard**, database **`(default)`**, modalità **produzione**. Se viene proposta un’edizione Enterprise o un servizio che richiede fatturazione, torna indietro.
3. Scegli una regione europea vicina, per esempio `europe-west8` (Milano), se disponibile fra le opzioni. La regione non si cambia dopo la creazione.
4. Mantieni il piano **Spark**: non attivare Blaze o una fatturazione per questa configurazione.

Il livello gratuito di Firestore Standard comprende 1 GiB, 50.000 letture e 20.000 scritture al giorno. Il costo resta zero entro le quote; superarle può rendere il servizio temporaneamente indisponibile. Una copertina non disponibile usa un segnaposto e non blocca i metadati; un aggiornamento manuale ritenta il recupero. La prima apertura di una libreria legge elementi ed edizioni; gli aggiornamenti invariati leggono solo il documento della libreria. Le ricerche testuali avvengono nella copia locale.

Riferimenti: [creazione Firestore](https://firebase.google.com/docs/firestore/quickstart), [quote](https://firebase.google.com/docs/firestore/quotas). Le copertine restano su Koofr perché [Firebase Storage richiede Blaze](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).

## 2. Crea una credenziale dedicata al Worker

Apri lo stesso progetto nella **Google Cloud Console** (dal collegamento nelle impostazioni Firebase):

1. **IAM e amministrazione → Account di servizio → Crea account di servizio**.
2. Nome suggerito: `bookflix-worker`.
3. Assegna **Cloud Datastore User / Datastore User**, identificativo `roles/datastore.user`. Non assegnare Owner o Editor del progetto.
4. Apri il nuovo account → **Chiavi → Aggiungi chiave → Crea nuova chiave → JSON**.
5. Conserva il file nella radice del repository con il nome **`.bookflix-firestore-service-account.local.json`**. Il nome è già escluso da Git.

Questa è una credenziale privata del backend: non va in `public/`, nel codice del sito, nelle variabili `VITE_*` o in un messaggio. Il Worker firma una richiesta OAuth con questa chiave e accede a Firestore tramite IAM. Le regole client non autorizzano il Worker: [documentazione REST ufficiale](https://firebase.google.com/docs/firestore/use-rest-api).

Nel `.env` deve esserci lo stesso `FIREBASE_PROJECT_ID` già usato per il login. Poi:

```powershell
node .\scripts\prepare-firestore.mjs
npx wrangler secret bulk .\.bookflix-firestore-worker.local.json --config .\worker\wrangler.jsonc
```

Lo script controlla progetto e chiave e prepara il solo secret `GOOGLE_SERVICE_ACCOUNT_JSON`. Non legge password degli utenti, non crea risorse e non si collega a Google. Non sovrascrive i secret Koofr o Firebase già caricati.

## 3. Pubblica regole e indici

Dalla radice del repository:

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project IL_TUO_PROJECT_ID
```

Sostituisci `IL_TUO_PROJECT_ID` con quello del tuo progetto. La configurazione è già in `firebase.json`. Non eseguire deploy di Hosting: il sito resta su Pages.

Le regole negano tutti gli accessi diretti dal browser, anche con login Firebase. Ogni operazione passa dal Worker, che verifica JWT, appartenenza alla libreria e ruolo. Gli indici automatici restano per amici e appartenenze; i grandi testi dei libri e dei commenti sono esclusi dagli indici.

Se preferisci non usare la CLI per le regole, puoi copiare `firestore.rules` in **Firestore → Regole → Pubblica**; per applicare anche le esenzioni dagli indici usa comunque il comando precedente.

## 4. Pubblica Worker e sito

I secret esistenti richiesti sono `FIREBASE_PROJECT_ID`, `KOOFR_USERNAME` e `KOOFR_PASSWORD`. Il nuovo secret è `GOOGLE_SERVICE_ACCOUNT_JSON`. `BOOKFLIX_OWNER_UID` e `KOOFR_COLLECTION_ID` servono solo per leggere la raccolta Koofr precedente: non controllano i permessi delle nuove librerie.

```powershell
npm test
npm run build
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Il [health check](https://bookflix-scraper.riciriccio.workers.dev/health) deve mostrare `version: "0.12.0"`, provider `Firestore + Koofr` e `configured: true`. Questo indica la presenza dei secret; la prima apertura verifica anche che database, credenziale e permessi siano corretti.

Poi commit e push dei sorgenti pubblici, nuovi file e test. Non includere `.env` o `.bookflix-*.local.*`. Pages si aggiorna con il workflow esistente. Nella PWA installata premi **Aggiorna Bookflix** quando compare la proposta; evita di cambiare versione con un modulo aperto.

## 5. Verifica struttura e inserimento ISBN

1. Accedi con il tuo account Firebase: ora puoi **creare una libreria**, scegliendone il nome. Non viene assegnata automaticamente nessuna raccolta precedente.
2. Aggiungi un libro tramite ISBN, controlla l’anteprima e salva. Ricarica: libro e copertina devono restare.
3. Crea una seconda libreria e cerca lo stesso ISBN: la fonte proposta deve essere **Catalogo Bookflix**, senza rifare lo scraping.
4. In Firestore vedrai un solo documento `catalog/isbn_<ISBN>` e un elemento in ogni `libraries/<UUID>/items/`. I collegamenti possono mantenere un ID precedente dopo una correzione dell’ISBN. ISBN-10 e ISBN-13 equivalenti condividono la stessa edizione. ISBN diversi identificano edizioni diverse; i libri senza ISBN hanno un ID manuale. Una correzione dell’ISBN aggiorna il collegamento conservando ID, posizione e contributi del libro nella libreria; la vecchia edizione centrale resta disponibile.
5. Modifica posizione o titolo nella seconda libreria: la prima deve restare invariata. Le correzioni sono locali alla libreria; la scheda centrale non viene sovrascritta.
6. Rimuovi il libro dalla seconda libreria: resta nella prima e nel catalogo centrale.

Il recupero dai portali dà priorità a Feltrinelli e completa i dati mancanti con le altre fonti. Una prenotazione temporanea coordina le ricerche simultanee dello stesso ISBN. Se il browser si chiude durante il recupero, scade dopo tre minuti. Una ricerca senza risultati non crea una scheda centrale vuota.

In Koofr le nuove immagini sono in `.booflix/catalog/covers/<SHA256>.<estensione>`. Contenuti identici riusano lo stesso file. Viene creata anche `.booflix/<UUID>/` per ogni nuova libreria; i suoi dati sono in Firestore, non in un nuovo `books.json`.

## 6. Verifica consultazione, amici e ruoli

1. Crea un secondo account (Google o email verificata), poi apri **Librerie e amici** da entrambi gli account.
2. Invia una richiesta tramite email o codice amico. Il destinatario deve accettarla.
3. Quando il destinatario accetta, entrambi vengono aggiunti automaticamente come viewer alle librerie di cui l’altro è owner. Anche le nuove librerie includono gli amici già accettati come viewer. I ruoli già presenti restano invariati e sono modificabili dal selettore. Le librerie in cui sei soltanto editor/reviewer/viewer non vengono condivise con i tuoi amici.

Le amicizie precedenti a questo aggiornamento vengono allineate una sola volta al successivo accesso di ciascun proprietario. Le rimozioni manuali effettuate dopo l’allineamento restano rispettate. Le librerie archiviate non vengono condivise. Se una libreria ha già 100 membri, l’accettazione viene interrotta con un messaggio e nessuna condivisione parziale.
4. **Viewer:** vede libri, voti e recensioni, ma non può scrivere.
5. **Reviewer:** aggiunge/modifica/rimuove i propri voti e recensioni; non modifica libri, posizioni o copertine.
6. **Editor e owner:** gestiscono libri, nome, membri e permessi con gli stessi poteri. Deve rimanere almeno un owner.
7. Voti e recensioni appartengono alla singola libreria e all’UID dell’autore; la media si riferisce ai voti presenti in quella libreria, inclusi quelli conservati dopo l’uscita di un membro. Non si possono alterare contributi altrui.
8. La ricerca immediata resta sulle copertine e sui metadati della libreria selezionata. Cambiando libreria cambiano risultati e cache.

I permessi si aggiornano al caricamento o a un’operazione online, senza notifiche in tempo reale. Una libreria aperta su un altro dispositivo va aggiornata con **Aggiorna raccolta**. Le scritture rifiutano versioni obsolete senza chiudere la bozza. La copia locale non è cifrata: chi ha accesso al profilo del browser può leggerla. Una revoca blocca le successive richieste online; non può cancellare copie o backup già ottenuti.

La rimozione di un amico non rimuove automaticamente i suoi accessi: modifica anche i membri della libreria. **Archivia libreria** la nasconde a tutti, conservando i dati. Il ripristino dell’archivio si può effettuare dalla console amministrativa impostando `archived` a `false`; non c’è un cestino nell’app.

## 7. Raccolta precedente, importazione e backup

L’archivio Koofr precedente non viene cancellato o migrato automaticamente. Se hai configurato il tuo nuovo UID in `BOOKFLIX_OWNER_UID`, nella tua nuova libreria compare **Importa raccolta Koofr precedente**. La procedura copia libri e copertine, saltando quelli già presenti; conserva la sorgente. I contributi storici dismessi non vengono ripristinati.

Il backup ZIP contiene `library.json` e immagini ed è esportabile per ogni libreria. Non esporta account, amicizie o permessi. L’importazione **aggiunge/aggiorna i libri della libreria selezionata** senza cancellare gli altri e senza modificare il catalogo condiviso esistente. Ripristina solo i contributi dell’UID corrente, conservando quelli già presenti di altri membri.

L’importazione scrive un libro per volta: in caso di interruzione segnala quanti ne ha importati e si può riprovare. Non è una transazione unica sull’intero ZIP. Limiti: ZIP 200 MB, immagine 10 MB, 20.000 libri nella raccolta, 100 membri, 100 voti e 1.000 recensioni per libro. Una singola richiesta può modificare al massimo 100 contributi personali.

Rimuovere un libro elimina il suo collegamento nella libreria, conservando edizione e immagini condivise. Voti e recensioni vengono conservati e tornano visibili se l’edizione viene reinserita nella stessa libreria. Non esiste una pulizia automatica dei file non referenziati né un backup cloud programmato; usa l’esportazione ZIP.

## Modello dei dati e verifiche tecniche

- `catalog/{editionId}`: metadati bibliografici e riferimento alla copertina, condivisi e immutabili dopo la creazione.
- `libraries/{UUID}`: nome, membri e ruoli.
- `libraries/{UUID}/items/{editionId}`: collegamento, posizione, correzioni locali e copertina alternativa.
- `libraries/{UUID}/reviews/` e `ratings/`: contributi in documenti separati, visibili solo ai membri.
- `profiles/` e `friends/`: profili essenziali, codici e richieste amico; niente password.
- `lookupJobs/{ISBN}`: prenotazioni temporanee del recupero; riutilizzabili dopo la scadenza, senza TTL a pagamento.

Le scritture controllano atomicamente la versione del libro e della libreria, includendo così eventuali cambiamenti dei permessi. La cache è separata per UID e libreria; una risposta tardiva resta legata alla libreria che l’ha richiesta.

I test automatici usano JWT firmati e servizi OAuth, Firestore REST e WebDAV simulati. Non usano account o dati reali. Il controllo su progetto Firebase, IAM, Koofr, portali e smartphone si fa con i passaggi sopra dopo il tuo deploy.
