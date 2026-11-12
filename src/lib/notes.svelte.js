import { invoke } from '@tauri-apps/api/core';

const inTauri = '__TAURI_INTERNALS__' in window;

// Outside Tauri (plain browser preview) notes live in localStorage so the UI can be checked without the app.
// shortcut: browser-only fallback for UI checks, never used in the real app.
const fake = {
  all: () => JSON.parse(localStorage.getItem('plico.fake') || '[]'),
  put(list) { localStorage.setItem('plico.fake', JSON.stringify(list)); },
};
const notInPreview = async () => { throw new Error('Folders and Recently deleted only work in the app'); };
const api = inTauri
  ? {
      list: () => invoke('list_notes'),
      read: (path) => invoke('read_note', { path }),
      pictureTexts: () => invoke('picture_texts'),
      save: (path, body, created, opts = {}) => invoke('save_note', { path, body, created, ...opts }),
      trash: (path) => invoke('trash_note', { path }),
      folders: () => invoke('list_folders'),
      createFolder: (name) => invoke('create_folder', { name }),
      renameFolder: (from, to) => invoke('rename_folder', { from, to }),
      deleteFolder: (name) => invoke('delete_folder', { name }),
      move: (path, folder) => invoke('move_note', { path, folder }),
      listTrash: () => invoke('list_trash'),
      restore: (name) => invoke('restore_note', { name }),
      deleteForever: (name) => invoke('delete_forever', { name }),
      versions: (created) => invoke('list_versions', { created }),
      keepVersion: (path) => invoke('keep_version', { path }),
    }
  : {
      list: async () => fake.all(),
      read: async (path) => fake.all().find((n) => n.path === path) ?? null,
      pictureTexts: async () => JSON.parse(localStorage.getItem('plico.fakePictureText') || '{}'),
      async save(path, body, created, opts = {}) {
        const list = fake.all().filter((n) => n.path !== path);
        const note = { path: path ?? `${crypto.randomUUID()}.md`, body, created, modified: opts.modified ?? new Date().toISOString(), pinned: !!opts.pinned };
        fake.put([...list, note]);
        return note;
      },
      async trash(path) { fake.put(fake.all().filter((n) => n.path !== path)); },
      folders: async () => [],
      createFolder: notInPreview, renameFolder: notInPreview, deleteFolder: notInPreview, move: notInPreview,
      listTrash: async () => [], restore: notInPreview, deleteForever: notInPreview,
      versions: async (created) => JSON.parse(localStorage.getItem('plico.fakeVersions') || '{}')[created] ?? [],
      keepVersion: async () => {},
    };

// the first non-blank line is the title; a bare "#" there (quick capture without a title) means untitled
export const linesOf = (body) => body.split('\n').filter((l) => l.trim());
export const titleOf = (body) => linesOf(body)[0]?.replace(/^#+\s*/, '').trim() ?? '';

const plain = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/\|/g, ' ').replace(/[*_~`>#\[\]()!\\-]/g, '').replace(/\s+/g, ' ').trim();
const previewOf = (body) => linesOf(body).slice(1).map(plain).filter(Boolean).join(' ').slice(0, 140);

// view: 'all' | 'pinned' | 'trash' | 'folder:<name>'
export const store = $state({ pictureText: {}, notes: [], currentId: null, query: '', loaded: false, error: null, view: 'all', folders: [], trash: [], trashId: null });
let nextId = 1;

const folderOf = (path) => (path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);
const decorate = (n) => ({ ...n, pinned: !!n.pinned, folder: folderOf(n.path), id: nextId++, title: titleOf(n.body), preview: previewOf(n.body), rev: 0, saved: n.body, queue: Promise.resolve() });
const fail = (what) => (e) => { console.error(what, e); store.error = `${what}: ${e}`; };

export async function load() {
  [store.notes, store.folders] = await Promise.all([api.list().then((l) => l.map(decorate)), api.folders()]);
  store.currentId = sorted(store.notes)[0]?.id ?? null;
  store.loaded = true;
  api.pictureTexts().then((t) => (store.pictureText = { ...t, ...store.pictureText })).catch(() => {});
}

/** Picks up notes written elsewhere (quick capture) without disturbing the one being edited. */
export async function refresh() {
  const list = await api.list();
  const known = new Set(store.notes.map((n) => n.path)); // after the await, so a note added meanwhile isn't doubled
  const fresh = list.filter((n) => !known.has(n.path)).map(decorate);
  if (!fresh.length) return;
  store.notes = [...fresh, ...store.notes];
  if (store.currentId == null) store.currentId = sorted(fresh)[0].id;
}

export const flushAll = () => Promise.all(store.notes.map(flush));

// dates come as UTC (from the app) and with a local offset (from the files): compare real times, not strings
export const sorted = (notes) => [...notes].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
export const current = () => store.notes.find((n) => n.id === store.currentId) ?? null;

/**
 * A tag is # followed by a word with at least one letter (#ideas, #work/college), after a space or at
 * the start of a line, so headings ("# Title"), numbers (#1) and links (page#part) aren't tags.
 * The saved file may hold it as \#tag (Markdown escaping at the start of a line).
 */
export const TAG = /(?:^|[\s(])\\?(#[\p{L}\p{M}\p{N}_\-/]*\p{L}[\p{L}\p{M}\p{N}_\-/]*)/gu; // \p{M}: vowel signs in Hindi and similar scripts
export const tagsIn = (body) => [...new Set([...body.matchAll(TAG)].map((m) => m[1].slice(1).toLowerCase()))];

// pictures are written as ![](images/x.png); search also covers the text read from them
const picturesIn = (body) => [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);

/** Everything search looks at for a note: title, text, and words inside its pictures. */
export const haystack = (n) =>
  (n.title + '\n' + n.body + '\n' + picturesIn(n.body).map((src) => store.pictureText[src] ?? '').join('\n')).toLowerCase();

/** True when a search matches the note only through text inside one of its pictures. */
export const onlyInPicture = (n, words) =>
  words.length > 0 && !words.every((w) => (n.title + '\n' + n.body).toLowerCase().includes(w));

export function visible() {
  const words = store.query.toLowerCase().split(/\s+/).filter(Boolean);
  const v = store.view;
  let list = sorted(store.notes);
  if (v === 'pinned') list = list.filter((n) => n.pinned);
  else if (v.startsWith('folder:')) list = list.filter((n) => n.folder === v.slice(7));
  else if (v.startsWith('tag:')) list = list.filter((n) => tagsIn(n.body).includes(v.slice(4)));
  if (!words.length) return list;
  return list.filter((n) => {
    const hay = haystack(n);
    return words.every((w) => hay.includes(w));
  });
}

const timers = new Map();

/** Called on every edit: updates the list right away, writes the file shortly after typing pauses. */
export function edit(note, body) {
  note.body = body;
  note.title = titleOf(body);
  note.preview = previewOf(body);
  note.modified = new Date().toISOString();
  note.dirty = true;
  clearTimeout(timers.get(note.id));
  timers.set(note.id, setTimeout(() => flush(note), 400));
}

/** A note's earlier versions ({ saved, body }), newest first. */
export async function versionsOf(note) {
  await flush(note);
  return note.created ? api.versions(note.created) : [];
}

/** Puts an old version back; the current text is kept as a version first, so this can be undone too. */
export async function restoreVersion(note, body) {
  await flush(note);
  if (note.path) await api.keepVersion(note.path);
  edit(note, body);
  note.rev++;
}

/** Saves are chained per note so a rename never races the next write. */
export function flush(note) {
  clearTimeout(timers.get(note.id));
  timers.delete(note.id);
  if (!note.dirty || (!note.body.trim() && !note.path)) return note.queue;
  note.dirty = false;
  note.queue = note.queue.then(async () => {
    try {
      // pinning isn't an edit, so it keeps the note's time and place in the list
      const keep = note.keepTime ? note.modified : undefined;
      note.keepTime = false;
      const body = note.body;
      const saved = await api.save(note.path, body, note.created, { pinned: note.pinned, folder: note.folder, modified: keep });
      note.path = saved.path;
      note.modified = saved.modified;
      note.saved = body; // what the file now holds, so our own write isn't mistaken for an outside change
    } catch (e) {
      console.error('Could not save note', e);
      store.error = `Couldn't save "${note.title || 'Untitled'}". Your text is still here; it will retry on the next edit.`;
    }
  });
  return note.queue;
}

// ---- changes made outside Plico (OneDrive, phone sync, a text editor) ----
let pendingPaths = new Set(), diskTimer = null, diskQueue = Promise.resolve();

/** Called with paths the folder watcher saw change; waits for the burst to settle, then reloads them. */
export function diskChanged(paths) {
  paths.forEach((p) => pendingPaths.add(p));
  clearTimeout(diskTimer);
  diskTimer = setTimeout(() => {
    const batch = [...pendingPaths];
    pendingPaths = new Set();
    diskQueue = diskQueue.then(() => applyDiskChanges(batch)).catch(fail("Couldn't reload a note changed outside Plico"));
  }, 300);
}

export async function applyDiskChanges(paths) {
  await Promise.all(store.notes.map((n) => n.queue)); // our own saves settle first, so their new paths are known
  if (paths.some((p) => !p.endsWith('.md'))) store.folders = await api.folders();
  for (const path of paths.filter((p) => p.endsWith('.md'))) {
    const fresh = await api.read(path);
    const note = store.notes.find((n) => n.path === path);
    if (!note) {
      if (fresh && !store.notes.some((n) => n.path === path)) store.notes = [decorate(fresh), ...store.notes];
      continue;
    }
    const local = note.body !== note.saved; // typed here but not written yet
    if (!fresh) {
      // deleted or renamed elsewhere: unsaved text becomes a new file, otherwise drop it from the list
      if (local) { note.path = null; note.dirty = true; flush(note); }
      else await remove(note, { skipTrash: true });
      continue;
    }
    if (fresh.body === note.saved) continue; // our own write
    if (local) {
      create(note.body); // keep both: this edit becomes its own note
      store.error = `"${note.title || 'Untitled'}" was changed outside Plico while you were editing it. Your version is kept as a separate note.`;
    }
    clearTimeout(timers.get(note.id));
    Object.assign(note, { body: fresh.body, saved: fresh.body, title: titleOf(fresh.body), preview: previewOf(fresh.body), modified: fresh.modified, pinned: !!fresh.pinned, dirty: false });
    note.rev++; // an open editor shows the new text
  }
}

export function select(id) {
  const prev = current();
  if (prev && prev.id !== id) {
    flush(prev);
    if (!prev.body.trim() && !prev.path) store.notes = store.notes.filter((n) => n !== prev);
  }
  store.currentId = id;
}

/** Every tag in use, with how many notes have it, A to Z. */
export function allTags() {
  const counts = new Map();
  for (const n of store.notes) for (const t of tagsIn(n.body)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
}

export function create(body = '') {
  if (store.view.startsWith('tag:')) store.view = 'all'; // a new note has no tag yet, so it wouldn't show in the tag's list
  const now = new Date().toISOString();
  const note = decorate({ path: null, body, created: now, modified: now });
  note.folder = store.view.startsWith('folder:') ? store.view.slice(7) : null;
  store.notes = [note, ...store.notes];
  select(note.id);
  if (body) { note.dirty = true; flush(note); }
  return note;
}

export async function remove(note, { skipTrash = false } = {}) {
  clearTimeout(timers.get(note.id));
  await note.queue;
  if (note.path && !skipTrash) await api.trash(note.path);
  const list = sorted(store.notes);
  const i = list.findIndex((n) => n.id === note.id);
  store.notes = store.notes.filter((n) => n.id !== note.id);
  if (store.currentId === note.id) store.currentId = (list[i + 1] ?? list[i - 1])?.id ?? null;
}

/** Quick capture adding to an existing note. Done here, not in the capture window, so it can't clash with the open editor. */
export async function append(path, md) {
  let note = store.notes.find((n) => n.path === path);
  if (!note) { await refresh(); note = store.notes.find((n) => n.path === path); }
  if (!note) return flush(create(`#\n\n${md}`)); // gone or renamed meanwhile: keep the text as a new note
  edit(note, `${note.body.trimEnd()}\n\n${md}`);
  note.rev++; // tells an open editor to show the new text
  return flush(note);
}

export function togglePin(note) {
  note.pinned = !note.pinned;
  note.keepTime = true;
  note.dirty = true;
  return flush(note);
}

export async function moveTo(note, folder) {
  await flush(note);
  if (!note.path) { note.folder = folder; return; }
  try {
    note.path = await api.move(note.path, folder);
    note.folder = folderOf(note.path);
  } catch (e) { fail("Couldn't move the note")(e); }
}

// ---- folders ----
export async function newFolder(name) {
  try {
    const made = await api.createFolder(name);
    store.folders = await api.folders();
    return made;
  } catch (e) { fail("Couldn't create the folder")(e); }
}

/** Folder changes move files on disk, so the list is read again (keeping the open note open). */
async function reread() {
  const open = current();
  await flushAll();
  [store.notes, store.folders] = await Promise.all([api.list().then((l) => l.map(decorate)), api.folders()]);
  const again = open && store.notes.find((n) => n.created === open.created && n.title === open.title);
  store.currentId = again?.id ?? sorted(store.notes)[0]?.id ?? null;
}

export async function renameFolder(from, to) {
  try {
    const name = await api.renameFolder(from, to);
    await reread();
    if (store.view === `folder:${from}`) store.view = `folder:${name}`;
  } catch (e) { fail("Couldn't rename the folder")(e); }
}

export async function deleteFolder(name) {
  try {
    await api.deleteFolder(name);
    if (store.view === `folder:${name}`) store.view = 'all';
    await reread();
  } catch (e) { fail("Couldn't remove the folder")(e); }
}

// ---- recently deleted ----
let trashIds = 1;
export async function loadTrash() {
  store.trash = (await api.listTrash())
    .map((t) => ({ ...t, id: trashIds++, title: titleOf(t.body), preview: previewOf(t.body), modified: t.deleted }))
    .sort((a, b) => Date.parse(b.deleted) - Date.parse(a.deleted));
  store.trashId = store.trash[0]?.id ?? null;
}

const dropTrash = (entry) => {
  const i = store.trash.indexOf(entry);
  store.trash = store.trash.filter((t) => t !== entry);
  store.trashId = (store.trash[i] ?? store.trash[i - 1])?.id ?? null;
};

export async function restore(entry) {
  try {
    await api.restore(entry.name);
    dropTrash(entry);
    await refresh();
  } catch (e) { fail("Couldn't restore the note")(e); }
}

export async function deleteForever(entry) {
  try {
    await api.deleteForever(entry.name);
    dropTrash(entry);
  } catch (e) { fail("Couldn't delete the note")(e); }
}

export const daysLeft = (entry) => Math.max(0, 30 - Math.floor((Date.now() - Date.parse(entry.deleted)) / 864e5));

// ---- dates ----
const day = 864e5;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function groupOf(iso, now = new Date()) {
  const d = new Date(iso), diff = (startOfDay(now) - startOfDay(d)) / day;
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'Previous 7 days';
  if (diff < 30) return 'Previous 30 days';
  return d.toLocaleDateString('en-GB', { month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function timeOf(iso, now = new Date()) {
  const d = new Date(iso), diff = (startOfDay(now) - startOfDay(d)) / day;
  if (diff <= 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).replace('Sept', 'Sep');
}

export function stampOf(note) {
  const f = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const c = f(note.created), m = f(note.modified);
  if (c === m) return c;
  const sameDay = new Date(note.created).toDateString() === new Date(note.modified).toDateString();
  return `${c} · edited ${sameDay ? new Date(note.modified).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : m}`;
}
