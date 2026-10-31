import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
export const publicFiles=['manifest.webmanifest','favicon.ico','favicon-32.png','apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png'];
export function bookflixPWA(){return {name:'bookflix-pwa',apply:'build',enforce:'post',generateBundle(_,bundle){
 const files=[...new Set(['index.html',...Object.keys(bundle).filter(name=>/\.(js|css|html)$/.test(name)),...publicFiles])].sort();const hash=createHash('sha256');
 for(const [name,item] of Object.entries(bundle).sort(([a],[b])=>a.localeCompare(b))){hash.update(name);hash.update(item.type==='chunk'?item.code:item.source);}
 for(const file of publicFiles)hash.update(readFileSync(new URL('public/'+file,root)));
 const template=readFileSync(new URL('scripts/sw-template.js',root),'utf8');hash.update(template);const version=hash.digest('hex').slice(0,16);
 const source=template.replace('__BOOKFLIX_VERSION__',JSON.stringify(version)).replace('__BOOKFLIX_PRECACHE__',JSON.stringify(files));this.emitFile({type:'asset',fileName:'sw.js',source});
 }};}
