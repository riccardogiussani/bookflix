# Bookflix / Scaffale — libreria personale

Applicazione in italiano con copertine, inserimento ISBN e consultazione a righe orizzontali. React, TypeScript e Vite su GitHub Pages; Cloudflare Worker per metadati e archivio Koofr/WebDAV; IndexedDB per la cache locale; backup ZIP aperto con immagini.

## Avvio e controlli

Con Node.js 22 o successivo, nella radice del progetto:

```powershell
npm ci
npm run dev
```

`npm test` verifica archivio, backup, login, scanner, scraper e integrazione cloud con un WebDAV simulato. `npm run build` produce il sito statico in `dist`. I test non accedono al tuo account Koofr e non sostituiscono le prove del servizio distribuito.

## Configurazione e pubblicazione

- **Koofr:** segui [worker/KOOFR.md](worker/KOOFR.md). Contiene tutti i comandi, la struttura della raccolta e le verifiche da fare sui tuoi dispositivi.
- **Login e scraper:** [worker/SETUP.md](worker/SETUP.md).
- **Fonti metadati:** [worker/SOURCES.md](worker/SOURCES.md).

Configurazione dei secret e deploy del Worker sono da eseguire personalmente dall’utente. Pubblica prima il Worker 0.9.0, poi fai commit e push dell’app su `main`. GitHub Actions esegue test e build e pubblica su Pages. Non aggiungere credenziali al repository.

Il Worker si pubblica dalla radice con:

```powershell
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Non lanciare il deploy automatico Vite dalla radice senza questo file di configurazione. Il Worker importa anche `worker/koofr.mjs`.

## Dati e sincronizzazione

Catalogo e immagini vengono salvati in `.booflix/<uuid-raccolta>/` su Koofr. Il Worker utilizza `KOOFR_USERNAME` e `KOOFR_PASSWORD` come secret; `KOOFR_COLLECTION_ID` è l’identificativo pubblico della raccolta. Il login usa utenti personali (`AUTH_USERS_JSON`) e sessioni firmate (`AUTH_SESSION_SECRET`). La vecchia password condivisa `ACCESS_CODE` non viene più accettata; segui [worker/USERS.md](worker/USERS.md) per il `.env` precompilato e i comandi di configurazione.

L’app aggiorna la raccolta all’accesso e con **Aggiorna raccolta**. Le scritture richiedono connessione e usano la versione WebDAV del catalogo per rilevare conflitti tra dispositivi. Non c’è sincronizzazione in tempo reale. La cache viene sostituita solo dopo il caricamento completo e la verifica delle copertine o dopo un salvataggio confermato.

Nell’app già aperta puoi consultare i dati caricati anche senza rete; serve Internet per un nuovo login o per ricaricare il sito. La cache non è cifrata. Non è ancora disponibile una PWA offline. Nessuna migrazione dell’archivio locale precedente: si usa una nuova cache senza cancellare il vecchio database.

Le immagini cloud sono immutabili: eliminare un libro o sostituire una copertina può lasciare file non più referenziati. Non è ancora prevista una pulizia automatica. La struttura permette raccolte distinte, ma in questa fase l’interfaccia apre la raccolta configurata nel Worker.

## Backup aperto

Esporta/importa ZIP con `library.json` (`format: "scaffale"`, `version: 1`, `exportedAt`, `books`) e immagini in `covers/<id>`. Password e impostazioni di accesso non entrano nel backup. L’importazione sostituisce la raccolta Koofr dopo conferma; il file viene prima validato in un archivio temporaneo. Un backup invalido non cancella la raccolta.

Limiti: ZIP 200 MB, ogni immagine 10 MB, 20.000 libri; catalogo cloud JSON 16 MiB. Restano applicabili le quote dei piani gratuiti Koofr e Cloudflare.

## Verifica funzionale

1. Su telefono HTTPS, Aggiungi libro deve aprire la fotocamera a tutto schermo con guida ISBN e pulsante Inserimento manuale. Un codice valido avvia subito il recupero e apre il modulo compilato. Prova anche il permesso negato e la chiusura della fotocamera. Le prove fisiche le esegue l’utente.
2. Inserisci un libro con autori e generi separati da punto e virgola, immagine, posizione e valutazione; riaprilo da un altro dispositivo dopo Aggiorna raccolta.
3. Verifica modifica, eliminazione, duplicati ISBN, esportazione e ripristino ZIP.
4. Esegui le prove di conflitto e rete assente in [worker/KOOFR.md](worker/KOOFR.md).
5. La ricerca dei metadati prova Amazon per primo e poi le altre fonti. Puoi incollare un link, correggere l’anteprima o compilare tutto manualmente se i portali non rispondono.

La ricerca nel catalogo è disponibile; restano da completare i filtri per metadato, ulteriori ottimizzazioni delle righe di consultazione e PWA. Nessun deploy né accesso al tuo account Koofr è stato eseguito dall’agente.

## Ricerca nel catalogo

Il campo “Cerca nella tua libreria” trova subito i libri mentre scrivi, senza richieste al Worker o a Koofr. Cerca in titolo, sottotitolo, autori, editore, generi, ISBN, anno, trama, lingua, posizione e recensioni (testo e autore); ignora maiuscole e accenti. Più parole devono essere tutte presenti, anche in campi diversi. Gli ISBN completi possono essere scritti con trattini, in formato ISBN-10 o ISBN-13.

I risultati mostrano copertine, titolo e autore; selezionandone uno si apre il dettaglio abituale. Per cataloghi grandi vengono mostrati 60 risultati per volta, con il pulsante Mostra altri. La ricerca funziona anche nella copia locale già caricata. Cancella il testo, premi Escape nel campo o usa il pulsante × per tornare alle righe della home.

Per verificare: cerca un titolo parziale, un autore con accenti, un genere e un ISBN; combina autore e anno, prova una ricerca senza risultati, apri un libro e cancella il testo per tornare alla home. Prova anche dal telefono. Basta commit e push dell’app: nessun aggiornamento del Worker è richiesto per questa funzione.

Il campo facoltativo **Posizione** indica dove si trova il libro fisico. Nel modulo si può scegliere solo **Soggiorno**, **Taverna** o **Camere**, oppure lasciarlo vuoto e compare nel dettaglio e nella ricerca; lo scraper non lo propone. È incluso nel catalogo Koofr e nei backup ZIP. I libri e i backup precedenti rimangono compatibili e mostrano la posizione vuota.

Eventuali posizioni libere salvate con la versione precedente restano leggibili: nel modulo appaiono come “Da aggiornare” e per salvare il libro occorre selezionare una delle tre posizioni o Non indicata.

Nel modulo di aggiunta manuale la ricerca automatica si avvia dal pulsante ↻ accanto all’unico campo ISBN. Il pulsante mostra l’attività durante la ricerca; il salvataggio attende la fine del recupero. Invio nel campo ISBN avvia la stessa ricerca. Il link diretto a una scheda resta disponibile nella sezione facoltativa richiudibile sotto il campo. Non viene più mostrato il riquadro iniziale “Aggiungi tramite ISBN”.

## Recensioni

Nel dettaglio del libro le recensioni appaiono come commenti con autore, data e testo. Il modulo firma automaticamente con lo username corrente, ricordato dal login. Con lo stesso ID utente puoi modificare ed eliminare i tuoi commenti; il Worker controlla la proprietà anche sul catalogo completo. La valutazione a stelle è personale: ogni utente ha un solo voto per libro e la scheda mostra la media. Sono configurati i sette utenti personali, senza registrazioni o email. Ognuno accede con la propria password e la sessione ricordata conserva un token, senza memorizzare la password nel browser.

Recensioni e autori sono conservati su Koofr, inclusi nel backup ZIP e ricercabili nel catalogo. I conflitti non cancellano il testo che stai scrivendo: aggiorna la raccolta e riprova.

Le vecchie note vengono eliminate, senza convertirle in recensioni. Al primo avvio aggiornato viene ripulita la cache; al primo caricamento online viene ripulito anche il catalogo Koofr con controllo della versione. Se il salvataggio di pulizia fallisce, l’app segnala l’errore e riprova al successivo aggiornamento. Lo stato di lettura è rimosso dal modulo, dalle copertine, dalle righe della home e dai dati. I vecchi ZIP restano importabili: note e stato vengono scartati. I file di backup già scaricati non vengono modificati.

Verifica: apri un libro e pubblica una recensione; controlla firma e data, modifica il testo, riapri da un altro dispositivo, esporta/importa il backup e prova l’eliminazione. Accedendo con un altro utente puoi leggere gli altri commenti ma non modificarli o eliminarli. Per il passaggio agli utenti personali occorre configurare i nuovi secret, pubblicare il Worker 0.9.0 e poi aggiornare Pages: [guida utenti](worker/USERS.md).

## Configurare le password dal .env

Apri il `.env` nella radice, con gli username di Riccardo, Corrado, Alessandra, Sara, Giulia, Dario e Alessia già compilati, e inserisci personalmente le password vuote (almeno 12 caratteri). Il file non viene versionato. Poi esegui `node scripts/configure-users.mjs` per preparare gli hash, e segui [worker/USERS.md](worker/USERS.md) per caricarli e pubblicare il Worker. Lo script non genera password utente e non le stampa. Solo `.env.example`, con valori vuoti, deve entrare nel repository.

## Valutazioni personali

Ogni utente può dare un solo voto intero da 1 a 5 a ciascun libro, modificarlo o rimuoverlo dal dettaglio in “La tua valutazione”, anche senza recensione. La scheda e le copertine del catalogo mostrano la media dei voti personali e il numero di valutazioni; se non ci sono voti viene mostrato “Nessuna valutazione”. I voti altrui non sono modificabili, neppure tramite invio dell’intero catalogo, eliminazione del libro o importazione di un backup. Questo segue la stessa protezione delle recensioni.

Le vecchie valutazioni condivise (`rating` ed eventuale `legacyRating`) vengono eliminate dalla cache, dai backup importati e da Koofr al primo caricamento aggiornato, senza attribuirle ad alcun utente. La pulizia cloud controlla la versione del catalogo. I voti personali sono inclusi nei backup ZIP e conservano gli ID degli autori.

Per attivare pubblica il Worker 0.9.0 e poi fai commit e push dell’app. Non serve rigenerare o ricaricare password e secret. Se il Worker non è aggiornato l’app segnala l’aggiornamento richiesto e impedisce le scritture che richiedono le nuove protezioni.

Per verificare: come Riccardo dai 5 a un libro; come Sara dai 2; dopo Aggiorna raccolta deve comparire 3,5/5 con 2 valutazioni. Modifica o rimuovi il voto di Sara e verifica la nuova media. Controlla anche che esportazione e reimportazione conservino i voti personali. I backup non possono essere usati per cancellare o introdurre voti a nome di altri utenti.
