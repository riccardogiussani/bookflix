# Aggiornamento 0.5.0: login iniziale

Login, ricerca e copertine richiedono il secret Cloudflare `ACCESS_CODE`, da impostare personalmente seguendo **[worker/SETUP.md](worker/SETUP.md)** prima del deploy. Non inserire il codice nel repository o nella build del sito. I file locali sono aggiornati; il deploy resta a cura dell’utente.

# Bookflix / Scaffale — prototipo scraper

Applicazione personale in italiano, archivio locale nel browser. React, TypeScript, Dexie/IndexedDB e backup ZIP con immagini. L’interfaccia rimane su GitHub Pages. Un piccolo Cloudflare Worker recupera i metadati da pagine pubbliche di libri.

## Avvio e verifiche

Con Node.js 22 o successivo, nella radice del progetto:

```
npm ci
npm run dev
```

Aprire l’indirizzo mostrato. `npm test` esegue le verifiche di archivio, backup, client e scraper. `npm run build` produce il sito statico in `dist`. I test del Worker girano in Node: non sono una verifica sul runtime Cloudflare.

## Pubblicazione del sito

Caricare nella radice del repository il contenuto del progetto, incluse `.github`, `src`, `worker`, `package.json` e `package-lock.json`. Non caricare `node_modules`, backup personali o catalogo. Mantenere la licenza già presente nel repository.

In GitHub Settings → Pages scegliere GitHub Actions. Il workflow su `main` esegue test e build prima della pubblicazione. Il sito funziona sotto `https://riccardogiussani.github.io/bookflix/`.

## Setup del servizio di recupero

Vedi **[worker/SETUP.md](worker/SETUP.md)**. Il setup e il deploy del Worker sono da eseguire personalmente dall’utente. L’agente non ha creato risorse Cloudflare e non ha aggiornato il sito pubblicato.

Nell’app, La schermata iniziale richiede username libero e password; la password viene verificata online su `/auth/check` prima di caricare la libreria. L’indirizzo del Worker è preconfigurato nel sorgente. Nessuna API Google Books o Open Library è usata in questa versione.

## Verifica funzionale

1. Aggiungere manualmente un libro con più autori e generi separati da punto e virgola, copertina, note e valutazione.
2. Riaprire il sito nello stesso browser: tutti i dati devono restare disponibili. Modificare il libro e verificare il salvataggio.
3. Esportare lo ZIP, eliminare il libro e ripristinare dal backup. Verificare anche la copertina. Un backup errato non deve cancellare l’archivio.
4. Dopo il setup del Worker, cercare ISBN `9788834603000` con link diretto IBS (vedere la guida). Controllare l’anteprima, correggere e salvare. Cercare nuovamente: deve aprirsi il libro già presente.
5. Provare la ricerca senza link e un ISBN non trovato. Il recupero automatico tramite Giunti è sperimentale e può essere limitato dal portale; il modulo manuale resta disponibile.
6. Su telefono HTTPS, autorizzare la fotocamera e leggere un EAN-13 ISBN. Chiudere il modulo deve spegnere la fotocamera. Provare anche il rifiuto del permesso. La scansione fisica non è stata verificata dall’agente.

## Persistenza e backup

Archivio locale, senza account o sincronizzazione. Telefono e computer hanno librerie separate. Il codice di accesso viene conservato separatamente nella sessione o, su scelta esplicita, nel browser. Non entra nei backup del catalogo. Cancellare i dati del sito può eliminare archivio e impostazione del servizio. Il pulsante di persistenza dipende dal browser: esportare regolarmente i backup.

Il dominio del sito determina l’ambito dei dati IndexedDB. Prima di cambiare origine, esportare un backup. Più copie di Bookflix sulla stessa origine github.io condividono l’archivio.

Formato ZIP: `library.json` con `format: "scaffale"`, `version: 1`, `exportedAt`, `books`; immagini in `covers/<id>`. Autori e generi sono array, valutazione null o intero 1–5, pagine null o intero positivo, date ISO. ISBN-10 normalizzato a ISBN-13. Importazione con sostituzione completa dopo conferma e validazione, in transazione unica. Limiti: ZIP 200 MB, immagine 10 MB, 20.000 record.

## Stato del prototipo

- Archivio manuale, dettagli, prime righe orizzontali, scansione e integrazione scraper implementati.
- Schede IBS: estrazione provata su due ISBN, con completamento degli autori dal contenuto della scheda. Lingua e sottotitolo non sono sempre dichiarati e restano vuoti.
- Giunti: parser provato su HTML reale; ricerca automatica sperimentale. Osservati anche HTTP 429. Non si promette una ricerca universale affidabile.
- Non sono implementati Amazon e una ricerca generale sul web. Per IBS serve il link diretto; la ricerca interna IBS non viene interrogata.
- Il Worker accetta solo fonti e immagini note, verifica la corrispondenza ISBN, gestisce timeout, limita le dimensioni delle risposte e non esegue JavaScript dei portali. I redirect vengono rifiutati; in quel caso usare il link finale della scheda.
- Cloudflare può ricevere risposte diverse rispetto al computer locale. Il funzionamento dal Worker pubblicato va verificato dopo il setup.
- Restano da completare ottimizzazioni delle righe (fase 3), ricerca e filtri (fase 4), installazione PWA e cache offline dell’interfaccia.
- Google Fonts è un caricamento esterno dell’interfaccia; in assenza di rete si usa il font di sistema.
