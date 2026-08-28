const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadExtension() {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#tidy-commands-${Date.now()}-${Math.random()}`);
}

test('Tidy command is shortcut-ready, resolves one target, and cleans up', async () => {
  const extension = await loadExtension();
  const palette = new Map();
  const calls = [];
  const extensionAPI = {
    ui: {
      commandPalette: {
        addCommand: (command) => palette.set(command.label, command),
        removeCommand: ({ label }) => palette.delete(label),
      },
    },
  };
  const commands = extension.createTidyCommands({
    extensionAPI,
    resolveTarget: () => ({
      planUid: 'plan-a',
      settledUids: ['done-a', 'past-event'],
      language: 'en',
    }),
    tidy: async (options) => calls.push(options),
  });

  assert.equal(commands.initialize(), true);
  assert.equal(commands.initialize(), false);
  assert.deepEqual([...palette.keys()], ['Nautilus Log: Tidy Primary Plan']);
  const command = palette.get('Nautilus Log: Tidy Primary Plan');
  assert.equal('defaultHotkey' in command, false);

  await command.callback();
  assert.deepEqual(calls, [{
    planUid: 'plan-a',
    settledUids: ['done-a', 'past-event'],
    language: 'en',
  }]);

  commands.destroy();
  assert.equal(palette.size, 0);
});

test('Tidy command registration is optional in command-palette-free shells', async () => {
  const extension = await loadExtension();
  const commands = extension.createTidyCommands({
    extensionAPI: {},
    tidy: async () => ({ ok: true }),
  });

  assert.equal(commands.initialize(), false);
  assert.doesNotThrow(() => commands.destroy());
});

test('Tidy command projection includes completed tasks and elapsed or completed events', async () => {
  const extension = await loadExtension();
  const settled = extension.settledUidsForTidy({
    reviewCandidates: [
      { uid: 'todo-a', status: 'TODO' },
      { uid: 'done-a', status: 'DONE' },
      { uid: 'done-source', status: 'DONE', statusOrigin: 'source' },
    ],
    fixedEvents: [
      { uid: 'past-event', end: 600, done: false },
      { uid: 'future-event', end: 900, done: false },
      { uid: 'done-event', end: 900, done: true },
    ],
  }, 720);

  assert.deepEqual(settled, ['done-a', 'done-source', 'past-event', 'done-event']);
});
