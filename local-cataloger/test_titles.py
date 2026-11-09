import copy
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock

from cataloger import CatalogError, decode
from titles import TitleJobs, TitleNormalizer, TitleStore, check_title, title_proposal


ORIGINAL = 'PERRY MASON E LE ZAMPE DI VELLUTO'
PROPOSED = 'Perry Mason e le Zampe di Velluto'
EDITION = 'isbn_9788804668237'
BASE = 'projects/bookflix-test/databases/(default)/documents'
DOCUMENT = {'name':BASE+'/catalog/'+EDITION, 'revision':'r1',
            'data':{'metadata':{'title':ORIGINAL,'language':'it','subtitle':'altro'}, 'cover':None}}


class TitleTests(unittest.TestCase):
    def test_bonsai_returns_a_case_only_proposal(self):
        model = TitleNormalizer()
        model.complete_json = Mock(return_value=({'title':PROPOSED}, {}))
        self.assertEqual(model.classify(DOCUMENT['data']['metadata']), title_proposal(ORIGINAL, PROPOSED, 'bonsai'))
        messages, schema, _ = model.complete_json.call_args.args
        self.assertEqual(schema['required'], ['title'])
        self.assertNotIn('subtitle', messages[1]['content'])
        model.complete_json.return_value = ({'title':PROPOSED + '.'}, {})
        with self.assertRaises(CatalogError): model.classify(DOCUMENT['data']['metadata'])

    def test_unicode_case_is_allowed_but_punctuation_and_spelling_are_protected(self):
        self.assertEqual(check_title('L’UNITÀ, VOL. IV', 'L’Unità, Vol. IV'), 'L’Unità, Vol. IV')
        self.assertEqual(check_title('STRAẞE', 'Straße'), 'Straße')
        for changed in ("L'Unità, Vol. IV", 'L’Unita, Vol. IV', 'L’Unità, Vol. 4', 'L’Unità,  Vol. IV'):
            with self.subTest(changed=changed), self.assertRaises(CatalogError):
                check_title('L’UNITÀ, VOL. IV', changed)

    def test_apply_only_updates_title_audit_and_catalog_revision(self):
        base = Mock(project='bookflix-test')
        base.name = BASE
        base.get.return_value = copy.deepcopy(DOCUMENT)
        store = TitleStore(base)
        entry = {'id':EDITION, 'revision':'r1', 'before':DOCUMENT['data'], 'proposed':title_proposal(ORIGINAL, PROPOSED, 'manual')}
        self.assertEqual(store.apply(entry), 'applied')
        writes = base.request.call_args.args[1]['writes']
        self.assertEqual(len(writes), 3)
        self.assertEqual(writes[0]['updateMask']['fieldPaths'], ['metadata.title'])
        self.assertEqual(decode(writes[0]['update']['fields']['metadata']), {'title':PROPOSED})
        self.assertEqual(writes[0]['currentDocument'], {'updateTime':'r1'})
        self.assertTrue(writes[2]['update']['name'].startswith(BASE+'/titleAudit/'))
        base.get.return_value['revision'] = 'r2'
        with self.assertRaises(CatalogError): store.apply(entry)
        base.get.return_value['data']['metadata']['title'] = PROPOSED
        self.assertEqual(store.apply(entry), 'already_applied')
        self.assertEqual(base.request.call_count, 1)

    def test_selected_preview_and_manual_review_write_only_after_apply(self):
        base, model = Mock(project='bookflix-test'), Mock()
        base.name = BASE
        base.get.return_value = copy.deepcopy(DOCUMENT)
        model.classify.return_value = title_proposal(ORIGINAL, ORIGINAL, 'bonsai')
        with tempfile.TemporaryDirectory() as directory:
            jobs = TitleJobs(base, model, directory, threading.Lock())
            with self.assertRaises(CatalogError): jobs.start_preview()
            job_id = jobs.start_preview(edition_ids=[EDITION])
            job = self.wait_job(jobs, job_id, 'preview_ready')
            self.assertEqual(job['entries'][0]['status'], 'unchanged')
            with self.assertRaises(CatalogError): jobs.start_apply(job_id, [EDITION])
            revised = jobs.review(job_id, EDITION, PROPOSED)
            self.assertEqual(revised['entries'][0]['status'], 'ready')
            base.request.assert_not_called()
            jobs.start_apply(job_id, [EDITION])
            self.wait_job(jobs, job_id, 'applied')
            base.request.assert_called_once()

    def wait_job(self, jobs, job_id, state):
        end = time.monotonic() + 3
        while time.monotonic() < end:
            job = jobs.load(job_id)
            if job['state'] == state:
                with jobs.busy: return job
            time.sleep(.01)
        self.fail(f'Anteprima non arrivata allo stato {state}')
