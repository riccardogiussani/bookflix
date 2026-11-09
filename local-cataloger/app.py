"""Local API and review page. Run with: uv run python app.py --project YOUR_PROJECT_ID"""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from cataloger import ROOT, TAXONOMY, Bonsai, CatalogError, Firestore, Jobs
from authors import AuthorJobs
from titles import TitleJobs, TitleNormalizer
from admin import Admin, Covers, MAX_IMAGE

ADMIN_PAGES = {
    '/': ('index.html', 'catalog'),
    '/generi': ('batch.html', 'genres'),
    '/batch': ('batch.html', 'genres'),
    '/autori': ('batch.html', 'authors'),
    '/titoli': ('batch.html', 'titles'),
    '/copertina': ('cover-batch.html', 'covers'),
}
ADMIN_ASSETS = {
    '/admin/nav.css': ('admin-nav.css', 'text/css; charset=utf-8'),
    '/admin/client.js': ('admin-client.js', 'text/javascript; charset=utf-8'),
    '/admin/cover-batch.js': ('cover-batch.js', 'text/javascript; charset=utf-8'),
    '/admin/bulk-edit.js': ('bulk-edit.js', 'text/javascript; charset=utf-8'),
    '/admin/genre-batch.js': ('genre-batch.js', 'text/javascript; charset=utf-8'),
}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Do not print request bodies or private metadata.

    def send(self, value, status=200, content_type="application/json; charset=utf-8"):
        data = value if isinstance(value, bytes) else (json.dumps(value, ensure_ascii=False) if content_type.startswith("application/json") else value).encode()
        self.send_response(status)
        for k, v in {"Content-Type": content_type, "Content-Length": str(len(data)), "Cache-Control": "private, max-age=3600, immutable" if content_type.startswith('image/') else "no-store",
                     "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'"}.items(): self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def guard(self, write=False):
        port = self.server.server_port
        if self.headers.get("Host") not in (f"127.0.0.1:{port}", f"localhost:{port}"): raise CatalogError("Host non autorizzato.", 403)
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{port}", f"http://localhost:{port}"): raise CatalogError("Origine non autorizzata.", 403)
        if write and self.headers.get("X-Bookflix-Local") != "1": raise CatalogError("Serve l’header X-Bookflix-Local: 1.", 403)

    def do_OPTIONS(self):
        self.send({"error": "Accesso da altri siti non consentito."}, 403)

    def admin_page(self, filename, active):
        page = Path(__file__).with_name(filename).read_text(encoding='utf-8')
        nav = Path(__file__).with_name('admin-nav.html').read_text(encoding='utf-8')
        nav = nav.replace(f'data-page="{active}"', 'aria-current="page"')
        return self.send(page.replace('<!-- admin-nav -->', nav), content_type='text/html; charset=utf-8')

    def do_GET(self):
        try:
            self.guard()
            url = urlsplit(self.path)
            if url.path in ADMIN_PAGES: return self.admin_page(*ADMIN_PAGES[url.path])
            if url.path in ADMIN_ASSETS:
                filename, content_type = ADMIN_ASSETS[url.path]
                return self.send(Path(__file__).with_name(filename).read_bytes(), content_type=content_type)
            if self.path == '/favicon.ico': return self.send((ROOT / 'public/favicon.ico').read_bytes(), content_type='image/x-icon')
            if url.path.startswith('/admin/covers/'):
                data, mime = self.server.admin.covers.download(url.path[len('/admin/covers/'):])
                return self.send(data, content_type=mime)
            if url.path == '/admin/catalog': return self.send(self.admin_call(lambda: self.server.admin.page(parse_qs(url.query).get('pageToken', [''])[0])))
            if url.path.startswith('/admin/books/'): return self.send(self.admin_call(lambda: self.server.admin.present(self.server.admin.store.get(url.path[len('/admin/books/'):]))))
            if self.path == "/health": return self.send({"ok": True, "project": self.server.jobs.store.project, "bonsai": self.server.jobs.model.base, "mode": self.server.jobs.model.mode})
            if self.path == "/taxonomy": return self.send(TAXONOMY)
            if self.path == '/genres/processed': return self.send(self.server.jobs.processed_revisions())
            if self.path == "/authors/jobs": return self.send(sorted(p.stem for p in self.server.author_jobs.directory.glob("*.json")))
            if self.path.startswith("/authors/jobs/"): return self.send(self.server.author_jobs.load(self.path[len("/authors/jobs/"):]))
            if self.path == '/titles/jobs': return self.send(sorted(path.stem for path in self.server.title_jobs.directory.glob('*.json')))
            if self.path.startswith('/titles/jobs/'): return self.send(self.server.title_jobs.load(self.path[len('/titles/jobs/'):]))
            if self.path == "/jobs": return self.send(sorted([p.stem for p in self.server.jobs.directory.glob("*.json")]))
            if self.path.startswith("/jobs/"): return self.send(self.server.jobs.load(self.path[6:]))
            raise CatalogError("Percorso non trovato.", 404)
        except Exception as e: self.send({"error": str(e) if isinstance(e, CatalogError) else "Operazione non riuscita."}, e.status if isinstance(e, CatalogError) else 500)

    def do_POST(self):
        try:
            self.guard(write=True)
            try: length = int(self.headers.get("Content-Length", "0"))
            except ValueError: raise CatalogError("Content-Length non valido.") from None
            if self.path in ('/admin/cover', '/admin/cover-metadata'):
                if not 0 < length <= MAX_IMAGE: raise CatalogError('La copertina deve essere entro 10 MB.', 413)
                content = self.rfile.read(length)
                action = self.server.admin.suggest_cover if self.path == '/admin/cover-metadata' else self.server.admin.covers.upload
                return self.send(self.admin_call(lambda: action(content)))
            if not 0 < length <= (200000 if self.path.startswith('/admin/') else 32768): raise CatalogError("Richiesta vuota o troppo grande.", 413)
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json": raise CatalogError("Usa application/json.")
            try: body = json.loads(self.rfile.read(length))
            except ValueError: raise CatalogError("JSON non valido.") from None
            if not isinstance(body, dict): raise CatalogError("Serve un oggetto JSON.")
            if self.path in ('/admin/save', '/admin/create', '/admin/save-many'):
                creating = self.path == '/admin/create'
                action = {'/admin/create':self.server.admin.create, '/admin/save':self.server.admin.save,
                          '/admin/save-many':self.server.admin.save_many}[self.path]
                result = self.admin_call(lambda: action(body))
                self.server.author_jobs.store.documents = None
                return self.send(result, 201 if creating else 200)
            if self.path == '/admin/suggest': return self.send(self.admin_call(lambda: self.server.admin.suggest(body)))
            if self.path == "/authors/review":
                return self.send(self.server.author_jobs.review(body.get("jobId"), body.get("editionId"), body.get("authors")))
            if self.path == '/genres/review':
                return self.send(self.server.jobs.review(body.get('jobId'), body.get('editionId'), body.get('classification')))
            if self.path == '/titles/review':
                return self.send(self.server.title_jobs.review(body.get('jobId'), body.get('editionId'), body.get('title')))
            if self.path == "/authors/preview": job_id = self.server.author_jobs.start_preview(body.get("limit", 30), body.get("force") is True, body.get("editionIds"))
            elif self.path == "/authors/apply": job_id = self.server.author_jobs.start_apply(body.get("jobId"), body.get("editionIds"))
            elif self.path == '/titles/preview': job_id = self.server.title_jobs.start_preview(edition_ids=body.get('editionIds'))
            elif self.path == '/titles/apply':
                job_id = self.server.title_jobs.start_apply(body.get('jobId'), body.get('editionIds'))
                self.server.author_jobs.store.documents = None
            elif self.path == "/preview": job_id = self.server.jobs.start_preview(body.get("limit", 30), body.get("force") is True, body.get("editionIds"))
            elif self.path == "/apply": job_id = self.server.jobs.start_apply(body.get("jobId"), body.get("editionIds"))
            else: raise CatalogError("Percorso non trovato.", 404)
            self.send({"jobId": job_id}, 202)
        except Exception as e: self.send({"error": str(e) if isinstance(e, CatalogError) else "Operazione non riuscita."}, e.status if isinstance(e, CatalogError) else 500)

    def admin_call(self, action):
        if not self.server.jobs.busy.acquire(blocking=False): raise CatalogError('È in corso un’altra operazione. Attendi e riprova.', 409)
        try: return action()
        finally: self.server.jobs.busy.release()


def main():
    parser = argparse.ArgumentParser(description="Bookflix: classificazione locale con anteprima e applicazione esplicita")
    parser.add_argument("--project", default=os.environ.get("FIREBASE_PROJECT_ID"), required=not bool(os.environ.get("FIREBASE_PROJECT_ID")))
    parser.add_argument("--credentials", default=str(ROOT / ".bookflix-firestore-service-account.local.json"))
    parser.add_argument("--bonsai-url", default="http://127.0.0.1:8080")
    parser.add_argument("--model", default="Bonsai-27B-Q1_0")
    parser.add_argument("--mode", choices=["fast", "json"], default="json", help="json: output compatto senza reasoning/rationale; fast: etichette vincolate sperimentali")
    parser.add_argument("--context", type=int, default=8192)
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--jobs-dir", default=str(ROOT / ".bookflix-classifier.local.jobs"))
    parser.add_argument('--koofr-secrets', default=str(ROOT / '.bookflix-secrets.local.json'), help='File locale con KOOFR_USERNAME e KOOFR_PASSWORD (oppure variabili di ambiente)')
    args = parser.parse_args()
    jobs = Jobs(Firestore(args.project, args.credentials), Bonsai(args.bonsai_url, args.model, args.context, mode=args.mode), args.jobs_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.jobs = jobs
    server.author_jobs = AuthorJobs(jobs.store, Path(args.jobs_dir) / "authors", jobs.busy)
    server.title_jobs = TitleJobs(jobs.store, TitleNormalizer(args.bonsai_url, args.model, args.context), Path(args.jobs_dir) / 'titles', jobs.busy)
    server.admin = Admin(jobs.store, jobs.model, jobs.busy, Covers(Path(args.koofr_secrets)))
    print(f"Bookflix catalogatore: http://127.0.0.1:{args.port} — progetto {args.project}")
    print(f"Modalità Bonsai: {args.mode}")
    print('Editor centrale e strumenti batch nella barra di navigazione in fondo alla pagina.')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__ == "__main__": main()
