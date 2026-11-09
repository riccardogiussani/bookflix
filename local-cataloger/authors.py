"""Conservative, deterministic author normalization. No model or cloud calls on import."""
import copy
import re
import unicodedata
import uuid
from collections import Counter, defaultdict
from urllib.parse import quote
from cataloger import CatalogError, Firestore, Jobs, encode, fingerprint, unpack, utcnow

AUTHOR_VERSION = "1.0"
PARTICLES = {"van", "von", "der", "den", "ten", "ter", "zu", "zur"}
ORGANIZATION = re.compile(r"\b(?:universit[aà]|istituto|accademia|associazione|fondazione|redazione|comitato|ministero|societ[aà]|s\.?r\.?l\.?|s\.?p\.?a\.?)\b", re.I)
ROLES = re.compile(r"[;\d/]|\([^)]*(?:cura|trad|edit|illustr|prefaz)[^)]*\)|\b(?:a cura di|curatore|curatrice|traduttore|traduttrice)\b", re.I)

def clean_name(raw):
    value = unicodedata.normalize("NFC", raw).translate(str.maketrans({"’": "'", "‘": "'", "ʼ": "'", "‐": "-", "‑": "-", "–": "-"}))
    value = re.sub(r"\s+", " ", value).strip()
    return re.sub(r"\s*'\s*", "'", value)

def identity_key(name):
    # Keep accents, hyphens and name order: similarity is not proof of identity.
    return clean_name(name).casefold()

def normalize_name(raw):
    name = clean_name(raw)
    notes, issues = [], []
    if not name:
        return {"name": "", "notes": ["Voce vuota rimossa"], "issues": [], "commaOrder": False}
    if name != raw: notes.append("Spazi e punteggiatura uniformati")
    if re.fullmatch(r"(?:a\.?\s*a\.?\s*v\.?\s*v\.?|autori vari)", name, re.I):
        return {"name": "Autori vari", "notes": notes + ["Forma collettiva uniformata"], "issues": [], "commaOrder": False}
    if re.fullmatch(r"(?:n[./]?d\.?|n/a|non disponibile|autore sconosciuto|[-–—]+)", name, re.I):
        return {"name": name, "notes": notes, "issues": ["Possibile segnaposto, non un nome d’autore"], "commaOrder": False}
    if ORGANIZATION.search(name):
        return {"name": name, "notes": notes, "issues": ["Possibile ente: verificare la denominazione, non forzare Nome Cognome"], "commaOrder": False}
    if ROLES.search(name) or "(" in name or ")" in name or re.search(r"\s(?:e|&)\s", name):
        return {"name": name, "notes": notes, "issues": ["Possibili ruoli, più persone o testo non riconducibile a un singolo nome"], "commaOrder": False}
    comma = False
    if "," in name:
        pieces = [p.strip() for p in name.split(",")]
        if len(pieces) != 2 or not all(pieces) or re.search(r"(?:^|\s)(?:jr|sr|ii|iii|iv)\.?$", pieces[-1], re.I):
            return {"name": name, "notes": notes, "issues": ["Virgole o suffissi ambigui: controllare l’ordine"], "commaOrder": False}
        name = pieces[1] + " " + pieces[0]
        notes.append("Ordine Cognome, Nome convertito in Nome Cognome")
        comma = True
    # Space initials without expanding them or merging them into a guessed full name.
    name = re.sub(r"\b([^\W\d_])\.\s*", r"\1. ", name, flags=re.UNICODE).strip()
    words = []
    for position, word in enumerate(name.split()):
        letters = ''.join(c for c in word if c.isalpha())
        if len(name.split()) == 1 and letters.isupper() and len(letters) > 1:
            words.append(word)  # An isolated uppercase word may be an acronym: do not invent its casing.
        elif len(letters) == 1:
            words.append(word.upper())
        elif word.casefold() in PARTICLES and position > 0:
            words.append(word.lower() if letters.isupper() or letters.islower() else word)
        elif letters.isupper() or letters.islower():
            words.append(word.title())
        else:
            words.append(word)  # preserve McCarthy, LeGuin and authored internal capitals
            if re.search(r"[A-ZÀ-ÖØ-Þ]{3,}", word): issues.append("Maiuscole interne insolite: controllare la grafia")
    normalized = " ".join(words)
    if normalized != name: notes.append("Maiuscole e minuscole uniformate")
    if len(words) == 1:
        issues.append("Nome singolo, iniziali o possibile mononimo: non viene inventato il resto del nome")
    if any(len(''.join(c for c in word if c.isalpha())) == 1 for word in words):
        notes.append("Iniziali mantenute, senza espansioni ipotetiche")
    return {"name": normalized, "notes": notes, "issues": issues, "commaOrder": comma}

class AuthorNormalizer:
    def __init__(self):
        self.canonical = {}
        self.explicit_order = set()
        self.confirmed_keys = set()
        self.similar = defaultdict(set)

    def prepare(self, documents):
        groups = defaultdict(list)
        self.explicit_order = set()
        self.confirmed_keys = set()
        for doc in documents:
            authors = doc["data"].get("metadata", {}).get("authors", [])
            if not isinstance(authors, list): continue
            marker = doc["data"].get("authorNormalization") or {}
            confirmed = marker.get("source") == "manual" and marker.get("authors") == authors
            for raw in authors:
                if not isinstance(raw, str): continue
                item = normalize_name(raw)
                if not item["name"]: continue
                key = identity_key(item["name"])
                if confirmed and "," not in raw:
                    item.update(name=clean_name(raw), issues=[], manual=True)
                    self.confirmed_keys.add(key)
                    self.explicit_order.add(key)
                groups[key].append((raw, item))
                if item["commaOrder"]: self.explicit_order.add(key)
        self.canonical = {}
        self.similar = defaultdict(set)
        for key, rows in groups.items():
            counts = Counter(item["name"] for _, item in rows)
            def rank(row):
                raw, item = row
                name = item["name"]
                internal = sum(bool(re.search(r"[a-zà-öø-ÿ][A-ZÀ-ÖØ-Þ]", word)) for word in name.split())
                return (item.get("manual", False), not item["issues"], clean_name(raw) == name, internal, counts[name], name)
            self.canonical[key] = max(rows, key=rank)[1]["name"]
            ascii_key = ''.join(c for c in unicodedata.normalize("NFKD", key) if not unicodedata.combining(c))
            self.similar[ascii_key].add(key)

    def classify(self, metadata):
        raw_authors = metadata.get("authors", [])
        if not isinstance(raw_authors, list) or any(not isinstance(x, str) for x in raw_authors):
            raise CatalogError("Il campo autori non è una lista di testi validi.")
        authors, notes, warnings, mappings, seen = [], [], [], [], set()
        for raw in raw_authors:
            item = normalize_name(raw)
            if not item["name"]:
                notes.extend(item["notes"])
                continue
            key = identity_key(item["name"])
            canonical = self.canonical.get(key, item["name"])
            issues = [] if key in self.confirmed_keys else list(item["issues"])
            words = key.split()
            reverse = ' '.join(reversed(words))
            if len(words) == 2 and key not in self.explicit_order and reverse != key and reverse in self.canonical:
                issues.append("Possibile variante con ordine invertito: " + self.canonical[reverse])
            ascii_key = ''.join(c for c in unicodedata.normalize("NFKD", key) if not unicodedata.combining(c))
            variants = self.similar.get(ascii_key, set()) - {key}
            if variants: issues.append("Possibili varianti negli accenti: " + ', '.join(sorted(self.canonical[k] for k in variants)))
            if key in seen:
                notes.append("Autore duplicato nello stesso libro rimosso: " + canonical)
            else:
                authors.append(canonical)
                seen.add(key)
            if canonical != raw:
                mappings.append({"from": raw, "to": canonical})
                notes.extend(item["notes"])
                if canonical != item["name"]: notes.append("Usata la grafia già presente nel catalogo: " + canonical)
            warnings.extend(issues)
        if raw_authors and not authors:
            warnings.append("L’elenco diventerebbe vuoto: confermare manualmente")
        return {"authors": authors, "authorsVersion": AUTHOR_VERSION, "authorStatus": "needs_review" if warnings else "normalized",
                "source": "local_rules", "mappings": mappings, "notes": list(dict.fromkeys(notes)),
                "warnings": list(dict.fromkeys(warnings)), "changed": authors != raw_authors}

class AuthorStore:
    def __init__(self, base, normalizer):
        self.base, self.normalizer, self.project = base, normalizer, base.project
        self.documents = None

    def scan(self):
        documents, token = [], ""
        while True:
            response = self.base.request("/catalog?pageSize=500" + ("&pageToken=" + quote(token) if token else ""))
            documents.extend(unpack(raw) for raw in response.get("documents", []))
            token = response.get("nextPageToken")
            if not token: break
        self.documents = {doc["name"].rsplit('/', 1)[-1]: doc for doc in documents}
        self.normalizer.prepare(documents)

    def get(self, edition_id):
        if self.documents is None: self.scan()
        return self.base.get(edition_id)

    def pending(self, limit, force=False):
        if force or self.documents is None: self.scan()
        for doc in self.documents.values():
            metadata = doc["data"].get("metadata", {})
            if not metadata.get("authors"): continue
            proposal = self.normalizer.classify(metadata)
            marker = doc["data"].get("authorNormalization") or {}
            if marker.get("authorsVersion") == AUTHOR_VERSION and marker.get("authors") == metadata.get("authors") and (marker.get("source") == "manual" or not proposal["changed"]):
                continue
            # Previously normalized and unchanged rows do not repeatedly fill the preview.
            if proposal["changed"] or proposal["warnings"]:
                yield copy.deepcopy(doc)
                limit -= 1
                if limit == 0: break

    def apply(self, entry):
        current = self.base.get(entry["id"])
        proposed = entry["proposed"]
        authors = validate_authors(proposed.get("authors"))
        marker = {"authorsVersion": AUTHOR_VERSION, "source": proposed["source"], "authors": authors,
                  "jobProposalId": proposed["proposalId"], "updatedAt": proposed["updatedAt"]}
        if current["data"].get("authorNormalization") == marker and current["data"].get("metadata", {}).get("authors") == authors:
            return "already_applied"
        if current["revision"] != entry["revision"] or fingerprint(current["data"].get("metadata", {})) != entry["inputHash"]:
            raise CatalogError("Libro modificato dopo l’anteprima: nessuna sovrascrittura.", 409)
        audit = {"editionId": entry["id"], "before": {"authors": current["data"].get("metadata", {}).get("authors", []),
                 "authorNormalization": current["data"].get("authorNormalization")}, "after": marker, "createdAt": utcnow()}
        result = self.base.request(":commit", {"writes": [
            {"update": {"name": current["name"], "fields": {"metadata": encode({"authors": authors}), "authorNormalization": encode(marker)}},
             "updateMask": {"fieldPaths": ["metadata.authors", "authorNormalization"]}, "currentDocument": {"updateTime": current["revision"]}},
            {"update": {"name": self.base.name + "/system/catalogState", "fields": {"authorRevision": encode(str(uuid.uuid4()))}},
             "updateMask": {"fieldPaths": ["authorRevision"]}},
            {"update": {"name": self.base.name + "/authorAudit/" + str(uuid.uuid4()), "fields": {k: encode(v) for k, v in audit.items()}}, "currentDocument": {"exists": False}}
        ]})
        if self.documents is not None:
            fresh = copy.deepcopy(current)
            fresh["data"]["metadata"]["authors"] = authors
            fresh["data"]["authorNormalization"] = marker
            revisions = (result or {}).get("writeResults", [])
            if revisions and revisions[0].get("updateTime"): fresh["revision"] = revisions[0]["updateTime"]
            self.documents[entry["id"]] = fresh
            self.normalizer.prepare(list(self.documents.values()))
        return "applied"

def validate_authors(authors):
    if not isinstance(authors, list) or len(authors) > 100 or any(not isinstance(x, str) or not x.strip() or len(x) > 1000 for x in authors):
        raise CatalogError("Inserisci al massimo 100 autori, uno per riga, senza voci vuote.")
    cleaned = [clean_name(x) for x in authors]
    keys = [identity_key(x) for x in cleaned]
    if len(keys) != len(set(keys)): raise CatalogError("La correzione contiene ancora autori duplicati.")
    return cleaned

class AuthorJobs(Jobs):
    def __init__(self, base, directory, shared_busy):
        normalizer = AuthorNormalizer()
        super().__init__(AuthorStore(base, normalizer), normalizer, directory, tool="authors")
        self.busy = shared_busy

    def review(self, job_id, edition_id, authors):
        if not self.busy.acquire(blocking=False): raise CatalogError("Attendi la fine dell’operazione in corso.", 409)
        try:
            job = self.load(job_id)
            if job.get("tool") != "authors" or job.get("project") != self.store.project or job["state"] not in ("preview_ready", "applied", "interrupted"):
                raise CatalogError("Anteprima autori non disponibile.", 409)
            entry = next((row for row in job["entries"] if row["id"] == edition_id), None)
            if not entry or entry["status"] in ("applied", "already_applied"): raise CatalogError("Proposta non modificabile.", 409)
            values = validate_authors(authors)
            entry["proposed"] = {"authors": values, "authorsVersion": AUTHOR_VERSION, "authorStatus": "normalized", "source": "manual",
                                 "notes": ["Correzione confermata nell’anteprima"], "warnings": [], "changed": True,
                                 "proposalId": str(uuid.uuid4()), "updatedAt": utcnow()}
            entry["status"] = "ready"
            entry.pop("error", None)
            self.save(job)
            return job
        finally: self.busy.release()
