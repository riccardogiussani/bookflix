# Bookflix: deduplicatore autori nel catalogatore locale

L’home apre l’[editor del catalogo centrale](CATALOG-ADMIN.md). Il deduplicatore è su `http://127.0.0.1:8091/autori`, raggiungibile dalla barra in basso.

Il servizio è lo stesso descritto in [GENRES.md](GENRES.md). La barra in fondo alla finestra permette di passare fra **Generi** e **Autori**. Le due cronologie di anteprime sono separate. Può essere eseguita una sola elaborazione alla volta.

## Avvio e prima verifica

Dopo aver aggiornato i sorgenti, riavvia il catalogatore dal suo terminale:

```powershell
Set-Location C:\Users\ricca\Repo\web-apps\bookflix\local-cataloger
uv run python app.py --project bookflix-c9d44
```

La credenziale Firestore è quella già usata dal catalogatore. Sostituisci il Project ID se stai usando un altro progetto. **Per gli autori Bonsai può restare spento:** questa funzione usa regole locali, non invia nomi a un modello e non richiede nuove chiavi.

1. Apri la pagina e scegli **Autori** dalla barra in basso.
2. Lascia inizialmente il limite a 30 libri e premi **Genera anteprima**. Questa operazione legge, senza scrivere, il catalogo centrale.
3. Controlla autori precedenti, nomi proposti e note delle trasformazioni.
4. Se una voce è **needs_review**, correggi o conferma i nomi nel campo **Un autore per riga**, poi premi **Conferma correzione nell’anteprima**. Questo salva solo il job locale.
5. Seleziona le proposte corrette e premi **Applica le proposte selezionate**. Viene chiesta conferma del progetto e del numero di libri.
6. In Bookflix premi **Aggiorna raccolta** e verifica i nomi in scheda e ricerca. Il Worker deve già includere l’integrazione del catalogatore descritta in GENRES.md; il deduplicatore riusa lo stesso meccanismo di aggiornamento della cache.

Le correzioni digitate e non confermate non sono applicabili; vengono conservate durante la revisione delle altre righe. Prima di cambiare strumento o anteprima, la pagina chiede se scartarle.

## Criteri applicati

- Spazi ripetuti, Unicode e apostrofi equivalenti vengono uniformati.
- **Cognome, Nome** diventa **Nome Cognome** quando c’è una sola virgola e non ci sono indizi di ruoli o suffissi ambigui.
- Parole tutte maiuscole/minuscole vengono normalizzate, preservando grafie interne già espresse, come **McCarthy**, e gli accenti.
- Le iniziali vengono spaziate e mantenute, senza espanderle in nomi inventati.
- Le grafie equivalenti per ordine, lettere e accenti ricevono una forma comune ricavata dal catalogo. Una grafia già presente con maiuscole interne, per esempio **Cormac McCarthy**, è preferita a una capitalizzazione generata come **Cormac Mccarthy**.
- I duplicati nello stesso libro vengono rimossi, preservando l’ordine e gli altri coautori.
- **AA.VV.** viene uniformato a **Autori vari**, come attribuzione collettiva.

Esempi:

| Prima | Proposta |
|---|---|
| `Eco, Umberto` | `Umberto Eco` |
| `UMBERTO ECO` | `Umberto Eco` |
| `GARCÍA MÁRQUEZ, GABRIEL` | `Gabriel García Márquez` |
| `J.R.R. TOLKIEN` | `J. R. R. Tolkien` |
| `Eco, Umberto; UMBERTO ECO` come due elementi della lista | Un solo `Umberto Eco` |

La lista degli autori è ancora memorizzata nei singoli libri: la deduplicazione rende coerenti le stringhe nel catalogo e rimuove ripetizioni nel singolo libro. Non viene creato un archivio di identità anagrafiche. Nomi uguali non consentono di distinguere omonimi già presenti come la stessa stringa.

## Casi da controllare

Le regole non provano l’identità di una persona. Restano da verificare enti, mononimi, nomi incompleti, ruoli editoriali, voci che sembrano contenere più persone, virgole multiple e possibili inversioni. Un nome senza virgola mantiene l’ordine originale: non viene presunto che la prima parola sia sempre un nome o sempre un cognome.

Le varianti che differiscono negli accenti sono segnalate, senza essere fuse automaticamente. Iniziali, pseudonimi e nomi completi diversi non vengono uniti sulla base della somiglianza. Per esempio **J. R. R. Tolkien** non viene automaticamente collegato a **John Ronald Reuel Tolkien**. Puoi stabilire la forma desiderata manualmente nell’anteprima.

Un acronimo isolato come **NASA** mantiene le maiuscole e resta da verificare come nome singolo/possibile ente, finché non confermi la denominazione corretta. Le conferme manuali vengono registrate e non vengono annullate dal successivo passaggio automatico sullo stesso contenuto.

## Scansione, dati e ripresa

Per trovare grafie comuni la prima anteprima legge **tutto il catalogo centrale**, anche se chiedi soltanto 30 proposte. Il limite indica quanti libri da correggere mostrare, non quanti documenti leggere per costruire l’indice. La scansione è riusata in memoria per le anteprime successive e aggiornata con le modifiche applicate dal servizio.

Se aggiungi o modifichi libri da altri dispositivi, seleziona **Rileggi tutto il catalogo da Firestore** per aggiornare l’indice. Anche un riavvio ricostruisce l’indice alla successiva richiesta. Su un catalogo grande evita riletture inutili: valgono le quote gratuite Firestore. Non vengono proposti libri senza autori o libri già coerenti e senza ambiguità.

Le scritture sono atomiche per libro e aggiornano soltanto:

- `catalog/<edizione>.metadata.authors`;
- `catalog/<edizione>.authorNormalization`, con versione `1.0`, sorgente, nomi confermati e identificativo della proposta;
- `system/catalogState.authorRevision`, per aggiornare la cache;
- `authorAudit/<UUID>`, con i valori precedenti e successivi.

Non vengono modificati generi, classificazione Bonsai, trama, copertine, rilegatura, voti, recensioni o permessi. **Le correzioni autori specifiche delle librerie (`overrides.authors`) restano conservate**, quindi possono continuare a mostrare una grafia personale diversa dal catalogo centrale.

Se il documento è cambiato dopo l’anteprima, la proposta viene marcata **conflict** e non lo sovrascrive. Genera una nuova anteprima aggiornata. La ripresa riconosce scritture già riuscite e non le ripete. I job autori sono in `.bookflix-classifier.local.jobs/authors/`, esclusa da Git insieme ai job generi. Le correzioni manuali non modificano immediatamente gli altri libri. Le grafie confermate possono essere riutilizzate nelle proposte successive per varianti equivalenti nelle lettere e negli accenti; iniziali diverse, pseudonimi e nomi differenti restano separati. Seleziona e verifica anche le proposte degli altri libri prima di applicarle.

Le esenzioni dagli indici per `authorNormalization` e `authorAudit` sono in `firestore.indexes.json`. Sono un’ottimizzazione, non un nuovo requisito di accesso. Puoi pubblicarle con:

```powershell
npx firebase-tools deploy --only firestore:indexes --project bookflix-c9d44
```

Non c’è un annullamento globale nell’interfaccia; i valori precedenti sono conservati nell’audit e nell’anteprima per un eventuale ripristino amministrativo.

## API locale

Stesse restrizioni di Host, Origin e header del catalogatore. Per POST usa `Content-Type: application/json` e `X-Bookflix-Local: 1`.

| Endpoint | Funzione |
|---|---|
| `GET /authors/jobs` | Elenco job autori |
| `GET /authors/jobs/<UUID>` | Anteprima e avanzamento |
| `POST /authors/preview` | `{"limit":30,"force":false}`; `force` rilegge il catalogo |
| `POST /authors/review` | Correzione locale: `{"jobId":"UUID","editionId":"isbn_...","authors":["Nome Cognome"]}` |
| `POST /authors/apply` | Scrittura esplicita: `{"jobId":"UUID","editionIds":["isbn_..."]}` |

Le anteprime possono essere ripetute su edizioni specifiche con `editionIds`, come quelle dei generi. Il frontend lo fa con **Rielabora questi libri**.

I test usano dati e Firestore simulati, senza aprire credenziali reali. Coprono formati, omonimie/varianti ambigue, coautori, revisione manuale, maschere di aggiornamento, conflitti, ripresa e cache della scansione. Per verificare i dati veri usa il campione iniziale e applica prima una sola proposta.
