const KEY='bookflix-access-code';
let memory='';
export function readAccessCode(){try{return localStorage.getItem(KEY)||sessionStorage.getItem(KEY)||memory;}catch{return memory;}}
export function rememberedAccess(){try{return !!localStorage.getItem(KEY);}catch{return false;}}
export function storeAccessCode(code:string,remember:boolean){
 const value=code.trim();if(!value)throw Error('Inserisci il codice di accesso.');
 if(!/^[\x21-\x7E]{1,512}$/.test(value))throw Error('Usa un codice senza spazi, con lettere, numeri o simboli ASCII.');
 memory=value;
 try{localStorage.removeItem(KEY);sessionStorage.removeItem(KEY);(remember?localStorage:sessionStorage).setItem(KEY,value);}catch{throw Error('Il browser non consente di ricordare il codice. Puoi comunque usarlo per questa sessione.');}
}
export function forgetAccessCode(){memory='';try{localStorage.removeItem(KEY);}catch{}try{sessionStorage.removeItem(KEY);}catch{}}
