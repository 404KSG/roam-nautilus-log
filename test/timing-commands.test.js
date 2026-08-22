const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#commands-${Date.now()}-${Math.random()}`);
}

test('timing commands are shortcut-ready, execute global Clock Out, and clean up', async (t) => {
  global.window = { roamAlphaAPI: { ui: { blockContextMenu: {} } } };
  t.after(() => { delete global.window; });
  const extension = await loadExtension();
  const palette = new Map();
  const contexts = new Map();
  const calls = [];
  const extensionAPI = {
    ui: {
      commandPalette: {
        addCommand: (command) => palette.set(command.label, command),
        removeCommand: ({ label }) => palette.delete(label),
      },
    },
  };
  window.roamAlphaAPI.ui.blockContextMenu = {
    addCommand: (command) => contexts.set(command.label, command),
    removeCommand: ({ label }) => contexts.delete(label),
  };
  const commands = extension.createTimingCommands({
    extensionAPI,
    runtime: {
      startTask: async (uid) => calls.push(['start', uid]),
      stopTask: async () => calls.push(['stop']),
      locate: async () => calls.push(['locate']),
    },
    getFocusedUid: () => 'task-a',
    getString: () => '{{[[TODO]]}} Alpha 30m',
    notify: (message) => calls.push(['notice', message]),
  });

  commands.initialize();
  assert.deepEqual([...palette.keys()], [
    'Nautilus Log: Focus current block',
    'Nautilus Log: Clock out Timing Line',
    'Nautilus Log: Locate Primary Plan',
  ]);
  assert.equal([...palette.values()].every((command) => !('defaultHotkey' in command)), true);
  assert.deepEqual([...contexts.keys()], ['Nautilus Log: Clock in', 'Nautilus Log: Clock out']);

  await palette.get('Nautilus Log: Focus current block').callback();
  await palette.get('Nautilus Log: Clock out Timing Line').callback();
  await palette.get('Nautilus Log: Locate Primary Plan').callback();
  assert.deepEqual(calls, [['start', 'task-a'], ['stop'], ['locate']]);

  commands.destroy();
  assert.equal(palette.size, 0);
  assert.equal(contexts.size, 0);
});
