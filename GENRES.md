# Bookflix: classificazione locale con Bonsai — generi 2.0

L’home apre l’[editor del catalogo centrale](CATALOG-ADMIN.md). Il classificatore è su `http://127.0.0.1:8091/generi`, raggiungibile dalla barra in basso.

Il servizio in `local-cataloger/` legge le edizioni da Firestore, genera un’anteprima con Bonsai e applica soltanto le proposte che selezioni. Non parte nessun aggiornamento all’avvio. Il modello resta sul PC; non ci sono chiamate a OpenAI o altri modelli a pagamento.

La voce **Autori** della barra in basso apre il deduplicatore descritto in [AUTHORS.md](AUTHORS.md). Il deduplicatore usa lo stesso servizio e credenziale ma non richiede Bonsai acceso. Le cronologie sono separate.

## 1. Liste e struttura

La fonte unica delle liste è `shared/genre-taxonomy.json`, riusata da app, Worker e servizio Python. Contiene:

- **23 generi**, ciascuno con ID stabile, etichetta italiana e definizione.
- **12 forme dell’opera**: romanzo, racconto, raccolta di racconti, saggio, biografia/autobiografia, diario/memorie, raccolta poetica, opera teatrale, fumetto/graphic novel, manuale/guida, opera di consultazione, antologia mista.
- **5 pubblici**: bambini, ragazzi, young adult, adulti, trasversale. Se non determinabile, il valore è `null`.
- **4 formati fisici**: brossura, copertina rigida, spillato, altro. Il modello non li assegna: il campo è modificabile manualmente nell’app.

I generi sono: Narrativa generale, Giallo, Thriller, Fantascienza, Fantasy, Romance, Horror, Romanzo storico, Avventura, Biografie e autobiografie, Storia, Filosofia, Politica e società, Religione e spiritualità, Psicologia, Scienza e divulgazione, Arte e cultura, Economia e lavoro, Tecnologia e informatica, Salute e benessere, Saggistica generale, Poesia, Teatro.

Ogni risultato riuscito contiene **un primario e da zero a due secondari**, distinti e presenti nella lista. «Da verificare» è uno stato, non un genere. Una semplice ambientazione storica, un tema o una sottotrama non bastano a giustificare un secondario.

## 2. Pubblica prima l’integrazione Bookflix

Dalla radice di `bookflix`:

```powershell
npm test
npm run build
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Poi commit e push dei file pubblici, inclusa la cartella `shared/`. Aggiorna la PWA quando viene proposto. Non pubblicare la credenziale privata o le anteprime locali.

È cambiata anche la configurazione degli indici, con esenzioni per i dati di classificazione e audit. Per applicarle, usando il tuo progetto:

```powershell
npx firebase-tools deploy --only firestore:indexes --project bookflix-c9d44
```

Il nome del progetto riportato negli esempi è quello mostrato nelle tue schermate; sostituiscilo se stai usando un altro progetto. Non servono nuovi account cloud, secret o provider. Il servizio usa il service account già preparato per Firestore, con ruolo `roles/datastore.user`.

Questa pubblicazione fa riconoscere all’app gli aggiornamenti al catalogo centrale, senza riscrivere tutte le librerie. Un modulo aperto prima della classificazione viene bloccato al salvataggio se basato su dati vecchi: conserva la bozza, aggiorna la raccolta e riapri il libro.

## 3. Avvia Bonsai, primo terminale

Usa il progetto che hai già sul PC:

```powershell
Set-Location C:\Users\ricca\Repo\python\bonsai-test
.\start.ps1
```

Attendi il caricamento del modello sulla porta `8080`. La classificazione dei generi usa solo testo. Lo script carica anche il proiettore multimodale richiesto per leggere le copertine dall’editor.

Se il server divide il contesto su più slot e segnala spazio insufficiente, avvialo esplicitamente con un solo slot:

```powershell
.\llama.cpp\llama-server.exe -m .\models\Bonsai-27B-Q1_0.gguf -ngl 99 -c 8192 --parallel 1 --host 127.0.0.1 --port 8080
```

Il catalogatore controlla il contesto effettivo per slot e conta i token del prompt formattato, riservando spazio alla risposta. Se trama e tassonomia non entrano, segnala l’errore: non taglia silenziosamente il testo. Non aumentare il contesto oltre le risorse disponibili della GPU.

## 4. Avvia il catalogatore, secondo terminale

Prerequisiti: Python 3.11+ e `uv` (già usato dal progetto Bonsai).

```powershell
Set-Location C:\Users\ricca\Repo\web-apps\bookflix\local-cataloger
uv run python app.py --project bookflix-c9d44 --mode json
```

Al primo avvio `uv` prepara l’ambiente Python del solo catalogatore e installa `google-auth` con il trasporto HTTP. Non scarica il modello Bonsai.

La credenziale viene letta a runtime dal file già previsto:

```text
bookflix/.bookflix-firestore-service-account.local.json
```

Se il file è altrove, aggiungi `--credentials "C:\percorso\chiave.json"`. Non incollare il contenuto nel prompt, nel codice o nella chat. Il servizio verifica che la credenziale appartenga al progetto indicato.

Apri **http://127.0.0.1:8091/generi**. Il servizio accetta richieste solo sull’interfaccia locale, controlla Host e Origin e non abilita CORS verso Pages o altri siti. Tieni entrambi i terminali aperti; `Ctrl+C` chiude il relativo servizio.

## 5. Seleziona e rivedi i libri

1. In **Libri nel catalogo** trovi tutte le edizioni. **✓ Classificato** indica una classificazione salvata, **◐ Da rivedere** un’anteprima per la revisione corrente del libro o una classificazione incompleta, **○ Da elaborare** l’assenza di entrambe.
2. Clicca i libri da elaborare e premi **Genera proposte**. Puoi selezionare anche libri già classificati. **Elaborazione per quantità** mantiene la scansione automatica per numero di libri.
3. Controlla i generi precedenti e la proposta. Puoi cambiare il primario, i secondari, la forma e il pubblico. **Conferma correzione nell’anteprima** salva la modifica nella cronologia locale.
4. Spunta le proposte da applicare. Se Bonsai non ha assegnato un genere primario, puoi sceglierlo tu nell’anteprima per rendere applicabile la proposta.
5. Seleziona inizialmente uno o due risultati corretti e premi **Applica le proposte selezionate**. Il browser mostra il progetto e il numero di edizioni prima della conferma.
6. In Bookflix premi **Aggiorna raccolta**: la riga del primario, i tag e la ricerca devono usare i nuovi generi. Forma e pubblico sono nella scheda; il formato fisico si compila manualmente.
7. Verifica che una correzione di genere specifica di una libreria sia rimasta conservata.

La modalità predefinita è `json`, con output compatto vincolato, `enable_thinking: false` e `reasoning_effort: "none"`. Non vengono richiesti né salvati reasoning o rationale. Il limite è 128 token di output per chiamata, massimo 256 per libro (non un consumo fisso). L’anteprima mostra il consumo effettivo riportato dal server; se manca, lo indica come non disponibile. Bonsai compie due passaggi: prima primario/forma/pubblico, poi i secondari eventuali. Le risposte sono vincolate tramite JSON Schema e ricontrollate in Python. I metadati sono trattati come dati, non istruzioni. Non si utilizzano punteggi di confidenza inventati né probabilità del primo token per autorizzare aggiornamenti.

Il prompt completo è in `local-cataloger/cataloger.py` (`SYSTEM` e `Bonsai.classify`). Gli input sono titolo, sottotitolo, autori, descrizione, vecchi generi, editore e lingua. Le informazioni precedenti sono indizi, non vincoli. Il modello è istruito a non aggiungere dettagli della trama dalla memoria.

Puoi riprovare le stesse edizioni con **Rielabora questi libri**. `--mode fast` conserva la variante sperimentale a etichette (fino a cinque chiamate da quattro token). Per confrontarle cambia modalità, riavvia solo il catalogatore e riapri la vecchia anteprima. Le nuove proposte restano separate.

## 6. Cosa viene scritto e come riprendere

Solo dopo l’applicazione esplicita, un singolo commit atomico:

- aggiorna `catalog/<edizione>.classification`;
- aggiorna `catalog/<edizione>.metadata.genres` con etichette italiane, primario per primo;
- cambia `system/catalogState.genreRevision`, per invalidare la cache delle librerie;
- aggiunge `genreAudit/<UUID>` con generi e classificazione precedenti e nuova proposta.

La classificazione contiene `primaryGenre`, `secondaryGenres`, `workForm`, `audience`, `genreVersion: "2.0"`, `genreStatus: "classified"`, sorgente, impronta dell’input e data. Le proposte di Bonsai includono modello, versione del prompt e consumo token riportato dal server. Le proposte corrette hanno sorgente `manual`. `genreVersion` è una stringa. Non vengono aggiornati titolo, trama, posizione, immagini, rilegatura, membri, recensioni o voti.

Ogni edizione è classificata una volta nel catalogo centrale. Le librerie con generi personali (`overrides.genres`) mantengono le proprie scelte e le proprie righe; quelle senza override usano il solo primario nelle righe principali. I secondari restano nei tag e nella ricerca. Non sono stati introdotti nuovi selettori di filtri: la ricerca testuale trova anche secondari, forma, pubblico e formato fisico.

L’anteprima conserva la revisione del documento. Se qualcuno modifica quel documento prima dell’applicazione, il servizio segnala `conflict` e non lo sovrascrive. Serve una nuova anteprima. Non ci sono fusioni automatiche di una proposta obsoleta.

Le anteprime sono file JSON in `.bookflix-classifier.local.jobs/`, esclusa da Git. Se interrompi il servizio, puoi riaprire il job dal selettore **Riprendi un’anteprima**. I risultati applicati non vengono riscritti; un commit riuscito prima di un’interruzione viene riconosciuto alla ripresa. Gli errori di rete applicativi possono essere ritentati selezionando di nuovo la proposta. I conflitti richiedono una nuova analisi.

Le proposte «da verificare» restano nell’anteprima e non ricevono la versione nel database. Le nuove anteprime includono documenti privi di versione; i documenti con versione `2.0` vengono saltati, salvo selezionare **Includi quelli già classificati**. La scansione avanza con un cursore salvato nelle anteprime per evitare di rileggere ogni volta l’intero catalogo; torna all’inizio quando raggiunge la fine, così ritrova anche eventuali edizioni aggiunte prima del cursore.

Dopo il campione iniziale puoi aumentare il lotto fino a 200 libri. L’elaborazione resta sequenziale per non sovraccaricare la GPU. L’applicazione è atomica per libro, non per l’intero lotto: la pagina indica quali scritture sono riuscite e quali no.

Non esiste ancora un pulsante di annullamento globale. L’audit cloud e la copia locale conservano i valori precedenti per un ripristino amministrativo. Evita di modificare direttamente i file dei job mentre il servizio è in esecuzione.

## 7. API locale

Le chiamate POST richiedono `Content-Type: application/json` e `X-Bookflix-Local: 1`.

| Endpoint | Funzione |
|---|---|
| `GET /health` | Configurazione del servizio locale; non prova le credenziali cloud |
| `GET /taxonomy` | Liste e definizioni |
| `GET /jobs` | Identificativi delle anteprime salvate |
| `GET /jobs/<UUID>` | Stato, risultati e metadati di un’anteprima |
| `POST /preview` | Avvia lettura e classificazione: `{"limit":30,"force":false}` |
| `POST /apply` | Applica solo le edizioni selezionate: `{"jobId":"UUID","editionIds":["isbn_978..."]}` |

Entrambi i POST restituiscono HTTP 202 e `jobId`; consulta `GET /jobs/<UUID>` per l’avanzamento. È consentita una sola elaborazione alla volta. Le anteprime leggono il progetto cloud reale scelto dall’utente; l’inferenza è locale.

## 8. Verifiche eseguite e limiti

I test Python usano Firestore e Bonsai simulati: nessuna credenziale reale viene aperta. Coprono categorie, astensione, secondari, token, JSON, maschere di aggiornamento, conflitti, ripresa e restrizioni dell’API. I test dell’app coprono primario/secondari e ricerca; quelli del Worker coprono cache centrale, correzioni locali e aggiornamenti concorrenti. Le chiamate di rete reali e l’accuratezza sui tuoi libri vanno verificate con il campione iniziale dopo aver avviato Bonsai.

```powershell
# Dalla radice di bookflix
python -m unittest discover -s .\local-cataloger -p "test_*.py"
npm test
npm run build
```

Riferimenti: [API llama.cpp e JSON Schema](https://github.com/ggml-org/llama.cpp/tree/master/tools/server), [commit atomici Firestore](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit).
