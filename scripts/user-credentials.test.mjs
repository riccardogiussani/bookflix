import {it,expect} from 'vitest';
import {parseEnv} from 'node:util';
import {credentials} from './user-credentials.mjs';
import {initialUsers} from '../worker/users.mjs';
import {authConfig,login,authenticate} from '../worker/legacy-auth.mjs';
const values=Object.fromEntries(initialUsers.map(u=>['BOOKFLIX_PASSWORD_'+u.username.toUpperCase(),'Manual-test-password-'+u.username]));
it('usa le password del .env, conserva solo hash salati e mantiene stabili gli ID',async()=>{
 const {secrets}=credentials(undefined,values);const config=authConfig(secrets);expect(config.users).toHaveLength(7);expect(JSON.stringify(secrets)).not.toContain('Manual-test-password-');const first=config.users[0];const result=await login(new Request('https://test/auth/login',{method:'POST',body:JSON.stringify({username:first.username,password:values.BOOKFLIX_PASSWORD_RICCARDO,remember:true})}),secrets);expect(result.user.id).toBe(initialUsers[0].id);const again=credentials(secrets,values).secrets;expect(again).toEqual(secrets);
});
it('revoca solo le sessioni dell’utente a cui cambia la password e permette la disabilitazione',async()=>{
 const initial=credentials(undefined,values).secrets;const token=(await login(new Request('https://test/auth/login',{method:'POST',body:JSON.stringify({username:'riccardo',password:values.BOOKFLIX_PASSWORD_RICCARDO})}),initial)).accessToken;const changed=credentials(initial,{...values,BOOKFLIX_PASSWORD_RICCARDO:'Different-manual-password'}).secrets;expect(changed.AUTH_SESSION_SECRET).toBe(initial.AUTH_SESSION_SECRET);expect(authConfig(changed).users[0].id).toBe(initialUsers[0].id);await expect(authenticate(new Request('https://test',{headers:{Authorization:'Bearer '+token}}),changed)).rejects.toThrow('Sessione');const disabled=credentials(changed,values,{type:'disable',username:'riccardo'}).secrets;expect(authConfig(disabled).users[0].disabled).toBe(true);
});
it('indica i campi mancanti o corti senza stamparne i valori e interpreta le password quotate',()=>{
 expect(()=>credentials(undefined,{})).toThrow('BOOKFLIX_PASSWORD_RICCARDO');expect(()=>credentials(undefined,{...values,BOOKFLIX_PASSWORD_RICCARDO:'short'})).toThrow('12 a 512');const parsed=parseEnv('BOOKFLIX_PASSWORD_RICCARDO="a test # password"');expect(parsed.BOOKFLIX_PASSWORD_RICCARDO).toBe('a test # password');
});

it('conserva la maiuscola scelta nel .env e permette il login senza distinguere maiuscole',async()=>{const config=credentials(undefined,{...values,BOOKFLIX_USER_RICCARDO:'Riccardo'}).secrets;expect(authConfig(config).users[0].username).toBe('Riccardo');const result=await login(new Request('https://test/auth/login',{method:'POST',body:JSON.stringify({username:'riccardo',password:values.BOOKFLIX_PASSWORD_RICCARDO})}),config);expect(result.user.username).toBe('Riccardo');});
