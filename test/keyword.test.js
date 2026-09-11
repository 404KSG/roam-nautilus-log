const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../src/log-core');

test('urgent keywords are literal tokens, never user-supplied regular expressions', () => {
  for (const keyword of ['[', '(', 'a+b', '.*', '紧急', 'a"b\\c']) {
    assert.equal(core.hasUrgentKeyword({ text:`Do ${keyword} now`, keyword }), true);
    assert.equal(core.hasUrgentKeyword({ text:`Do x${keyword} now`, keyword }), false);
  }
  assert.equal(core.hasUrgentKeyword({ text:'anything', keyword:'' }), false);
  assert.equal(core.hasUrgentKeyword({ text:'anything', keyword:'.*' }), false);
});

test('render arguments quote special keyword characters without changing their value', async () => {
  const bundle=fs.readFileSync('extension.js','utf8');
  const {generateTemplateString}=await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#quoted-keyword`);
  const keyword='a"b\\c';
  const result=await generateTemplateString({settings:{get:k=>k==='color-1-trigger'?keyword:undefined}});
  const quoted=result.match(/"(?:\\.|[^"\\])*"/)?.[0];
  assert.equal(JSON.parse(quoted),keyword);
});
