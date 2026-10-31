const KEY='bookflix-access-code';
const USER_KEY='bookflix-access-username';
let memory='',memoryUser='';
export type SavedLogin={username:string;accessCode:string;remember:boolean};
export function readAccessCode(){return readSavedLogin()?.accessCode||'';}
export function rememberedAccess(){try{return !!localStorage.getItem(KEY);}catch{return false;}}
export function readSavedLogin():SavedLogin|null{
 let accessCode='',username='',remember=false;
 try{accessCode=localStorage.getItem(KEY)||'';if(accessCode){username=localStorage.getItem(USER_KEY)||'';remember=true;}}catch{}
 if(!accessCode)try{accessCode=sessionStorage.getItem(KEY)||'';if(accessCode)username=sessionStorage.getItem(USER_KEY)||'';}catch{}
 if(!accessCode){accessCode=memory;username=memoryUser;}
 // Older versions remembered only the code. Recover those sessions as well.
 return accessCode?{username:username.trim()||'Lettore',accessCode,remember}:null;
}
export function storeAccessCode(code:string,remember:boolean,username=''){
 const value=code.trim();if(!value)throw Error('Inserisci il codice di accesso.');
 if(!/^[\x21-\x7E]{1,512}$/.test(value))throw Error('Usa un codice senza spazi, con lettere, numeri o simboli ASCII.');
 memory=value;memoryUser=username.trim();
 try{localStorage.removeItem(KEY);localStorage.removeItem(USER_KEY);sessionStorage.removeItem(KEY);sessionStorage.removeItem(USER_KEY);const target=remember?localStorage:sessionStorage;target.setItem(KEY,value);target.setItem(USER_KEY,memoryUser);}catch{throw Error('Il browser non consente di ricordare il codice. Puoi comunque usarlo per questa sessione.');}
}
export function forgetAccessCode(){memory='';memoryUser='';for(const key of [KEY,USER_KEY]){try{localStorage.removeItem(key);}catch{}try{sessionStorage.removeItem(key);}catch{}}}
