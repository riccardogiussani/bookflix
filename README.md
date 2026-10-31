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

Configurazione dei secret e deploy del Worker sono da eseguire personalmente dall’utente. Pubblica prima il Worker 0.7.0, poi fai commit e push dell’app su `main`. GitHub Actions esegue test e build e pubblica su Pages. Non aggiungere credenziali al repository.

Il Worker si pubblica dalla radice con:

```powershell
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Non lanciare il deploy automatico Vite dalla radice senza questo file di configurazione. Il Worker importa anche `worker/koofr.mjs`.

## Dati e sincronizzazione

Catalogo e immagini vengono salvati in `.booflix/<uuid-raccolta>/` su Koofr. Il Worker utilizza `KOOFR_USERNAME` e `KOOFR_PASSWORD` come secret; `KOOFR_COLLECTION_ID` è l’identificativo pubblico della raccolta. Il login Bookflix continua a usare il secret `ACCESS_CODE`, mentre lo username è solo un nome visualizzato.

L’app aggiorna la raccolta all’accesso e con **Aggiorna raccolta**. Le scritture richiedono connessione e usano la versione WebDAV del catalogo per rilevare conflitti tra dispositivi. Non c’è sincronizzazione in tempo reale. La cache viene sostituita solo dopo il caricamento completo e la verifica delle copertine o dopo un salvataggio confermato.

Nell’app già aperta puoi consultare i dati caricati anche senza rete; serve Internet per un nuovo login o per ricaricare il sito. La cache non è cifrata. Non è ancora disponibile una PWA offline. Nessuna migrazione dell’archivio locale precedente: si usa una nuova cache senza cancellare il vecchio database.

Le immagini cloud sono immutabili: eliminare un libro o sostituire una copertina può lasciare file non più referenziati. Non è ancora prevista una pulizia automatica. La struttura permette raccolte distinte, ma in questa fase l’interfaccia apre la raccolta configurata nel Worker.

## Backup aperto

Esporta/importa ZIP con `library.json` (`format: "scaffale"`, `version: 1`, `exportedAt`, `books`) e immagini in `covers/<id>`. Password e impostazioni di accesso non entrano nel backup. L’importazione sostituisce la raccolta Koofr dopo conferma; il file viene prima validato in un archivio temporaneo. Un backup invalido non cancella la raccolta.

Limiti: ZIP 200 MB, ogni immagine 10 MB, 20.000 libri; catalogo cloud JSON 16 MiB. Restano applicabili le quote dei piani gratuiti Koofr e Cloudflare.

## Verifica funzionale

1. Su telefono HTTPS, Aggiungi libro deve aprire la fotocamera a tutto schermo con guida ISBN e pulsante Inserimento manuale. Un codice valido avvia subito il recupero e apre il modulo compilato. Prova anche il permesso negato e la chiusura della fotocamera. Le prove fisiche le esegue l’utente.
2. Inserisci un libro con autori e generi separati da punto e virgola, immagine, note e valutazione; riaprilo da un altro dispositivo dopo Aggiorna raccolta.
3. Verifica modifica, eliminazione, duplicati ISBN, esportazione e ripristino ZIP.
4. Esegui le prove di conflitto e rete assente in [worker/KOOFR.md](worker/KOOFR.md).
5. La ricerca dei metadati prova Amazon per primo e poi le altre fonti. Puoi incollare un link, correggere l’anteprima o compilare tutto manualmente se i portali non rispondono.

La ricerca nel catalogo è disponibile; restano da completare i filtri per metadato, ulteriori ottimizzazioni delle righe di consultazione e PWA. Nessun deploy né accesso al tuo account Koofr è stato eseguito dall’agente.

## Ricerca nel catalogo

Il campo “Cerca nella tua libreria” trova subito i libri mentre scrivi, senza richieste al Worker o a Koofr. Cerca in titolo, sottotitolo, autori, editore, generi, ISBN, anno, trama, lingua, stato, posizione e note; ignora maiuscole e accenti. Più parole devono essere tutte presenti, anche in campi diversi. Gli ISBN completi possono essere scritti con trattini, in formato ISBN-10 o ISBN-13.

I risultati mostrano copertine, titolo, autore e stato; selezionandone uno si apre il dettaglio abituale. Per cataloghi grandi vengono mostrati 60 risultati per volta, con il pulsante Mostra altri. La ricerca funziona anche nella copia locale già caricata. Cancella il testo, premi Escape nel campo o usa il pulsante × per tornare alle righe della home.

Per verificare: cerca un titolo parziale, un autore con accenti, un genere e un ISBN; combina autore e anno, prova una ricerca senza risultati, apri un libro e cancella il testo per tornare alla home. Prova anche dal telefono. Basta commit e push dell’app: nessun aggiornamento del Worker è richiesto per questa funzione.

Il campo facoltativo **Posizione** indica dove si trova il libro fisico. Nel modulo si può scegliere solo **Soggiorno**, **Taverna** o **Camere**, oppure lasciarlo vuoto e compare nel dettaglio e nella ricerca; lo scraper non lo propone. È incluso nel catalogo Koofr e nei backup ZIP. I libri e i backup precedenti rimangono compatibili e mostrano la posizione vuota.

Eventuali posizioni libere salvate con la versione precedente restano leggibili: nel modulo appaiono come “Da aggiornare” e per salvare il libro occorre selezionare una delle tre posizioni o Non indicata.

Nel modulo di aggiunta manuale la ricerca automatica si avvia dal pulsante ↻ accanto all’unico campo ISBN. Il pulsante mostra l’attività durante la ricerca; il salvataggio attende la fine del recupero. Invio nel campo ISBN avvia la stessa ricerca. Il link diretto a una scheda resta disponibile nella sezione facoltativa richiudibile sotto il campo. Non viene più mostrato il riquadro iniziale “Aggiungi tramite ISBN”.
