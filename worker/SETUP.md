# Setup personale del Worker Bookflix

Questa guida è per il setup che eseguirai tu. Nessun Worker o risorsa Cloudflare è stato creato o pubblicato dall'agente.

## 1. Crea e pubblica il Worker dal tuo computer

Questo percorso usa gli strumenti ufficiali Cloudflare e non dipende dalle etichette della dashboard. Node.js è lo stesso prerequisito già usato per avviare Bookflix.

1. Accedi a https://dash.cloudflare.com/ con il tuo account. Se serve un account nuovo, completa tu la registrazione. Mantieni il piano **Workers Free**: non servono database, R2, dominio personale o servizi a pagamento.
2. Estrai lo ZIP del progetto e apri un terminale **dentro la cartella `worker`**, quella che contiene `scraper.mjs` e `wrangler.jsonc`.
3. Esegui:

```
npx wrangler login
```

4. Se viene chiesto di scaricare Wrangler dal registro npm, conferma. Si apre il browser: accedi e autorizza tu lo strumento ufficiale Cloudflare. Se hai più account, scegli quello da usare.
5. Tornato al terminale, esegui:

```
npx wrangler deploy
```

6. Questo comando crea/pubblica **soltanto il Worker**, con il nome `bookflix-scraper`. Non pubblica il sito GitHub Pages. Alla prima pubblicazione Cloudflare può chiederti di scegliere un sottodominio workers.dev: completalo tu. Il terminale mostra l'indirizzo finale, da conservare.

Non inserire password o token nel codice o nella chat. Per successivi aggiornamenti dello scraper basterà ripetere `npx wrangler deploy` nella cartella `worker`.

Guida ufficiale: https://developers.cloudflare.com/workers/get-started/guide/

Se preferisci fare tutto dalla dashboard: Workers & Pages → Create application, scegli il modello di Worker minimo disponibile e sostituisci il file principale con `scraper.mjs`, poi pubblica. La dashboard può proporre anche l'importazione da Git: in quel caso seleziona la cartella `worker` come directory del progetto. Per il primo setup è più ripetibile il percorso da terminale sopra.

## 2. Verifica il servizio

Cloudflare mostra un indirizzo simile a `https://bookflix-scraper.TUO-SOTTODOMINIO.workers.dev`.

Apri quell'indirizzo aggiungendo `/health`. Devi vedere un oggetto con `"ok": true` e la versione `0.3.0`. La radice da sola risponde con percorso non trovato: è normale.

Per provare un libro da IBS, aggiungi al tuo indirizzo:

```
/lookup?isbn=9788834603000&url=https%3A%2F%2Fwww.ibs.it%2Fnome-della-rosa-ediz-illustrata-libro-umberto-eco%2Fe%2F9788834603000
```

La risposta deve contenere `candidates` con la scheda corrispondente, oppure `warnings` con un errore comprensibile. Un 200 da solo non prova che il libro sia stato trovato: controlla che `candidates` non sia vuoto.

## 3. Collega Bookflix

1. Aggiorna il progetto GitHub con il contenuto del pacchetto **bookflix-scraper-prototipo.zip**. Mantieni la cartella `.github` e la licenza esistente. Non caricare `node_modules` o backup della libreria. Le cartelle `src` e `worker` vanno nella radice del repository, allo stesso livello di `package.json`.
2. Attendi il completamento della pubblicazione GitHub Pages e ricarica il sito.
3. Apri **Aggiungi libro → Servizio di recupero**.
4. Inserisci l'indirizzo base del Worker, senza `/health` o altri percorsi, e premi **Salva indirizzo**. L'indirizzo viene conservato in questo browser; va configurato anche sul telefono.
5. Cerca l'ISBN `9788834603000`. Per una prova più affidabile incolla anche il link della scheda IBS:

https://www.ibs.it/nome-della-rosa-ediz-illustrata-libro-umberto-eco/e/9788834603000

6. Controlla titolo, autore, editore, anno, pagine, generi e copertina nell'anteprima. Salva soltanto dopo averli verificati.

## 4. Origini consentite

Il codice è già configurato per `https://riccardogiussani.github.io`. L'origine **non comprende `/bookflix/`**.

Per provare dal sito locale, nelle **Settings → Variables and Secrets** del Worker aggiungi una variabile di testo chiamata `ALLOWED_ORIGINS` con:

```
https://riccardogiussani.github.io,http://localhost:5173
```

Salva e ripubblica se richiesto. Non serve questa modifica per usare il sito GitHub Pages dal telefono.

## Cosa aspettarti dal prototipo

- Senza link, tenta di trovare la scheda tramite ricerca HTML Giunti al Punto. La scoperta automatica è sperimentale: nelle prove sono comparsi risultati vuoti e HTTP 429. Non è garantita per tutti gli ISBN.
- Con link, legge schede IBS o Giunti ed esige una corrispondenza ISBN nei dati della pagina. La ricerca interna IBS non viene interrogata. Non utilizza Google Books, Open Library o una API di ricerca a pagamento.
- Amazon non è implementato. Altri editori richiedono adattatori dedicati.
- Lingua e sottotitolo restano vuoti se la fonte non li dichiara. Non vengono dedotti dalla lingua del sito. Autori e categorie vanno verificati.
- Il servizio scarica le copertine ammesse per consentirne il salvataggio locale; può fallire se il portale ne blocca il download. In quel caso carica l'immagine manualmente.
- Cache delle schede positive per 24 ore nel nodo Cloudflare. Le ricerche e le immagini non sono ancora memorizzate nella cache condivisa. Freno di 12 richieste/minuto per IP, best effort per istanza: non è un sistema di autenticazione o una quota globale. CORS limita le pagine browser abilitate, non gli altri client.
- La libreria resta nel browser. Il Worker riceve ISBN e link della scheda e non memorizza note, valutazioni o catalogo. Le query possono comparire nei normali log del servizio.
- Le prove locali non dimostrano l'accesso dai server Cloudflare: i portali possono trattarli diversamente. La verifica dopo il deploy è necessaria prima di considerarlo operativo.

## Se qualcosa non funziona

- **Origine non autorizzata:** controlla `ALLOWED_ORIGINS`, senza il percorso `/bookflix/`.
- **Limite di richieste:** attendi qualche minuto. Non rilanciare ricerche ripetute.
- **ISBN non corrispondente:** usa il link dell'edizione cartacea che possiedi.
- **Risultati vuoti:** prova una scheda diretta; se fallisce, completa il modulo manualmente.
- **Impossibile contattare il servizio:** verifica `/health`, l'indirizzo salvato nell'app e il completamento del deploy.

Non sono necessari token API nell'app o modifiche ai dati esistenti. Prima di aggiornare il sito esporta comunque un backup ZIP della libreria.
