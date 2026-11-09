import {useLibraryDatabase,type Library} from './data';
export type Role='owner'|'editor'|'reviewer'|'viewer';
export type LibraryInfo={id:string;name:string;role:Role;revision:string;primary?:boolean};
export type Context={library:LibraryInfo;database:Library;userId:string};
let active:Context|null=null;
export function selectLibrary(library:LibraryInfo,userId:string){active={library,userId,database:useLibraryDatabase(userId,library.id)};return active;}
export function libraryContext(){if(!active)throw Error('Seleziona prima una libreria.');return active;}
export function optionalContext(){return active;}
export function clearLibrary(){active=null;}
export const mayEdit=(role:Role)=>role==='owner'||role==='editor';
export const mayReview=(role:Role)=>role!=='viewer';
