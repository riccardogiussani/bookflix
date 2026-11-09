import {CloudError,jsonApi,readCatalogueCover,type CloudCover} from './central-api';
import {newId,type Book} from './data';
import {AccessDeniedError,type Metadata} from './isbn';

export type CatalogueMatch = Pick<Book,'id'|'title'|'authors'|'publisher'|'year'|'isbn'>;
type Edition = Metadata & Partial<Pick<Book,'isbn'|'physicalFormat'|'classification'>> & {id:string;title:string;cover?:CloudCover|null};
export type CatalogueSelection = {book:Edition;cover?:Blob;warning?:string;linkedBookId?:string};
const libraryPath = (id:string) => '/v2/libraries/'+encodeURIComponent(id);

export async function searchCatalogueTitle(libraryId:string,title:string,code:string,signal:AbortSignal):Promise<{books:CatalogueMatch[];hasMore:boolean}> {
  try {
    return await jsonApi(libraryPath(libraryId)+'/catalogue-title?'+new URLSearchParams({title}),code,undefined,signal);
  } catch (failure) {
    if (failure instanceof CloudError && failure.status === 404) {
      throw Error('La ricerca per titolo richiede il Worker Bookflix aggiornato. Puoi continuare a compilare la scheda a mano.');
    }
    throw failure;
  }
}

export async function selectCatalogueEdition(libraryId:string,editionId:string,code:string,signal:AbortSignal):Promise<CatalogueSelection> {
  const path = libraryPath(libraryId);
  const {book,linkedBookId}:{book:Edition;linkedBookId?:string} = await jsonApi(path+'/catalogue-edition/'+encodeURIComponent(editionId),code,undefined,signal);
  if (linkedBookId || !book.cover) return {book,linkedBookId};
  try {
    return {book,cover:await readCatalogueCover(path,book.id,book.cover,code,signal)};
  } catch (failure) {
    if (signal.aborted || failure instanceof AccessDeniedError) throw failure;
    return {book,warning:'Copertina non disponibile. Puoi aggiungerla dal dispositivo.'};
  }
}

export function fillFromCatalogue(draft:Book,{book,cover}:CatalogueSelection):Book {
  return {
    ...draft,id:book.id.startsWith('manual_')?book.id:newId(),title:book.title,subtitle:book.subtitle??'',
    authors:book.authors??[],publisher:book.publisher??'',year:book.year??'',pages:book.pages??null,
    language:book.language??'',genres:book.genres??[],description:book.description??'',isbn:book.isbn??'',
    physicalFormat:book.physicalFormat??'',classification:book.classification??undefined,cover,
  };
}
