import {centralApi,hashBlob,jsonApi,type CloudCover} from './central-api';
import type {Book} from './data';

export type AdminSession = {session:string;expiresAt:string};
export type AdminMetadata = Pick<Book,'title'|'subtitle'|'authors'|'publisher'|'year'|'pages'|'language'|'genres'|'description'|'isbn'|'physicalFormat'>;
export type AdminClassificationField = 'primaryGenre'|'secondary1'|'secondary2'|'workForm'|'audience';
export type AdminEdition = {id:string;revision:string;metadata:Partial<AdminMetadata>;classification?:Book['classification']|null;cover?:CloudCover|null};
export type AdminPatch = {metadata:Partial<AdminMetadata>;classification:Partial<Record<AdminClassificationField,string|null>>;cover?:CloudCover|null};
export type AdminResult = {id?:string;books:number;references:number};

export function openAdminSession(code:string,token:string,signal:AbortSignal):Promise<AdminSession> {
  return jsonApi('/v2/admin/session',code,{token},signal);
}

export function adminClient(code:string,session:string) {
  const adminHeaders = {'X-Bookflix-Admin':session};
  const request = (path:string,options:RequestInit={}) => centralApi('/v2/admin'+path,code,{...options,headers:{...adminHeaders,...options.headers}});
  async function json<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
    const options = body === undefined ? {signal} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal};
    return (await request(path,options)).json();
  }
  return {
    page: (token:string,signal:AbortSignal) => json<{books:AdminEdition[];nextPageToken:string}>('/catalog?'+new URLSearchParams({pageToken:token}),undefined,signal),
    editions: (ids:string[]) => json<{books:AdminEdition[]}>('/catalog/read',{ids}),
    create: (draftId:string,patch:AdminPatch) => json<AdminResult>('/catalog',{draftId,...patch}),
    edit: (editions:Pick<AdminEdition,'id'|'revision'>[],patch:AdminPatch) => json<AdminResult>('/catalog/edit',{editions,...patch}),
    cover: async (id:string,signal:AbortSignal) => (await request('/catalog/'+encodeURIComponent(id)+'/cover',{signal})).blob(),
    upload: async (file:File):Promise<CloudCover> => {
      const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[file.type];
      if(!extension||!file.size||file.size>10*1024*1024)throw Error('Scegli una copertina JPG, PNG o WebP fino a 10 MB.');
      const hash=await hashBlob(file);
      return (await request('/covers/'+hash+'.'+extension,{method:'PUT',headers:{'Content-Type':file.type},body:file})).json();
    },
  };
}

export type AdminClient = ReturnType<typeof adminClient>;
