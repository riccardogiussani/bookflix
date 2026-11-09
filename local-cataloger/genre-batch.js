let genreBooks = [];
let processed = new Map();
let genreShown = 60;
let genreLoading = false;
let matchingBooks = 0;
const genreSelection = new Set();

function genreBookState(book) {
  if (titlesMode) {
    const title = book.metadata?.title || '';
    return title === title.toUpperCase() && title !== title.toLowerCase() ? 'caps' : '';
  }
  const classification = book.classification;
  if (classification?.genreVersion === taxonomy.version) {
    return classification.genreStatus === 'classified' && classification.primaryGenre ? 'classified' : 'review';
  }
  return processed.get(book.id)?.has(book.revision) ? 'review' : 'pending';
}

function controlsGenreCatalog(locked) {
  $('startSelected').disabled = locked || !genreSelection.size;
  $('selectAllGenreBooks').disabled = locked || !matchingBooks;
  $('clearGenreBooks').disabled = locked || !genreSelection.size;
  $('refreshBooks').disabled = locked;
  for (const button of $('genreBooks').querySelectorAll('button')) button.disabled = locked;
  $('genreBookCount').textContent = genreLoading ? 'Caricamento catalogo…' :
    `${matchingBooks} di ${genreBooks.length} libri · ${genreSelection.size} selezionati` +
    (genreSelection.size > 200 ? ' · massimo 200 per anteprima' : '');
}

function matchingGenreBooks() {
  const query = $('genreSearch').value.trim().toLocaleLowerCase('it');
  const filter = $('genreState').value;
  return genreBooks.filter(book => {
    const metadata = book.metadata || {};
    const terms = [metadata.title, ...(metadata.authors || []), metadata.isbn];
    return (!filter || genreBookState(book) === filter) && terms.join(' ').toLocaleLowerCase('it').includes(query);
  });
}

function renderGenreCatalog() {
  const matches = matchingGenreBooks();
  matchingBooks = matches.length;
  const results = $('genreBooks');
  results.replaceChildren();
  const descriptions = {classified:'✓ Classificato', review:'◐ Da rivedere', pending:'○ Da elaborare', caps:'AA · Tutto maiuscolo'};
  for (const book of matches.slice(0, genreShown)) {
    const metadata = book.metadata || {};
    const button = text('button', '');
    button.type = 'button';
    button.className = 'genre-book';
    const pick = text('span', '');
    pick.className = 'book-pick';
    pick.setAttribute('aria-hidden', 'true');
    const title = text('span', '');
    title.append(text('strong', metadata.title || 'Senza titolo'));
    const subtitle = [...(metadata.authors || []), metadata.isbn].filter(Boolean).join(' · ');
    if (subtitle) title.append(text('small', subtitle));
    const state = genreBookState(book);
    button.append(pick, title);
    if (state) {
      const badge = text('span', descriptions[state]);
      badge.className = 'book-state ' + state;
      button.append(badge);
    }
    const showSelection = () => {
      const selected = genreSelection.has(book.id);
      button.setAttribute('aria-pressed', String(selected));
      pick.textContent = selected ? '☑' : '☐';
    };
    showSelection();
    button.onclick = () => {
      if (!genreSelection.delete(book.id)) genreSelection.add(book.id);
      $('error').textContent = '';
      showSelection();
      controlsGenreCatalog(busy || inFlight);
    };
    results.append(button);
  }
  $('moreGenreBooks').hidden = matches.length <= genreShown;
  controlsGenreCatalog(busy || inFlight);
}

async function loadGenreCatalog() {
  genreLoading = true;
  controlsGenreCatalog(true);
  try {
    const revisions = titlesMode ? {} : await api('/genres/processed');
    const books = [];
    let token = '';
    do {
      const page = await api('/admin/catalog' + (token ? '?pageToken=' + encodeURIComponent(token) : ''));
      books.push(...page.books);
      token = page.nextPageToken;
    } while (token);
    genreBooks = books;
    processed = new Map(Object.entries(revisions).map(([id, versions]) => [id, new Set(versions)]));
    const ids = new Set(books.map(book => book.id));
    for (const id of genreSelection) if (!ids.has(id)) genreSelection.delete(id);
  } finally {
    genreLoading = false;
    renderGenreCatalog();
  }
}

function rememberGenreJob(job) {
  const books = new Map(genreBooks.map(book => [book.id, book]));
  for (const entry of job.entries) {
    if (entry.proposed?.genreVersion !== taxonomy.version) continue;
    if (!processed.has(entry.id)) processed.set(entry.id, new Set());
    processed.get(entry.id).add(entry.revision);
    const book = books.get(entry.id);
    if (book?.revision === entry.revision && ['applied','already_applied'].includes(entry.status)) {
      book.classification = entry.proposed;
    }
  }
  renderGenreCatalog();
}

function rememberTitleJob(job) {
  const applied = new Map(job.entries.filter(entry => ['applied', 'already_applied'].includes(entry.status)).map(entry => [entry.id, entry]));
  for (const book of genreBooks) {
    const entry = applied.get(book.id);
    if (entry && book.revision === entry.revision) book.metadata.title = entry.proposed.title;
  }
  if (applied.size) renderGenreCatalog();
}

function configureGenreCatalog() {
  $('genreCatalog').hidden = false;
  if (titlesMode) {
    $('genreState').replaceChildren(new Option('Tutti i titoli', ''), new Option('Solo tutto maiuscolo', 'caps'));
    $('genreState').setAttribute('aria-label', 'Filtro maiuscole');
  }
  const filter = () => { genreShown = 60; renderGenreCatalog(); };
  $('genreSearch').oninput = filter;
  $('genreState').onchange = filter;
  $('moreGenreBooks').onclick = () => { genreShown += 60; renderGenreCatalog(); };
  $('refreshBooks').onclick = () => run(loadGenreCatalog);
  $('selectAllGenreBooks').onclick = () => {
    genreSelection.clear();
    for (const book of matchingGenreBooks()) genreSelection.add(book.id);
    $('error').textContent = '';
    renderGenreCatalog();
  };
  $('clearGenreBooks').onclick = () => { genreSelection.clear(); renderGenreCatalog(); };
  $('startSelected').onclick = () => run(() => {
    if (genreSelection.size > 200) throw Error('Puoi elaborare fino a 200 libri per anteprima. Riduci la selezione e riprova.');
    return startPreview({editionIds:[...genreSelection]});
  });
}

function renderGenreProposal(entry, after) {
  const proposed = entry.proposed || {};
  const fields = [
    ['primaryGenre', 'Genere primario', 'genres'],
    ['secondary1', 'Genere secondario', 'genres'],
    ['secondary2', 'Altro genere secondario', 'genres'],
    ['workForm', 'Forma dell’opera', 'workForms'],
    ['audience', 'Pubblico', 'audiences'],
  ];
  const initial = {...proposed, secondary1:proposed.secondaryGenres?.[0], secondary2:proposed.secondaryGenres?.[1]};
  const editable = ['preview_ready','applied','interrupted'].includes(job.state) &&
    !['applied','already_applied','conflict'].includes(entry.status);
  if (!editable) {
    for (const [field, caption, group] of fields) {
      if (initial[field]) after.append(text('small', caption + ' · ' + (labels(group)[initial[field]] || initial[field])));
    }
    return;
  }
  const form = text('div', '');
  form.className = 'genre-form';
  const original = Object.fromEntries(fields.map(([field]) => [field, initial[field] || '']));
  const current = {...(drafts.get(entry.id) || original)};
  for (const [field, caption, group] of fields) {
    const label = text('label', caption);
    const select = text('select', '');
    select.dataset.genreChoice = '1';
    select.append(new Option('Non indicato', ''), ...taxonomy[group].map(item => new Option(item.label, item.id)));
    select.value = current[field];
    select.onchange = () => {
      current[field] = select.value;
      if (fields.some(([key]) => current[key] !== original[key])) {
        drafts.set(entry.id, {...current});
        proposalPicks.delete(entry.id);
      } else drafts.delete(entry.id);
      controls();
    };
    label.append(select);
    form.append(label);
  }
  const save = text('button', 'Conferma correzione nell’anteprima');
  save.type = 'button';
  save.dataset.genreSave = entry.id;
  save.onclick = () => run(async () => {
    const classification = {
      primaryGenre:current.primaryGenre || null,
      secondaryGenres:[current.secondary1, current.secondary2].filter(Boolean),
      workForm:current.workForm || null, audience:current.audience || null,
    };
    const revised = await api('/genres/review', {jobId:job.id, editionId:entry.id, classification});
    drafts.delete(entry.id);
    showJob(revised);
  });
  form.append(save);
  after.append(form);
}
