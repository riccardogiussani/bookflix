export function prepareFirebase(values){
 const config={apiKey:values.FIREBASE_API_KEY||'',authDomain:values.FIREBASE_AUTH_DOMAIN||'',projectId:values.FIREBASE_PROJECT_ID||'',appId:values.FIREBASE_APP_ID||''};for(const [key,value] of Object.entries(config))if(!value.trim())throw Error('Compila la configurazione Firebase: manca '+key+'.');if(!/^[a-z][a-z0-9-]{4,29}$/.test(config.projectId))throw Error('FIREBASE_PROJECT_ID non valido.');
 const owner=(values.BOOKFLIX_OWNER_UID||'').trim();if(owner.length>128||/\s/.test(owner))throw Error('BOOKFLIX_OWNER_UID non valido.');return {config,worker:{FIREBASE_PROJECT_ID:config.projectId,BOOKFLIX_OWNER_UID:owner||'__BOOKFLIX_UNASSIGNED__'}};
}
