# Collegare Bookflix a Koofr

L’app resta su GitHub Pages. Il Worker esistente collega il browser a WebDAV: le credenziali Koofr restano nei secret Cloudflare. Nessuna migrazione dell’archivio locale precedente è prevista. Il vecchio archivio IndexedDB non viene cancellato; Bookflix usa ora una cache separata.

## 1. Crea una password WebDAV

Accedi a Koofr, apri le impostazioni dell’account e la sezione delle password. Genera una **password specifica per applicazione** con nome `Bookflix`. Usa la tua email Koofr e questa password dedicata, non la password principale dell’account.

Guida ufficiale: https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/

Non scrivere password nei file del progetto, nei commit o in chat.

## 2. Configura i due secret del Worker

Da PowerShell, nella cartella `C:\Users\ricca\Repo\web-apps\bookflix`, esegui separatamente:

```powershell
npx wrangler secret put KOOFR_USERNAME --config .\worker\wrangler.jsonc
```

Inserisci la tua email Koofr quando richiesta. Poi:

```powershell
npx wrangler secret put KOOFR_PASSWORD --config .\worker\wrangler.jsonc
```

Inserisci la password dedicata appena generata. Il secret `ACCESS_CODE` del login Bookflix rimane quello esistente; non serve cambiarlo.

## 3. Pubblica il Worker

```powershell
npx wrangler deploy --config .\worker\wrangler.jsonc
```

Il file `worker/koofr.mjs` deve rimanere insieme a `scraper.mjs`: Wrangler include automaticamente entrambi. Non usare il deploy automatico Vite dalla radice senza `--config`.

Apri https://bookflix-scraper.riciriccio.workers.dev/health e controlla `version: "0.7.0"` e `storage.configured: true`. Questo conferma la presenza delle impostazioni, **non** la correttezza delle credenziali: quella viene verificata quando l’app legge o salva la raccolta.

## 4. Pubblica l’app

Fai commit e push delle modifiche su `main`, inclusi i nuovi file `src/cloud.ts`, i test e `worker/koofr.mjs`. Il workflow GitHub Pages pubblica l’interfaccia aggiornata dopo test e build.

Accedi con il login Bookflix abituale. Se le credenziali Koofr sono corrette vedrai “Raccolta Koofr”. Se compaiono errori, correggi i secret e premi **Aggiorna raccolta**.

## Struttura della raccolta

```text
.booflix/
  ca91c2ce-b8c7-487e-8f40-99024a354c63/
    collection.json
    books.json
    covers/
      <uuid>.jpg | .png | .webp
```

Il percorso `.booflix` segue il nome concordato. Le cartelle vengono create automaticamente al primo salvataggio; inizialmente la lettura di una raccolta vuota non scrive su Koofr.

L’UUID è nella variabile `KOOFR_COLLECTION_ID` in `worker/wrangler.jsonc`. È pubblico, non è una password: tutti i dispositivi dello stesso Worker aprono la stessa raccolta. Non cambiarlo dopo aver iniziato a inserire libri, altrimenti aprirai un’altra raccolta vuota. La struttura supporta raccolte separate; il selettore nell’interfaccia non è ancora previsto in questa fase.

`books.json` è JSON aperto e contiene i metadati e i riferimenti alle copertine. Le copertine sono file separati e immutabili. Quando cambi o rimuovi una copertina, il vecchio file può restare su Koofr senza essere referenziato: non viene eliminato automaticamente per evitare interferenze con salvataggi concorrenti. Anche l’eliminazione di un libro rimuove il record dal catalogo, ma può lasciare la copertina. Una futura pulizia potrà rimuovere i file inutilizzati.

## Verifiche da fare tu

1. **Primo salvataggio:** inserisci un libro con copertina. Controlla su Koofr la creazione della struttura e ricarica l’app: il libro deve restare.
2. **Altro dispositivo:** apri Pages dal telefono e accedi. Devi vedere lo stesso libro e la stessa copertina. Modificalo; sul computer premi Aggiorna raccolta.
3. **Conflitto:** apri la raccolta su entrambi i dispositivi. Salva dal telefono, poi prova a salvare dal computer senza aggiornare. Deve apparire il conflitto e il modulo deve rimanere aperto. Dopo l’aggiornamento, se lo stesso libro è cambiato devi riaprirlo prima di salvare. Le modifiche ad altri libri possono essere riprovate dopo l’aggiornamento.
4. **Rete assente:** con l’app già aperta e la raccolta caricata, scollega la rete. La consultazione della copia locale deve funzionare; il salvataggio viene disabilitato o rifiutato. Ricollegati e premi Aggiorna raccolta.
5. **Backup:** esporta lo ZIP e reimportalo. Verifica i metadati e le copertine anche dall’altro dispositivo. L’importazione sostituisce il catalogo cloud dopo conferma.
6. **Eliminazione:** elimina un libro e controlla dall’altro dispositivo dopo Aggiorna raccolta.

Nessuna prova con il tuo account Koofr è stata eseguita dall’agente. I controlli automatici usano un servizio WebDAV simulato, compresi If-Match/If-None-Match: la prova del conflitto verifica il comportamento effettivo di Koofr.

## Rete, cache e limiti

- Serve Internet per il login e per ricaricare il sito: non è ancora una PWA offline. La consultazione senza rete funziona nell’app già aperta, dopo il caricamento della raccolta.
- La raccolta viene riletta all’accesso e con Aggiorna raccolta; non c’è aggiornamento in tempo reale. Prima di ogni scrittura l’app controlla la versione remota e usa una scrittura condizionata WebDAV.
- Il browser aggiorna la propria cache solo dopo la conferma del catalogo remoto. Se manca una copertina o il catalogo è corrotto, la vecchia cache non viene sostituita. I download delle immagini sono limitati a quattro contemporanei; le copertine già presenti vengono riutilizzate.
- Un errore dopo un timeout può avere esito incerto: aggiorna la raccolta prima di riprovare. Gli upload delle immagini precedono il catalogo; un salvataggio fallito può lasciare immagini non referenziate.
- Limiti: catalogo JSON 16 MiB, 20.000 record, ogni immagine 10 MiB. Per il backup ZIP resta il limite di 200 MiB. Le quote del tuo piano Koofr e Cloudflare si applicano normalmente; non sono stati attivati servizi a pagamento.
- Lo username Bookflix resta solo un nome visualizzato. Chi conosce la password Bookflix può leggere e modificare questa raccolta. Le credenziali Koofr non arrivano al browser, ma autorizzano il Worker ad accedere allo spazio WebDAV: conserva la password dedicata e revocala su Koofr se necessario.
