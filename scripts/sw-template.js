// Only application files are cached. Auth, Koofr, metadata and uploads use the network.
const VERSION=__BOOKFLIX_VERSION__;
const FILES=__BOOKFLIX_PRECACHE__;
const SCOPE=self.registration.scope;
const PREFIX='bookflix-shell:'+SCOPE+':';
const CACHE=PREFIX+VERSION;
const INDEX=new URL('index.html',SCOPE).href;
const URLS=FILES.map(file=>new URL(file,SCOPE).href);
const STATIC=new Set(URLS);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
// A new version waits until the user explicitly chooses to reload.
self.addEventListener('message',event=>{if(event.data?.type==='BOOKFLIX_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url),scope=new URL(SCOPE);
 if(request.method!=='GET'||request.headers.has('Authorization')||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 if(request.mode==='navigate'){
  event.respondWith((async()=>{try{return await fetch(request);}catch{const cache=await caches.open(CACHE);const saved=await cache.match(INDEX);if(saved)return saved;return new Response('Bookflix non è ancora disponibile offline. Apri l’app una volta con una connessione attiva.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}})());return;
 }
 if(STATIC.has(url.href))event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(request)||fetch(request);})());
});
