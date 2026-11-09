"""Local root editor. Cloud operations happen only on explicit API requests."""
import copy
import hashlib
import json
import os
import re
import uuid
from collections import Counter
from dataclasses import dataclass, field
from urllib.parse import quote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from authors import AuthorNormalizer, clean_name
from cataloger import CATALOG_ID, CatalogError, TAXONOMY, encode, unpack, utcnow, fingerprint, validate_genre_choices

FIELDS = ('title', 'subtitle', 'authors', 'publisher', 'year', 'pages', 'language', 'genres', 'description', 'isbn', 'physicalFormat')
CLASSIFICATION_FIELDS = ('primaryGenre', 'secondary1', 'secondary2', 'workForm', 'audience')
STRUCTURED_GENRES = set(CLASSIFICATION_FIELDS[:3])
COVER = re.compile(r'[a-f0-9]{64}\.(?:jpg|png|webp)\Z')
MAX_IMAGE = 10 * 1024 * 1024


@dataclass
class EditionEdit:
    current: dict
    target_id: str
    data: dict
    changed: list
    cover_changed: bool
    library_changes: list = field(default_factory=list)

    @property
    def edition_id(self):
        return self.current['name'].rsplit('/', 1)[-1]


def checked_classification(classification, old, values):
    validate_genre_choices(classification)
    classification = copy.deepcopy(classification)
    if classification != old:
        source = 'bonsai' if classification.get('source') == 'bonsai' and classification.get('inputHash') == fingerprint(values) else 'manual'
        classification.update(genreVersion='2.0', source=source, updatedAt=utcnow(), genreStatus='classified' if classification.get('primaryGenre') else 'needs_review')
    return classification


def genre_labels(classification):
    labels = {r['id']:r['label'] for r in TAXONOMY['genres']}
    return [labels[x] for x in [classification['primaryGenre'], *classification['secondaryGenres']]]


def manual_authors(authors):
    return {'authorsVersion':'1.0','source':'manual','authors':authors,'updatedAt':utcnow()}

def metadata(value):
    if not isinstance(value, dict): raise CatalogError('Metadati non validi.')
    result = {}
    for field in FIELDS:
        v = value.get(field, [] if field in ('authors', 'genres') else None if field == 'pages' else '')
        if field in ('authors', 'genres'):
            if not isinstance(v, list) or len(v) > 100 or any(not isinstance(x, str) or len(x) > 1000 for x in v): raise CatalogError('Elenco non valido: ' + field)
            result[field] = list(dict.fromkeys(x.strip() for x in v if x.strip()))
        elif field == 'pages':
            if v is not None and (type(v) is not int or not 1 <= v <= 100000): raise CatalogError('Numero di pagine non valido.')
            result[field] = v
        else:
            if not isinstance(v, str) or len(v) > (100000 if field == 'description' else 1000): raise CatalogError('Testo non valido: ' + field)
            result[field] = v.strip()
    if not result['title']: raise CatalogError('Inserisci il titolo.')
    if result['year'] and not re.fullmatch(r'\d{4}', result['year']): raise CatalogError('L’anno deve avere quattro cifre.')
    isbn = re.sub(r'[\s-]', '', result['isbn']).upper()
    if len(isbn) == 10 and re.fullmatch(r'\d{9}[\dX]', isbn):
        if sum((10-i) * (10 if c == 'X' else int(c)) for i,c in enumerate(isbn)) % 11: raise CatalogError('ISBN non valido.')
        isbn = '978' + isbn[:9]
        isbn += str((-sum(int(c) * (1 if i % 2 == 0 else 3) for i,c in enumerate(isbn))) % 10)
    if isbn and (not re.fullmatch(r'(?:978|979)\d{10}', isbn) or sum(int(c) * (1 if i % 2 == 0 else 3) for i,c in enumerate(isbn)) % 10): raise CatalogError('ISBN non valido (sono ammessi ISBN-10 e ISBN-13).')
    result['isbn'] = isbn
    if result['physicalFormat'] and result['physicalFormat'] not in {r['id'] for r in TAXONOMY['physicalFormats']}: raise CatalogError('Formato fisico non valido.')
    return result

def cover_ref(value):
    if value is None: return None
    if not isinstance(value, dict) or not COVER.fullmatch(value.get('path', '')): raise CatalogError('Riferimento copertina non valido.')
    ext = value['path'].rsplit('.', 1)[1]
    mime = {'jpg':'image/jpeg', 'png':'image/png', 'webp':'image/webp'}[ext]
    if value.get('hash') != value['path'].split('.')[0] or value.get('type') != mime: raise CatalogError('Riferimento copertina non coerente.')
    return {k: value[k] for k in ('path', 'hash', 'type')}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

class Covers:
    base = 'https://app.koofr.net/dav/Koofr/.booflix/catalog/covers/'
    def __init__(self, secrets): self.secrets = secrets

    def request(self, url, method='GET', data=None, headers=None):
        import base64
        try:
            secrets = json.loads(self.secrets.read_text(encoding='utf-8')) if self.secrets.exists() else {}
            user = os.environ.get('KOOFR_USERNAME') or secrets.get('KOOFR_USERNAME')
            password = os.environ.get('KOOFR_PASSWORD') or secrets.get('KOOFR_PASSWORD')
            if not user or not password: raise ValueError()
            auth = base64.b64encode((user + ':' + password).encode()).decode()
        except Exception: raise CatalogError('Configura KOOFR_USERNAME e KOOFR_PASSWORD nel file locale dei secret o nell’ambiente.', 503) from None
        req = Request(url, data=data, method=method, headers={'Authorization':'Basic ' + auth, **(headers or {})})
        try:
            with build_opener(NoRedirect).open(req, timeout=30) as response:
                content = response.read(MAX_IMAGE + 1)
                if len(content) > MAX_IMAGE: raise CatalogError('Copertina troppo grande.', 413)
                return content
        except HTTPError as e:
            if (method == 'MKCOL' and e.code == 405) or (method == 'PUT' and e.code == 412): return b''
            raise CatalogError('Koofr: richiesta non riuscita (HTTP ' + str(e.code) + ').', 502) from None
        except (URLError, TimeoutError, OSError): raise CatalogError('Koofr non raggiungibile. Riprova.', 503) from None

    @staticmethod
    def identify(data):
        if not data or len(data) > MAX_IMAGE: raise CatalogError('Immagine vuota o oltre 10 MB.', 413)
        if data.startswith(b'\x89PNG\r\n\x1a\n'): return 'png', 'image/png'
        if data.startswith(b'\xff\xd8\xff'): return 'jpg', 'image/jpeg'
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP': return 'webp', 'image/webp'
        raise CatalogError('Usa un’immagine JPEG, PNG o WebP.')

    def upload(self, data):
        ext, mime = self.identify(data)
        digest = hashlib.sha256(data).hexdigest()
        for path in ('', 'catalog/', 'catalog/covers/'):
            self.request('https://app.koofr.net/dav/Koofr/.booflix/' + path, 'MKCOL', b'')
        filename = digest + '.' + ext
        self.request(self.base + filename, 'PUT', data, {'Content-Type':mime, 'If-None-Match':'*'})
        return {'path':filename, 'hash':digest, 'type':mime}

    def download(self, filename):
        if not COVER.fullmatch(filename): raise CatalogError('Copertina non valida.')
        data = self.request(self.base + filename)
        _, mime = self.identify(data)
        return data, mime

class Admin:
    def __init__(self, store, model, busy, covers):
        self.store, self.model, self.busy, self.covers = store, model, busy, covers

    def page(self, token=''):
        if not isinstance(token, str) or len(token) > 8192: raise CatalogError('Pagina non valida.')
        raw = self.store.request('/catalog?pageSize=250' + ('&pageToken=' + quote(token, safe='') if token else ''))
        return {'books':[self.present(unpack(d)) for d in raw.get('documents', [])], 'nextPageToken':raw.get('nextPageToken', '')}

    @staticmethod
    def present(doc):
        return {'id':doc['name'].rsplit('/',1)[-1], 'revision':doc['revision'], **{k:doc['data'].get(k) for k in ('metadata','cover','classification')}}

    def all_documents(self, path):
        token = ''
        while True:
            raw = self.store.request('/' + path + '?pageSize=500' + ('&pageToken=' + quote(token, safe='') if token else ''))
            yield from (unpack(d) for d in raw.get('documents', []))
            token = raw.get('nextPageToken')
            if not token: break

    def suggest_cover(self, image):
        _, mime = self.covers.identify(image)
        if mime not in ('image/jpeg', 'image/png'):
            raise CatalogError('Per leggere la copertina serve un’immagine JPEG o PNG.')
        return self.model.read_cover(image, mime)

    def suggest(self, body):
        field = body.get('field')
        draft = body.get('metadata')
        if not isinstance(draft, dict): raise CatalogError('Metadati non validi.')
        if field == 'genres':
            # Always use constrained language-model output, without reasoning/rationale.
            self.model.ready()
            proposal = self.model.classify_json(metadata(draft))
            labels = {r['id']:r['label'] for r in TAXONOMY['genres']}
            return {'classification':proposal, 'genres':[labels[x] for x in [proposal['primaryGenre'], *proposal['secondaryGenres']] if x], 'warnings':[] if proposal['primaryGenre'] else ['Dati insufficienti: Bonsai non ha assegnato un genere primario.']}
        docs = list(self.all_documents('catalog'))
        if field == 'authors':
            authors = draft.get('authors')
            if not isinstance(authors, list) or len(authors)>100 or any(not isinstance(x,str) or len(x)>1000 for x in authors): raise CatalogError('Elenco autori non valido.')
            normalizer = AuthorNormalizer()
            normalizer.prepare(docs)
            return normalizer.classify(draft)
        if field == 'publisher':
            raw = draft.get('publisher', '')
            if not isinstance(raw, str) or len(raw) > 1000: raise CatalogError('Editore non valido.')
            value = clean_name(raw)
            # Match spelling/spacing/case only: imprints remain separate publishers.
            key = lambda s: re.sub(r'\s+', ' ', clean_name(s)).casefold()
            variants = Counter(d['data'].get('metadata', {}).get('publisher', '') for d in docs)
            candidates = [v for v in variants if v and key(v) == key(value)]
            if candidates: value = max(candidates, key=lambda v:(not v.isupper() and not v.islower(), variants[v], v))
            elif value.isupper() or value.islower(): value = value.title()
            return {'publisher':value, 'warnings':[], 'notes':['Uniformazione di spazi e maiuscole; marchi editoriali distinti non vengono accorpati.']}
        raise CatalogError('Suggerimento non disponibile.')

    def save(self, body):
        return self.edit_transaction(lambda transaction: self.save_transaction(body, transaction))

    def edit_transaction(self, action, conflict='Salvataggio annullato: libro o libreria modificati, oppure ISBN già presente. Riapri il libro e controlla l’ISBN.'):
        transaction = self.store.request(':beginTransaction', {'options':{'readWrite':{}}}).get('transaction')
        if not transaction: raise CatalogError('Impossibile iniziare il salvataggio. Riprova.', 503)
        try:
            return action(transaction)
        except Exception as error:
            try: self.store.request(':rollback', {'transaction':transaction})
            except Exception: pass
            if isinstance(error, CatalogError) and error.status == 409:
                raise CatalogError(conflict, 409) from None
            raise

    @staticmethod
    def edition_changes(body, old):
        values = metadata(body.get('metadata'))
        before = old.get('metadata', {})
        changed = [k for k in FIELDS if values[k] != before.get(k, [] if k in ('authors','genres') else None if k == 'pages' else '')]
        cover = cover_ref(body.get('cover'))
        cover_changed = cover != old.get('cover')
        classification = body.get('classification')
        if classification is not None:
            classification = checked_classification(classification, old.get('classification'), values)
            # Legacy free text must not be silently replaced by an empty classification.
            if classification.get('primaryGenre'):
                values['genres'] = genre_labels(classification)
                if values['genres'] != before.get('genres', []) and 'genres' not in changed: changed.append('genres')
        data = copy.deepcopy(old)
        data['metadata'] = {**before, **values}
        data['cover'] = cover
        if classification is not None: data['classification'] = classification
        elif 'genres' in changed: data.pop('classification', None)
        if 'authors' in changed:
            data['authorNormalization'] = manual_authors(values['authors'])
        return data, changed, cover_changed

    def catalog_state_write(self):
        return {'update':{'name':self.store.name+'/system/catalogState','fields':{'adminRevision':encode(str(uuid.uuid4()))}},'updateMask':{'fieldPaths':['adminRevision']}}

    def audit_write(self, audit):
        if len(json.dumps(audit, ensure_ascii=False).encode()) > 800000: raise CatalogError('Libro o personalizzazioni troppo grandi per il registro delle modifiche. Nessuna modifica eseguita.', 413)
        return {'update':{'name':self.store.name+'/catalogAdminAudit/'+str(uuid.uuid4()),'fields':{k:encode(v) for k,v in audit.items()}},'currentDocument':{'exists':False}}

    def create(self, body):
        data, changed, cover_changed = self.edition_changes(body, {})
        isbn = data['metadata']['isbn']
        if isbn:
            edition_id = 'isbn_' + isbn
        else:
            # Keep the ID stable if the same draft is submitted again after a network error.
            draft_id = body.get('draftId')
            if not isinstance(draft_id, str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', draft_id):
                raise CatalogError('Bozza non valida. Riapri il modulo di inserimento.')
            edition_id = 'manual_' + draft_id
        data['createdAt'] = utcnow()
        audit = {'editionId':edition_id,'targetId':edition_id,'changedFields':changed,'coverChanged':cover_changed,'before':None,'after':data,'createdAt':data['createdAt'],'references':0,'libraryChanges':[]}
        writes = [
            {'update':{'name':self.store.name+'/catalog/'+edition_id,'fields':{k:encode(v) for k,v in data.items()}},'currentDocument':{'exists':False}},
            self.catalog_state_write(),
            self.audit_write(audit),
        ]
        try:
            self.store.request(':commit', {'writes':writes})
        except CatalogError as error:
            if error.status != 409:
                raise
            message = 'ISBN già presente nel catalogo. Cerca l’edizione esistente per modificarla.' if isbn else 'Questa bozza risulta già salvata. Aggiorna il catalogo per ritrovare il libro.'
            raise CatalogError(message, 409) from None
        return {'id':edition_id, 'message':'Libro aggiunto al catalogo centrale.'}

    def save_transaction(self, body, transaction):
        current = self.store.get(body.get('id', ''))
        if not body.get('revision') or current['revision'] != body['revision']: raise CatalogError('Il libro è stato modificato. Riaprilo prima di salvare.', 409)
        old = current['data']
        data, changed, cover_changed = self.edition_changes(body, old)
        isbn = data['metadata']['isbn']
        old_id = current['name'].rsplit('/',1)[-1]
        new_id = 'isbn_' + isbn if isbn else old_id if old_id.startswith('manual_') else 'manual_' + str(uuid.uuid4())
        affected = self.commit_edits([EditionEdit(current, new_id, data, changed, cover_changed)], transaction)
        return {'id':new_id, 'references':affected, 'message':'Salvato nel catalogo centrale e nelle librerie collegate.'}

    def save_many(self, body):
        books = body.get('books')
        if not isinstance(books, list) or not 2 <= len(books) <= 200:
            raise CatalogError('Seleziona da 2 a 200 libri per il salvataggio multiplo.')
        revisions = {}
        for book in books:
            if not isinstance(book, dict): raise CatalogError('Selezione non valida.')
            edition_id, revision = book.get('id'), book.get('revision')
            if not isinstance(edition_id, str) or not CATALOG_ID.fullmatch(edition_id) or edition_id in revisions or not isinstance(revision, str) or not revision:
                raise CatalogError('Selezione non valida. Aggiorna il catalogo e riprova.')
            revisions[edition_id] = revision
        values = body.get('metadata', {})
        if not isinstance(values, dict) or values.keys() - (set(FIELDS) - {'isbn'}):
            raise CatalogError('Metadati non validi. L’ISBN si modifica da una singola scheda.')
        # Validate submitted fields without revalidating or normalizing old, untouched values.
        normalized = metadata({'title':'Titolo di prova', **values})
        patch = {key:normalized[key] for key in values}
        classification = body.get('classification', {})
        if not isinstance(classification, dict) or classification.keys() - set(CLASSIFICATION_FIELDS) or any(value is not None and not isinstance(value, str) for value in classification.values()):
            raise CatalogError('Classificazione non valida.')
        if 'genres' in patch and STRUCTURED_GENRES & classification.keys():
            raise CatalogError('Modifica i generi liberi o quelli strutturati in un solo passaggio.')
        cover = {'cover':cover_ref(body['cover'])} if 'cover' in body else {}
        if not (patch or classification or cover): raise CatalogError('Scegli almeno un campo da applicare.')
        return self.edit_transaction(
            lambda transaction: self.save_many_transaction(revisions, patch, classification, cover, transaction),
            'Salvataggio annullato: un libro o una libreria è cambiata. Aggiorna il catalogo e riprova.',
        )

    def save_many_transaction(self, revisions, patch, classification, cover, transaction):
        names = {self.store.name+'/catalog/'+edition_id:revision for edition_id, revision in revisions.items()}
        rows = self.store.request(':batchGet', {'documents':list(names), 'transaction':transaction})
        current = {row['found']['name']:unpack(row['found']) for row in rows if 'found' in row}
        if any(name not in current or current[name]['revision'] != revision for name, revision in names.items()):
            raise CatalogError('La selezione è cambiata. Aggiorna il catalogo e riprova.', 409)
        edits = [self.patch_edition(doc, patch, classification, cover) for doc in current.values()]
        edits = [edit for edit in edits if edit.data != edit.current['data']]
        if not edits:
            self.store.request(':rollback', {'transaction':transaction})
            return {'books':0, 'references':0, 'message':'I libri selezionati hanno già i valori richiesti.'}
        affected = self.commit_edits(edits, transaction)
        return {'books':len(edits), 'references':affected, 'message':f'Libri aggiornati nel catalogo centrale: {len(edits)}.'}

    @staticmethod
    def patch_edition(current, patch, classification_patch, cover):
        old = current['data']
        before = old.get('metadata', {})
        changed = {key:value for key, value in patch.items() if before.get(key, [] if key in ('authors','genres') else None if key == 'pages' else '') != value}
        data = {**old}
        if 'cover' in cover and cover['cover'] != old.get('cover'): data.update(cover)
        previous = old.get('classification') or {}
        classification = {**previous}
        if classification_patch or ('genres' in changed and previous):
            secondary = (previous.get('secondaryGenres', []) + [None, None])[:2]
            for index, key in enumerate(('secondary1', 'secondary2')):
                secondary[index] = classification_patch.get(key, secondary[index])
            for key in ('primaryGenre', 'workForm', 'audience'):
                if key in classification_patch and classification_patch[key] != previous.get(key):
                    classification[key] = classification_patch[key]
            if 'genres' in changed or ('primaryGenre' in classification_patch and classification_patch['primaryGenre'] is None):
                if any(classification_patch.get(key) for key in ('secondary1', 'secondary2')):
                    raise CatalogError('Scegli il genere primario prima dei secondari.')
                if classification.get('primaryGenre') is not None: classification['primaryGenre'] = None
                secondary = []
            secondary = [value for value in secondary if value is not None]
            if secondary != previous.get('secondaryGenres', []): classification['secondaryGenres'] = secondary
            if classification != previous:
                classification.setdefault('secondaryGenres', [])
                classification['source'] = 'manual'
                try:
                    data['classification'] = checked_classification(classification, previous, {**before, **changed})
                except CatalogError as error:
                    raise CatalogError(f'{before.get("title") or "Libro senza titolo"} · {error}') from None
                if STRUCTURED_GENRES & classification_patch.keys() and classification.get('primaryGenre'):
                    genres = genre_labels(classification)
                    if genres != before.get('genres', []): changed['genres'] = genres
        if changed: data['metadata'] = {**before, **changed}
        if 'authors' in changed: data['authorNormalization'] = manual_authors(changed['authors'])
        edition_id = current['name'].rsplit('/', 1)[-1]
        return EditionEdit(current, edition_id, data, list(changed), data.get('cover') != old.get('cover'))

    def commit_edits(self, edits, transaction):
        # Read every library and its references. CAS on library roots detects concurrent app edits.
        writes = []
        by_id = {edit.edition_id:edit for edit in edits}
        ids = list(by_id)
        # Transactional queries keep the reference scan consistent with new libraries/items too.
        libraries = self.store.request(':runQuery', {'transaction':transaction, 'structuredQuery':{'from':[{'collectionId':'libraries'}]}})
        for library in (unpack(row['document']) for row in libraries if 'document' in row):
            path = library['name'][len(self.store.name)+1:]
            # Verify even empty libraries, to catch a newly added reference during this scan.
            writes.append({'verify':library['name'],'currentDocument':{'updateTime':library['revision']}})
            for start in range(0, len(ids), 30):
                group = ids[start:start+30]
                match = {'op':'EQUAL','value':encode(group[0])} if len(group) == 1 else {'op':'IN','value':encode(group)}
                rows = self.store.request('/' + path + ':runQuery', {'transaction':transaction, 'structuredQuery':{'from':[{'collectionId':'items'}], 'where':{'fieldFilter':{'field':{'fieldPath':'catalogId'},**match}}}})
                for ref in (unpack(row['document']) for row in rows if 'document' in row):
                    item = copy.deepcopy(ref['data'])
                    edit = by_id[item['catalogId']]
                    edit.library_changes.append({'path':ref['name'], 'overrides':copy.deepcopy(item.get('overrides', {})), 'catalogId':item.get('catalogId'), 'hadCoverOverride':'coverOverride' in item, 'coverOverride':item.get('coverOverride')})
                    overrides = item.get('overrides', {})
                    for key in edit.changed: overrides.pop(key, None)
                    item['overrides'] = overrides
                    if edit.cover_changed: item.pop('coverOverride', None)
                    item['catalogId'] = edit.target_id
                    item['updatedAt'] = utcnow()
                    writes.append({'update':{'name':ref['name'],'fields':{k:encode(v) for k,v in item.items()}},'currentDocument':{'updateTime':ref['revision']}})
        for edit in edits:
            current = edit.current
            fields = {k:encode(v) for k,v in edit.data.items()}
            version = {'updateTime':current['revision']}
            if edit.target_id == edit.edition_id:
                writes.append({'update':{'name':current['name'],'fields':fields},'currentDocument':version})
            else:
                writes.extend([{'update':{'name':self.store.name+'/catalog/'+edit.target_id,'fields':fields},'currentDocument':{'exists':False}}, {'delete':current['name'],'currentDocument':version}])
            audit = {'editionId':edit.edition_id,'targetId':edit.target_id,'changedFields':edit.changed,'coverChanged':edit.cover_changed,'before':current['data'],'after':edit.data,'createdAt':utcnow(),'references':len(edit.library_changes),'libraryChanges':edit.library_changes}
            writes.append(self.audit_write(audit))
        writes.append(self.catalog_state_write())
        if len(writes)>450: raise CatalogError('Troppe librerie o copie per un salvataggio atomico. Seleziona meno libri e riprova.', 413)
        if len(json.dumps(writes, ensure_ascii=False).encode()) > 9 * 1024 * 1024: raise CatalogError('Aggiornamento troppo grande per un salvataggio atomico. Nessuna modifica eseguita.', 413)
        self.store.request(':commit', {'writes':writes, 'transaction':transaction})
        return sum(len(edit.library_changes) for edit in edits)
