const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let loaded;
const extension = () => loaded ||= import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(__dirname, '../extension.js'))).toString('base64')}#desk-notifications`);

function documentFixture() {
  const node = () => ({
    children: [], className: '', dataset: {}, isConnected: false, parentElement: null,
    append(child) { this.children.push(child); child.parentElement = this; child.isConnected = true; },
    get firstElementChild() { return this.children[0] || null; },
    remove() {
      if (!this.parentElement) return;
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
      this.parentElement = null; this.isConnected = false;
    },
  });
  const body = node(); body.isConnected = true;
  return { body, createElement: node };
}

function hostFixture({ throwCreate = false, throwShow = false } = {}) {
  const document = documentFixture();
  const calls = { create: [], show: [], showKeys: [], clear: 0, roots: new Set(), unmount: 0, throwNext: false };
  const host = {
    document, setTimeout: () => 1, clearTimeout: () => {},
    ReactDOM: { unmountComponentAtNode(node) {
      if (!calls.roots.delete(node)) return false;
      calls.unmount += 1; return true;
    } },
    Blueprint: { Core: {
      Position: { TOP: 'top' },
      Toaster: { create(props, container) {
        if (throwCreate) throw new Error('Toaster unavailable');
        assert.equal(container.parentElement, document.body, 'host Toaster receives an extension-owned body container');
        const mount = document.createElement('div'); container.append(mount); calls.roots.add(mount);
        calls.create.push({ props, container, mount });
        let sequence = 0;
        return {
          show(options, key) {
            if (throwShow || calls.throwNext) { calls.throwNext = false; throw new Error('host toast unavailable'); }
            // This is Blueprint's public show(options, key) contract: the
            // supplied second argument becomes the toast key, not options.key.
            const actualKey = key === undefined ? `toast-${sequence++}` : key;
            calls.showKeys.push(key); calls.show.push({ ...options, key: actualKey });
          },
          clear() { calls.clear += 1; },
        };
      } },
    } },
  };
  return { host, document, calls };
}

test('confirmed outcomes use a bounded host Blueprint Toaster with native key semantics', async () => {
  const { createDeskNotifications } = await extension();
  const f = hostFixture();
  const notices = createDeskNotifications({ host: f.host, document: f.document });
  assert.deepEqual(notices.notify({ key: 'add', message: 'Added embed. Original kept.', intent: 'success' }), { native: true });
  assert.deepEqual(notices.notify({ key: 'duplicate', message: 'Already in this plan.', intent: 'primary' }), { native: true });
  assert.equal(f.calls.create.length, 1);
  assert.deepEqual(f.calls.create[0].props, { position: 'top', timeout: 3000, autoFocus: false, canEscapeKeyClear: false, maxToasts: 3 });
  assert.deepEqual(f.calls.showKeys, ['add', 'duplicate'], 'receipt keys use Blueprint show(options, key)');
  assert.deepEqual(f.calls.show, [
    { message: 'Added embed. Original kept.', intent: 'success', timeout: 3000, key: 'add' },
    { message: 'Already in this plan.', intent: 'primary', timeout: 3000, key: 'duplicate' },
  ]);
  assert.deepEqual(notices.notify({ key: 'add', message: 'Added embed. Original kept.', intent: 'success' }), { native: true, deduped: true });
  assert.equal(f.calls.show.length, 2, 'the same logical receipt is deduplicated');
  notices.destroy();
  assert.equal(f.calls.clear, 1);
  assert.equal(f.calls.unmount, 1, 'unload unmounts only the owned Blueprint React root');
  assert.equal(f.calls.roots.size, 0);
  assert.equal(f.document.body.children.length, 0, 'unload removes only the owned container');
});

test('a discarded native toaster invalidates receipt state before recovery', async () => {
  const { createDeskNotifications } = await extension();
  const f = hostFixture();
  const notices = createDeskNotifications({ host: f.host, document: f.document });
  assert.deepEqual(notices.notify({ key: 'receipt-A', message: 'Added A', intent: 'success' }), { native: true });
  f.calls.throwNext = true;
  assert.deepEqual(notices.notify({ key: 'receipt-B', message: 'Added B', intent: 'success' }), { native: false });
  assert.deepEqual(notices.notify({ key: 'receipt-C', message: 'Added C', intent: 'success' }), { native: true });
  assert.deepEqual(notices.notify({ key: 'receipt-A', message: 'Added A', intent: 'success' }), { native: true }, 'a receipt from the discarded toaster is delivered again');
  assert.deepEqual(f.calls.showKeys, ['receipt-A', 'receipt-C', 'receipt-A']);
  notices.destroy();
  assert.equal(f.calls.unmount, 2, 'failure and unload each unmount their own host root');
});

test('missing or throwing host toasts leave confirmed writes eligible for accessible fallback', async () => {
  const { createDeskNotifications } = await extension();
  const absent = createDeskNotifications({ host: { document: documentFixture() }, document: documentFixture() });
  assert.deepEqual(absent.notify({ key: 'remove', message: 'Local reference removed. Source unchanged.', intent: 'success' }), { native: false });
  const createBroken = hostFixture({ throwCreate: true });
  const unavailable = createDeskNotifications({ host: createBroken.host, document: createBroken.document });
  assert.deepEqual(unavailable.notify({ key: 'remove', message: 'Local reference removed. Source unchanged.', intent: 'success' }), { native: false });
  assert.equal(createBroken.document.body.children.length, 0);
  const f = hostFixture({ throwShow: true });
  const broken = createDeskNotifications({ host: f.host, document: f.document });
  assert.deepEqual(broken.notify({ key: 'remove', message: 'Local reference removed. Source unchanged.', intent: 'success' }), { native: false });
  assert.equal(f.calls.show.length, 0);
  assert.equal(f.calls.unmount, 1, 'show failure unmounts the owned root before fallback');
  assert.equal(f.document.body.children.length, 0);
});
