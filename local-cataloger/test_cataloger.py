import copy
import json
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from cataloger import TAXONOMY, Bonsai, CatalogError, Firestore, Jobs, encode, decode, fingerprint
from app import Handler

ID = "isbn_9788804668237"
META = {"title": "Il mistero del castello", "subtitle": "", "authors": ["Autore"], "description": "Una detective indaga su un delitto in un castello medievale.", "genres": ["Romanzi"], "physicalFormat": "copertina_rigida"}
DOC = {"name": "projects/bookflix-test/databases/(default)/documents/catalog/" + ID, "revision": "2026-11-01T10:00:00Z", "data": {"metadata": META, "cover": {"path": "keep.jpg"}}}
FIRST = {"primaryGenre": "giallo", "workForm": "romanzo", "audience": None}
SECOND = {"secondaryGenres": ["romanzo_storico"]}

def classified():
    model = Bonsai(mode="json")
    model.ask = Mock(side_effect=[copy.deepcopy(FIRST), copy.deepcopy(SECOND)])
    return model.classify(META)

class ClassifierTests(unittest.TestCase):
    def test_taxonomy_has_agreed_lists_and_stable_ids(self):
        self.assertEqual([len(TAXONOMY[x]) for x in ("genres", "workForms", "audiences", "physicalFormats")], [23, 12, 5, 4])
        for group in ("genres", "workForms", "audiences", "physicalFormats"):
            ids = [r["id"] for r in TAXONOMY[group]]
            self.assertEqual(len(ids), len(set(ids)))

    def test_two_passes_and_no_inferred_binding(self):
        result = classified()
        self.assertEqual(result["primaryGenre"], "giallo")
        self.assertEqual(result["secondaryGenres"], ["romanzo_storico"])
        self.assertEqual(result["genreVersion"], "2.0")
        self.assertNotIn("physicalFormat", result)

    def test_no_primary_abstains_and_skips_secondary_call(self):
        model = Bonsai(mode="json")
        model.ask = Mock(return_value={**FIRST, "primaryGenre": None, "workForm": None})
        result = model.classify({"title": "Volume I"})
        self.assertEqual(result["genreStatus"], "needs_review")
        self.assertEqual(result["secondaryGenres"], [])
        self.assertEqual(model.ask.call_count, 1)

    def test_empty_secondary_is_valid(self):
        model = Bonsai(mode="json")
        model.ask = Mock(side_effect=[FIRST, {"secondaryGenres": []}])
        self.assertEqual(model.classify(META)["secondaryGenres"], [])

    def test_rejects_unknown_duplicate_or_primary_secondaries(self):
        for secondary in (["inventato"], ["giallo"], ["fantasy", "fantasy"], ["fantasy", "horror", "thriller"]):
            model = Bonsai(mode="json")
            model.ask = Mock(side_effect=[FIRST, {"secondaryGenres": secondary}])
            with self.assertRaises(CatalogError): model.classify(META)

    def test_no_remote_bonsai_or_credentials_in_url(self):
        for base in ("https://example.com", "http://evil.test:8080", "http://user:pass@localhost:8080"):
            with self.assertRaises(CatalogError): Bonsai(base)

    @patch("cataloger.json_request")
    def test_long_context_is_rejected_before_generation(self, request):
        request.side_effect = [{"prompt": "rendered"}, {"tokens": [1] * 8000}]
        with self.assertRaises(CatalogError): Bonsai().ask([], {})
        self.assertEqual(request.call_count, 2)

    @patch("cataloger.json_request")
    def test_truncated_output_is_rejected(self, request):
        request.side_effect = [{"prompt": "rendered"}, {"tokens": [1] * 20}, {"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}]
        with self.assertRaises(CatalogError): Bonsai().ask([], {})

    @patch("cataloger.json_request")
    def test_schema_and_no_thinking_are_sent_to_local_server(self, request):
        request.side_effect = [{"prompt": "rendered"}, {"tokens": [1]}, {"choices": [{"finish_reason": "stop", "message": {"content": '{"ok":true}'}}]}]
        self.assertEqual(Bonsai().ask([], {"type": "object"}), {"ok": True})
        payload = request.call_args.args[1]
        self.assertEqual(payload["response_format"]["schema"], {"type": "object"})
        self.assertFalse(payload["chat_template_kwargs"]["enable_thinking"])
        self.assertEqual(payload["reasoning_effort"], "none")
        self.assertEqual(payload["max_tokens"], 128)

    @patch("cataloger.json_request")
    def test_cover_sends_one_multimodal_completion_and_preserves_missing_fields(self, request):
        model = Bonsai(mode="fast")
        model.ready = Mock()
        content = json.dumps({"title": " Il libro ", "authors": ["Nome Cognome", "Nome Cognome", "Altra Autrice"], "publisher": None})
        request.return_value = {"choices": [{"finish_reason": "stop", "message": {"content": content}}]}

        result = model.read_cover(b"photo", "image/jpeg")

        self.assertEqual(result, {"title": "Il libro", "authors": ["Nome Cognome", "Altra Autrice"], "publisher": None})
        model.ready.assert_called_once_with()
        request.assert_called_once()
        url, payload = request.call_args.args
        self.assertEqual(url, "http://127.0.0.1:8080/v1/chat/completions")
        image = payload["messages"][1]["content"][0]
        self.assertEqual(image, {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,cGhvdG8="}})
        self.assertEqual(payload["response_format"]["schema"]["required"], ["title", "authors", "publisher"])

    @patch("cataloger.json_request")
    def test_cover_rejects_malformed_metadata(self, request):
        model = Bonsai()
        model.ready = Mock()
        request.return_value = {"choices": [{"finish_reason": "stop", "message": {"content": '{"title":null,"authors":"Nome","publisher":null}'}}]}
        with self.assertRaisesRegex(CatalogError, "metadati di copertina non validi"):
            model.read_cover(b"photo", "image/jpeg")

    @patch("cataloger.json_request")
    def test_reads_actual_model_and_per_slot_context(self, request):
        request.side_effect = [{"status": "ok"}, {"data": [{"id": "actual-bonsai.gguf"}]}, {"default_generation_settings": {"n_ctx": 4096}}]
        model = Bonsai(mode="json")
        model.ready()
        self.assertEqual(model.loaded_model, "actual-bonsai.gguf")
        self.assertEqual(model.context, 4096)

    @patch("cataloger.json_request")
    def test_fast_requests_one_code_with_four_token_limit_and_logprobs(self, request):
        request.side_effect = [{"prompt": "rendered"}, {"tokens": [1] * 20}, {"choices": [{"finish_reason": "stop", "message": {"content": "A"}, "logprobs": {"content": [{"token": "A", "logprob": -0.2}]}}], "usage": {"completion_tokens": 1, "prompt_tokens": 20}}]
        model = Bonsai(mode="fast")
        self.assertEqual(model.mode, "fast")
        value, trace = model.decide_fast("Primario", {"giallo": "Indagine", None: "Non determinabile"}, META)
        self.assertEqual(value, "giallo")
        payload = request.call_args.args[1]
        self.assertEqual(payload["max_tokens"], 4)
        self.assertEqual(payload["grammar"], 'root ::= "A" | "B"')
        self.assertTrue(payload["logprobs"])
        self.assertFalse(payload["chat_template_kwargs"]["enable_thinking"])
        self.assertNotIn("response_format", payload)
        self.assertEqual(trace["outputTokens"], 1)
        self.assertAlmostEqual(trace["firstTokenProbability"], 0.81873075)

    @patch("cataloger.json_request")
    def test_fast_rejects_truncation_and_out_of_grammar_text(self, request):
        for output, finish in (("A", "length"), ("A because mystery", "stop"), ("Z", "stop")):
            request.side_effect = [{"prompt": "rendered"}, {"tokens": [1]}, {"choices": [{"finish_reason": finish, "message": {"content": output}}]}]
            with self.assertRaises(CatalogError): Bonsai().decide_fast("Primario", {"giallo": "Indagine"}, META)

    @patch("cataloger.json_request")
    def test_fast_reports_missing_usage_as_unknown_not_zero(self, request):
        request.side_effect = [{"prompt": "rendered"}, {"tokens": [1]}, {"choices": [{"finish_reason": "stop", "message": {"content": "A"}}]}]
        _, trace = Bonsai().decide_fast("Primario", {"giallo": "Indagine"}, META)
        self.assertIsNone(trace["outputTokens"])
        self.assertIsNone(trace["firstTokenProbability"])

    def fast_model(self, values):
        model = Bonsai(mode="fast")
        model.decide_fast = Mock(side_effect=[(v, {"outputTokens": 1, "inputTokens": 30}) for v in values])
        return model

    def test_fast_maximum_five_decisions_and_twenty_output_tokens(self):
        model = self.fast_model(["giallo", "romanzo_storico", "thriller", "romanzo", None])
        result = model.classify(META)
        self.assertEqual(result["primaryGenre"], "giallo")
        self.assertEqual(result["secondaryGenres"], ["romanzo_storico", "thriller"])
        self.assertEqual(result["tokenUsage"]["requestCount"], 5)
        self.assertEqual(result["tokenUsage"]["maximumOutputTokens"], 20)
        self.assertEqual(result["tokenUsage"]["outputTokens"], 5)
        self.assertEqual(result["inferenceMode"], "fast")
        self.assertNotIn("giallo", model.decide_fast.call_args_list[1].args[1])
        self.assertNotIn("romanzo_storico", model.decide_fast.call_args_list[2].args[1])
        self.assertNotIn("physicalFormat", result)

    def test_fast_no_secondaries_stops_after_first_none(self):
        model = self.fast_model(["giallo", None, "romanzo", None])
        result = model.classify(META)
        self.assertEqual(result["secondaryGenres"], [])
        self.assertEqual(result["tokenUsage"]["maximumOutputTokens"], 16)
        self.assertEqual(result["tokenUsage"]["requestCount"], 4)

    def test_fast_can_abstain_without_other_decisions(self):
        model = self.fast_model([None])
        result = model.classify({"title": "Volume I"})
        self.assertEqual(result["genreStatus"], "needs_review")
        self.assertEqual(result["tokenUsage"]["maximumOutputTokens"], 4)
        self.assertIsNone(result["audience"])
        self.assertIsNone(result["workForm"])
        self.assertEqual(model.decide_fast.call_count, 1)

    def test_fast_preserves_already_selected_values_from_later_mutation(self):
        model = self.fast_model(["giallo", None, "romanzo", None])
        model.classify(META)
        self.assertEqual(model.decide_fast.call_args_list[0].args[3], {})
        self.assertEqual(model.decide_fast.call_args_list[1].args[3], {"primaryGenre": "giallo"})

    def test_preview_can_repeat_exact_edition_set_without_scanning_catalogue(self):
        with tempfile.TemporaryDirectory() as directory:
            store, model = Mock(project="bookflix-test"), Mock()
            store.get.return_value = copy.deepcopy(DOC)
            model.classify.return_value = classified()
            jobs = Jobs(store, model, directory)
            job_id = jobs.start_preview(edition_ids=[ID, ID])
            job = self.wait_job(jobs, job_id, "preview_ready")
            self.assertEqual(len(job["entries"]), 1)
            store.pending.assert_not_called()
            store.apply.assert_not_called()

    def test_default_json_has_no_rationale_in_schema_or_output(self):
        model = Bonsai()
        self.assertEqual(model.mode, "json")
        model.ask = Mock(side_effect=[copy.deepcopy(FIRST), copy.deepcopy(SECOND)])
        result = model.classify(META)
        self.assertNotIn("reason", result)
        self.assertNotIn("secondaryReason", result)
        self.assertNotIn("rationale", result)
        self.assertEqual(result["tokenUsage"]["maximumOutputTokens"], 256)
        for call in model.ask.call_args_list:
            for key in ("reason", "rationale", "reasoning"):
                self.assertNotIn(key, call.args[1]["properties"])

    def test_firestore_value_roundtrip(self):
        value = {"name": "città", "v": [None, True, 2, 1.5], "meta": META}
        self.assertEqual(decode(encode(value)), value)

    def test_only_classification_and_genres_are_written_atomically_with_invalidation_and_audit(self):
        store = Firestore("bookflix-test", "never-opened.json")
        store.get = Mock(return_value=copy.deepcopy(DOC))
        store.request = Mock()
        proposed = classified()
        entry = {"id": ID, "revision": DOC["revision"], "inputHash": fingerprint(META), "proposed": proposed}
        self.assertEqual(store.apply(entry), "applied")
        writes = store.request.call_args.args[1]["writes"]
        self.assertEqual(len(writes), 3)
        self.assertEqual(writes[0]["updateMask"]["fieldPaths"], ["classification", "metadata.genres"])
        self.assertEqual(writes[0]["currentDocument"]["updateTime"], DOC["revision"])
        self.assertTrue(writes[1]["update"]["name"].endswith("system/catalogState"))
        data = {k: decode(v) for k, v in writes[0]["update"]["fields"].items()}
        self.assertEqual(data["metadata"]["genres"], ["Giallo", "Romanzo storico"])
        self.assertNotIn("physicalFormat", data["metadata"])
        self.assertNotIn("cover", data)

    def test_stale_preview_never_writes_and_successful_commit_can_be_resumed(self):
        store = Firestore("bookflix-test", "never-opened.json")
        store.request = Mock()
        current = copy.deepcopy(DOC)
        current["revision"] = "newer"
        store.get = Mock(return_value=current)
        entry = {"id": ID, "revision": DOC["revision"], "inputHash": fingerprint(META), "proposed": classified()}
        with self.assertRaises(CatalogError): store.apply(entry)
        store.request.assert_not_called()
        current["data"]["classification"] = entry["proposed"]
        self.assertEqual(store.apply(entry), "already_applied")
        store.request.assert_not_called()

    def test_pending_includes_missing_version_and_pages(self):
        store = Firestore("bookflix-test", "never-opened.json")
        raw = lambda ident, data: {"name": DOC["name"].replace(ID, ident), "updateTime": DOC["revision"], "fields": {k: encode(v) for k, v in data.items()}}
        store.request = Mock(side_effect=[[{"document": raw(ID, {"classification": {"genreVersion": "2.0"}})}], [{"document": raw(ID, {"metadata": META})}]])
        self.assertEqual(len(list(store.pending(1))), 1)
        self.assertEqual(store.request.call_args.args[1]["structuredQuery"]["startAt"]["before"], False)

    def test_preview_does_not_write_and_apply_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Mock(project="bookflix-test")
            store.pending.return_value = [copy.deepcopy(DOC)]
            store.apply.return_value = "applied"
            model = Mock()
            model.classify.return_value = classified()
            jobs = Jobs(store, model, directory)
            job_id = jobs.start_preview(1)
            self.wait_job(jobs, job_id, "preview_ready")
            store.apply.assert_not_called()
            jobs.start_apply(job_id, [ID])
            self.wait_job(jobs, job_id, "applied")
            self.assertEqual(store.apply.call_count, 1)
            jobs.start_apply(job_id, [ID])
            self.wait_job(jobs, job_id, "applied")
            self.assertEqual(store.apply.call_count, 1)

    def test_review_required_rows_are_not_applied(self):
        with tempfile.TemporaryDirectory() as directory:
            store, model = Mock(project="bookflix-test"), Mock()
            store.pending.return_value = [copy.deepcopy(DOC)]
            model.classify.return_value = {**classified(), "primaryGenre": None, "secondaryGenres": [], "genreStatus": "needs_review"}
            jobs = Jobs(store, model, directory)
            job_id = jobs.start_preview(1)
            self.wait_job(jobs, job_id, "preview_ready")
            with self.assertRaises(CatalogError): jobs.start_apply(job_id, [ID])
            store.apply.assert_not_called()

    def test_manual_genre_review_is_local_and_applies_the_corrected_proposal(self):
        with tempfile.TemporaryDirectory() as directory:
            store, model = Mock(project='bookflix-test'), Mock()
            store.get.return_value = copy.deepcopy(DOC)
            store.apply.return_value = 'applied'
            model.classify.return_value = {**classified(), 'primaryGenre':None, 'secondaryGenres':[], 'genreStatus':'needs_review'}
            jobs = Jobs(store, model, directory)
            job_id = jobs.start_preview(edition_ids=[ID])
            self.wait_job(jobs, job_id, 'preview_ready')
            with self.assertRaises(CatalogError):
                jobs.review(job_id, ID, {**FIRST, 'secondaryGenres':['giallo']})
            correction = {**FIRST, 'primaryGenre':'thriller', 'secondaryGenres':['giallo']}
            entry = jobs.review(job_id, ID, correction)['entries'][0]
            self.assertEqual(entry['status'], 'ready')
            self.assertEqual(entry['proposed']['source'], 'manual')
            self.assertEqual(entry['proposed']['inputHash'], fingerprint(META))
            self.assertEqual(jobs.load(job_id)['entries'][0], entry)
            store.apply.assert_not_called()
            jobs.start_apply(job_id, [ID])
            self.wait_job(jobs, job_id, 'applied')
            self.assertEqual(store.apply.call_args.args[0]['proposed']['primaryGenre'], 'thriller')
            with self.assertRaises(CatalogError):
                jobs.review(job_id, ID, correction)

    def test_processed_revisions_include_local_previews_for_current_project_and_taxonomy(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs = Jobs(Mock(project='bookflix-test'), Mock(), directory)
            current = {'id':ID, 'revision':'r1', 'proposed':{'genreVersion':TAXONOMY['version']}}
            jobs.save({'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'project':'bookflix-test', 'state':'preview_ready',
                       'entries':[current, {**current, 'revision':'r2'}, {**current, 'revision':'old', 'proposed':{'genreVersion':'1.0'}},
                                  {**current, 'revision':'error', 'proposed':None}]})
            jobs.save({'id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'project':'another-project', 'state':'preview_ready',
                       'entries':[{**current, 'revision':'other'}]})
            self.assertEqual(jobs.processed_revisions(), {ID:['r1', 'r2']})

    def test_restart_recovers_interrupted_job(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs = Jobs(Mock(project="bookflix-test"), Mock(), directory)
            job = {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "state": "applying", "entries": []}
            jobs.save(job)
            restarted = Jobs(Mock(project="bookflix-test"), Mock(), directory)
            self.assertEqual(restarted.load(job["id"])["state"], "interrupted")

    def test_api_blocks_cross_origin_writes_and_dns_rebinding(self):
        from types import SimpleNamespace
        handler = object.__new__(Handler)
        handler.server = SimpleNamespace(server_port=8091)
        handler.headers = {"Host": "127.0.0.1:8091", "X-Bookflix-Local": "1"}
        handler.guard(write=True)
        for headers in ({"Host": "127.0.0.1:8091", "Origin": "https://evil.test", "X-Bookflix-Local": "1"}, {"Host": "evil.test", "X-Bookflix-Local": "1"}, {"Host": "127.0.0.1:8091"}):
            handler.headers = headers
            with self.assertRaises(CatalogError) as error: handler.guard(write=True)
            self.assertEqual(error.exception.status, 403)

    def wait_job(self, jobs, job_id, state):
        end = time.monotonic() + 3
        while time.monotonic() < end:
            job = jobs.load(job_id)
            if job["state"] == state: return job
            time.sleep(.01)
        self.fail(str(jobs.load(job_id)))

if __name__ == "__main__": unittest.main()
