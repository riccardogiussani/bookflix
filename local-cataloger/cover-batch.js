const $ = id => document.getElementById(id);
const queue = [];
const fields = [['title', 'Titolo *', 1000], ['authors', 'Autori (separati da ;)', 10000],
  ['publisher', 'Editore', 1000], ['isbn', 'ISBN (facoltativo)', 40]];
let operation = null;
let pauseRequested = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function createCard(item) {
  const card = element('article', 'candidate');
  const image = element('img', 'thumbnail');
  image.src = item.url;
  image.alt = '';
  image.loading = 'lazy';
  const content = element('div');
  const name = element('p', 'filename', item.file.name);
  name.id = 'cover-' + item.draftId;
  card.setAttribute('aria-labelledby', name.id);
  const status = element('p', 'status');
  const error = element('p', 'error');
  const metadata = element('fieldset', 'metadata');
  metadata.setAttribute('aria-label', 'Dati del libro');
  const inputs = {};
  for (const [field, caption, maxLength] of fields) {
    const label = element('label', '', caption);
    const input = element('input');
    input.maxLength = maxLength;
    input.addEventListener('input', () => {
      item.metadata[field] = input.value;
      if (!canSave(item)) item.selected = false;
      updateCard(item);
      updateControls();
    });
    inputs[field] = input;
    label.append(input);
    metadata.append(label);
  }
  const actions = element('div', 'row-actions');
  const label = element('label');
  const select = element('input');
  select.type = 'checkbox';
  select.onchange = () => { item.selected = select.checked; updateControls(); };
  label.append(select, ' Includi nel salvataggio');
  const retry = element('button', '', 'Rimetti in coda');
  retry.type = 'button';
  retry.onclick = () => {
    item.state = 'queued';
    item.error = '';
    item.selected = false;
    updateCard(item);
    updateControls();
  };
  const remove = element('button', '', 'Rimuovi dalla coda');
  remove.type = 'button';
  remove.onclick = () => {
    queue.splice(queue.indexOf(item), 1);
    URL.revokeObjectURL(item.url);
    card.remove();
    updateControls();
  };
  actions.append(label, retry, remove);
  content.append(name, status, error, metadata, actions);
  card.append(image, content);
  $('queue').append(card);
  return {status, error, metadata, inputs, label, select, retry, remove};
}

function canReview(item) {
  return ['review', 'analysis-error', 'save-error'].includes(item.state);
}

function canSave(item) {
  return canReview(item) && Boolean(item.metadata.title.trim());
}

function updateCard(item) {
  const view = item.view;
  const review = canReview(item);
  const saved = item.state === 'saved';
  const status = {
    queued: 'In coda', analyzing: 'Analisi in corso',
    review: item.metadata.title.trim() ? 'Proposta da verificare' : 'Da completare · inserisci il titolo',
    'analysis-error': 'Analisi non riuscita · puoi compilare i dati a mano',
    saving: 'Salvataggio in corso', 'save-error': 'Salvataggio da riprovare', saved: 'Aggiunto al catalogo',
  }[item.state];
  if (view.status.textContent !== status) view.status.textContent = status;
  view.error.textContent = item.error;
  view.error.hidden = !item.error;
  view.metadata.hidden = !review && !saved && item.state !== 'saving';
  view.metadata.disabled = Boolean(operation) || saved;
  view.label.hidden = !review;
  view.select.disabled = Boolean(operation) || !canSave(item);
  view.select.checked = item.selected;
  view.retry.hidden = item.state !== 'analysis-error';
  view.remove.hidden = saved;
  view.retry.disabled = view.remove.disabled = Boolean(operation);
}

function updateControls() {
  const working = Boolean(operation);
  const pending = queue.filter(item => item.state === 'queued').length;
  const ready = queue.filter(canSave);
  const selected = ready.filter(item => item.selected).length;
  $('files').disabled = working;
  $('analyze').disabled = working || pending === 0;
  $('pause').hidden = operation !== 'analysis';
  $('pause').disabled = pauseRequested;
  $('pause').textContent = pauseRequested ? 'Pausa dopo questa immagine' : 'Metti in pausa';
  $('selectAll').disabled = working || ready.length === 0;
  $('selectAll').checked = selected > 0 && selected === ready.length;
  $('selectAll').indeterminate = selected > 0 && selected < ready.length;
  $('saveBooks').disabled = working || selected === 0;
  $('saveBooks').textContent = selected ? `Aggiungi selezionati (${selected})` : 'Aggiungi selezionati';
  const saved = queue.filter(item => item.state === 'saved').length;
  const attention = queue.filter(item => item.error).length;
  const progress = operation === 'analysis' ? 'Analisi in corso · ' : operation === 'save' ? 'Salvataggio in corso · ' : '';
  const message = queue.length
    ? `${progress}${queue.length} immagini · ${pending} in attesa · ${ready.length} con titolo da rivedere · ${saved} aggiunti · ${attention} con errori`
    : 'Nessuna immagine in coda.';
  if ($('queueStatus').textContent !== message) $('queueStatus').textContent = message;
}

$('files').onchange = () => {
  const skipped = [];
  const known = new Set(queue.map(item => item.key));
  for (const file of $('files').files) {
    const key = JSON.stringify([file.name, file.size, file.lastModified]);
    if (known.has(key)) continue;
    if ((!/\.(?:jpe?g|png|webp)$/i.test(file.name) && !/^image\/(?:jpeg|png|webp)$/.test(file.type)) ||
        file.size < 1 || file.size > 10 * 1024 * 1024) {
      skipped.push(file.name);
      continue;
    }
    known.add(key);
    const item = {file, key, draftId: crypto.randomUUID(), url: URL.createObjectURL(file), state: 'queued', error: '',
      metadata: {title: '', authors: '', publisher: '', isbn: ''}, cover: null, selected: false};
    item.view = createCard(item);
    queue.push(item);
    updateCard(item);
  }
  $('files').value = '';
  $('fileNotice').hidden = !skipped.length;
  $('fileNotice').textContent = skipped.length ? 'File vuoti, non supportati o oltre 10 MB: ' + skipped.join(', ') : '';
  updateControls();
};

async function run(mode, items, action) {
  if (operation || !items.length) return;
  operation = mode;
  queue.forEach(updateCard);
  updateControls();
  try {
    for (const item of items) {
      if (pauseRequested) break;
      await action(item);
      updateCard(item);
      updateControls();
    }
  } finally {
    operation = null;
    pauseRequested = false;
    queue.forEach(updateCard);
    updateControls();
  }
}

$('analyze').onclick = () => run('analysis', queue.filter(item => item.state === 'queued'), async item => {
  item.state = 'analyzing';
  updateCard(item);
  updateControls();
  try {
    const {title, authors, publisher} = await readCoverMetadata(item.file);
    item.metadata.title ||= title || '';
    item.metadata.authors ||= authors.join('; ');
    item.metadata.publisher ||= publisher || '';
    for (const [field] of fields) item.view.inputs[field].value = item.metadata[field];
    item.state = 'review';
  } catch (error) {
    item.state = 'analysis-error';
    item.error = error.message;
  }
});
$('pause').onclick = () => { pauseRequested = true; updateControls(); };

$('selectAll').onchange = () => {
  for (const item of queue.filter(canSave)) {
    item.selected = $('selectAll').checked;
    updateCard(item);
  }
  updateControls();
};

$('saveBooks').onclick = () => run('save', queue.filter(item => canSave(item) && item.selected), async item => {
  item.state = 'saving';
  item.error = '';
  updateCard(item);
  updateControls();
  try {
    item.cover ??= await postImage('/admin/cover', item.file);
    const {title, authors, publisher, isbn} = item.metadata;
    await api('/admin/create', {draftId: item.draftId, cover: item.cover, metadata: {
      title, authors: authors.split(';').map(name => name.trim()).filter(Boolean), publisher, isbn,
    }});
    item.state = 'saved';
    item.selected = false;
  } catch (error) {
    item.state = 'save-error';
    item.error = error.message;
  }
});

window.addEventListener('beforeunload', event => {
  if (queue.some(item => item.state !== 'saved')) {
    event.preventDefault();
    event.returnValue = '';
  }
});
