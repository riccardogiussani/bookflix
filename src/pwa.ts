export function registerBookflix(onUpdate:(activate:()=>void)=>void){
 if(!('serviceWorker' in navigator))return ()=>{};
 let disposed=false,registration:ServiceWorkerRegistration|undefined,reloading=false;
 const reload=()=>{if(reloading)window.location.reload();};
 const offer=()=>{if(!disposed&&registration?.waiting)onUpdate(()=>{reloading=true;registration?.waiting?.postMessage({type:'BOOKFLIX_UPDATE'});});};
 const found=()=>{const worker=registration?.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offer();});};
 navigator.serviceWorker.addEventListener('controllerchange',reload);
 const url=new URL('sw.js',document.baseURI),scope=new URL('./',document.baseURI).pathname;
 void navigator.serviceWorker.register(url,{scope,updateViaCache:'none'}).then(value=>{registration=value;if(disposed)return;offer();registration.addEventListener('updatefound',found);}).catch(()=>{/* The online site remains usable if registration is unavailable. */});
 return ()=>{disposed=true;registration?.removeEventListener('updatefound',found);navigator.serviceWorker.removeEventListener('controllerchange',reload);};
}
