<script>
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { listen, emitTo } from '@tauri-apps/api/event';
  import { Check, X, SquarePen, ListPlus, ChevronLeft } from 'lucide-svelte';
  import { savePicture, isPicture } from './lib/media.js';
  import './lib/settings.svelte.js'; // same theme and accent as the main window
  import { titleOf, sorted, timeOf } from './lib/notes.svelte.js';

  const win = getCurrentWindow();
  let title = $state('');
  let text = $state(''); // kept between openings, so a dismissed draft isn't lost
  let saving = $state(false);
  let saved = $state(false);
  let error = $state(null);
  let box = $state(), findBox = $state(), picksEl = $state();
  // 'new' writes a new note; 'add' appends to an existing one. Both are kept between openings.
  let mode = $state('new');
  // each opening starts on the two choices, unless a draft is waiting
  let choosing = $state(true);
  let tiles = $state();
  let pics = $state([]); // pasted or dropped pictures, written to disk only when the note is saved
  let target = $state(null); // { path, title } being added to
  let notes = $state([]);
  let query = $state('');
  let pick = $state(0);
  const matches = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return notes.filter((n) => words.every((w) => (n.title + '\n' + n.body).toLowerCase().includes(w)));
  });

  async function loadNotes() {
    try { notes = sorted(await invoke('list_notes')).map((n) => ({ ...n, title: titleOf(n.body) })); }
    catch (e) { error = `Couldn't read your notes: ${e}`; }
  }

  const focusNow = () => requestAnimationFrame(() => (choosing ? tiles?.querySelector('[aria-checked="true"]') : mode === 'add' && !target ? findBox : box)?.focus());

  function setMode(m) {
    mode = m;
    choosing = false;
    if (m === 'add' && !target) { query = ''; pick = 0; loadNotes(); }
    focusNow();
  }

  function choose(n) {
    target = { path: n.path, title: n.title };
    focusNow();
  }

  function change() { target = null; query = ''; pick = 0; loadNotes(); focusNow(); }

  function onFindKey(e) {
    const n = matches.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
      e.preventDefault();
      pick = (pick + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      requestAnimationFrame(() => picksEl?.children[pick]?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter') { e.preventDefault(); if (matches[pick]) choose(matches[pick]); }
    else if (e.key === 'Escape') { e.preventDefault(); win.hide(); }
  }

  const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  // each line is its own paragraph; a line that is just a link becomes a link card
  const toMarkdown = (t) =>
    t.trim().split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => (/^https?:\/\/\S+$/.test(l) ? `<div data-link-card="${escAttr(l)}">${escAttr(new URL(l).hostname.replace(/^www\./, ''))}</div>` : l))
      .join('\n\n');

  function addPics(files) {
    const found = [...files].filter(isPicture);
    pics = [...pics, ...found.map((file) => ({ file, url: URL.createObjectURL(file) }))];
    return found.length > 0;
  }
  const onPaste = (e) => { if (addPics(e.clipboardData?.files ?? [])) e.preventDefault(); };
  const onDrop = (e) => { e.preventDefault(); addPics(e.dataTransfer?.files ?? []); box?.focus(); };
  function dropPic(i) {
    URL.revokeObjectURL(pics[i].url);
    pics = pics.filter((_, j) => j !== i);
    box?.focus();
  }

  // the typed lines, then each picture on its own line
  async function content() {
    const srcs = [];
    for (const p of pics) srcs.push(await savePicture(p.file));
    return [text.trim() && toMarkdown(text), ...srcs.map((s) => `![](${s})`)].filter(Boolean).join('\n\n');
  }

  async function save() {
    if (mode === 'add') return add();
    if ((!text.trim() && !title.trim() && !pics.length) || saving) return;
    error = null;
    try {
      const md = await content();
      // the first line is the note's title; a bare "#" keeps it empty so the content isn't promoted to title
      const body = `# ${title.trim()}`.trim() + (md ? `

${md}` : '');
      await invoke('save_note', { path: null, body, created: new Date().toISOString() });
    } catch (e) {
      error = `Couldn't save: ${e}`;
      return;
    }
    await emitTo('main', 'notes-changed');
    done();
  }

  // the main window does the writing (see append in notes.svelte.js), so an open editor never overwrites it
  async function add() {
    if ((!text.trim() && !pics.length) || !target || saving) return;
    error = null;
    try {
      await emitTo('main', 'capture-append', { path: target.path, md: await content() });
    } catch (e) {
      error = `Couldn't save: ${e}`;
      return;
    }
    done();
  }

  function done() {
    saving = saved = true;
    setTimeout(async () => {
      await win.hide();
      text = title = '';
      pics.forEach((p) => URL.revokeObjectURL(p.url));
      pics = [];
      saving = saved = false;
    }, 1100);
  }

  function onChooseKey(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); mode = mode === 'new' ? 'add' : 'new'; focusNow(); }
    else if (e.key === 'Enter') { e.preventDefault(); setMode(mode); }
    else if (e.key === 'Escape') { e.preventDefault(); win.hide(); }
    // typing straight away starts a new note, so the choice never slows a quick thought down
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); text += e.key; setMode('new'); }
  }

  function back() { choosing = true; focusNow(); }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); win.hide(); }
  }

  onMount(() => {
    const offOpen = listen('capture-open', () => {
      error = null;
      choosing = !text.trim() && !title.trim() && !pics.length;
      if (mode === 'add' && !target) loadNotes();
      focusNow();
    });
    // clicking away puts it away, like Windows search
    const offFocus = win.onFocusChanged(({ payload: focused }) => { if (!focused && !saving) win.hide(); });
    return () => { offOpen.then((f) => f()); offFocus.then((f) => f()); };
  });
</script>

<div class="capture-stage">
  <div class="capture" class:saving role="dialog" aria-label="Quick note" tabindex="-1" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
    <div class="capture-head" data-tauri-drag-region>
      <span class="name" data-tauri-drag-region>Plico</span>
      {#if !choosing}
        <button class="where" onclick={back} title="Choose again"><ChevronLeft size={14} strokeWidth={1.5} />{mode === 'new' ? 'New note' : 'Add to a note'}</button>
      {/if}
    </div>
    {#if choosing}
      <div class="choices" role="radiogroup" aria-label="Where this goes" bind:this={tiles}>
        <button role="radio" aria-checked={mode === 'new'} tabindex={mode === 'new' ? 0 : -1} onclick={() => setMode('new')} onkeydown={onChooseKey}>
          <SquarePen size={22} strokeWidth={1.5} /><span>New note</span>
        </button>
        <button role="radio" aria-checked={mode === 'add'} tabindex={mode === 'add' ? 0 : -1} onclick={() => setMode('add')} onkeydown={onChooseKey}>
          <ListPlus size={22} strokeWidth={1.5} /><span>Add to a note</span>
        </button>
      </div>
    {:else}
    {#if mode === 'new'}
      <input class="title" bind:value={title} onkeydown={onKey} onpaste={onPaste} aria-label="Title" placeholder="Title">
    {:else if target}
      <div class="target"><span class="title">{target.title || 'Untitled'}</span><button class="change" onclick={change}>Change</button></div>
    {/if}
    {#if mode === 'add' && !target}
      <input class="title find" bind:this={findBox} bind:value={query} oninput={() => (pick = 0)} onkeydown={onFindKey}
        role="combobox" aria-expanded="true" aria-controls="picks" aria-label="Find a note" placeholder="Find a note">
      <div class="picks" id="picks" role="listbox" aria-label="Notes" bind:this={picksEl}>
        {#each matches as n, i (n.path)}
          <button role="option" aria-selected={i === pick} onclick={() => choose(n)} onmousemove={() => (pick = i)}>
            <span>{n.title || 'Untitled'}</span><small>{timeOf(n.modified)}</small>
          </button>
        {:else}
          <p class="none">{notes.length ? 'No notes match' : 'No notes yet'}</p>
        {/each}
      </div>
    {:else}
      <textarea bind:this={box} bind:value={text} onkeydown={onKey} onpaste={onPaste} aria-label="Quick note text"
        placeholder={mode === 'add' ? 'Added to the end of this note' : 'A thought, a link, a screenshot'}></textarea>
      {#if pics.length}
        <div class="thumbs">
          {#each pics as p, i (p.url)}
            <div class="thumb"><img src={p.url} alt="" /><button aria-label="Remove picture" onclick={() => dropPic(i)}><X size={12} strokeWidth={2} /></button></div>
          {/each}
        </div>
      {/if}
    {/if}
    {/if}
    {#if error}<p class="capture-error" role="alert">{error}</p>{/if}
    <div class="capture-foot">
      {#if choosing}
        <span><kbd>Left Right</kbd>Move</span><span><kbd>Enter</kbd>Choose</span><span>Or just start typing</span><span><kbd>Esc</kbd>Close</span>
      {:else if mode === 'add' && !target}
        <span><kbd>Up Down</kbd>Move</span><span><kbd>Enter</kbd>Choose</span><span><kbd>Esc</kbd>Close</span>
      {:else}
        <span><kbd>Enter</kbd>Save</span><span><kbd>Shift Enter</kbd>New line</span>{#if mode === 'new'}<span><kbd>Shift Tab</kbd>Title</span>{/if}<span><kbd>Esc</kbd>Close</span>
      {/if}
    </div>
  </div>
  <div class="saved" class:show={saved} role="status"><Check size={16} strokeWidth={1.5} />{mode === 'add' && target ? `Added to ${target.title || 'Untitled'}` : 'Saved to Plico'}</div>
</div>
