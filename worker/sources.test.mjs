import {testEnv,tokenFor} from './test-auth.mjs';
const authToken=await tokenFor();
import {afterEach,expect,it,vi} from 'vitest';
import worker,{extract,sourceURL,imageURL,automaticURL,isbn10} from './scraper.mjs';
const isbn='9788834603000';
const ld=data=>`<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const book={ '@type':'Book',isbn,name:'Titolo',author:{name:'Autore'},numberOfPages:124};
afterEach(()=>vi.unstubAllGlobals());
it('accetta soltanto schede prodotto dei nuovi portali, mai URL arbitrari',()=>{
 for(const url of [`https://www.lafeltrinelli.it/titolo/e/${isbn}`,`https://www.hoepli.it/libro/titolo/${isbn}.html`,`https://www.mondadoristore.it/titolo/p/${isbn}`,'https://www.amazon.it/titolo/dp/8834603001?tag=tracking'])expect(sourceURL(url)).toMatch(/^https:/);
 for(const url of ['https://www.hoepli.it/cerca/?isbn='+isbn,'https://www.amazon.it.evil.test/dp/8834603001','https://www.amazon.it/ap/signin','https://user:pass@www.mondadoristore.it/titolo/p/'+isbn,'http://www.hoepli.it/libro/titolo/'+isbn+'.html'])expect(()=>sourceURL(url)).toThrow();
 expect(sourceURL('https://www.amazon.it/titolo/dp/8834603001?tag=x')).toBe('https://www.amazon.it/dp/8834603001');
});
it('genera URL di prodotto da ISBN e non inventa ISBN-10 per prefissi 979',()=>{expect(isbn10(isbn)).toBe('8834603001');expect(isbn10('9791281692503')).toBe('');expect(automaticURL('amazon','9791281692503')).toBe('');expect(automaticURL('hoepli',isbn)).toContain('/libro/libro/'+isbn);expect(()=>automaticURL('unknown',isbn)).toThrow();});
it('estrae Book annidato in mainEntity di Hoepli e preferisce la trama HTML non corrotta',()=>{
 const html=ld({'@type':'WebPage',mainEntity:{...book,description:'Un 39 testo corrotto',inLanguage:'Italiano'},breadcrumb:{'@type':'BreadcrumbList',itemListElement:[{item:{name:'LIBRI'}},{item:{name:'NARRATIVA'}}]}})+'<h1>Titolo. Sottotitolo</h1><h2 class="prodotto"><a>Nome Autore</a></h2><h2>Trama</h2><div class="dettaglioDati"><div class="lh22 fs14">Una trama con l&#39;apostrofo.</div></div>';
 const c=extract(html,`https://www.hoepli.it/libro/titolo/${isbn}.html`,isbn);expect(c.data).toMatchObject({title:'Titolo. Sottotitolo',authors:['Nome Autore'],pages:124,description:"Una trama con l'apostrofo.",language:'Italiano',genres:['NARRATIVA']});
});
it('estrae Product+Book Mondadori senza confondere brand e editore',()=>{const c=extract(ld({...book,'@type':['Product','Book'],brand:'mondadori',publisher:{name:'Editore diverso'},image:'https://media.mondadoristore.it/picture/123/01/NZO'}),`https://www.mondadoristore.it/titolo/p/${isbn}`,isbn);expect(c.source).toBe('Mondadori Store');expect(c.data.publisher).toBe('Editore diverso');expect(c.covers).toHaveLength(1);});
it('usa l’adattatore IBS per Feltrinelli ma conserva il nome della fonte',()=>{expect(extract(ld(book),`https://www.lafeltrinelli.it/titolo/e/${isbn}`,isbn).source).toBe('Feltrinelli');});
const amazon=`<span id="productTitle">Titolo Amazon</span><div id="bylineInfo"><span class="author"><a>Nome Autore</a><span>(Autore)</span></span><span>Formato: Copertina flessibile</span></div><div id="detailBullets_feature_div"><ul><li>ISBN-13: ${isbn}</li><li>Lingua: Italiano</li><li>Editore: Editore</li><li>Lunghezza stampa: 624 pagine</li><li>Data di pubblicazione: 21 maggio 2020</li></ul></div><div id="bookDescription_feature_div"><div class="a-expander-content"><span>Trama.</span></div></div><img id="landingImage" src="https://m.media-amazon.com/images/I/cover.jpg">`;
it('estrae Amazon solo quando i dettagli dichiarano l’ISBN esatto',()=>{const c=extract(amazon,'https://www.amazon.it/dp/8834603001',isbn);expect(c.data).toMatchObject({title:'Titolo Amazon',authors:['Nome Autore'],pages:624,language:'Italiano',publisher:'Editore',year:'2020',description:'Trama.'});expect(c.covers).toHaveLength(1);expect(()=>extract(amazon.replace(isbn,'9780306406157'),'https://www.amazon.it/dp/8834603001',isbn)).toThrow('corrispondenza');});
it('non ricava metadati da CAPTCHA o da un ISBN presente solo nei consigli',()=>{expect(()=>extract('<title>Robot check</title><a href="/dp/8834603001">'+isbn+'</a>','https://www.amazon.it/dp/8834603001',isbn)).toThrow();});
it('rifiuta schede digitali anche se l’ISBN è dichiarato',()=>{expect(()=>extract(amazon.replace('Copertina flessibile','Edizione Kindle'),'https://www.amazon.it/dp/8834603001',isbn)).toThrow('digitale');expect(()=>extract(ld({...book,bookFormat:'https://schema.org/EBook'}),`https://www.mondadoristore.it/titolo/p/${isbn}`,isbn)).toThrow('digitale');});
it('limita anche le nuove copertine a domini e percorsi noti',()=>{for(const url of ['https://copertine.hoepli.it/hoepli/cover.jpg','https://media.mondadoristore.it/picture/123/01/NZO','https://m.media-amazon.com/images/I/cover.jpg'])expect(imageURL(url,'https://www.hoepli.it')).toBe(url);for(const url of ['https://evil.test/cover.jpg','https://m.media-amazon.com.evil.test/images/I/cover.jpg','http://m.media-amazon.com/images/I/cover.jpg'])expect(imageURL(url,'https://www.hoepli.it')).toBe('');});
it('non salva come copertina l’immagine segnaposto Hoepli',()=>{expect(imageURL('https://copertine.hoepli.it/hoepli/ndBigNew.png','https://www.hoepli.it')).toBe('');});
it('segue il redirect canonico Feltrinelli e restituisce il link finale',async()=>{
 const target=`https://www.lafeltrinelli.it/titolo/e/${isbn}`;const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:301,headers:{Location:target}})).mockResolvedValueOnce(new Response(ld(book)));vi.stubGlobal('fetch',fetch);
 const r=await worker.fetch(new Request('https://worker.test/lookup?isbn='+isbn+'&source=feltrinelli',{headers:{Authorization:'Bearer '+authToken,'CF-Connecting-IP':crypto.randomUUID()}}),testEnv);expect((await r.json()).candidates[0].url).toBe(target);expect(fetch).toHaveBeenCalledTimes(2);
});
it('non segue reindirizzamenti verso altri host o verso percorsi non bibliografici',async()=>{
 for(const location of ['https://internal.test/secret','https://www.lafeltrinelli.it/area-personale/']){const fetch=vi.fn().mockResolvedValue(new Response('',{status:302,headers:{Location:location}}));vi.stubGlobal('fetch',fetch);const r=await worker.fetch(new Request('https://worker.test/lookup?isbn='+isbn+'&source=feltrinelli',{headers:{Authorization:'Bearer '+authToken,'CF-Connecting-IP':crypto.randomUUID()}}),testEnv);expect((await r.json()).candidates).toEqual([]);expect(fetch).toHaveBeenCalledOnce();}
});
