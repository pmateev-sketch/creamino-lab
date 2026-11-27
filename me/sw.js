/* VAYSHA Me service worker — isolated cache with offline navigation fallback only. */
const CACHE='vaysha-me-v5';
const OWNED_PREFIXES=['creamino-me-','vaysha-me-'];
const SHELL=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./icon-180.png','./favicon-32.png','./icon-maskable-192.png','./icon-maskable-512.png','./point-surface-icon.svg','./bsr_golf.json','./run_pld.json','./run_vrn.json'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&OWNED_PREFIXES.some(prefix=>k.startsWith(prefix))).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
  const navigation=request.mode==='navigate';
  event.respondWith(
    fetch(request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));
      }
      return response;
    }).catch(async ()=>{
      const cached=await caches.match(request);
      if(cached)return cached;
      if(navigation)return (await caches.match('./index.html'))||Response.error();
      return Response.error();
    })
  );
});
