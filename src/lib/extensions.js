import { Node, Mark, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import Suggestion from '@tiptap/suggestion';
import { resolveSrc, hostOf, openLink } from './media.js';
import { TAG } from './notes.svelte.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Pictures keep their relative path (`images/x.png`) in the note and are shown through the asset protocol. */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-src') ?? el.getAttribute('src'),
        renderHTML: (a) => ({ src: resolveSrc(a.src), 'data-src': a.src }),
      },
    };
  },
  // pictures are blocks: each gets its own line in the .md file
  addStorage: () => ({
    markdown: {
      serialize(state, node) {
        state.write(`![${state.esc(node.attrs.alt ?? '')}](${node.attrs.src})`);
        state.closeBlock(node);
      },
      parse: {},
    },
  }),
}).configure({ inline: false, HTMLAttributes: { loading: 'lazy', class: 'note-img' } });

/**
 * A pasted link on its own line becomes a card with the site name and, once fetched, the page title.
 * Saved in the .md file as `<div data-link-card="url">Title</div>` so it reads back as a card.
 */
export const LinkCard = Node.create({
  name: 'linkCard',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ href: { default: null }, title: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-link-card]', getAttrs: (el) => ({ href: el.getAttribute('data-link-card'), title: el.textContent.trim() || null }) }],
  renderHTML: ({ node }) => ['div', { 'data-link-card': node.attrs.href }, node.attrs.title ?? hostOf(node.attrs.href)],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('a');
      dom.className = 'linkline';
      dom.href = node.attrs.href;
      dom.title = `${node.attrs.href}\nClick to open`;
      const host = hostOf(node.attrs.href);
      dom.innerHTML = `<span class="fav">${esc(host[0]?.toUpperCase() ?? '?')}</span><span><b>${esc(node.attrs.title ?? host)}</b><small>${esc(host)}</small></span>`;
      dom.addEventListener('click', (e) => { e.preventDefault(); openLink(node.attrs.href); });
      return { dom };
    };
  },
  addStorage: () => ({
    markdown: {
      serialize(state, node) {
        state.write(`<div data-link-card="${esc(node.attrs.href)}">${esc(node.attrs.title ?? hostOf(node.attrs.href))}</div>`);
        state.closeBlock(node);
      },
      parse: {},
    },
  }),
});

/**
 * The `/` menu, and (configured with `char: '[['`) the note link picker. `items` is a list or a
 * function of the typed query. `onState` receives { items, index, rect, pick } while open and null when closed.
 */
export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addOptions: () => ({ items: [], onState: () => {}, char: '/', allowSpaces: false }),
  addProseMirrorPlugins() {
    const { items, onState, char, allowSpaces } = this.options;
    let state = null;
    return [
      Suggestion({
        editor: this.editor,
        char,
        allowSpaces,
        pluginKey: new PluginKey(this.name),
        items: ({ query }) => (typeof items === 'function' ? items(query)
          : items.filter((i) => (i.label + ' ' + (i.keys ?? '')).toLowerCase().includes(query.toLowerCase()))),
        command: ({ editor, range, props }) => props.run(editor.chain().focus().deleteRange(range), editor),
        render: () => ({
          onStart: (p) => { state = { items: p.items, index: 0, rect: p.clientRect?.(), pick: (i) => p.command(p.items[i]) }; onState(state); },
          onUpdate: (p) => { state = { items: p.items, index: 0, rect: p.clientRect?.(), pick: (i) => p.command(p.items[i]) }; onState(state); },
          onKeyDown: ({ event }) => {
            if (!state?.items.length) return false;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              const n = state.items.length;
              state = { ...state, index: (state.index + (event.key === 'ArrowDown' ? 1 : n - 1)) % n };
              onState(state);
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') { state.pick(state.index); return true; }
            if (event.key === 'Escape') { onState(null); return true; }
            return false;
          },
          onExit: () => { state = null; onState(null); },
        }),
      }),
    ];
  },
});

/** Keeps an empty paragraph after a picture, table or card at the end, so there's always somewhere to type. */
export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingParagraph'),
        appendTransaction: (trs, __, state) => {
          const last = state.doc.lastChild;
          if (!last || last.type.name === 'paragraph') return null;
          const tr = state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
          // opening a note must not count as an edit
          if (trs.some((t) => t.getMeta('preventUpdate'))) tr.setMeta('preventUpdate', true);
          return tr;
        },
      }),
    ];
  },
});

/** Text colour, saved as `<span data-color="red">` (a name, not a hex) so each theme shows a readable shade. */
export const TEXT_COLORS = ['red', 'amber', 'green', 'blue', 'grey'];
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({ color: { default: null, parseHTML: (el) => el.getAttribute('data-color'), renderHTML: (a) => ({ 'data-color': a.color }) } }),
  parseHTML: () => [{ tag: 'span[data-color]', getAttrs: (el) => (TEXT_COLORS.includes(el.getAttribute('data-color')) ? null : false) }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
  addCommands() {
    return { setTextColor: (color) => ({ commands }) => (color ? commands.setMark(this.name, { color }) : commands.unsetMark(this.name)) };
  },
});

/** Highlight in colours, saved as `<mark data-color="green">` like text colour; a plain `<mark>` is the usual yellow. */
export const HIGHLIGHT_COLORS = ['red', 'green', 'blue', 'grey'];
export const ColorHighlight = Highlight.extend({
  addAttributes: () => ({
    color: { default: null, parseHTML: (el) => el.getAttribute('data-color'), renderHTML: (a) => (a.color ? { 'data-color': a.color } : {}) },
  }),
}).configure({ multicolor: true });

/**
 * A link to another note by its title, written in the file as `[[Title]]` (the same as Obsidian),
 * shown as a clickable chip. Clicking is handled by the editor (`onopenlink`).
 */
export const NoteLink = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ title: { default: '' } }),
  parseHTML: () => [{ tag: 'a[data-note-link]', priority: 60, getAttrs: (el) => ({ title: el.getAttribute('data-note-link') }) }],
  renderHTML: ({ node }) => ['a', { 'data-note-link': node.attrs.title, class: 'note-link', title: 'Open this note' }, node.attrs.title],
  addStorage: () => ({
    markdown: {
      serialize(state, node) { state.write(`[[${node.attrs.title}]]`); },
      parse: {
        // turns [[Title]] in the file into the chip; titles can't contain brackets, | or new lines
        setup(md) {
          md.inline.ruler.before('link', 'note_link', (st, silent) => {
            const m = /^\[\[([^\[\]|\n]+)\]\]/.exec(st.src.slice(st.pos));
            if (!m) return false;
            if (!silent) {
              const t = st.push('html_inline', '', 0);
              const title = esc(m[1].trim());
              t.content = `<a data-note-link="${title}">${title}</a>`;
            }
            st.pos += m[0].length;
            return true;
          });
        },
      },
    },
  }),
});

/** Titles a note links to, from its Markdown. */
export const linksIn = (body) => [...body.matchAll(/\[\[([^\[\]|\n]+)\]\]/g)].map((m) => m[1].trim().toLowerCase());

/** Colours #tags in the text (the text itself is unchanged); Ctrl+click is handled by the editor. */
export const Tags = Extension.create({
  name: 'tags',
  addProseMirrorPlugins() {
    const find = (doc) => {
      const decos = [];
      doc.descendants((node, pos, parent) => {
        if (!node.isText || parent?.type.name === 'codeBlock' || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return;
        for (const m of node.text.matchAll(TAG)) {
          const start = pos + m.index + m[0].length - m[1].length;
          decos.push(Decoration.inline(start, start + m[1].length, { class: 'tag', 'data-tag': m[1].slice(1).toLowerCase(), title: 'Ctrl+click to see notes with this tag' }));
        }
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: new PluginKey('tags'),
        state: { init: (_, { doc }) => find(doc), apply: (tr, old) => (tr.docChanged ? find(tr.doc) : old) },
        props: { decorations(state) { return this.getState(state); } },
      }),
    ];
  },
});
