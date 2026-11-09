import copy
import io
import json
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from admin import Admin, Covers, cover_ref, metadata
from app import Handler
from cataloger import CatalogError, decode, encode, fingerprint

ID = 'isbn_9780140449136'
OTHER = 'isbn_9788804668237'
BASE = 'projects/bookflix-test/databases/(default)/documents'

def doc(path, data):
    return {'name':BASE+'/'+path, 'revision':'r1', 'data':data}

def raw(d):
    return {'name':d['name'], 'updateTime':d['revision'], 'fields':{k:encode(v) for k,v in d['data'].items()}}

class Store:
    name, project = BASE, 'bookflix-test'
    def __init__(self):
        self.documents = {
            BASE+'/catalog/'+ID:doc('catalog/'+ID, {'metadata':metadata({'title':'Titolo','authors':['Eco, Umberto'],'isbn':'9780140449136','genres':['Giallo']}), 'cover':None, 'createdAt':'keep'}),
            BASE+'/libraries/l1':doc('libraries/l1', {'members':{'u':'owner'}}),
            BASE+'/libraries/l2':doc('libraries/l2', {'members':{'v':'editor'}}),
            BASE+'/libraries/l1/items/local-id':doc('libraries/l1/items/local-id', {'catalogId':ID, 'overrides':{'authors':['Local Author'],'publisher':'Local publisher'},'location':'Camere','createdAt':'keep','coverOverride':None}),
            BASE+'/libraries/l2/items/another-id':doc('libraries/l2/items/another-id', {'catalogId':ID,'overrides':{'title':'Local title'},'location':'Taverna'})}
        self.commits = []
        self.conflict = None
        self.queries = []

    def get(self, edition_id): return copy.deepcopy(self.documents[BASE+'/catalog/'+edition_id])
    def request(self, suffix, body=None):
        if suffix == ':beginTransaction': return {'transaction':'test-transaction'}
        if suffix == ':rollback': return {}
        if suffix == ':batchGet':
            if body.get('transaction') != 'test-transaction': raise AssertionError('Missing transaction')
            return [{'found':raw(self.documents[name])} if name in self.documents else {'missing':name} for name in reversed(body['documents'])]
        if suffix == ':commit':
            writes = body['writes']
            if 'transaction' in body and body['transaction'] != 'test-transaction': raise AssertionError('Invalid transaction')
            if self.conflict: self.documents[self.conflict]['revision'] = 'r2'
            # Validate all preconditions before any mutation, like a real atomic commit.
            for w in writes:
                name = w.get('verify') or w.get('delete') or w['update']['name']
                condition = w.get('currentDocument', {})
                old = self.documents.get(name)
                if condition.get('exists') is False and old: raise CatalogError('ISBN già presente.',409)
                if 'updateTime' in condition and (not old or condition['updateTime'] != old['revision']): raise CatalogError('Conflitto.',409)
            self.commits.append(copy.deepcopy(writes))
            for w in writes:
                if 'delete' in w: del self.documents[w['delete']]
                if 'update' in w:
                    update = w['update']; values = {k:decode(v) for k,v in update['fields'].items()}
                    if 'updateMask' in w:
                        d=self.documents.setdefault(update['name'], {'data':{}});d['data'].update(values);d['revision']='r2'
                    else: self.documents[update['name']]={'name':update['name'],'revision':'r2','data':values}
            return {}
        if ':runQuery' in suffix:
            self.queries.append(copy.deepcopy(body))
            if suffix == ':runQuery': return [{'document':raw(d)} for name,d in self.documents.items() if name.startswith(BASE+'/libraries/') and '/items/' not in name]
            parent=suffix.split(':')[0]
            match=body['structuredQuery']['where']['fieldFilter']
            target=decode(match['value'])
            ids=target if match['op']=='IN' else [target]
            return [{'document':raw(d)} for name,d in self.documents.items() if name.startswith(BASE+parent+'/items/') and d['data']['catalogId'] in ids]
        collection=suffix.split('?')[0]
        return {'documents':[raw(d) for name,d in self.documents.items() if name.startswith(BASE+collection+'/') and '/' not in name[len(BASE+collection+'/'):]]}

class AdminTests(unittest.TestCase):
    def setUp(self):
        self.store=Store();self.model=Mock();self.admin=Admin(self.store,self.model,threading.Lock(),Mock())

    def body(self):
        b=self.admin.present(self.store.get(ID))
        b['metadata']=copy.deepcopy(b['metadata'])
        return b

    def bulk_body(self):
        self.store.documents[BASE+'/catalog/'+OTHER] = doc('catalog/'+OTHER, {
            'metadata':{'title':'Altro libro', 'isbn':'9788804668237', 'publisher':'Secondo editore', 'year':'s.d.', 'custom':'keep'},
            'classification':{'primaryGenre':'giallo', 'secondaryGenres':[], 'audience':'adulti'},
        })
        self.store.documents[BASE+'/libraries/l1/items/other'] = doc('libraries/l1/items/other', {
            'catalogId':OTHER, 'overrides':{'authors':['Autore locale'], 'title':'Altro titolo'},
        })
        return {'books':[{'id':ID,'revision':'r1'}, {'id':OTHER,'revision':'r1'}]}

    def test_bulk_save_updates_only_selected_fields_in_one_commit(self):
        body = {**self.bulk_body(), 'metadata':{'authors':[' Nuovo autore ']}}
        result = self.admin.save_many(body)
        self.assertEqual(result['books'], 2)
        self.assertEqual(result['references'], 3)
        self.assertEqual(len(self.store.commits), 1)
        second = self.store.get(OTHER)['data']
        self.assertEqual(second['metadata'], {'title':'Altro libro','isbn':'9788804668237','publisher':'Secondo editore',
                                               'year':'s.d.','custom':'keep','authors':['Nuovo autore']})
        self.assertEqual(second['classification'], {'primaryGenre':'giallo','secondaryGenres':[],'audience':'adulti'})
        self.assertNotIn('cover', second)
        self.assertEqual(self.store.get(ID)['data']['metadata']['title'], 'Titolo')
        item = self.store.documents[BASE+'/libraries/l1/items/other']['data']
        self.assertEqual(item['overrides'], {'title':'Altro titolo'})
        self.assertEqual(item['catalogId'], OTHER)
        writes = self.store.commits[0]
        self.assertEqual(len([w for w in writes if 'verify' in w]), 2)
        self.assertEqual(len([w for w in writes if '/catalogAdminAudit/' in w.get('update', {}).get('name','')]), 2)

    def test_bulk_save_changes_structured_genres_and_preserves_other_classification_fields(self):
        body = {**self.bulk_body(), 'classification':{'primaryGenre':'thriller', 'secondary1':'fantasy'}}
        self.admin.save_many(body)
        second = self.store.get(OTHER)['data']
        self.assertEqual(second['classification']['audience'], 'adulti')
        self.assertEqual(second['classification']['secondaryGenres'], ['fantasy'])
        self.assertEqual(second['metadata']['genres'], ['Thriller','Fantasy'])

    def test_bulk_save_conflict_aborts_all_edits(self):
        body = {**self.bulk_body(), 'metadata':{'publisher':'Nuovo editore'}}
        self.store.conflict = BASE+'/catalog/'+OTHER
        with self.assertRaises(CatalogError) as error:
            self.admin.save_many(body)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.store.commits, [])
        self.assertEqual(self.store.get(ID)['data']['metadata']['publisher'], '')

    def test_bulk_save_rejects_isbn_patch_and_stale_selection(self):
        body = self.bulk_body()
        with self.assertRaisesRegex(CatalogError, 'ISBN'):
            self.admin.save_many({**body, 'metadata':{'isbn':'9788804668237'}})
        body['books'][1]['revision'] = 'old'
        with self.assertRaises(CatalogError) as error:
            self.admin.save_many({**body, 'metadata':{'publisher':'Nuovo editore'}})
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.store.commits, [])

    def test_admin_pages_share_navigation_and_mark_the_correct_tab(self):
        handler = object.__new__(Handler)
        handler.server = SimpleNamespace(server_port=8091)
        handler.headers = {'Host':'127.0.0.1:8091'}
        handler.send = Mock()
        for path, active, script in (
            ('/', '/', '/admin/client.js'),
            ('/generi', '/generi', '/admin/client.js'),
            ('/batch', '/generi', '/admin/client.js'),
            ('/autori', '/autori', '/admin/client.js'),
            ('/titoli', '/titoli', '/admin/genre-batch.js'),
            ('/copertina', '/copertina', '/admin/cover-batch.js'),
        ):
            with self.subTest(path=path):
                handler.path = path
                handler.do_GET()
                page = handler.send.call_args.args[0]
                self.assertIn(f'href="{active}" aria-current="page"', page)
                self.assertEqual(page.count('aria-current="page"'), 1)
                self.assertIn('href="/admin/nav.css"', page)
                self.assertIn(f'src="{script}"', page)
                self.assertEqual(handler.send.call_args.kwargs['content_type'], 'text/html; charset=utf-8')
        for asset in ('/admin/cover-batch.js', '/admin/bulk-edit.js'):
            handler.path = asset
            handler.do_GET()
            self.assertTrue(handler.send.call_args.kwargs['content_type'].startswith('text/javascript'))

    def test_create_route_saves_normalized_edition_and_audit_without_library_references(self):
        handler = object.__new__(Handler)
        author_store = SimpleNamespace(documents=[])
        handler.server = SimpleNamespace(jobs=SimpleNamespace(busy=threading.Lock()), admin=self.admin,
                                         author_jobs=SimpleNamespace(store=author_store), server_port=8091)
        cover = {'path':'a'*64+'.jpg', 'hash':'a'*64, 'type':'image/jpeg'}
        payload = json.dumps({'metadata':{'title':' Nuovo libro ', 'isbn':'88-04-66823-7'}, 'cover':cover,
                              'classification':{'primaryGenre':'thriller', 'secondaryGenres':[]}}).encode()
        handler.path = '/admin/create'
        handler.rfile = io.BytesIO(payload)
        handler.headers = {'Host':'127.0.0.1:8091', 'Content-Type':'application/json',
                           'Content-Length':str(len(payload)), 'X-Bookflix-Local':'1'}
        handler.send = Mock()

        handler.do_POST()

        result, status = handler.send.call_args.args
        self.assertEqual(status, 201)
        self.assertEqual(result['id'], OTHER)
        edition = self.store.get(OTHER)['data']
        self.assertEqual(edition['metadata']['title'], 'Nuovo libro')
        self.assertEqual(edition['metadata']['genres'], ['Thriller'])
        self.assertEqual(edition['cover'], cover)
        self.assertTrue(edition['createdAt'])
        self.assertIsNone(author_store.documents)
        self.assertEqual(self.store.queries, [])
        self.assertEqual(len(self.store.commits), 1)
        paths = [w['update']['name'][len(BASE):] for w in self.store.commits[0]]
        self.assertEqual(paths[:2], ['/catalog/'+OTHER, '/system/catalogState'])
        self.assertTrue(paths[2].startswith('/catalogAdminAudit/'))
        self.assertEqual(len(paths), 3)
        audit = self.store.documents[BASE+paths[2]]['data']
        self.assertIsNone(audit['before'])
        self.assertEqual(audit['after'], edition)

    def test_create_rejects_existing_isbn_without_writes(self):
        with self.assertRaisesRegex(CatalogError, 'ISBN già presente') as error:
            self.admin.create({'metadata':{'title':'Duplicato', 'isbn':'0-14-044913-2'}})
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.store.get(ID)['data']['metadata']['title'], 'Titolo')
        self.assertEqual(self.store.commits, [])

    def test_create_without_isbn_protects_against_retries_of_the_same_draft(self):
        draft_id = 'f869ec71-4ab6-4ceb-971b-78f7057956e9'
        body = {'metadata':{'title':'Libro senza ISBN'}, 'draftId':draft_id}
        result = self.admin.create(body)
        self.assertEqual(result['id'], 'manual_'+draft_id)
        self.assertEqual(self.store.get(result['id'])['data']['metadata']['isbn'], '')
        with self.assertRaisesRegex(CatalogError, 'bozza risulta già salvata'):
            self.admin.create(body)
        self.assertEqual(len(self.store.commits), 1)

    def test_root_updates_changed_fields_in_every_library_preserves_other_overrides_and_locations(self):
        b=self.body();b['metadata']['authors']=['Umberto Eco']
        result=self.admin.save(b)
        self.assertEqual(result['references'],2)
        first=self.store.documents[BASE+'/libraries/l1/items/local-id']['data']
        self.assertEqual(first['overrides'],{'publisher':'Local publisher'})
        self.assertEqual(first['location'],'Camere')
        self.assertEqual(first['createdAt'],'keep')
        second=self.store.documents[BASE+'/libraries/l2/items/another-id']['data']
        self.assertEqual(second['overrides'],{'title':'Local title'})
        self.assertTrue(any('/system/catalogState' in w.get('update',{}).get('name','') for w in self.store.commits[0]))
        audit=next(d for name,d in self.store.documents.items() if '/catalogAdminAudit/' in name)['data']
        self.assertEqual(audit['libraryChanges'][0]['overrides']['authors'],['Local Author'])
        self.assertEqual(len([w for w in self.store.commits[0] if 'verify' in w]),2)
        self.assertTrue(all(q.get('transaction')=='test-transaction' for q in self.store.queries))

    def test_revision_conflict_stops_all_writes(self):
        b=self.body();b['revision']='stale'
        with self.assertRaises(CatalogError): self.admin.save(b)
        self.assertEqual(self.store.commits,[])

    def test_library_changes_during_scan_are_atomic_conflicts(self):
        self.store.conflict=BASE+'/libraries/l1'
        b=self.body();b['metadata']['title']='Nuovo titolo'
        with self.assertRaises(CatalogError): self.admin.save(b)
        self.assertEqual(self.store.get(ID)['data']['metadata']['title'],'Titolo')
        self.assertEqual(self.store.commits,[])

    def test_isbn_rekey_keeps_item_ids_and_feedback_paths(self):
        b=self.body();b['metadata']['isbn']='9788804668237'
        result=self.admin.save(b)
        self.assertEqual(result['id'],OTHER)
        self.assertNotIn(BASE+'/catalog/'+ID,self.store.documents)
        self.assertEqual(self.store.documents[BASE+'/libraries/l1/items/local-id']['data']['catalogId'],OTHER)
        self.assertEqual(self.store.get(OTHER)['data']['createdAt'],'keep')

    def test_duplicate_isbn_cannot_merge_or_destroy_existing_book(self):
        self.store.documents[BASE+'/catalog/'+OTHER]=doc('catalog/'+OTHER,{'metadata':{'title':'Altro'}})
        b=self.body();b['metadata']['isbn']='9788804668237'
        with self.assertRaises(CatalogError): self.admin.save(b)
        self.assertEqual(self.store.get(OTHER)['data']['metadata']['title'],'Altro')
        self.assertEqual(self.store.documents[BASE+'/libraries/l1/items/local-id']['data']['catalogId'],ID)

    def test_cover_replacement_removes_local_cover_overrides(self):
        b=self.body();b['cover']={'path':'a'*64+'.jpg','hash':'a'*64,'type':'image/jpeg'}
        self.admin.save(b)
        self.assertNotIn('coverOverride',self.store.documents[BASE+'/libraries/l1/items/local-id']['data'])
        self.assertEqual(self.store.get(ID)['data']['cover'],b['cover'])

    def test_author_and_publisher_suggestions_do_not_write(self):
        b=self.body()
        b['metadata']['authors']=['Eco, Umberto','UMBERTO ECO','Eco, Umberto']
        self.assertEqual(self.admin.suggest({'field':'authors','metadata':b['metadata']})['authors'],['Umberto Eco'])
        self.store.documents[BASE+'/catalog/'+OTHER]=doc('catalog/'+OTHER,{'metadata':{'publisher':'Mondadori'}})
        b['metadata']['publisher']=' MONDADORI '
        self.assertEqual(self.admin.suggest({'field':'publisher','metadata':b['metadata']})['publisher'],'Mondadori')
        self.assertEqual(self.store.commits,[])

    def test_bonsai_suggestions_are_constrained_and_draft_only(self):
        self.model.classify_json.return_value={'primaryGenre':'giallo','secondaryGenres':[]}
        b=self.body()
        p=self.admin.suggest({'field':'genres','metadata':b['metadata']})
        self.assertEqual(p['genres'],['Giallo'])
        self.model.ready.assert_called_once();self.model.classify_json.assert_called_once()
        self.assertEqual(self.store.commits,[])

    def test_cover_metadata_route_requires_local_guard_and_only_reads_image(self):
        handler = object.__new__(Handler)
        handler.server = SimpleNamespace(jobs=SimpleNamespace(busy=threading.Lock()), admin=self.admin, server_port=8091)
        self.admin.covers = Covers(Path('not-read'))
        self.model.read_cover.return_value = {'title':'Titolo', 'authors':[], 'publisher':None}
        image = b'\xff\xd8\xffimage'
        handler.path = '/admin/cover-metadata'
        handler.headers = {'Host':'127.0.0.1:8091', 'Content-Type':'image/jpeg', 'Content-Length':str(len(image))}
        handler.rfile = io.BytesIO(image)
        handler.send = Mock()

        handler.do_POST()
        self.assertEqual(handler.send.call_args.args[1], 403)
        self.model.read_cover.assert_not_called()

        handler.headers['X-Bookflix-Local'] = '1'
        handler.rfile = io.BytesIO(image)
        handler.do_POST()
        self.model.read_cover.assert_called_once_with(image, 'image/jpeg')
        handler.send.assert_called_with(self.model.read_cover.return_value)
        self.assertEqual(self.store.commits, [])

    def test_structured_genres_propagate_and_duplicate_secondaries_are_rejected(self):
        b=self.body();b['classification']={'primaryGenre':'thriller','secondaryGenres':['giallo'],'workForm':'romanzo','audience':'adulti'}
        self.admin.save(b)
        self.assertEqual(self.store.get(ID)['data']['metadata']['genres'],['Thriller','Giallo'])
        b=self.admin.present(self.store.get(ID));b['classification']['secondaryGenres']=['giallo','giallo']
        with self.assertRaises(CatalogError): self.admin.save(b)

    def test_validation_isbn10_cover_and_malformed_image(self):
        self.assertEqual(metadata({'title':'Test','isbn':'0-14-044913-2'})['isbn'],'9780140449136')
        for bad in ['8021234567890','9780140449137']:
            with self.assertRaises(CatalogError): metadata({'title':'Test','isbn':bad})
        with self.assertRaises(CatalogError): cover_ref({'path':'../secret'})
        with self.assertRaises(CatalogError): Covers.identify(b'<svg>')
        with self.assertRaises(CatalogError): Covers.identify(b'x'*(10*1024*1024+1))
        self.assertEqual(Covers.identify(b'\x89PNG\r\n\x1a\nimage'),('png','image/png'))

    def test_cover_upload_is_content_addressed_and_never_overwrites(self):
        covers=Covers(Path('not-read'));covers.request=Mock(return_value=b'')
        result=covers.upload(b'\xff\xd8\xffimage')
        put=covers.request.call_args
        self.assertEqual(put.args[1],'PUT')
        self.assertEqual(put.args[3]['If-None-Match'],'*')
        self.assertEqual(result['path'],result['hash']+'.jpg')

    def test_handler_requires_guard_and_releases_shared_lock_on_error(self):
        handler=object.__new__(Handler)
        handler.server=SimpleNamespace(jobs=SimpleNamespace(busy=threading.Lock()),admin=self.admin,server_port=8091)
        handler.server.jobs.busy.acquire()
        with self.assertRaises(CatalogError): handler.admin_call(lambda:None)
        handler.server.jobs.busy.release()
        with self.assertRaises(CatalogError): handler.admin_call(lambda:(_ for _ in ()).throw(CatalogError('test')))
        self.assertFalse(handler.server.jobs.busy.locked())
        payload=json.dumps(self.body()).encode()
        handler.path='/admin/save';handler.rfile=io.BytesIO(payload);handler.send=Mock()
        handler.headers={'Host':'127.0.0.1:8091','Content-Type':'application/json','Content-Length':str(len(payload))}
        handler.do_POST()
        self.assertEqual(handler.send.call_args.args[1],403)
        self.assertEqual(self.store.commits,[])

if __name__=='__main__': unittest.main()
