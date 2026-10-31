# Scaffale — fase 1

Applicazione personale in italiano, con archivio locale nel browser. React, TypeScript, Dexie/IndexedDB e JSZip. Nessun dato del catalogo viene incluso nella pubblicazione del sito. Il font è scaricato da Google Fonts; in assenza di rete viene usato il font di sistema.

## Avvio sul computer

Con Node.js 22 o successivo installato, aprire questa cartella nel terminale:

```
npm ci
npm run dev
```

Aprire l’indirizzo mostrato. Per creare il sito statico: `npm run build`. Per le verifiche automatiche: `npm test`.

## Pubblicazione gratuita su GitHub Pages

1. Creare un repository pubblico su GitHub Free e caricare **il contenuto di questa cartella**, inclusi `package-lock.json` e `.github`, nella radice del repository. Non caricare `node_modules`, backup personali o il catalogo.
2. Usare il ramo `main`.
3. In Settings → Pages → Build and deployment, scegliere **GitHub Actions**.
4. Avviare il workflow “Pubblica su GitHub Pages” nella scheda Actions, oppure effettuare un nuovo push su main.
5. Il workflow verifica e costruisce il sito, quindi mostra l’indirizzo pubblicato.

Il percorso degli asset è relativo: funziona anche su `https://nome.github.io/repository/`. Non cambiare dominio/percorso senza prima esportare un backup: l'archivio è legato all'origine del sito. Applicazioni diverse sulla stessa origine github.io condividono l'ambito IndexedDB: non ospitare copie indipendenti di Scaffale sotto lo stesso dominio aspettandoti archivi separati.

## Verifica manuale della fase 1

1. Aggiungere un libro con titolo, più autori e generi separati da punto e virgola, una copertina JPG/PNG/WebP, note e valutazione.
2. Chiudere e riaprire la pagina nello stesso browser: libro e copertina devono restare presenti.
3. Aprire la scheda, modificare stato e note e salvare. Controllare che il libro compaia nelle righe corrispondenti.
4. Provare un ISBN non valido e poi due libri con ISBN equivalenti: il salvataggio deve essere impedito con un messaggio.
5. Esportare il backup ZIP. Eliminare il libro, reimportare lo ZIP e verificare metadati e copertina.
6. Provare un file ZIP errato: l'archivio precedente deve restare intatto.
7. Ripetere su smartphone; il trasferimento dal computer avviene esportando e importando lo ZIP.

## Formato aperto del backup

ZIP contenente `library.json` e `covers/<id>`. Il JSON ha `format: "scaffale"`, `version: 1`, `exportedAt` e `books`. Ogni record include tutti i metadati, ID UUID, date ISO, `coverPath` e `coverType`. ISBN vuoto è consentito; gli ISBN-10 validi sono convertiti in ISBN-13. Autori e generi sono array. Valutazione: null o intero 1–5. Pagine: null o intero positivo. Stato: “Da leggere”, “In lettura”, “Letto”. Importazione: **sostituzione completa**, confermata dall'utente, dopo validazione di tutti i record e delle immagini e dentro una transazione unica. Limiti: ZIP 200 MB, singola immagine 10 MB, 20.000 record.

## Limiti e prossime fasi

- Archivio locale, senza account o sincronizzazione. La cancellazione dei dati del sito può eliminare la libreria. Il pulsante di persistenza dipende dalle decisioni del browser; esportare regolarmente il backup.
- Implementato l'archivio e una prima consultazione a righe. Non ancora implementati recupero/scansione ISBN (fase 2), ottimizzazioni della consultazione (fase 3), ricerca e filtri (fase 4).
- Installazione PWA e cache offline dell'interfaccia saranno completate prima della consegna finale; questa fase richiede il caricamento del sito.
- Le prove automatiche coprono integrità dei dati e backup. Restano necessarie le verifiche sui browser e dispositivi reali.
