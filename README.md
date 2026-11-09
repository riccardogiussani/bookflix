# Bookflix

Libreria personale e condivisa, con copertine, ricerca, ISBN, recensioni e voti personali. Interfaccia React/TypeScript su GitHub Pages, PWA installabile, Firebase Authentication e Cloudflare Worker per accesso ai dati e scraping. Catalogo centrale e librerie sono su Firestore Standard; Koofr conserva le copertine condivise. Amici e ruoli sono gestiti dal Worker.

**Editor root del catalogo centrale:** [CATALOG-ADMIN.md](CATALOG-ADMIN.md), con ricerca, suggerimenti per campo, classificazione Bonsai e copertine.

**Normalizzazione e deduplicazione autori:** [AUTHORS.md](AUTHORS.md), nello stesso frontend locale con selettore in basso.

**Generi strutturati e classificazione locale Bonsai:** [GENRES.md](GENRES.md). Anteprima senza scritture, applicazione esplicita e versione `2.0`.

## Avvio

Con Node.js 22 o successivo:

```powershell
npm ci
npm run dev
```

`npm test` esegue le verifiche automatiche. `npm run build` prepara `dist`, manifest, icone e service worker. Lo sviluppo non registra il service worker.

## Configurazione e pubblicazione

- **Account, Google e reset:** [FIREBASE.md](FIREBASE.md), configurazione del login.
- **Catalogo centrale, librerie e ruoli:** [FIRESTORE.md](FIRESTORE.md), setup attuale **0.12.0**.
- **Installazione e icone:** [PWA.md](PWA.md).
- **Koofr/WebDAV:** [worker/KOOFR.md](worker/KOOFR.md), per collegare il servizio di archiviazione. I passaggi sul login precedenti a Firebase sono superati da FIREBASE.md.
- **Fonti ISBN:** [worker/SOURCES.md](worker/SOURCES.md).

Gli utenti ora si registrano con nome, email e password (con verifica dell’indirizzo), oppure usano Google. Non si importano i sette account precedenti e non si compilano elenchi di password. Nel `.env` servono i quattro valori pubblici dell’app Firebase e l’eventuale `BOOKFLIX_OWNER_UID`.

`node scripts/prepare-firebase.mjs` genera `public/firebase-config.json`, da pubblicare, e il JSON locale per configurare il Worker. Non esegue importazioni né richieste di rete. `.env` e `.bookflix-*.local.*` restano esclusi da Git.

Configurazione Firebase, eventuale cancellazione degli account precedenti, caricamento dei secret e deploy vengono eseguiti personalmente dall’utente. Il Worker va pubblicato con:

```powershell
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Poi commit e push su `main` pubblicano Pages tramite il workflow di test e build. La nuova app e il Worker 0.12.0 devono essere aggiornati insieme; completa prima il setup Firestore.

## Raccolta conservata e nuovi account

Dopo il login ogni utente può creare una libreria o aprire quelle condivise con lui. Da **Librerie e amici** invia richieste via email/codice e assegna ruoli owner, editor, reviewer o viewer. Accettando l’amicizia, entrambi accedono come viewer alle librerie di cui l’altro è owner, incluse quelle create in seguito; i ruoli esistenti restano invariati. Owner ed editor hanno gli stessi poteri di gestione; deve restare almeno un owner.

`BOOKFLIX_OWNER_UID` riguarda solo l’importazione esplicita della raccolta Koofr precedente: non assegna diritti sulle nuove librerie. La sorgente resta conservata.

Il reset confermato elimina tutte le recensioni e valutazioni precedenti al nuovo sistema, preservando libri e immagini. Si applica alla cache aggiornata e, al primo caricamento autorizzato, a Koofr con controllo If-Match. Il catalogo conserva `identityEpoch: "firebase-self-service-v1"` per non ripetere il reset sui contributi nuovi. Il marcatore non deve essere rimosso.

La cache locale resta non cifrata. Login e scritture richiedono rete. La PWA conserva l’interfaccia; una raccolta già aperta è consultabile dalla copia locale. Il rinnovo del token dello stesso utente non deve chiudere i moduli aperti.

## Libri, recensioni e voti

Aggiungi libro apre la fotocamera a tutto schermo. Inserimento manuale apre il modulo; il pulsante ↻ accanto a ISBN avvia il recupero da Feltrinelli e dalle altre fonti supportate. Il modulo permette di correggere dati e copertina prima del salvataggio e impedisce duplicati ISBN. Posizione è facoltativa e usa le opzioni presenti nel menu.

La home mostra righe di copertine per genere e aggiunti di recente. La ricerca immediata trova metadati, posizione e recensioni, senza nuove richieste di rete.

Nel dettaglio le recensioni appaiono come commenti firmati. Ogni utente ha un solo voto da 1 a 5, modificabile o rimovibile. La scheda e le copertine mostrano media e numero dei votanti. Il Worker verifica l’UID e il ruolo. Voti e recensioni sono separati per libreria. Rimuovere un libro scollega l’edizione, preservando catalogo centrale, immagini e contributi per un eventuale reinserimento.

## Backup e conflitti

Il backup ZIP aperto conserva `library.json` e immagini in `covers/`. Il nome pubblico è Bookflix; il formato storico `scaffale`, versione 1, resta compatibile. I nuovi backup includono `identityEpoch` e mantengono i nuovi contributi. Nei vecchi backup i contributi precedenti vengono scartati all’importazione, conservando libri e copertine.

L’importazione aggiunge/aggiorna i libri senza cancellare gli altri; ripristina solo i contributi del tuo UID, preservando quelli altrui. Scrive un libro alla volta e segnala eventuali interruzioni. Limiti: ZIP 200 MB, singola immagine 10 MB, 20.000 libri per libreria. Le versioni Firestore impediscono di sovrascrivere modifiche concorrenti. Le immagini identiche condividono un percorso basato su SHA-256; non c’è pulizia automatica dei file non referenziati.

## Verifiche

I test usano token firmati, utenti, OAuth, Firestore REST e WebDAV simulati. Non usano credenziali reali. Le prove su Firebase, Koofr, fotocamera e installazione Android sono da eseguire dall’utente dopo il proprio deploy, seguendo le guide.
