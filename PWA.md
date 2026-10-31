# Bookflix: installazione e icone

Nome pubblico: **Bookflix**, nel titolo del browser, nel login, nell’intestazione e nell’app installata. I nuovi backup si chiamano `bookflix-backup-…zip`; il formato ZIP storico resta compatibile.

Le icone derivano dall’`icon.jpg` fornito nella radice del progetto. I file già generati sono in `public/`: favicon PNG/ICO, icona Apple 180 px, icone PNG 192 e 512 px e variante maskable per Android. Non serve un convertitore di immagini per eseguire la build.

Il manifest definisce nome, icone, visualizzazione standalone, ID `/bookflix/`, start URL e scope del progetto. Nome, icone e manifest sono parte dei [requisiti di installazione documentati da MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). L’ID è distinto dalle altre app sulla stessa origine GitHub Pages; [la risoluzione dell’ID usa l’origine dello start URL](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id).

## Pubblicazione

Fai commit e push, includendo `public/`, `scripts/pwa-build.mjs`, `scripts/sw-template.js`, i nuovi file PWA in `src/`, `index.html` e `vite.config.ts`. GitHub Actions genera e pubblica il sito. Non serve modificare secret o aggiornare il Worker per questa funzione.

La build genera `sw.js` con i file statici effettivamente prodotti da Vite. La modalità `npm run dev` non registra il service worker: per la verifica dell’installazione usa la versione pubblicata oppure una build di produzione.

## Verifica su Android

1. Apri [Bookflix](https://riccardogiussani.github.io/bookflix/) in Chrome o Brave, in una scheda normale con connessione attiva. Attendi il caricamento completo e ricarica.
2. Premi **Installa Bookflix** se il browser propone il pulsante nell’app. In alternativa usa il menu del browser: **Installa app** / **Aggiungi alla schermata Home**. La dicitura dipende dal browser.
3. Apri dall’icona: controlla nome Bookflix, icona fornita e finestra senza la normale barra degli indirizzi. Controlla anche la favicon nella scheda del browser.
4. Se avevi una vecchia scorciatoia, rimuovi solo quella e installa la nuova app. Non occorre cancellare i dati del sito.

I controlli automatici verificano manifest, dimensioni reali delle icone, percorsi sotto `/bookflix/`, cache e isolamento delle richieste autenticate. L’installazione fisica sui telefoni resta da provare dall’utente dopo il push.

## Cache e aggiornamenti

La cache conserva soltanto l’interfaccia e le icone; le richieste autenticate, le API del Worker e gli upload restano fuori. I libri e le copertine continuano a essere gestiti da IndexedDB e Koofr. Login, verifica delle sessioni e salvataggi richiedono ancora la rete. Una libreria già aperta resta consultabile nella copia locale; la presenza della PWA non abilita un nuovo login offline.

Le nuove versioni attendono il pulsante **Aggiorna Bookflix**: non viene eseguito un ricaricamento automatico mentre stai compilando un libro o una recensione. Salva eventuali modifiche prima di premere il pulsante. Le cache delle altre applicazioni sulla stessa origine non vengono eliminate.
