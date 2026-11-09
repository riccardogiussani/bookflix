let bulkEditDirty = false;

function commonBookValue(values) {
  const value = values[0];
  const signature = JSON.stringify(value);
  return {value, mixed: values.some(other => JSON.stringify(other) !== signature)};
}

function openBulkEditor(books, taxonomy, onSaved) {
  const dialog = $('bulkEditor');
  const form = $('bulkForm');
  const coverInput = $('bulkImage');
  const save = $('bulkSave');
  const error = $('bulkError');
  const status = $('bulkStatus');
  const changes = [];
  const commonCover = commonBookValue(books.map(book => book.cover?.path ?? null));
  let coverChanged = false;
  let replacement = null;
  let busy = false;

  function controls() {
    bulkEditDirty = coverChanged || changes.some(field => field.apply.checked);
    $('bulkInputs').disabled = busy;
    $('bulkClose').disabled = $('bulkCancel').disabled = busy;
    save.disabled = busy || !bulkEditDirty;
  }

  function field(name, caption, options = {}) {
    const {group, structured, long, array, readOnly} = options;
    const values = books.map(book => {
      if (name === 'secondary1' || name === 'secondary2') {
        return book.classification?.secondaryGenres?.[name === 'secondary1' ? 0 : 1] ?? '';
      }
      const source = structured ? book.classification : book.metadata;
      return source?.[name] ?? (array ? [] : '');
    });
    const {value, mixed} = commonBookValue(values);
    const labelId = 'bulk-label-' + name;
    const wrapper = el('div');
    wrapper.className = 'bulk-field' + (long || array ? ' wide' : '');
    const row = el('div');
    row.className = 'label-row';
    const label = el('label', caption);
    label.id = labelId;
    label.htmlFor = 'bulk-' + name;
    row.append(label);
    const control = el(group ? 'select' : long ? 'textarea' : 'input');
    control.id = label.htmlFor;
    if (group) {
      if (mixed) {
        const placeholder = new Option('—', '__mixed__');
        placeholder.disabled = true;
        control.append(placeholder);
      }
      control.append(new Option('Non indicato', ''));
      for (const item of taxonomy[group]) control.append(new Option(item.label, item.id));
      control.value = mixed ? '__mixed__' : value;
    } else {
      if (name === 'pages') {
        control.type = 'number'; control.min = '1'; control.max = '100000'; control.step = '1';
      } else if (name === 'year') {
        control.inputMode = 'numeric'; control.pattern = '[0-9]{4}'; control.maxLength = 4;
      } else if (long) {
        control.rows = 5; control.maxLength = 100000;
      } else if (!array) control.maxLength = 1000;
      control.value = mixed ? '' : array ? value.join('; ') : value;
      if (mixed) control.placeholder = '—';
    }
    wrapper.append(row, control);
    if (readOnly) {
      control.readOnly = true;
      wrapper.append(el('small', 'L’ISBN si modifica dalla scheda singola.'));
    } else {
      const applyLabel = el('label');
      applyLabel.className = 'apply-field';
      const apply = el('input');
      apply.type = 'checkbox';
      apply.setAttribute('aria-label', 'Applica ' + caption.toLowerCase());
      applyLabel.append(apply, 'Applica');
      row.append(applyLabel);
      if (array) wrapper.append(el('small', 'Separa i valori con punto e virgola.'));
      if (name === 'genres') wrapper.append(el('small', 'Applicare un nuovo elenco azzera il genere primario e i secondari strutturati.'));
      const sync = () => { control.required = name === 'title' && apply.checked; controls(); };
      apply.onchange = sync;
      control.oninput = () => { apply.checked = true; sync(); };
      changes.push({name, control, apply, structured, array});
    }
    $('bulkFields').append(wrapper);
  }

  function renderCover() {
    const differing = !coverChanged && commonCover.mixed;
    const image = coverChanged ? replacement : differing ? null : books[0].cover;
    cover($('bulkPreview'), image, differing ? '—' : '');
    $('bulkCoverStatus').textContent = coverChanged
      ? (image ? 'Nuova copertina per tutti i libri selezionati.' : 'Copertina da rimuovere per tutti i libri selezionati.')
      : (differing ? '— Copertine diverse' : image ? 'Copertina comune' : 'Nessuna copertina');
    $('bulkResetCover').hidden = !coverChanged;
  }

  async function run(action, message) {
    if (busy) return;
    busy = true; error.textContent = ''; status.textContent = message; controls();
    try { await action(); }
    catch (failure) { error.textContent = failure.message; }
    finally { busy = false; status.textContent = ''; if (dialog.open) controls(); }
  }

  function close() {
    if (busy || (bulkEditDirty && !confirm('Abbandonare le modifiche non salvate?'))) return;
    bulkEditDirty = false;
    dialog.close();
  }

  $('bulkFields').replaceChildren();
  $('bulkTitle').textContent = 'Modifica ' + books.length + ' libri';
  coverInput.value = '';
  error.textContent = ''; status.textContent = '';
  field('title', 'Titolo'); field('subtitle', 'Sottotitolo');
  field('authors', 'Autori', {array:true}); field('publisher', 'Editore');
  field('year', 'Anno di pubblicazione'); field('pages', 'Pagine'); field('language', 'Lingua');
  field('isbn', 'ISBN', {readOnly:true}); field('physicalFormat', 'Formato fisico', {group:'physicalFormats'});
  field('primaryGenre', 'Genere primario', {structured:true,group:'genres'});
  field('secondary1', 'Genere secondario', {structured:true,group:'genres'});
  field('secondary2', 'Altro genere secondario', {structured:true,group:'genres'});
  field('workForm', 'Forma dell’opera', {structured:true,group:'workForms'});
  field('audience', 'Pubblico', {structured:true,group:'audiences'});
  field('genres', 'Generi liberi', {array:true}); field('description', 'Trama', {long:true});
  renderCover(); controls();

  $('bulkClose').onclick = $('bulkCancel').onclick = close;
  dialog.oncancel = event => { event.preventDefault(); close(); };
  coverInput.onchange = () => run(async () => {
    const file = coverInput.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw Error('La copertina deve essere entro 10 MB.');
    replacement = await postImage('/admin/cover', file);
    coverChanged = true; renderCover();
  }, 'Caricamento copertina…');
  $('bulkRemoveCover').onclick = () => { coverInput.value = ''; replacement = null; coverChanged = true; renderCover(); controls(); };
  $('bulkResetCover').onclick = () => { coverInput.value = ''; coverChanged = false; renderCover(); controls(); };
  form.onsubmit = event => {
    event.preventDefault();
    const patch = {books:books.map(({id, revision}) => ({id, revision})), metadata:{}, classification:{}};
    for (const {name, control, apply, structured, array} of changes) {
      if (!apply.checked) continue;
      if (!control.reportValidity()) return;
      const value = control.value;
      if (value === '__mixed__' && control.tagName === 'SELECT') {
        error.textContent = 'Scegli un valore per «' + control.labels[0].textContent + '».';
        control.focus(); return;
      }
      if (structured) patch.classification[name] = value || null;
      else if (array) patch.metadata[name] = value.split(';').map(part => part.trim()).filter(Boolean);
      else if (name === 'pages') patch.metadata[name] = value === '' ? null : Number(value);
      else patch.metadata[name] = value;
    }
    if (coverChanged) patch.cover = replacement;
    return run(async () => {
      const result = await api('/admin/save-many', patch);
      bulkEditDirty = false; dialog.close();
      await onSaved(result);
    }, 'Salvataggio dei libri selezionati…');
  };
  dialog.showModal();
}
