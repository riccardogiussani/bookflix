# Fonti Bookflix — versione 0.6.0

## Come funziona

L’app effettua una richiesta separata al Worker per ciascuna fonte. Questo isola errori e lavoro di estrazione, invece di analizzare sei grandi pagine in una sola richiesta sul Worker gratuito. La password autentica ciascuna richiesta e non viene inoltrata ai portali.

Priorità iniziale: eventuale link esplicito, poi Feltrinelli, IBS, Amazon, Hoepli, Mondadori Store e Giunti. Anche la copertina viene cercata prima su Feltrinelli. La regola di scelta è condivisa da app e adattatori del Worker in `shared/metadata-selection.mjs`. Per titolo, sottotitolo, autori, editore, anno, pagine, lingua e generi una fonte successiva completa i campi vuoti o non validi. Per la trama viene scelta la più lunga fra quelle valide, dopo la pulizia di HTML e spazi, indipendentemente dalla priorità della fonte. A parità di lunghezza vince la fonte prioritaria. Segnaposto e descrizioni palesemente commerciali vengono scartati; queste sono euristiche, non una verifica semantica del contenuto. Le lingue più comuni vengono normalizzate, gli autori e i generi deduplicati e le categorie generiche come «Libri» escluse. Pagine e anno non vengono scelti per valore massimo: i conflitti restano visibili. L’anteprima mostra le differenze e la provenienza dei dati proposti. “Usa i dati di…” è una scelta manuale esplicita: usa i campi validi di quella fonte, anche una trama più breve, completando quelli mancanti con la selezione automatica. Le correzioni manuali restano disponibili prima del salvataggio. La provenienza descrive i dati recuperati, non le successive correzioni manuali.

La corrispondenza ISBN deve essere dichiarata nella scheda: un ISBN nell’URL, una raccomandazione o una recensione non sono sufficienti. ISBN-10 e ISBN-13 equivalenti vengono riconosciuti. Non vengono importati prezzi, disponibilità o recensioni dei clienti.

Le nuove regole si applicano ai nuovi recuperi. Le edizioni già nel catalogo centrale mantengono i dati salvati: non viene eseguita una riclassificazione o una sostituzione automatica. Gli adattatori conservano tutti i paragrafi disponibili della trama Amazon e confrontano le descrizioni JSON-LD che dichiarano lo stesso ISBN. L’adattatore Hoepli continua a preferire il blocco HTML della trama al JSON-LD noto per contenere testo corrotto.

## Fonti

| Fonte | Ricerca da ISBN | Estrazione |
|---|---|---|
| IBS | Indirizzo di prodotto basato sull’ISBN, con redirect canonico | JSON-LD Book/Product e autori nella scheda |
| Feltrinelli | Indirizzo di prodotto basato sull’ISBN, con redirect canonico | JSON-LD Book/Product e autori nella scheda |
| Hoepli | Indirizzo di prodotto basato sull’ISBN, con redirect canonico | Book annidato in WebPage, titolo/autori/trama dall’HTML della scheda |
| Mondadori Store | Indirizzo di prodotto basato sull’ISBN | JSON-LD Book/Product, distinguendo editore e marchio del negozio |
| Giunti al Punto | Ricerca HTML del portale, poi scheda con ISBN corrispondente | JSON-LD e dettagli del prodotto |
| Amazon.it | Indirizzo prodotto tramite ISBN-10, per ISBN-13 con prefisso 978 | Dettagli prodotto con ISBN esatto, titolo, autori e descrizione del libro |

È disponibile anche l’importazione da link per tutte le fonti. La ricerca interna IBS/Feltrinelli/Hoepli/Mondadori non viene interrogata: si usano soltanto indirizzi di prodotto. I redirect sono limitati allo stesso host e ai percorsi ammessi; massimo due passaggi.

Amazon è sperimentale: non si esegue JavaScript del portale e non si aggirano blocchi, login o CAPTCHA. Con un ISBN 979 non viene inventato un ISBN-10; puoi indicare il link Amazon diretto, che deve comunque dichiarare l’ISBN giusto.

Ogni richiesta di fonte del browser scade dopo 26 secondi. La ricerca complessiva nell’app, incluso il recupero della copertina, è interrompibile e ha un limite di 50 secondi. Le altre fonti restano utilizzabili quando una fallisce. Hoepli ha un intervallo minimo di dieci secondi tra richieste per istanza, coerente con il Crawl-delay osservato; non è un coordinamento globale tra tutti i nodi Cloudflare.

## Prove reali del 31 ottobre 2026

Prove del codice Worker eseguito in Node.js con cache simulata, senza usare credenziali reali o pubblicare una nuova versione Cloudflare.

| ISBN | Libro | Metadati |
|---|---|---|
| 9788834603000 | Il nome della rosa. Ediz. illustrata | Corrispondenza valida da tutte le sei fonti |
| 9788831459754 | Il nome della rosa, adattamento a fumetti | Corrispondenza valida da tutte le sei fonti |
| 9788867908356 | Miss Kappa da ridere | Corrispondenza valida da tutte le sei fonti |

Per il primo ISBN sono state scaricate le immagini di Feltrinelli, Mondadori e Amazon. Il download Hoepli si è fermato per un errore di verifica della catena del certificato TLS nell’ambiente Node; nessun controllo dei certificati è stato disabilitato. L’app può usare la copertina di un’altra fonte. Le immagini segnaposto Hoepli vengono escluse.

Le fonti non sempre concordano: per esempio Mondadori ha restituito un solo autore per l’adattamento a fumetti, mentre IBS, Feltrinelli, Giunti e Amazon ne hanno restituiti due. Differiscono anche forma del titolo, nomi, categorie e lunghezza della descrizione. Per questo non si considera infallibile nessuna fonte.

Questi risultati non garantiscono la copertura dell’intero catalogo o il comportamento dai server Cloudflare. Non sono stati eseguiti test di carico sui portali.

## Verifica dopo il deploy

1. Pubblica il Worker con la configurazione in `worker/wrangler.jsonc`: `/health` deve mostrare `0.6.0` e sei fonti.
2. Fai commit e push dell’app su `main`, poi accedi con la password esistente.
3. Cerca ciascuno dei tre ISBN sopra. In anteprima controlla le fonti riuscite, eventuali avvisi, lingua, pagine, autori e copertina.
4. Apri “Confronta i dati delle fonti” e “Provenienza dei dati proposti”. Per il fumetto verifica il confronto tra le liste di autori.
5. Dai priorità a un’altra fonte: i valori presenti devono cambiare secondo quella scelta, mentre gli altri vengono completati. Correggi e salva.
6. Prova un link diretto Hoepli, Feltrinelli, Mondadori o Amazon insieme all’ISBN esatto. Un ISBN diverso dalla pagina deve far rifiutare quella fonte, lasciando attive le altre.
7. Dopo il login interrompi la rete e avvia una ricerca: deve restare possibile continuare manualmente. Il pulsante Interrompi deve annullare una ricerca in corso.

## API

- `GET /lookup?isbn=…&source=ibs|feltrinelli|hoepli|mondadori|giunti|amazon`: recupera una sola fonte per richiesta. In assenza di `source` mantiene il comportamento precedente (Giunti).
- `GET /lookup?isbn=…&url=…`: importa una scheda diretta, ignorando `source`.
- `GET /cover?isbn=…&url=…`: scarica una copertina estratta dalla scheda verificata.
- Tutti questi endpoint richiedono l’header Authorization. Non inserire mai la password nei link.

Le risposte di `/lookup` contengono `candidates` e `warnings`: HTTP 200 con elenco vuoto non significa che il libro sia stato trovato. La combinazione delle fonti avviene nell’app.
