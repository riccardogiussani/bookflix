import taxonomy from '../shared/genre-taxonomy.json';
import type {Book} from './data';
export {taxonomy};
export type Classification={primaryGenre:string|null;secondaryGenres:string[];workForm:string|null;audience:string|null;genreVersion:string;genreStatus:'classified'|'needs_review';source?:string;model?:string;promptVersion?:string;reason?:string;secondaryReason?:string};
export function label(group:'genres'|'workForms'|'audiences'|'physicalFormats',id:string|null|undefined){return taxonomy[group].find(row=>row.id===id)?.label||'';}
export function shelfGenres(book:Book){const c=book.classification;if(!book.genreOverride&&c?.genreVersion==='2.0'&&c.genreStatus==='classified'){const primary=label('genres',c.primaryGenre);if(primary)return [primary];}return book.genres;}
export function classificationTags(book:Book){const c=book.classification;if(book.genreOverride||c?.genreStatus!=='classified')return book.genres;return [c.primaryGenre,...c.secondaryGenres].map(id=>label('genres',id)).filter(Boolean);}
