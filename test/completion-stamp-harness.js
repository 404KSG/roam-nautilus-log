import { createCompletionStampWriter } from '../src/completion-stamp-writer';
import { createCompletionStampAdapter } from '../src/completion-stamp-adapter';
import * as core from '../src/completion-stamp-core';

const values = new Map([['completion-stamps-enabled', false]]), blocks = new Map(), watches = new Map(), views = new Map();
const stampUpdates = [], nativeUpdates = [], notices = [], keys = [];
let serial = 0, minute = 31, nativeDelay = 0, bufferDelay = 0, stampDelay = 0;
const KEYBOARD_COMMIT_DELAY_MS = 700;
const settings = { get: key => values.get(key), set: async (key, value) => values.set(key, JSON.parse(JSON.stringify(value))) };
const lookupUid = lookup => {
  if (typeof lookup !== 'string') throw Error('Native watches require EDN lookup strings.');
  const match = /^\[:block\/uid "([\w-]+)"\]$/.exec(lookup); if (!match) throw Error('Invalid watch lookup'); return match[1];
};
const pull = (_pattern, lookup) => {
  const uid = lookup?.[1], string = blocks.get(uid);
  return typeof string === 'string' ? { ':block/uid': uid, ':block/string': string } : null;
};
const notify = uid => { for (const callback of [...watches.get(uid) || []]) callback(); };
function apply(uid, string, origin) {
  blocks.set(uid, string); (origin === 'stamp' ? stampUpdates : nativeUpdates).push({ uid, string });
  // The graph commits before React redraws a still-focused raw textarea.
  notify(uid);
  if (origin === 'native' && bufferDelay) setTimeout(renderAll, bufferDelay); else renderAll();
}
window.roamAlphaAPI = { graph: { name: 'completion-fixture', type: 'hosted' }, user: { uid: () => 'fixture-user' }, data: {
  pull, block: { update: async ({ block }) => {
    if (stampDelay) await new Promise(resolve => setTimeout(resolve, stampDelay));
    apply(block.uid, block.string, 'stamp');
  } },
  addPullWatch: (_pattern, lookup, callback) => {
    const uid = lookupUid(lookup), set = watches.get(uid) || new Set(); set.add(callback); watches.set(uid, set);
    return undefined; // No invented unsubscribe-return API.
  },
  removePullWatch: (_pattern, lookup, callback) => watches.get(lookupUid(lookup))?.delete(callback),
} };
const writer = createCompletionStampWriter({ extensionAPI: { settings }, host: window, notify: text => notices.push(text) });
const adapter = createCompletionStampAdapter({ writer, host: window, document, now: () => new Date(2026, 10, 1, 10, minute) });

function nativeToggle(uid) {
  const before = blocks.get(uid);
  const after = core.status(before) === 'TODO' ? core.doneMarkerString(before) : core.status(before) === 'DONE' ? core.todoMarkerString(before) : before;
  if (after !== before) apply(uid, after, 'native');
}
function checkbox(uid) {
  const label = document.createElement('label'); label.className = 'check-container';
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = core.status(blocks.get(uid)) === 'DONE'; input.dataset.checkboxUid = uid;
  input.addEventListener('click', () => setTimeout(() => nativeToggle(uid), nativeDelay));
  label.append(input); return label;
}
const displayText = string => String(string || '').replace(/\{\{\[\[(?:TODO|DONE)\]\]\}\}|\{\{(?:TODO|DONE)\}\}/gi, '').trim();
function render(view) {
  if (view.editor) {
    const current = blocks.get(view.editorUid || view.uid);
    if (!view.uncommitted) {
      const { selectionStart: start, selectionEnd: end } = view.editor;
      view.editor.value = current;
      view.editor.setSelectionRange(Math.min(start, current.length), Math.min(end, current.length));
    }
    return;
  }
  const text = document.createElement('div'); text.className = 'roam-block'; text.id = `block-input-${view.windowId}-${view.uid}`;
  if (view.reference) {
    if (view.outerMarker) text.append(checkbox(view.uid));
    const ref = document.createElement('span'); ref.className = 'rm-block-ref'; ref.dataset.uid = view.reference;
    // Actual inline reference: a source data-uid, no fake nested source editor.
    ref.append(checkbox(view.reference), document.createTextNode(displayText(blocks.get(view.reference)))); text.append(ref);
  } else if (view.embed) {
    if (view.outerMarker) text.append(checkbox(view.uid));
    // Native embeds render a real nested source block, whose controls and
    // textarea have the source UID rather than the wrapper UID.
    const embed = document.createElement('div'); embed.className = 'rm-block-embed';
    const sourceRoot = document.createElement('div'); sourceRoot.className = 'roam-block-container'; sourceRoot.dataset.blockUid = view.embed;
    const sourceMain = document.createElement('div'); sourceMain.className = 'rm-block-main';
    const source = document.createElement('div'); source.className = 'roam-block'; source.id = `block-input-${view.windowId}-${view.embed}`;
    if (core.status(blocks.get(view.embed))) source.append(checkbox(view.embed));
    source.append(document.createTextNode(displayText(blocks.get(view.embed))));
    sourceMain.append(source); sourceRoot.append(sourceMain); embed.append(sourceRoot); text.append(embed); view.sourceMain = sourceMain;
  } else {
    if (core.status(blocks.get(view.uid))) text.append(checkbox(view.uid));
    text.append(document.createTextNode(displayText(blocks.get(view.uid))));
  }
  view.main.replaceChildren(text);
}
function renderAll() { for (const view of views.values()) render(view); }
function block(surface, uid, string, options = {}) {
  if (!blocks.has(uid)) blocks.set(uid, string);
  const root = document.createElement('div'); root.className = 'roam-block-container'; root.dataset.blockUid = uid;
  const main = document.createElement('div'); main.className = 'rm-block-main'; root.append(main);
  const id = `view-${++serial}`, view = { uid, root, main, windowId: id, ...options };
  views.set(id, view); (typeof surface === 'string' ? document.querySelector(surface) : surface).append(root); render(view);
  root.dataset.fixtureView = id; return id;
}
function nested(surface, parentUid, childUid) {
  const parent = block(surface, parentUid, '{{[[TODO]]}} Parent task');
  const children = document.createElement('div'); children.className = 'rm-block-children'; views.get(parent).root.append(children);
  return block(children, childUid, '{{[[TODO]]}} Nested child 15m');
}
function reference(surface, wrapperUid, sourceUid, outerMarker = false) {
  if (!blocks.has(sourceUid)) blocks.set(sourceUid, '{{[[TODO]]}} Reusable source 30m');
  return block(surface, wrapperUid, `${outerMarker ? '{{[[TODO]]}} ' : ''}((${sourceUid}))`, { reference: sourceUid, outerMarker });
}
function embed(surface, wrapperUid, sourceUid, outerMarker = false) {
  if (!blocks.has(sourceUid)) blocks.set(sourceUid, '{{[[TODO]]}} Reusable embedded source 30m');
  return block(surface, wrapperUid, `${outerMarker ? '{{[[TODO]]}} ' : ''}{{embed-path: ((${sourceUid})) closed}}`, { embed: sourceUid, outerMarker });
}
function nativeEditor(view, uid, main, value) {
  const field = document.createElement('textarea'); field.className = 'rm-block-input'; field.id = `block-input-${view.windowId}-${uid}`;
  field.value = value ?? blocks.get(uid); view.editor = field; view.editorUid = uid; view.uncommitted = value !== undefined && value !== blocks.get(uid);
  field.addEventListener('compositionstart', () => { view.composing = true; }); field.addEventListener('compositionend', () => { view.composing = false; });
  field.addEventListener('input', () => {
    // Roam updates its raw editing buffer immediately and debounces the graph
    // save by 700ms. Successive shortcuts can arrive before that first save.
    view.uncommitted = true;
    clearTimeout(view.keyboardTimer);
    view.keyboardTimer = setTimeout(() => {
      view.keyboardTimer = null; view.uncommitted = false;
      apply(uid, field.value, 'native');
    }, KEYBOARD_COMMIT_DELAY_MS);
  });
  field.addEventListener('keydown', event => {
    keys.push({ key: event.key, defaultPrevented: event.defaultPrevented });
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !view.composing) {
      // Native editor cycle: no marker -> TODO -> DONE -> no marker. This is
      // different from clicking a checkbox, which toggles the graph directly.
      const state = core.status(field.value);
      field.value = state === 'TODO' ? core.doneMarkerString(field.value)
        : state === 'DONE' ? field.value.replace(/\{\{(?:\[\[DONE\]\]|DONE)\}\}/i, '').trimStart()
          : `{{[[TODO]]}} ${field.value}`;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  main.replaceChildren(field); return field.id;
}
function edit(uid, value) {
  const view = [...views.values()].find(v => v.uid === uid);
  if (!view) throw Error('Unknown fixture view');
  return nativeEditor(view, uid, view.main, value);
}
function editEmbedSource(wrapperUid, value) {
  const view = [...views.values()].find(v => v.uid === wrapperUid && v.embed);
  if (!view?.sourceMain) throw Error('Unknown embedded source');
  return nativeEditor(view, view.embed, view.sourceMain, value);
}
function setEnabled(value) { values.set('completion-stamps-enabled', value); window.dispatchEvent(new Event('nautilus-log:settings-changed')); }
function select(uids) {
  for (const view of views.values()) view.root.classList.toggle('block-highlight-blue', uids.includes(view.uid));
  document.activeElement?.blur(); document.body.tabIndex = -1; document.body.focus();
}
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (['z', 'y'].includes(event.key.toLowerCase())) { keys.push({ key: event.key, defaultPrevented: event.defaultPrevented }); return; }
  if (event.key !== 'Enter' || event.target.matches('textarea')) return;
  keys.push({ key: event.key, defaultPrevented: event.defaultPrevented });
  const selected = new Set([...views.values()].filter(v => v.root.classList.contains('block-highlight-blue')).map(v => v.uid));
  for (const uid of selected) setTimeout(() => nativeToggle(uid), nativeDelay);
});
window.completionStampHarness = { block, nested, reference, embed, edit, editEmbedSource, select, setEnabled, blocks, stampUpdates, nativeUpdates, notices, keys,
  setMinute: value => { minute = value; }, setNativeDelay: value => { nativeDelay = value; }, setBufferDelay: value => { bufferDelay = value; },
  setStampDelay: value => { stampDelay = value; },
  hasReceipt: uid => Boolean(values.get('completion-stamp-receipts')?.items?.some(item => item.uid === uid)),
  passive: (uid, string) => { blocks.set(uid, string); renderAll(); notify(uid); },
  watchCount: () => [...watches.values()].reduce((n, set) => n + set.size, 0),
  direct: uid => writer.finishDirect({ uid, instant: new Date(2026, 10, 1, 10, minute) }),
  destroy: () => { adapter.destroy(); writer.destroy(); },
};
