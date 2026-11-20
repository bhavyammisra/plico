// shortcut: settings live in the web view's localStorage; move to .plico/settings.json when the notes folder becomes changeable.
const KEY = 'plico.settings';
const defaults = { theme: 'system', accent: 'terracotta', sel: 'none' };

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}

export const settings = $state({ ...defaults, ...saved });

const dark = matchMedia('(prefers-color-scheme: dark)');
const root = document.documentElement;

function paint() {
  root.dataset.theme = settings.theme === 'dark' || (settings.theme === 'system' && dark.matches) ? 'dark' : 'light';
  root.dataset.accent = settings.accent;
  root.dataset.sel = settings.sel;
}

export function set(key, value) {
  const apply = () => {
    settings[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
    paint();
  };
  // the theme change cross-fades as one snapshot instead of repainting every element
  if (key === 'theme' && document.startViewTransition) document.startViewTransition(apply);
  else apply();
}

dark.addEventListener('change', () => settings.theme === 'system' && paint());
// other Plico windows (quick capture) follow changes made in Settings
addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  try { Object.assign(settings, JSON.parse(e.newValue || '{}')); } catch {}
  paint();
});
paint();

/** Plico's global shortcuts live with the Windows side (they have to work before any window opens). */
export const shortcuts = $state({ capture: 'Ctrl+Shift+Space', open: 'Ctrl+Alt+P' });
if ('__TAURI_INTERNALS__' in window) {
  import('@tauri-apps/api/core').then(({ invoke }) => {
    for (const which of Object.keys(shortcuts)) {
      invoke('shortcut_keys', { which }).then((k) => { if (typeof k === 'string') shortcuts[which] = k; }).catch(() => {});
    }
  });
}

/** Turns a key press into a shortcut like `Ctrl+Shift+N`, or null while only modifiers are held. */
export function keysOf(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const key = e.code.replace(/^Key(?=[A-Z]$)/, '').replace(/^Digit(?=\d$)/, '');
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
}
