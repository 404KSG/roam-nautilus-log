const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let loaded;
const extension = () => loaded ||= import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(__dirname, '../extension.js'))).toString('base64')}#desk-notifications`);

function documentFixture() {
  const body = {
    children: [],
    append(node) { this.children.push(node); node.parentElement = this; node.isConnected = true; },
  };
  return {
    body,
    createElement() {
      return {
        className: '', dataset: {}, isConnected: false, parentElement: null,
        remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; this.isConnected = false; },
      };
    },
  };
}

function hostFixture({ throwCreate = false, throwShow = false } = {}) {
  const document = documentFixture(), calls = { create: [], show: [], clear: 0, destroy: 0 };
  const host = {
    document, setTimeout: () => 1, clearTimeout: () => {},
    Blueprint: { Core: {
      Position: { TOP: 'top' },
      Toaster: { create(props, container) {
        if (throwCreate) throw new Error('Toaster unavailable');
        assert.equal(container.parentElement, document.body, 'host Toaster receives an extension-owned body container');
        calls.create.push({ props, container });
        return {
          show(toast) { if (throwShow) throw new Error('host toast unavailable'); calls.show.push(toast); },
          clear() { calls.clear += 1; }, destroy() { calls.destroy += 1; },
        };
      } },
    } },
  };
  return { host, document, calls };
}

test('confirmed outcomes use a bounded host Blueprint Toaster with native semantics', async () => {
  const { createDeskNotifications } = await extension();
  const f = hostFixture();
  const notices = createDeskNotifications({ host: f.host, document: f.document });
  assert.deepEqual(notices.notify({ key: 'add', message: 'Added embed. Original kept.', intent: 'success' }), { native: true });
  assert.deepEqual(notices.notify({ key: 'duplicate', message: 'Already in this plan.', intent: 'primary' }), { native: true });
  assert.equal(f.calls.create.length, 1);
  assert.deepEqual(f.calls.create[0].props, { position: 'top', timeout: 3000, autoFocus: false, canEscapeKeyClear: false, maxToasts: 3 });
  assert.deepEqual(f.calls.show, [
    { key: 'add', message: 'Added embed. Original kept.', intent: 'success', timeout: 3000 },
    { key: 'duplicate', message: 'Already in this plan.', intent: 'primary', timeout: 3000 },
  ]);
  notices.notify({ key: 'add', message: 'Added embed. Original kept.', intent: 'success' });
  assert.equal(f.calls.show.length, 2, 'the same logical receipt is deduplicated');
  notices.destroy();
  assert.equal(f.calls.clear, 1);
  assert.equal(f.calls.destroy, 1);
  assert.equal(f.document.body.children.length, 0, 'unload removes only the owned container');
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
  assert.equal(f.document.body.children.length, 0);
});
