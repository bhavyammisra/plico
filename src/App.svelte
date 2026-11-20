<script>
  import { onMount, tick } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import {
    Minus, Square, X, PanelLeft, SquarePen, Notebook, Settings as Gear, Search, Maximize2, Minimize2, Trash2,
    Pin, PinOff, Folder, Hash, FolderInput, Plus, RotateCcw, Check, Lock, LockOpen, FolderOutput, History, ChevronLeft, ChevronRight, Printer,
  } from 'lucide-svelte';
  import Locked from './lib/Locked.svelte';
  import * as V from './lib/vault.svelte.js';
  const { vault } = V;
  import Editor from './lib/Editor.svelte';
  import Settings from './lib/Settings.svelte';
  import { initMedia } from './lib/media.js';
  import { lensMap } from './lib/glass.js';
  import { settings, set, capture } from './lib/settings.svelte.js';
  import { linksIn } from './lib/extensions.js';
  import {
    store, load, refresh, append, diskChanged, haystack, onlyInPicture, allTags, flushAll, visible, select, create, edit, remove, flush, groupOf, timeOf, stampOf,
    dates, versionsOf, restoreVersion, togglePin, moveTo, newFolder, renameFolder, deleteFolder, loadTrash, restore, deleteForever, daysLeft,
  } from './lib/notes.svelte.js';

  const win = '__TAURI_INTERNALS__' in window ? getCurrentWindow() : null;
  const icon = { size: 16, strokeWidth: 1.5 };

  let page = $state('notes'); // 'notes' | 'settings'
  let focusMode = $state(false);
  let sidebar = $state(true);
  let search = $state(), listEl = $state(), lens = $state();
  let naming = $state(null); // { from: null | folder, value } while creating or renaming a folder
  let confirmFolder = $state(null); // folder waiting for a second click to remove
  let confirmForever = $state(false);
  let moveMenu = $state(false);
  let ctx = $state(null); // { ns, x, y } while the right-click menu is open; ns = the notes it acts on
  let picked = $state([]); // ids of notes chosen with Ctrl or Shift click
  let anchor = null; // where a Shift click range starts

  function openCtx(e, n) {
    if (inTrash || inLocked) return;
    e.preventDefault();
    const ns = picked.includes(n.id) && picked.length > 1 ? store.notes.filter((m) => picked.includes(m.id)) : [n];
    // keep the menu inside the window
    ctx = { ns, x: Math.min(e.clientX, innerWidth - 230), y: Math.max(8, Math.min(e.clientY, innerHeight - 190 - 34 * store.folders.length)) };
  }

  async function ctxDo(fn) {
    const ns = ctx.ns;
    ctx = null;
    picked = [];
    for (const m of ns) await fn(m); // one at a time: each move renames files on disk
  }

  /** Ctrl+click adds or removes a note, Shift+click picks a run of notes; a plain click opens one. */
  function clickRow(e, n) {
    if (!inTrash && !inLocked && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      const flat = groups.flatMap((g) => g.notes);
      if (!picked.length && note) picked = [note.id];
      const from = flat.findIndex((m) => m.id === (anchor ?? note?.id));
      if (e.shiftKey && from >= 0) {
        const to = flat.indexOf(n);
        picked = flat.slice(Math.min(from, to), Math.max(from, to) + 1).map((m) => m.id);
      } else {
        picked = picked.includes(n.id) ? picked.filter((id) => id !== n.id) : [...picked, n.id];
        anchor = n.id;
      }
      return;
    }
    picked = [];
    anchor = n.id;
    pick(n);
  }

  const inTrash = $derived(store.view === 'trash');
  const inLocked = $derived(store.view === 'locked');
  const keyOf = (n) => (inLocked ? n.key : n.id);
  let confirmLockedDelete = $state(false);
  let past = $state(null); // { note, list, index } while looking through a note's earlier versions

  async function openHistory(n) {
    past = { id: n.id, note: n, list: [], index: 0, loading: true };
    try {
      const list = await versionsOf(n);
      if (past?.id === n.id) past = { id: n.id, note: n, list: list.map((v, i) => ({ id: `v${i}`, body: v.body, saved: v.saved, rev: 0 })), index: 0 };
    } catch (e) { past = null; store.error = `Couldn't read this note's history: ${e}`; }
  }

  /** Print, or Save as PDF from the print dialog: just the page, always in the light theme. */
  function printNote(n) {
    const root = document.documentElement, theme = root.dataset.theme, title = document.title;
    root.dataset.theme = 'light';
    document.title = n.title || 'Note'; // the suggested PDF file name
    addEventListener('afterprint', () => { root.dataset.theme = theme; document.title = title; }, { once: true });
    window.print();
  }

  async function putBack() {
    const { note: n, list, index } = past;
    past = null;
    try { await restoreVersion(n, list[index].body); }
    catch (e) { store.error = `Couldn't restore that version: ${e}`; }
  }
  const matches = (n, words) => { const hay = haystack(n); return words.every((w) => hay.includes(w)); };
  const searchWords = $derived(store.query.toLowerCase().split(/\s+/).filter(Boolean));
  const items = $derived.by(() => {
    const words = store.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (inLocked) return vault.unlocked && !vault.resetting ? [...vault.notes].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)).filter((n) => matches(n, words)) : [];
    if (!inTrash) return visible();
    return store.trash.filter((t) => matches(t, words));
  });
  const currentKey = $derived(inLocked ? vault.currentId : inTrash ? store.trashId : store.currentId);
  const groups = $derived.by(() => {
    const out = [];
    const add = (name, n) => { if (out.at(-1)?.name !== name) out.push({ name, notes: [] }); out.at(-1).notes.push(n); };
    const pinnedFirst = store.view === 'all' && !store.query;
    if (pinnedFirst) items.filter((n) => n.pinned).forEach((n) => add('Pinned', n));
    for (const n of items) if (!(pinnedFirst && n.pinned)) add(groupOf(n.modified), n);
    return out;
  });
  const note = $derived(store.notes.find((n) => n.id === store.currentId) ?? null);

  // notes whose text has a [[link]] to the open note's title
  const backlinks = $derived.by(() => {
    const t = note?.title.trim().toLowerCase();
    if (!t) return [];
    return store.notes.filter((n) => n !== note && linksIn(n.body).includes(t))
      .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
  });

  /** Opens the note a [[link]] names, or starts it if there isn't one yet. */
  function openNoteLink(title) {
    const t = title.trim().toLowerCase();
    const target = store.notes.find((n) => n.title.trim().toLowerCase() === t);
    store.query = '';
    if (!target) return create(`# ${title.trim()}`);
    if (store.view !== 'all' && !(store.view === `folder:${target.folder}`)) store.view = 'all';
    select(target.id);
  }
  const trashed = $derived(store.trash.find((t) => t.id === store.trashId) ?? null);
  const locked = $derived(vault.notes.find((n) => n.key === vault.currentId) ?? null);
  const count = (folder) => store.notes.filter((n) => n.folder === folder).length;
  const tags = $derived(allTags());
  const saved = (n) => n.path || n.body.trim();

  // contour patch per note: a stable offset into the map
  const patch = (n) => {
    let h = 0;
    for (const ch of String(n.id) + n.created) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `${-(h % 520)}px ${-((h >> 8) % 160)}px`;
  };

  // the liquid glass lens glides to the selected row, and its refraction map is sized to it
  $effect(() => {
    currentKey; items.length; page; sidebar; focusMode; store.view;
    tick().then(() => {
      const row = listEl?.querySelector('.row[aria-current="true"]');
      if (!lens) return;
      lens.style.visibility = row ? 'visible' : 'hidden';
      if (!row) return;
      lens.style.setProperty('--sel-y', `${row.offsetTop}px`);
      lens.style.setProperty('--sel-h', `${row.offsetHeight}px`);
      const f = document.getElementById('liquid');
      [f, f.querySelector('feImage')].forEach((el) => { el.setAttribute('width', row.offsetWidth); el.setAttribute('height', row.offsetHeight); });
      f.querySelector('feImage').setAttribute('href', lensMap(row.offsetWidth, row.offsetHeight));
    });
  });

  async function show(view) {
    page = 'notes';
    moveMenu = false;
    confirmForever = false;
    picked = [];
    store.view = view;
    confirmLockedDelete = false;
    if (view === 'trash') await loadTrash();
    else if (view === 'locked') await V.status();
    else if (!items.some((n) => n.id === store.currentId)) store.currentId = items[0]?.id ?? null;
  }

  function newNote() {
    if (inLocked && vault.unlocked) { page = 'notes'; store.query = ''; V.create(); return; }
    if (store.view === 'trash' || store.view === 'pinned' || store.view === 'locked') store.view = 'all';
    page = 'notes';
    store.query = '';
    create();
  }

  function pick(n) {
    if (inLocked) { V.select(n.key); confirmLockedDelete = false; }
    else if (inTrash) { store.trashId = n.id; confirmForever = false; }
    else select(n.id);
  }

  async function finishNaming() {
    const n = naming;
    naming = null;
    const value = n?.value.trim();
    if (!value || value === n.from) return;
    if (n.from) await renameFolder(n.from, value);
    else {
      const made = await newFolder(value);
      for (const m of n.move ?? []) await moveTo(m, made); // "New folder" from the right-click menu
      if (made) show(`folder:${made}`);
    }
  }

  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
    else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); page = 'notes'; focusMode = false; tick().then(() => search?.focus()); }
    else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); if (page === 'notes' && note && !inTrash && !inLocked) printNote(note); }
    else if (mod && e.key === '.') { e.preventDefault(); focusMode = !focusMode; }
    else if (mod && e.key === '\\') { e.preventDefault(); sidebar = !sidebar; }
    else if (e.key === 'Escape') { if (ctx) ctx = null; else if (picked.length) picked = []; else if (moveMenu) moveMenu = false; else if (focusMode) focusMode = false; }
  }

  function listKey(e) {
    if (e.key === 'Delete' && note && !inTrash && !inLocked) { e.preventDefault(); remove(note); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const flat = groups.flatMap((g) => g.notes);
      const i = flat.findIndex((n) => keyOf(n) === currentKey);
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) pick(next);
    }
  }

  const focusInput = (el) => { el.focus(); el.select(); };

  async function lockThis(n) {
    moveMenu = false;
    if (!vault.unlocked) return show('locked'); // unlock first, then move it
    try {
      await flush(n);
      if (n.path) await V.moveIn(n.path);
      await remove(n, { skipTrash: true });
    } catch (e) { store.error = `Couldn't lock the note: ${e}`; }
  }

  async function moveOut(n) {
    try { await V.moveOut(n); await refresh(); } catch (e) { store.error = `Couldn't move the note out: ${e}`; }
  }

  async function closeToTray() {
    await flushAll();
    if (vault.unlocked) await V.lock();
    win?.close();
  }

  onMount(async () => {
    try {
      await initMedia();
      await load();
      await V.status();
    } catch (e) {
      store.error = `Couldn't open your notes folder: ${e}`;
    } finally {
      await tick();
      // shown only once the last note is in the DOM: no splash, no white flash.
      // (a hidden web view doesn't run animation frames, so this can't wait for one)
      if (win && !(await invoke('started_hidden'))) win.show();
    }
    if (win) {
      listen('notes-changed', () => refresh());
      listen('capture-append', ({ payload }) => append(payload.path, payload.md));
      listen('disk-changed', ({ payload }) => diskChanged(payload));
      listen('picture-text', ({ payload: [src, text] }) => (store.pictureText = { ...store.pictureText, [src]: text }));
      // Quit from the tray: save anything still pending, then exit
      listen('quit-requested', async () => { await flushAll(); if (vault.unlocked) await V.lock(); invoke('quit'); });
    }
    addEventListener('beforeunload', () => store.notes.forEach(flush));
  });
</script>

<svelte:window onkeydown={onKey} onresize={() => (ctx = null)}
  onclick={(e) => { if (moveMenu && !e.target.closest?.('.move')) moveMenu = false; if (ctx && !e.target.closest?.('.ctx')) ctx = null; }} />

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="liquid" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="300" height="64" color-interpolation-filters="sRGB">
    <feImage x="0" y="0" width="300" height="64" preserveAspectRatio="none" result="map" />
    <feDisplacementMap in="SourceGraphic" in2="map" scale="18" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div class="window">
  <div class="titlebar" data-tauri-drag-region>
    <img class="app-ico" src="/icon.svg" alt="" data-tauri-drag-region />
    <span class="name" data-tauri-drag-region>Plico</span>
    <div class="caption">
      <button aria-label="Minimise" onclick={() => win?.minimize()}><Minus {...icon} /></button>
      <button aria-label="Maximise" onclick={() => win?.toggleMaximize()}><Square size={14} strokeWidth={1.5} /></button>
      <button class="close" aria-label="Close to tray" title="Close (Plico keeps running in the tray)" onclick={closeToTray}><X {...icon} /></button>
    </div>
  </div>

  <div class="app" class:focus={focusMode && page === 'notes'} style:grid-template-columns={page === 'settings' ? '216px minmax(0, 1fr)' : sidebar ? null : '0 304px minmax(0, 1fr)'}>
    <nav class="sidebar" aria-label="Library" style:visibility={sidebar || page === 'settings' ? null : 'hidden'}>
      <div class="side-top">
        <button class="icon-btn" aria-label="Hide sidebar (Ctrl+\)" title="Hide sidebar  Ctrl+\" onclick={() => (sidebar = false)}><PanelLeft {...icon} /></button>
        <button class="icon-btn" aria-label="New note (Ctrl+N)" title="New note  Ctrl+N" onclick={newNote}><SquarePen {...icon} /></button>
      </div>
      <button class="nav" aria-current={page === 'notes' && store.view === 'all'} onclick={() => show('all')}><Notebook {...icon} />All notes<span class="count">{store.notes.filter(saved).length}</span></button>
      <button class="nav" aria-current={page === 'notes' && store.view === 'pinned'} onclick={() => show('pinned')}><Pin {...icon} />Pinned<span class="count">{store.notes.filter((n) => n.pinned).length}</span></button>

      <div class="side-head">Folders<button onclick={() => (naming = { from: null, value: '' })}>New</button></div>
      {#each store.folders as f (f)}
        {#if naming?.from === f}
          <input class="nav-input" use:focusInput bind:value={naming.value} aria-label="Folder name"
            onkeydown={(e) => { if (e.key === 'Enter') finishNaming(); if (e.key === 'Escape') naming = null; }} onblur={finishNaming} />
        {:else}
          <div class="folder-row">
            <button class="nav" aria-current={page === 'notes' && store.view === `folder:${f}`} onclick={() => show(`folder:${f}`)}
              ondblclick={() => (naming = { from: f, value: f })} title="Double-click to rename">
              <Folder {...icon} /><span class="label">{f}</span><span class="count">{count(f)}</span>
            </button>
            {#if confirmFolder === f}
              <button class="folder-x confirm" onclick={() => { confirmFolder = null; deleteFolder(f); }} onblur={() => (confirmFolder = null)} title="Its notes move to All notes">Remove</button>
            {:else}
              <button class="folder-x" aria-label="Remove folder {f}" title="Remove folder" onclick={() => (confirmFolder = f)}><X size={14} strokeWidth={1.5} /></button>
            {/if}
          </div>
        {/if}
      {/each}
      {#if naming && !naming.from}
        <input class="nav-input" use:focusInput bind:value={naming.value} placeholder="Folder name" aria-label="New folder name"
          onkeydown={(e) => { if (e.key === 'Enter') finishNaming(); if (e.key === 'Escape') naming = null; }} onblur={finishNaming} />
      {/if}

      {#if tags.length}
        <div class="side-head">Tags</div>
        {#each tags as [t, c] (t)}
          <button class="nav" aria-current={page === 'notes' && store.view === `tag:${t}`} onclick={() => show(`tag:${t}`)}>
            <Hash {...icon} /><span class="label">{t}</span><span class="count">{c}</span>
          </button>
        {/each}
      {/if}

      <div class="side-head">Private</div>
      <button class="nav" aria-current={page === 'notes' && inLocked} onclick={() => show('locked')}>
        {#if vault.unlocked}<LockOpen {...icon} />{:else}<Lock {...icon} />{/if}Locked
        {#if vault.unlocked}<span class="count">{vault.notes.filter((n) => n.id || n.body.trim()).length}</span>{/if}
      </button>
      <button class="nav" aria-current={page === 'notes' && inTrash} onclick={() => show('trash')}><Trash2 {...icon} />Recently deleted</button>
      <div class="side-foot"><button class="nav" aria-current={page === 'settings'} onclick={() => (page = 'settings')}><Gear {...icon} />Settings</button></div>
    </nav>

    {#if page === 'notes'}
      <section class="list" aria-label="Notes">
        <div class="list-top">
          {#if !sidebar}<button class="icon-btn" aria-label="Show sidebar" onclick={() => (sidebar = true)}><PanelLeft {...icon} /></button>{/if}
          <label class="search"><Search {...icon} /><input bind:this={search} bind:value={store.query} placeholder={inTrash ? 'Search deleted notes' : 'Search notes'} aria-label="Search notes" /><kbd>Ctrl K</kbd></label>
        </div>
        <div class="list-scroll" bind:this={listEl} role="listbox" tabindex="0" aria-label="Notes" onkeydown={listKey}>
          <div class="lens" aria-hidden="true" bind:this={lens}></div>
          {#each groups as g (g.name)}
            <div class="group">{g.name}</div>
            {#each g.notes as n (keyOf(n))}
              <button class="row" role="option" aria-selected={keyOf(n) === currentKey} aria-current={keyOf(n) === currentKey} class:picked={picked.length > 1 && picked.includes(n.id)} onclick={(e) => clickRow(e, n)} oncontextmenu={(e) => openCtx(e, n)}>
                {#if keyOf(n) === currentKey}{#key keyOf(n)}<div class="topo" aria-hidden="true" style:--pos={patch(n)}></div>{/key}{/if}
                <div class="row-title">{#if n.pinned}<Pin size={13} strokeWidth={1.5} />{/if}{n.title || (n.preview ? 'Untitled' : 'New note')}</div>
                <div class="row-meta"><time>{timeOf(n.modified)}</time><span>{#if onlyInPicture(n, searchWords)}<em class="in-pic">Found in a picture</em> {/if}{#if !settings.hidePreviews}{n.preview}{/if}</span></div>
              </button>
            {/each}
          {:else}
            <p class="empty">
              {#if store.query}No notes mention "{store.query}".
              {:else if inTrash}Deleted notes wait here for 30 days.
              {:else if inLocked}{vault.unlocked ? 'Press Ctrl+N for a locked note, or move a note here.' : 'Unlock to see your locked notes.'}
              {:else if store.view === 'pinned'}Pin a note to keep it at the top.
              {:else if store.view.startsWith('folder:')}Press Ctrl+N to start a note in this folder.
              {:else}Press Ctrl+N to start a note.{/if}
            </p>
          {/each}
        </div>
        {#if picked.length > 1}
          <div class="picked-bar" role="status"><span>{picked.length} notes selected. Right-click one to move them.</span><button class="ghost-btn" onclick={() => (picked = [])}>Clear</button></div>
        {/if}
      </section>

      <section class="editor" aria-label="Note">
        {#if inLocked}
          {#if !vault.unlocked || vault.resetting}
            <Locked />
          {:else if locked}
            <div class="editor-bar">
              <button class="icon-btn" aria-label="Move out of Locked" title="Move out of Locked (to All notes)" onclick={() => moveOut(locked)}><FolderOutput {...icon} /></button>
              <button class="icon-btn" aria-label="Focus mode (Ctrl+.)" title="Focus mode  Ctrl+." onclick={() => (focusMode = !focusMode)}>
                {#if focusMode}<Minimize2 {...icon} />{:else}<Maximize2 {...icon} />{/if}
              </button>
              {#if confirmLockedDelete}
                <button class="ghost-btn danger" onclick={() => { confirmLockedDelete = false; V.remove(locked); }}>Delete forever</button>
              {:else}
                <button class="icon-btn" aria-label="Delete locked note" title="Delete (locked notes can't go to Recently deleted)" onclick={() => (confirmLockedDelete = true)}><Trash2 {...icon} /></button>
              {/if}
              <button class="icon-btn" aria-label="Lock now" title="Lock now" onclick={() => V.lock()}><Lock {...icon} /></button>
            </div>
            <article class="doc">
              <div class="stamp">{stampOf(locked)} · Locked</div>
              <Editor note={locked} pictures={false} onchange={(md) => V.edit(locked, md)} onnotice={(m) => (store.error = m)} />
            </article>
          {:else}
            <div class="doc-empty">Press Ctrl+N for a locked note.</div>
          {/if}
        {:else if inTrash}
          {#if trashed}
            <div class="trash-bar">
              <span>Deleted {stampOf({ created: trashed.deleted, modified: trashed.deleted })}. Removed for good in {daysLeft(trashed)} {daysLeft(trashed) === 1 ? 'day' : 'days'}.</span>
              <button class="ghost-btn" onclick={() => restore(trashed)}><RotateCcw size={14} strokeWidth={1.5} />Restore</button>
              {#if confirmForever}
                <button class="ghost-btn danger" onclick={() => { confirmForever = false; deleteForever(trashed); }}>Delete forever</button>
              {:else}
                <button class="ghost-btn" onclick={() => (confirmForever = true)}>Delete now</button>
              {/if}
            </div>
            <article class="doc"><Editor note={trashed} readonly /></article>
          {/if}
        {:else if note && past?.id === note.id}
          {@const v = past.list[past.index]}
          <div class="trash-bar">
            {#if past.loading}<span></span>
            {:else if v}
              <span title="Version {past.index + 1} of {past.list.length}">Saved {new Date(v.saved).toLocaleString(dates.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: dates.hour12 })}</span>
              <button class="icon-btn" aria-label="Older version" title="Older" disabled={past.index === past.list.length - 1} onclick={() => past.index++}><ChevronLeft {...icon} /></button>
              <button class="icon-btn" aria-label="Newer version" title="Newer" disabled={past.index === 0} onclick={() => past.index--}><ChevronRight {...icon} /></button>
              <button class="ghost-btn" title="Restore this version (the current text is kept as a version too)" onclick={putBack}><RotateCcw size={14} strokeWidth={1.5} />Restore</button>
            {:else}
              <span>No earlier versions yet. Plico keeps one every 10 minutes while you edit.</span>
            {/if}
            <button class="icon-btn" aria-label="Close earlier versions" title="Close" onclick={() => (past = null)}><X {...icon} /></button>
          </div>
          {#if v}{#key v.id}<article class="doc"><Editor note={v} readonly /></article>{/key}{/if}
        {:else if note}
          <div class="editor-bar">
            <button class="icon-btn" aria-label={note.pinned ? 'Unpin note' : 'Pin note'} aria-pressed={note.pinned} title={note.pinned ? 'Unpin' : 'Pin to the top'} onclick={() => togglePin(note)}>
              {#if note.pinned}<PinOff {...icon} />{:else}<Pin {...icon} />{/if}
            </button>
            <div class="move">
              <button class="icon-btn" aria-label="Move to folder" aria-expanded={moveMenu} title="Move to folder" onclick={() => (moveMenu = !moveMenu)}><FolderInput {...icon} /></button>
              {#if moveMenu}
                <div class="menu" role="menu">
                  <button role="menuitem" onclick={() => { moveMenu = false; moveTo(note, null); }}>{#if !note.folder}<Check size={14} strokeWidth={1.5} />{:else}<span class="ck"></span>{/if}No folder</button>
                  {#each store.folders as f (f)}
                    <button role="menuitem" onclick={() => { moveMenu = false; moveTo(note, f); }}>{#if note.folder === f}<Check size={14} strokeWidth={1.5} />{:else}<span class="ck"></span>{/if}{f}</button>
                  {/each}
                  <button role="menuitem" class="muted" onclick={() => { moveMenu = false; sidebar = true; naming = { from: null, value: '' }; }}><Plus size={14} strokeWidth={1.5} />New folder</button>
                  {#if vault.exists}<button role="menuitem" class="muted" onclick={() => lockThis(note)}><Lock size={14} strokeWidth={1.5} />{vault.unlocked ? 'Locked folder' : 'Locked folder (unlock first)'}</button>{/if}
                </div>
              {/if}
            </div>
            <button class="icon-btn" aria-label="Print or save as PDF (Ctrl+P)" title="Print or save as PDF  Ctrl+P" onclick={() => printNote(note)}><Printer {...icon} /></button>
            <button class="icon-btn" aria-label="Earlier versions" title="Earlier versions" onclick={() => openHistory(note)}><History {...icon} /></button>
            <button class="icon-btn" aria-label="Focus mode (Ctrl+.)" title="Focus mode  Ctrl+." onclick={() => (focusMode = !focusMode)}>
              {#if focusMode}<Minimize2 {...icon} />{:else}<Maximize2 {...icon} />{/if}
            </button>
            <button class="icon-btn" aria-label="Move to Recently deleted" title="Delete note" onclick={() => remove(note)}><Trash2 {...icon} /></button>
          </div>
          <article class="doc">
            <div class="stamp">{stampOf(note)}{#if note.folder} · {note.folder}{/if}</div>
            <Editor {note} onchange={(md) => edit(note, md)} onopenlink={openNoteLink} ontag={(t) => show(`tag:${t}`)}
              linkTitles={() => store.notes.filter((n) => n !== note && n.title).map((n) => n.title)} />
            {#if backlinks.length}
              <nav class="backlinks" aria-label="Linked from">
                <div class="label">Linked from</div>
                {#each backlinks as b (b.id)}
                  <button onclick={() => select(b.id)}><span>{b.title}</span><small>{timeOf(b.modified)}</small></button>
                {/each}
              </nav>
            {/if}
          </article>
        {:else if store.loaded}
          <div class="doc-empty">Press Ctrl+N to start a note.</div>
        {/if}
      </section>
    {:else}
      <section class="editor" aria-label="Settings"><Settings /></section>
    {/if}
  </div>
</div>

{#if !settings.introDone && store.loaded}
  <aside class="intro" aria-label="Quick note">
    <div class="t">Quick note from anywhere</div>
    <p>Press {#each capture.keys.split('+') as k}<kbd>{k}</kbd>{/each}in any app to write something down. Closing Plico keeps it in the tray, so this stays instant. You can change the keys in Settings.</p>
    <div class="intro-actions">
      {#if win}<button class="ghost-btn" onclick={() => { set('introDone', true); invoke('open_capture'); }}>Try it now</button>{/if}
      <button class="ghost-btn" onclick={() => set('introDone', true)}>Got it</button>
    </div>
  </aside>
{/if}

{#if ctx}
  {@const ns = ctx.ns}
  {@const all = (test) => ns.every(test)}
  <div class="menu ctx" role="menu" aria-label="Note actions" style:left="{ctx.x}px" style:top="{ctx.y}px">
    {#if ns.length > 1}<div class="menu-label">{ns.length} notes</div>{/if}
    <button role="menuitem" onclick={() => { const on = all((m) => m.pinned); ctxDo((m) => m.pinned === on && togglePin(m)); }}>
      {#if all((m) => m.pinned)}<PinOff size={14} strokeWidth={1.5} />Unpin{:else}<Pin size={14} strokeWidth={1.5} />Pin to the top{/if}
    </button>
    <div class="menu-label">Move to folder</div>
    <button role="menuitem" onclick={() => ctxDo((m) => moveTo(m, null))}>{#if all((m) => !m.folder)}<Check size={14} strokeWidth={1.5} />{:else}<span class="ck"></span>{/if}No folder</button>
    {#each store.folders as f (f)}
      <button role="menuitem" onclick={() => ctxDo((m) => moveTo(m, f))}>{#if all((m) => m.folder === f)}<Check size={14} strokeWidth={1.5} />{:else}<span class="ck"></span>{/if}{f}</button>
    {/each}
    <button role="menuitem" class="muted" onclick={() => { const move = ns; ctx = null; picked = []; sidebar = true; naming = { from: null, value: '', move }; }}><Plus size={14} strokeWidth={1.5} />New folder</button>
    {#if vault.exists}<button role="menuitem" class="muted" onclick={() => ctxDo(lockThis)}><Lock size={14} strokeWidth={1.5} />{vault.unlocked ? 'Locked folder' : 'Locked folder (unlock first)'}</button>{/if}
    <div class="menu-sep"></div>
    <button role="menuitem" class="danger" onclick={() => ctxDo(remove)}><Trash2 size={14} strokeWidth={1.5} />{ns.length > 1 ? `Delete ${ns.length} notes` : 'Delete'}</button>
  </div>
{/if}

{#if store.error}
  <div class="toast" role="alert">{store.error}<button class="ghost-btn" onclick={() => (store.error = null)}>Dismiss</button></div>
{/if}
