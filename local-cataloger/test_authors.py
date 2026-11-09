import copy
import tempfile
import threading
import time
import unittest
from authors import AuthorJobs, AuthorNormalizer, AuthorStore, normalize_name, validate_authors
from cataloger import CatalogError, decode, encode

ID = "isbn_9788804668237"
OTHER = "isbn_9780140449136"

def document(edition_id, authors):
    return {"name": "projects/bookflix-test/databases/(default)/documents/catalog/" + edition_id, "revision": "rev-1", "data": {
        "metadata": {"title": "Titolo", "authors": authors, "genres": ["Giallo"], "description": "Trama", "physicalFormat": "brossura"},
        "classification": {"genreVersion": "2.0", "primaryGenre": "giallo"}, "cover": {"path": "keep.jpg"}}}

class FakeBase:
    project = "bookflix-test"
    name = "projects/bookflix-test/databases/(default)/documents"
    def __init__(self, documents):
        self.documents = {d["name"].rsplit('/', 1)[-1]: copy.deepcopy(d) for d in documents}
        self.commits, self.scans = [], 0
    def get(self, edition_id): return copy.deepcopy(self.documents[edition_id])
    def request(self, suffix, body=None):
        if suffix.startswith('/catalog?'):
            self.scans += 1
            return {"documents": [{"name": d["name"], "updateTime": d["revision"], "fields": {k: encode(v) for k, v in d["data"].items()}} for d in self.documents.values()]}
        if suffix == ':commit':
            writes = body['writes']
            edition_id = writes[0]['update']['name'].rsplit('/', 1)[-1]
            doc = self.documents[edition_id]
            if writes[0]['currentDocument']['updateTime'] != doc['revision']: raise CatalogError('Conflict', 409)
            self.commits.append(copy.deepcopy(writes))
            fields = {k: decode(v) for k, v in writes[0]['update']['fields'].items()}
            doc['data']['metadata']['authors'] = fields['metadata']['authors']
            doc['data']['authorNormalization'] = fields['authorNormalization']
            doc['revision'] = 'rev-' + str(len(self.commits) + 1)
            return {'writeResults': [{'updateTime': doc['revision']}, {}, {}]}
        raise AssertionError(suffix)

class AuthorTests(unittest.TestCase):
    def normalized(self, docs, metadata=None):
        model = AuthorNormalizer()
        model.prepare(docs)
        return model.classify(metadata or docs[0]['data']['metadata'])

    def wait(self, jobs, job_id, state):
        end = time.monotonic() + 3
        while time.monotonic() < end:
            job = jobs.load(job_id)
            if job['state'] == state: return job
            time.sleep(.01)
        self.fail(str(jobs.load(job_id)))

    def test_surname_comma_and_case_are_normalized_with_compound_surname(self):
        self.assertEqual(normalize_name(' GARCÍA MÁRQUEZ, GABRIEL ')['name'], 'Gabriel García Márquez')
        self.assertEqual(normalize_name('Eco, Umberto')['name'], 'Umberto Eco')
        self.assertEqual(normalize_name('VAN GOGH, VINCENT')['name'], 'Vincent van Gogh')
        self.assertEqual(normalize_name('Martin Van Buren')['name'], 'Martin Van Buren')

    def test_initials_apostrophes_and_case_are_preserved_without_expansion(self):
        self.assertEqual(normalize_name('J.R.R. TOLKIEN')['name'], 'J. R. R. Tolkien')
        self.assertEqual(normalize_name('O’NEILL, EUGENE')['name'], "Eugene O'Neill")
        result = self.normalized([document(ID, ['J.R.R. Tolkien', 'John Ronald Reuel Tolkien'])])
        self.assertEqual(len(result['authors']), 2)

    def test_deduplicates_variants_without_deleting_other_authors_or_changing_order(self):
        result = self.normalized([document(ID, ['Eco, Umberto', 'UMBERTO ECO', 'Primo Levi'])])
        self.assertEqual(result['authors'], ['Umberto Eco', 'Primo Levi'])
        self.assertEqual(result['authorStatus'], 'normalized')

    def test_prefers_existing_internal_capitalization_across_books(self):
        docs = [document(ID, ['CORMAC MCCARTHY']), document(OTHER, ['Cormac McCarthy'])]
        self.assertEqual(self.normalized(docs)['authors'], ['Cormac McCarthy'])

    def test_never_merges_accent_variants_or_pseudonyms_without_review(self):
        docs = [document(ID, ['José Saramago', 'Jose Saramago', 'Lewis Carroll', 'Charles Lutwidge Dodgson'])]
        result = self.normalized(docs)
        self.assertEqual(len(result['authors']), 4)
        self.assertEqual(result['authorStatus'], 'needs_review')
        self.assertTrue(any('accenti' in warning for warning in result['warnings']))

    def test_reverse_without_comma_is_only_flagged_not_automatically_reordered(self):
        docs = [document(ID, ['Eco Umberto']), document(OTHER, ['Eco, Umberto'])]
        result = self.normalized(docs)
        self.assertEqual(result['authors'], ['Eco Umberto'])
        self.assertEqual(result['authorStatus'], 'needs_review')

    def test_organizations_roles_multi_comma_and_mononyms_require_review(self):
        for name in ['Università di Milano', 'Mario Rossi (a cura di)', 'Doe, John, Jr.', 'Mario Rossi; Luigi Bianchi', 'NASA', 'Platone', 'N/D']:
            self.assertTrue(normalize_name(name)['issues'], name)
        self.assertEqual(normalize_name('NASA')['name'], 'NASA')  # preserve acronyms until manual confirmation

    def test_collective_authors_are_normalized_as_collective_authors(self):
        for name in ['AA.VV.', 'AA VV', 'A. A. V. V.']:
            self.assertEqual(normalize_name(name)['name'], 'Autori vari')

    def test_never_automatically_clears_an_all_empty_list(self):
        result = self.normalized([document(ID, [' ', ''])])
        self.assertEqual(result['authors'], [])
        self.assertEqual(result['authorStatus'], 'needs_review')

    def test_manual_validation_disallows_duplicate_names(self):
        with self.assertRaises(CatalogError): validate_authors(['Mario Rossi', 'mario rossi'])
        with self.assertRaises(CatalogError): validate_authors([''])
        self.assertEqual(validate_authors([]), [])

    def test_preview_uses_catalog_wide_index_but_no_model_or_cloud_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            base = FakeBase([document(ID, ['CORMAC MCCARTHY']), document(OTHER, ['Cormac McCarthy'])])
            jobs = AuthorJobs(base, directory, threading.Lock())
            job_id = jobs.start_preview(30)
            job = self.wait(jobs, job_id, 'preview_ready')
            self.assertEqual(job['mode'], 'rules')
            self.assertEqual(job['tool'], 'authors')
            self.assertEqual(job['entries'][0]['proposed']['authors'], ['Cormac McCarthy'])
            self.assertEqual(base.commits, [])
            self.assertEqual(base.scans, 1)

    def test_apply_only_changes_authors_marker_revision_and_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            base = FakeBase([document(ID, ['Eco, Umberto', 'UMBERTO ECO'])])
            jobs = AuthorJobs(base, directory, threading.Lock())
            job_id = jobs.start_preview(30)
            self.wait(jobs, job_id, 'preview_ready')
            jobs.start_apply(job_id, [ID])
            job = self.wait(jobs, job_id, 'applied')
            self.assertEqual(job['entries'][0]['status'], 'applied')
            doc = base.documents[ID]['data']
            self.assertEqual(doc['metadata']['authors'], ['Umberto Eco'])
            self.assertEqual(doc['metadata']['genres'], ['Giallo'])
            self.assertEqual(doc['metadata']['physicalFormat'], 'brossura')
            self.assertEqual(doc['classification']['genreVersion'], '2.0')
            self.assertEqual(doc['cover']['path'], 'keep.jpg')
            writes = base.commits[0]
            self.assertEqual(writes[0]['updateMask']['fieldPaths'], ['metadata.authors', 'authorNormalization'])
            self.assertTrue(writes[1]['update']['name'].endswith('/system/catalogState'))
            self.assertTrue(writes[2]['update']['name'].startswith(base.name+'/authorAudit/'))

    def test_manual_review_is_local_then_explicit_apply_and_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            base = FakeBase([document(ID, ['NASA'])])
            jobs = AuthorJobs(base, directory, threading.Lock())
            job_id = jobs.start_preview(30)
            self.wait(jobs, job_id, 'preview_ready')
            with self.assertRaises(CatalogError): jobs.start_apply(job_id, [ID])
            corrected = jobs.review(job_id, ID, ['NASA'])
            self.assertEqual(corrected['entries'][0]['status'], 'ready')
            self.assertEqual(base.commits, [])
            jobs.start_apply(job_id, [ID])
            self.wait(jobs, job_id, 'applied')
            jobs.start_apply(job_id, [ID])
            self.wait(jobs, job_id, 'applied')
            self.assertEqual(len(base.commits), 1)
            # A reviewed mononym/acronym is not repeatedly proposed on the next scan.
            self.assertEqual(list(jobs.store.pending(30)), [])

    def test_manual_spelling_becomes_evidence_for_later_equivalent_variants(self):
        first = document(ID, ['NASA'])
        first['data']['authorNormalization'] = {'source': 'manual', 'authors': ['NASA'], 'authorsVersion': '1.0'}
        other = document(OTHER, ['Nasa'])
        model = AuthorNormalizer()
        model.prepare([first, other])
        result = model.classify(other['data']['metadata'])
        self.assertEqual(result['authors'], ['NASA'])
        self.assertEqual(result['authorStatus'], 'normalized')

    def test_author_api_routes_do_not_call_genre_jobs(self):
        import io, json
        from types import SimpleNamespace
        from unittest.mock import Mock
        from app import Handler
        author_jobs, genre_jobs = Mock(), Mock()
        author_jobs.start_preview.return_value = 'author-job'
        body = json.dumps({'limit': 12}).encode()
        handler = object.__new__(Handler)
        handler.server = SimpleNamespace(server_port=8091, author_jobs=author_jobs, jobs=genre_jobs)
        handler.headers = {'Host': '127.0.0.1:8091', 'X-Bookflix-Local': '1', 'Content-Type': 'application/json', 'Content-Length': str(len(body))}
        handler.path, handler.rfile, handler.send = '/authors/preview', io.BytesIO(body), Mock()
        handler.do_POST()
        author_jobs.start_preview.assert_called_once_with(12, False, None)
        genre_jobs.start_preview.assert_not_called()
        handler.send.assert_called_once_with({'jobId': 'author-job'}, 202)

    def test_stale_preview_and_cross_tool_jobs_cannot_overwrite_data(self):
        with tempfile.TemporaryDirectory() as directory:
            base = FakeBase([document(ID, ['Eco, Umberto'])])
            jobs = AuthorJobs(base, directory, threading.Lock())
            job_id = jobs.start_preview(30)
            self.wait(jobs, job_id, 'preview_ready')
            base.documents[ID]['revision'] = 'edited-elsewhere'
            jobs.start_apply(job_id, [ID])
            job = self.wait(jobs, job_id, 'applied')
            self.assertEqual(job['entries'][0]['status'], 'conflict')
            self.assertEqual(base.commits, [])
            job['tool'] = 'genres'
            jobs.save(job)
            with self.assertRaises(CatalogError): jobs.start_apply(job_id, [ID])

    def test_scan_is_cached_until_refresh_and_busy_lock_is_shared(self):
        with tempfile.TemporaryDirectory() as directory:
            base = FakeBase([document(ID, ['Eco, Umberto'])])
            lock = threading.Lock()
            jobs = AuthorJobs(base, directory, lock)
            list(jobs.store.pending(30))
            list(jobs.store.pending(30))
            self.assertEqual(base.scans, 1)
            list(jobs.store.pending(30, force=True))
            self.assertEqual(base.scans, 2)
            lock.acquire()
            try:
                with self.assertRaises(CatalogError): jobs.start_preview()
            finally: lock.release()

if __name__ == '__main__': unittest.main()
