# Bookflix: editor locale del catalogo centrale

## Area amministrativa online

Nell’app Bookflix, apri **Impostazioni e account → Accedi come amministratore**. Accedi prima con il tuo account Firebase, poi inserisci il valore di `ADMIN_TOKEN`. Il token è un secret del Worker. In `.env.example`, `ADMIN_TOKEN` è un segnaposto.

Dalla radice del progetto, configura il secret con un token casuale di almeno 32 caratteri e pubblica il Worker. Il primo comando richiede il valore in modo interattivo.

```powershell
npx wrangler secret put ADMIN_TOKEN --config .\worker\wrangler.jsonc
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Pubblica anche il frontend. La sessione amministrativa dura 30 minuti e viene rimossa dal browser all’uscita dall’area o al ricaricamento della pagina. Il catalogo online permette ricerca, inserimento e modifica manuale, anche multipla, con copertine. Le sezioni **Generi**, **Autori**, **Titoli** e **Copertina** mostrano **In arrivo…**. Le istruzioni seguenti riguardano l’editor Python su localhost.

L’home del progetto Python `local-cataloger/` mostra tutte le edizioni della collezione Firestore `catalog`, anche quelle non collegate a una libreria. Ricerca libera sui metadati, filtro per genere e copertine caricate quando visibili. Seleziona un libro per aprire l’editor nello stile di Bookflix.

## Avvio

Riavvia il servizio dal terminale:

```powershell
Set-Location C:\Users\ricca\Repo\web-apps\bookflix\local-cataloger
uv run python app.py --project bookflix-c9d44
```

Apri [il catalogo centrale](http://127.0.0.1:8091/). Riutilizza il file `.bookflix-firestore-service-account.local.json` nella radice del progetto e i suoi permessi IAM. Non serve un nuovo account o un deploy del Worker. Il servizio accetta richieste solo da localhost; non esporlo in rete.

La barra in basso apre **Catalogo generale**, **Generi**, **Autori**, **Titoli** e **Copertina**. Generi, Autori e Titoli hanno cronologie separate.

In **Titoli**, avvia Bonsai, seleziona i libri e premi **Genera proposte**. Il filtro **Solo tutto maiuscolo** aiuta a trovare i titoli in caps lock. Lo stile Bookflix mette in maiuscolo l’iniziale delle parole principali, come in *Perry Mason e le Zampe di Velluto*. Il controllo accetta solo cambi di maiuscole e minuscole. Puoi correggere ogni proposta e poi applicare quelle selezionate al catalogo centrale. Le librerie con un titolo personalizzato conservano la loro scelta.

## Editor e suggerimenti

- **Autori ↻:** riusa il normalizzatore esistente e la grafia presente nel catalogo. Uniforma Nome Cognome, iniziali e maiuscole e rimuove duplicati certi. Segnala i casi ambigui senza unire persone diverse per somiglianza.
- **Editore ↻:** propone la grafia già presente per la stessa denominazione, confrontando spazi e maiuscole. Non unisce automaticamente marchi o denominazioni differenti.
- **Generi ✦:** chiama Bonsai sul PC con output JSON vincolato, senza reasoning o rationale. Compila un primario, fino a due secondari facoltativi, forma e pubblico. Richiede Bonsai acceso con la configurazione già usata dal classificatore; usa sempre la modalità JSON anche se il batch viene avviato in modalità fast. Non modifica il formato fisico.
- Puoi correggere manualmente tutti i metadati, la classificazione strutturata e i generi liberi precedenti. Se assegni un primario, i generi salvati derivano dal primario e dai secondari.

I suggerimenti modificano soltanto la bozza. **Salva per tutti** applica le modifiche a un libro esistente. Annullando si scartano le modifiche al libro.

Per inserire una nuova edizione, premi **Aggiungi libro**. Compila almeno il titolo e premi **Aggiungi al catalogo**. L’ISBN è facoltativo. Se è già presente, l’inserimento viene rifiutato. Il libro viene salvato nel catalogo centrale senza essere assegnato a una libreria.

Premi **Seleziona** nel catalogo per scegliere uno o più libri. **Modifica** apre la scheda normale se hai selezionato un libro e la modifica multipla se ne hai selezionati almeno due. I valori condivisi sono visibili, mentre il trattino (—) indica valori diversi. Si salvano soltanto i campi con **Applica** spuntato. Puoi anche cambiare o rimuovere la copertina per l’intera selezione. L’ISBN si modifica dalla scheda singola.

## Copertine

Puoi caricare un JPEG, PNG o WebP fino a 10 MB, oppure rimuovere la copertina. Le immagini continuano a risiedere su Koofr, con gli stessi percorsi e la stessa deduplicazione SHA-256 dell’app.

**✦ Leggi copertina con AI** usa la foto della copertina attuale per proporre titolo, autori ed editore. Avvia Bonsai con `start.ps1` come indicato nella [guida Bonsai](GENRES.md#3-avvia-bonsai-primo-terminale), così il server carica anche il proiettore per le immagini. I dati leggibili vengono inseriti nella bozza, mentre i campi mancanti conservano il valore presente. Controlla la proposta prima di salvare.

Per importare più libri, apri **Copertina** nella barra in basso, seleziona le immagini e premi **Analizza coda**. Bonsai le elabora una alla volta. Puoi mettere in pausa dopo l’immagine in corso e riprendere da quelle in attesa. Correggi le schede, aggiungi l’ISBN se lo conosci e premi **Aggiungi selezionati** per salvare solo i libri spuntati. Il titolo è obbligatorio. I risultati e gli errori sono mostrati per singolo libro. La coda resta in memoria nella pagina, quindi tienila aperta fino alla fine della revisione.

Per visualizzare e caricare le immagini il servizio deve conoscere le credenziali Koofr: non può leggere i secret già caricati su Cloudflare. Per impostazione predefinita cerca `KOOFR_USERNAME` e `KOOFR_PASSWORD` nel file locale `.bookflix-secrets.local.json` nella radice del progetto. Se sono già presenti non devi fare altro. In alternativa usa variabili di ambiente o un altro file JSON con `--koofr-secrets PERCORSO`.

Esempio di struttura del file locale (sostituisci i segnaposto personalmente, senza pubblicare il file):

```json
{
  "KOOFR_USERNAME": "LA_TUA_EMAIL_KOOFR",
  "KOOFR_PASSWORD": "LA_TUA_PASSWORD_APPLICATIVA_KOOFR"
}
```

Il caricamento prepara un file immutabile su Koofr. Il libro usa la nuova immagine solo dopo il salvataggio. Se annulli, il file caricato può restare non referenziato; le immagini precedenti non vengono cancellate, perché potrebbero essere condivise.

## Effetto del salvataggio root

Il salvataggio aggiorna l’edizione centrale e rimuove dalle copie nelle librerie le personalizzazioni **dei soli campi modificati**. Cambiare autore non elimina, per esempio, un titolo personalizzato o una posizione. Sostituire/rimuovere la copertina elimina gli override della copertina. Voti, recensioni, ruoli e posizioni rimangono separati per libreria.

Un cambio di ISBN sposta l’edizione sul nuovo identificatore e aggiorna i collegamenti conservando gli ID degli elementi nelle librerie, quindi i riferimenti a voti e recensioni. Sono ammessi ISBN-10 e ISBN-13 validi; gli ISBN-10 vengono convertiti in ISBN-13. Un ISBN già catalogato causa un conflitto, senza unire o sovrascrivere libri. Se togli l’ISBN viene usato un identificatore manuale.

Il salvataggio è atomico: controlla la versione del libro, degli elementi collegati e delle librerie lette. In caso di modifica concorrente non applica una parte dell’aggiornamento: riapri il libro e riprova. Il registro `catalogAdminAudit` conserva il prima/dopo centrale e le personalizzazioni dei riferimenti; non c’è ancora un pulsante di ripristino. Aggiorna `system/catalogState`, già usato dal Worker per invalidare la cache. Gli utenti vedono i nuovi dati al successivo aggiornamento della raccolta.

Per evitare salvataggi parziali il servizio rifiuta operazioni che superano il proprio limite di 450 scritture o le dimensioni consentite. Nessuna elaborazione parte automaticamente all’avvio. Il file `firestore.indexes.json` include esenzioni dagli indici per i dati estesi del nuovo audit; pubblicarle è un’ottimizzazione, non un requisito per aprire l’editor.

## Verifica manuale

1. Apri il catalogo, cerca un libro e aprilo: i campi devono corrispondere all’edizione centrale.
2. Usa ↻ su autori/editore e ✦ sui generi: controlla i valori proposti; premi Annulla e riapri per verificare che non siano stati salvati.
3. Cambia un campo e premi Salva per tutti. Aggiorna Bookflix in due librerie contenenti quel libro: il campo cambia in entrambe; posizione e contributi personali restano invariati.
4. Sostituisci una copertina, salva e aggiorna Bookflix. Prova anche Rimuovi copertina.
5. Apri lo stesso libro in due schede dell’editor: dopo il primo salvataggio, il secondo deve segnalare un conflitto.

I test automatici usano Firestore, Bonsai e Koofr simulati: nessuna prova automatica scrive nel catalogo reale.
