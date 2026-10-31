export const IDENTITY_EPOCH='firebase-self-service-v1';
export function resetContributions(catalog){return {...catalog,identityEpoch:IDENTITY_EPOCH,books:catalog.books.map(book=>{const {notes,status,rating,legacyRating,...fields}=book;return {...fields,reviews:[],ratings:[]};})};}
