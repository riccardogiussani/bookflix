import {it,expect} from 'vitest';
import {blankBook} from './data';
import {shelfGenres,classificationTags,taxonomy} from './classification';
import {indexCatalog,searchCatalog} from './search';
const book={...blankBook(),title:'Il castello',genres:['Giallo','Romanzo storico'],classification:{primaryGenre:'giallo',secondaryGenres:['romanzo_storico'],workForm:'fumetto_graphic_novel',audience:'young_adult',genreVersion:'2.0',genreStatus:'classified' as const}};
it('le righe usano il primario e la scheda mantiene i secondari',()=>{expect(shelfGenres(book)).toEqual(['Giallo']);expect(classificationTags(book)).toEqual(['Giallo','Romanzo storico']);});
it('rispetta generi locali e libri non ancora classificati',()=>{expect(shelfGenres({...book,genreOverride:true,genres:['Personale']})).toEqual(['Personale']);expect(shelfGenres({...blankBook(),genres:['Vecchio genere']})).toEqual(['Vecchio genere']);});
it('ricerca anche secondari, forma e pubblico',()=>{const index=indexCatalog([book]);for(const query of ['storico','fumetto','young adult'])expect(searchCatalog(index,query)).toHaveLength(1);});
it('usa le liste concordate e tiene separata la rilegatura',()=>{expect(taxonomy.genres).toHaveLength(23);expect(taxonomy.workForms).toHaveLength(12);expect(taxonomy.audiences).toHaveLength(5);expect(taxonomy.physicalFormats).toHaveLength(4);});
