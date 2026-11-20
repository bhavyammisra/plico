<script>
  import { onMount } from 'svelte';
  import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart';
  import { settings, set, shortcuts, keysOf } from './settings.svelte.js';
  import { invoke } from '@tauri-apps/api/core';
  import { updates, look, install } from './updates.svelte.js';
  import { vault, setPassword, setQuestion, status as vaultStatus, explain } from './vault.svelte.js';

  const inTauri = '__TAURI_INTERNALS__' in window;
  let startup = $state(false);
  let startupError = $state(null);

  onMount(async () => { if (inTauri) { startup = await isEnabled().catch(() => false); await vaultStatus(); } });

  let editing = $state(null); // 'password' | 'question'
  let a = $state(''), b = $state(''), msg = $state(null);
  const begin = (what) => { editing = what; a = b = ''; msg = null; };

  async function saveVault(e) {
    e.preventDefault();
    msg = null;
    try {
      if (editing === 'password') {
        if (a.length < 6) return (msg = 'Use at least 6 characters.');
        if (a !== b) return (msg = "The two passwords don't match.");
        await setPassword(a);
      } else {
        if (!a.trim() || !b.trim()) return (msg = 'Write a question and an answer.');
        await setQuestion(a, b);
      }
      editing = null;
    } catch (err) { msg = explain(err); }
  }

  async function toggleStartup() {
    startupError = null;
    try {
      await (startup ? disable() : enable());
      startup = await isEnabled();
    } catch (e) {
      startupError = `Couldn't change this: ${e}`;
    }
  }

  let recording = $state(null), keysError = $state(null); // which shortcut is waiting for new keys; { which, text }

  async function recordKeys(e) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return (recording = null);
    const keys = keysOf(e);
    if (!keys) return;
    // Windows keeps the Win key for itself, and a shortcut without Ctrl or Alt would fire while typing
    const which = recording;
    if (!e.ctrlKey && !e.altKey) return (keysError = { which, text: 'Include Ctrl or Alt, for example Ctrl+Shift+N.' });
    recording = null;
    try { shortcuts[which] = await invoke('set_shortcut_keys', { which, keys }); keysError = null; }
    catch (err) { keysError = { which, text: String(err) }; }
  }

  const themes = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
  const styles = [['liquid', 'Liquid glass'], ['topo', 'Contour lines'], ['none', 'None']];
  const accents = [['gold', 'Gold'], ['ink', 'Ink blue'], ['terracotta', 'Terracotta'], ['moss', 'Moss']];
</script>

<svelte:window onkeydowncapture={recordKeys} />

<div class="settings">
  <h1>Settings</h1>
  <h2>Appearance</h2>
  <div class="set-row">
    <div><div class="t">Theme</div><div class="d">System follows your Windows setting.</div></div>
    <span class="seg" role="group" aria-label="Theme">
      {#each themes as [v, label]}<button aria-pressed={settings.theme === v} onclick={() => set('theme', v)}>{label}</button>{/each}
    </span>
  </div>
  <div class="set-row">
    <div><div class="t">Selected note style</div><div class="d">How the open note stands out in the list.</div></div>
    <span class="seg" role="group" aria-label="Selected note style">
      {#each styles as [v, label]}<button aria-pressed={settings.sel === v} onclick={() => set('sel', v)}>{label}</button>{/each}
    </span>
  </div>
  <div class="set-row">
    <div><div class="t">Accent colour</div><div class="d">Used for checkboxes, buttons and highlights.</div></div>
    <div class="swatches" role="group" aria-label="Accent colour">
      {#each accents as [v, label]}<button class="swatch" aria-pressed={settings.accent === v} onclick={() => set('accent', v)}><i class="sw-{v}"></i>{label}</button>{/each}
    </div>
  </div>

  <h2>Notes</h2>
  <div class="set-row">
    <div><div class="t">Hide note text in the list</div><div class="d">The list shows only titles and times, so the lines under each title stay private on a shared screen.</div></div>
    <button class="toggle" role="switch" aria-checked={!!settings.hidePreviews} aria-label="Hide note text in the list" onclick={() => set('hidePreviews', !settings.hidePreviews)}></button>
  </div>
  <div class="set-row">
    <div><div class="t">Notes folder</div><div class="path">Documents\Plico</div></div>
  </div>
  {#each [['capture', 'Quick capture shortcut', 'Opens a small note box over any app.'], ['open', 'Open Plico shortcut', 'Brings Plico to the front from any app.']] as [which, title, about] (which)}
    <div class="set-row">
      <div><div class="t">{title}</div><div class="d" class:err={keysError?.which === which}>{keysError?.which === which ? keysError.text : about}</div></div>
      <span class="keys">
        {#if recording === which}<span class="d">Press the new keys</span>
        {:else}<span class="hint">{#each shortcuts[which].split('+') as k}<kbd>{k}</kbd>{/each}</span>{/if}
        <button class="ghost-btn" disabled={!inTauri} onclick={() => { keysError = null; recording = recording === which ? null : which; }}>{recording === which ? 'Cancel' : 'Change'}</button>
      </span>
    </div>
  {/each}
  <div class="set-row">
    <div>
      <div class="t">Start with Windows</div>
      <div class="d">{startupError ?? 'Waits quietly in the tray so quick capture is ready.'}</div>
    </div>
    <button class="toggle" role="switch" aria-checked={startup} aria-label="Start with Windows" disabled={!inTauri} onclick={toggleStartup}></button>
  </div>

  {#if vault.exists}
    <h2>Locked folder</h2>
    {#if !vault.unlocked}
      <div class="set-row"><div><div class="t">Password and security question</div><div class="d">Unlock the Locked folder first to change these.</div></div></div>
    {:else if editing}
      <form class="set-form" onsubmit={saveVault}>
        {#if editing === 'password'}
          <div class="field"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password" bind:value={a} /></div>
          <div class="field"><label for="np2">Confirm new password</label><input id="np2" type="password" autocomplete="new-password" bind:value={b} /></div>
        {:else}
          <div class="field"><label for="nq">New security question</label><input id="nq" bind:value={a} placeholder="What was the name of her dog?" /></div>
          <div class="field"><label for="na">Answer</label><input id="na" bind:value={b} autocomplete="off" placeholder="Capitals and spaces don't matter" /></div>
        {/if}
        {#if msg}<p class="lock-error" role="alert">{msg}</p>{/if}
        <div class="lock-actions">
          <button class="primary" type="submit" disabled={vault.busy}>{vault.busy ? 'Saving…' : 'Save'}</button>
          <button class="ghost-btn" type="button" onclick={() => (editing = null)}>Cancel</button>
        </div>
      </form>
    {:else}
      <div class="set-row"><div><div class="t">Password</div><div class="d">Opens the Locked folder.</div></div><button class="ghost-btn" onclick={() => begin('password')}>Change</button></div>
      <div class="set-row"><div><div class="t">Security question</div><div class="d">{vault.question}</div></div><button class="ghost-btn" onclick={() => begin('question')}>Change</button></div>
    {/if}
    <div class="set-row"><div><div class="t">Locks again</div><div class="d">After 5 minutes without use, and whenever you close Plico.</div></div></div>
  {/if}
  <h2>Updates</h2>
  <div class="set-row">
    <div>
      <div class="t">Plico {updates.current || ''}</div>
      <div class="d" class:err={updates.state === 'error'}>
        {#if updates.state === 'checking'}Checking for a new version...
        {:else if updates.state === 'downloading'}Downloading the update{updates.progress ? `, ${Math.round(updates.progress * 100)}%` : ''}...
        {:else if updates.state === 'error'}{updates.error}
        {:else if updates.found}Version {updates.found.version} is ready to install.
        {:else if updates.state === 'none'}You have the latest version.
        {:else}Plico looks for new versions by itself and asks before installing.{/if}
      </div>
    </div>
    {#if updates.found && updates.state !== 'downloading'}
      <button class="ghost-btn" onclick={install}>Update now</button>
    {:else}
      <button class="ghost-btn" disabled={!inTauri || updates.state === 'checking' || updates.state === 'downloading'} onclick={() => look()}>Check now</button>
    {/if}
  </div>
</div>
