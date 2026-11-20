// New versions are published as GitHub releases. Plico looks for one shortly after it starts and then
// every few hours, and only installs when the person says so.
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { flushAll } from './notes.svelte.js';

const inTauri = '__TAURI_INTERNALS__' in window;

export const updates = $state({
  current: '',
  found: null, // the update ready to install: { version, notes }
  state: 'idle', // 'idle' | 'checking' | 'none' | 'downloading' | 'error'
  progress: 0, // 0 to 1 while downloading
  error: null,
  later: false, // "Later" hides the card until the next start
});

let pending = null; // the plugin's update object

/** Looks for a new version; `quiet` keeps errors out of sight (no internet is normal). */
export async function look({ quiet = false } = {}) {
  if (!inTauri || updates.state === 'checking' || updates.state === 'downloading') return;
  updates.state = 'checking';
  updates.error = null;
  try {
    pending = await check();
    updates.found = pending ? { version: pending.version, notes: pending.body ?? '' } : null;
    updates.state = pending ? 'idle' : 'none';
  } catch (e) {
    updates.state = quiet ? 'idle' : 'error';
    updates.error = quiet ? null : `Couldn't check for updates: ${e}`;
  }
}

/** Saves every note, downloads and installs the update, then starts the new version. */
export async function install() {
  if (!pending) return;
  updates.state = 'downloading';
  updates.progress = 0;
  try {
    await flushAll();
    let total = 0, got = 0;
    await pending.downloadAndInstall((e) => {
      if (e.event === 'Started') total = e.data.contentLength ?? 0;
      else if (e.event === 'Progress') { got += e.data.chunkLength; updates.progress = total ? got / total : 0; }
    });
    await relaunch();
  } catch (e) {
    updates.state = 'error';
    updates.error = `The update didn't install: ${e}`;
  }
}

if (inTauri) {
  getVersion().then((v) => (updates.current = v)).catch(() => {});
  setTimeout(() => look({ quiet: true }), 8000); // after start-up, so opening Plico is never slower
  setInterval(() => look({ quiet: true }), 6 * 60 * 60 * 1000);
}
