# Worker Bookflix 0.6.0 — attivazione del codice di accesso

Il sito resta su GitHub Pages. Il suo codice contiene l’URL pubblico `https://bookflix-scraper.riciriccio.workers.dev`, ma non contiene il codice di accesso. Ricerca e download delle copertine richiedono entrambi l’autorizzazione. Senza il secret il servizio resta chiuso (HTTP 503), senza codice corretto restituisce HTTP 401. `/health` resta pubblico.

Setup e deploy sono da eseguire personalmente dall’utente. L’agente ha modificato e verificato i file locali senza pubblicare il Worker e senza impostare credenziali Cloudflare.

## 1. Imposta il codice su Cloudflare

Dal terminale nella **radice del tuo repository**, `C:\Users\ricca\Repo\web-apps\bookflix`, esegui:

```powershell
npx wrangler secret put ACCESS_CODE --config .\worker\wrangler.jsonc
```

Quando richiesto, inserisci personalmente un codice casuale lungo (consigliati almeno 24 caratteri, lettere, cifre e simboli ASCII senza spazi), generato e conservato nel tuo gestore di password. È il codice che inserirai nell’app. Il terminale ne gestisce l’inserimento: **non aggiungerlo alla riga del comando, non inviarlo in chat e non salvarlo in `wrangler.jsonc`, `.env`, GitHub Secrets della build o nel sorgente**.

Questo comando imposta un secret nel Worker `bookflix-scraper`; non aggiorna il sito su GitHub Pages. Se Wrangler chiede di autenticarti, esegui tu `npx wrangler login`.

Documentazione ufficiale: https://developers.cloudflare.com/workers/configuration/secrets/

## 2. Pubblica il Worker aggiornato

Sempre dalla radice del repository:

```powershell
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Non avviare `wrangler deploy` senza `--config` dalla radice: proverebbe a configurare l’app Vite invece dello scraper.

Apri https://bookflix-scraper.riciriccio.workers.dev/health . Il risultato atteso include:

```json
{"ok":true,"version":"0.6.0","authentication":{"required":true,"configured":true}}
```

Può includere anche `sources`. Se `configured` è false, il secret manca. Il valore del secret non viene restituito.

Aprendo nel browser `/lookup?isbn=9788834603000` senza header di autorizzazione è **corretto** ricevere HTTP 401: un link pubblico non deve permettere di usare lo scraper. Non aggiungere il codice all’URL per provare.

## 3. Aggiorna il sito GitHub Pages

Fai commit e push dei file modificati dell’app, del Worker, dei test e delle istruzioni su `main`. Non includere file con credenziali. Attendi il completamento del workflow GitHub Actions e ricarica l’app.

Il codice del Worker nel repository è pubblico, ma il suo secret resta su Cloudflare. Non serve inserirlo nelle variabili GitHub Actions.

## 4. Login all’apertura dell’app

1. Apri o ricarica Bookflix: deve comparire la schermata di login, prima della libreria.
2. Inserisci uno **username qualsiasi** e come **password** il valore di `ACCESS_CODE`. Lo username non viene verificato né inviato al Worker: è un’etichetta locale e non crea un archivio separato.
3. Premi **Accedi**. L’app chiama `/auth/check`, protetto dalla password. Soltanto una risposta `{ "authenticated": true }` apre la libreria. Il solo `/health` pubblico non è sufficiente. Non vengono interrogati portali di libri durante il login.
4. Se la password è errata, il Worker non è aggiornato o manca la connessione, il login resta visibile con un messaggio. Serve Internet per ogni nuovo accesso all’apertura della pagina.
5. Facoltativamente scegli **Ricorda la password su questo dispositivo**. Anche se ricordata, viene nuovamente verificata dopo ogni caricamento della pagina. Chi accede al browser potrebbe recuperare una password salvata.
6. **Esci** torna al login e rimuove la password salvata su questo browser; i libri restano nell’archivio locale. Se la password viene cambiata sul Worker, la successiva richiesta ISBN o di copertina rifiutata riporta al login.

L’indirizzo del servizio è già configurato nel sorgente (`src/isbn.ts`). La password viene trasmessa via HTTPS nell’header Authorization, mai nella query, e non viene inoltrata ai portali. La libreria non viene caricata dall’interfaccia prima dell’accesso. L’archivio locale non è cifrato: questa schermata non costituisce un sistema di account multipli o di cifratura dei dati sul dispositivo.

Se hai già configurato `ACCESS_CODE` nella versione precedente, **non occorre modificarlo**: basta ripubblicare il Worker aggiornato e fare commit e push dell’app. Non è stato eseguito alcun deploy dall’agente.

## Rotazione o revoca

Ripeti `wrangler secret put ACCESS_CODE --config .\worker\wrangler.jsonc` e scegli un nuovo valore. Le nuove richieste con il vecchio codice vengono rifiutate. Aggiorna il codice nell’app su ciascun dispositivo. Nessuna nuova build del sito è necessaria per cambiare il secret.

## Prove locali opzionali

Le credenziali locali, se necessarie, vanno in `worker/.dev.vars`, escluso da Git. Non crearle se non stai provando il Worker localmente. Per la normale app locale che usa il Worker online basta includere l’origine locale in `ALLOWED_ORIGINS`, per esempio `https://riccardogiussani.github.io,http://localhost:5173`.

La restrizione di origine non è autenticazione: il controllo del codice viene eseguito anche su richieste senza Origin. Il limite di richieste in memoria è best effort per istanza, non una protezione globale contro tentativi distribuiti. Il codice lungo e casuale evita di dipendere da un PIN breve.

## Fonti e recupero dei dati

Vedi **[SOURCES.md](SOURCES.md)** per stato delle fonti, risultati delle prove e limiti.

L’app interroga separatamente IBS, Feltrinelli, Hoepli, Mondadori Store, Giunti e Amazon. Un link diretto dà priorità alla fonte indicata; le altre completano i campi vuoti. Le differenze vengono segnalate nell’anteprima, insieme alla provenienza dei valori proposti. Puoi dare priorità ai dati di un’altra fonte o correggere manualmente.

Il login e il secret `ACCESS_CODE` non cambiano. Pubblica prima il Worker 0.6.0 e poi fai commit e push dell’app. La parte Koofr non è stata modificata.

- Un’assenza o un blocco di una fonte non cancella i dati delle altre.
- Amazon è sperimentale. Per ISBN con prefisso 979 serve un link Amazon diretto, perché non esiste la conversione a ISBN-10 usata per costruire il suo indirizzo di prodotto.
- I redirect sono seguiti solo sullo stesso dominio e verso schede o immagini ammesse. Non viene eseguito JavaScript dei portali e non si risolvono CAPTCHA.
- Per Hoepli le richieste sono distanziate di dieci secondi per istanza. La ricerca può quindi richiedere più tempo rispetto alle altre fonti.
- Le schede con ISBN diverso o formato digitale vengono escluse. Lingua e sottotitolo rimangono vuoti se non dichiarati dalle fonti.
- Cache delle schede positive per 24 ore nel nodo Cloudflare, anche sul link canonico di un redirect. Le ricerche Giunti e le immagini non sono conservate nella cache condivisa.
- Limite best effort per istanza: 60 richieste metadati/copertine al minuto per IP e 12 richieste di login; dopo 12 password errate nell’arco di un minuto vengono bloccati anche gli altri endpoint protetti. Non è una quota globale distribuita.
- Le nuove richieste dirette ai portali non ricevono la password Bookflix. Il catalogo resta nel browser e non viene inviato ai portali.
- Le prove locali non sostituiscono una prova del Worker distribuito: accessibilità e tempi possono differire dai server Cloudflare.

## Errori frequenti

- **HTTP 503:** manca `ACCESS_CODE` sul Worker pubblicato.
- **HTTP 401:** il codice inserito nell’app non corrisponde al secret attuale.
- **Errore di rete dopo l’aggiornamento:** controlla deploy del Worker e preflight CORS; questa versione consente l’header Authorization.
- **HTTP 429:** attendi prima di riprovare.
- **Origine non autorizzata:** `ALLOWED_ORIGINS` deve contenere il dominio senza il percorso `/bookflix/`.

La libreria rimane locale e modificabile anche quando il servizio di scraping non è disponibile.
