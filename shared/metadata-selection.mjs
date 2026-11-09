// Deterministic selection shared by portal adapters and the browser's cross-source merge.
const TEXT_FIELDS=['title','subtitle','publisher','year','language','description'];
const KEYS=[...TEXT_FIELDS,'authors','genres','pages'];
const PLACEHOLDER=/^(?:n\/?a|n[./]?d\.?|null|undefined|[-–—]+|non (?:disponibile|indicato|indicata|specificato|specificata)|(?:descrizione|trama|informazioni?) (?:non disponibil[ei]|assent[ei])|nessuna (?:descrizione|trama|informazione)(?: disponibile)?|(?:autore|editore|lingua|anno|titolo) non disponibile|description not available|no description(?: available)?)[.!]?$/i;
export function cleanText(raw){
 if(typeof raw!=='string')return '';
 const text=raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/?(?:p|br|div|span|a|strong|em|b|i|u|ul|ol|li|h[1-6]|blockquote|section|article|small|sup|sub)\b[^>]*>/gi,' ').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,e)=>{
  if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}
  return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[e.toLowerCase()];
 }).replace(/[\s\u200b\u200e\u200f]+/g,' ').trim();
 return PLACEHOLDER.test(text)?'':text;
}
const folded=value=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function normalizeMetadata(raw){
 const out={};if(!raw||typeof raw!=='object')return out;
 for(const key of TEXT_FIELDS){let value=cleanText(raw[key]);if(key==='description'){
  value=value.replace(/(?:^|\s+)(?:leggi (?:di piu|di più|tutto|di meno)|mostra (?:di piu|di più|di meno)|read (?:more|less))[.!…]*$/i,'').trim();
  if(PLACEHOLDER.test(value)||/^(?:acquista|compra|ordina)\s+(?:online|il libro)\b/i.test(value))value='';
 }if(!value||value.length>(key==='description'?50000:1000))continue;
 if(key==='year'&&(!/^\d{4}$/.test(value)||Number(value)===0))continue;
 if(key==='language'){const languages={it:'Italiano',ita:'Italiano','it it':'Italiano',italiano:'Italiano',italian:'Italiano',en:'Inglese',eng:'Inglese','en gb':'Inglese','en us':'Inglese',inglese:'Inglese',english:'Inglese',fr:'Francese',fra:'Francese',fre:'Francese',french:'Francese',francais:'Francese',francese:'Francese',de:'Tedesco',deu:'Tedesco',ger:'Tedesco',german:'Tedesco',deutsch:'Tedesco',tedesco:'Tedesco',es:'Spagnolo',spa:'Spagnolo',spanish:'Spagnolo',espanol:'Spagnolo',spagnolo:'Spagnolo',pt:'Portoghese',por:'Portoghese',portuguese:'Portoghese',portoghese:'Portoghese'};value=languages[folded(value).replace(/[-_]/g,' ')]||value;}
 out[key]=value;}
 for(const key of ['authors','genres'])if(Array.isArray(raw[key])){const seen=new Set(),values=[];for(const item of raw[key].slice(0,100)){const value=cleanText(item),id=folded(value);if(!value||value.length>1000||seen.has(id)||key==='genres'&&/^(?:home|libri?|books?|catalogo)$/i.test(value))continue;seen.add(id);values.push(value);}if(values.length)out[key]=values;}
 if(Number.isInteger(raw.pages)&&raw.pages>0)out.pages=raw.pages;
 return out;
}
export function selectMetadata(candidates,preferred){
 const rows=candidates.map(candidate=>({source:candidate.source,data:normalizeMetadata(candidate.data)})),pinned=preferred?{source:preferred.source,data:normalizeMetadata(preferred.data)}:null,data={},fieldSources={};
 for(const key of KEYS){const available=rows.filter(row=>row.data[key]!==undefined);let selected=pinned?.data[key]!==undefined?pinned:available[0];
  if(!pinned?.data[key]&&key==='description')for(const row of available)if(!selected||row.data.description.length>selected.data.description.length)selected=row;
  if(selected){data[key]=selected.data[key];fieldSources[key]=selected.source;}
 }
 return {data,fieldSources};
}
