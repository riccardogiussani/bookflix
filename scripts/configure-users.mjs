import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {credentials} from './user-credentials.mjs';
import {authConfig} from '../worker/auth.mjs';
const root=new URL('../',import.meta.url),secretsFile=new URL('.bookflix-secrets.local.json',root);
try{
 const args=process.argv.slice(2);if(args.length&&!(args.length===2&&['--reset','--disable'].includes(args[0])))throw Error('Uso: node scripts/configure-users.mjs [--reset username | --disable username]');
 let values;try{values=parseEnv(await readFile(new URL('.env',root),'utf8'));}catch(e){if(e.code==='ENOENT')throw Error('Crea .env a partire da .env.example e compila le password.');throw Error('Impossibile leggere .env. Controlla il file.');}
 let previous;try{previous=JSON.parse(await readFile(secretsFile,'utf8'));authConfig(previous);}catch(e){if(e.code!=='ENOENT')throw Error('La configurazione locale degli hash non è valida. Controlla il file senza pubblicarlo.');}
 if(!previous&&args.length)throw Error('Esegui prima lo script senza opzioni per creare i sette utenti.');
 const result=credentials(previous,values,args.length?{type:args[0]==='--reset'?'reset':'disable',username:args[1]}:{});authConfig(result.secrets);
 if(previous)await copyFile(secretsFile,new URL('.bookflix-secrets-backup.local.json',root));await writeFile(secretsFile,JSON.stringify(result.secrets,null,2)+'\n',{mode:0o600});
 console.log('Configurazione pronta: '+result.changed+' password o abilitazioni aggiornate.');console.log('File per Cloudflare: '+fileURLToPath(secretsFile));console.log('Nessuna password è stata mostrata o inviata. Esegui personalmente il caricamento dei secret.');
}catch(e){console.error(e instanceof Error?e.message:'Configurazione non riuscita.');process.exitCode=1;}
