import {testEnv,tokenFor,withJWKS} from './test-auth.mjs';
const authToken=await tokenFor();
import {afterEach,expect,it,vi} from 'vitest';
import worker,{extract,sourceURL,plain} from './scraper.mjs';
const isbn='9788834603000';const url=`https://www.ibs.it/titolo/e/${isbn}`;
const fixture=(id=isbn)=>`<html><script type="application/ld+json">${JSON.stringify({'@graph':[
 {'@type':'Product',gtin13:id,name:'Titolo',image:`https://www.ibs.it/images/${id}.jpg`,additionalProperty:[{name:'Pagine',value:'200'},{name:'Editore',value:'Editore esempio'},{name:'Anno',value:'2024'}]},
 {'@type':'Book',name:'Titolo',author:[{name:'Autore uno'},{name:'Autore due'}],description:'Una trama di prova.',additionalProperty:[{name:'ISBN',value:id}]},
 {'@type':'Book',name:'Consiglio da ignorare',isbn:'9780140328721',author:{name:'Altro autore'}},
 {'@type':'BreadcrumbList',itemListElement:[{name:'Home'},{name:'Libri'},{name:'Narrativa'},{name:'Titolo'}]}
 ]})}</script></html>`;
afterEach(()=>vi.unstubAllGlobals());
it('unisce Book e Product della stessa edizione senza importare consigli e recensioni',()=>{const c=extract(fixture(),url,isbn);expect(c.data).toMatchObject({title:'Titolo',authors:['Autore uno','Autore due'],publisher:'Editore esempio',pages:200,year:'2024',genres:['Narrativa']});expect(c.covers).toHaveLength(1);});
it('rifiuta l’ISBN diverso anche se presente nel percorso',()=>{expect(()=>extract(fixture('9780306406157'),url,isbn)).toThrow('ISBN richiesto');});
it('completa gli autori IBS dalla scheda quando JSON-LD riporta solo il primo',()=>{const html=fixture().replace("Autore due","Autore uno")+'<span class="cc-item-value"><a href="/libri/autori/uno">Autore uno,</a><a href="/libri/autori/due">Autore due</a></span>';expect(extract(html,url,isbn).data.authors).toEqual(['Autore uno','Autore due']);});
it('rifiuta sorgenti arbitrarie e ripulisce query di tracciamento',()=>{for(const u of ['https://localhost/x','https://www.ibs.it.evil.test/a/e/'+isbn,'https://www.ibs.it/search/?q=x','https://user:pass@www.ibs.it/a/e/'+isbn])expect(()=>sourceURL(u)).toThrow();expect(sourceURL(url+'?tracking=x#x')).toBe(url);});
it('esclude copertine provenienti da host arbitrari',()=>{const c=extract(fixture().replace(`https://www.ibs.it/images/${isbn}.jpg`,'https://internal.test/image'),url,isbn);expect(c.covers).toEqual([]);});
it('estrae i dettagli Giunti dalla tabella del prodotto e l’autore visibile',()=>{const html=`<p class="author__name">di <span>Autore</span></p><table class="details-accordion__table"><tr><td>Editore</td><td>Editore &amp; Figli</td></tr><tr><td>Pagine</td><td>124</td></tr></table><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Titolo',offers:[{gtin13:isbn}]})}</script>`;expect(extract(html,'https://giuntialpunto.it/products/titolo-'+isbn,isbn).data).toMatchObject({authors:['Autore'],pages:124,publisher:'Editore & Figli'});});
it('gestisce JSON-LD rotto senza importare la pagina sbagliata',()=>{expect(()=>extract('<script type="application/ld+json">{broken}</script>',url,isbn)).toThrow('ISBN');expect(plain('Un &quot;titolo&quot; &#232; bello')).toBe('Un "titolo" è bello');});
it('blocca origini non autorizzate prima di contattare il portale',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',withJWKS(fetch));const r=await worker.fetch(new Request(`https://worker.test/lookup?isbn=${isbn}`,{headers:{Origin:'https://other.test'}}));expect(r.status).toBe(403);expect(fetch).not.toHaveBeenCalled();});
it('espone lo stato del servizio e l’origine corretta',async()=>{const r=await worker.fetch(new Request('https://worker.test/health',{headers:{Origin:'https://riccardogiussani.github.io'}}));expect(r.status).toBe(200);expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://riccardogiussani.github.io');expect((await r.json()).ok).toBe(true);});
it('importa una scheda tramite endpoint e conserva messaggi utili se il sito risponde 429',async()=>{vi.stubGlobal('fetch',withJWKS(vi.fn().mockResolvedValueOnce(new Response(fixture())).mockResolvedValueOnce(new Response('limit',{status:429}))));const request=()=>new Request(`https://worker.test/lookup?isbn=${isbn}&url=${encodeURIComponent(url)}`,{headers:{Authorization:'Bearer '+authToken}});const ok=await (await worker.fetch(request(),testEnv)).json();expect(ok.candidates[0].data.title).toBe('Titolo');const limited=await (await worker.fetch(request(),testEnv)).json();expect(limited.candidates).toEqual([]);expect(limited.warnings[0]).toContain('limita');});

