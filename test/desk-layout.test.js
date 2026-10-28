const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nativeRowSpan, readDeskPreview } = require('../src/desk-core');

test('native masonry uses a four-pixel row span plus the host column gap', () => {
  assert.equal(nativeRowSpan(80,12),23);
  assert.equal(nativeRowSpan(81,12),24);
  assert.equal(nativeRowSpan(0,0),1);
  assert.equal(nativeRowSpan(199.5,12),53);
});

test('embedded scope restores only native card sizing and drag chrome, never native page ownership', () => {
  const css=fs.readFileSync(path.join(__dirname,'../extension.css'),'utf8').split('/* Desk deliberately uses Roam')[1];
  assert.ok(css);
  assert.doesNotMatch(css,/nautilus-desk__position|is-drop-before|60vh|font-family\s*:|\bfont\s*:/);
  assert.doesNotMatch(css,/\.rm-article-wrapper[^{}]*\{|\.roam-article[^{}]*\{|\.rm-spacing--[^{}]*\{/);
  const columns=[...css.matchAll(/grid-template-columns:\s*([^;]+);/g)].map(match=>match[1]);
  assert.deepEqual(columns,['repeat(auto-fill, minmax(240px, 1fr))']);
  const sizes=[...new Set([...css.matchAll(/font-size:\s*(\w+);/g)].map(match=>match[1]))].sort();
  assert.deepEqual(sizes,['11px','13px']);
  assert.match(css,/\.rm-desk-tile__preview\s*\{\s*font-size:\s*13px;\s*line-height:\s*1\.5/);
  assert.match(css,/content:\s*counter\(rm-desk-tile\)/);
  assert.match(css,/content:\s*attr\(data-position\)/);
  assert.match(css,/inset-inline-start:\s*-7\.5px/);
  assert.match(css,/inset-inline-end:\s*-7\.5px/);
  assert.match(css,/color:\s*#8A9BA8;\s*background:\s*#F5F8FA/);
  assert.match(css,/pointer-events:\s*none/);
  const view=fs.readFileSync(path.join(__dirname,'../src/desk-view.js'),'utf8');
  assert.match(view,/el\('section', 'nautilus-desk'\)/);
  assert.doesNotMatch(view,/el\('section', 'rm-desk-page/);
  const layout=fs.readFileSync(path.join(__dirname,'../src/desk-masonry.js'),'utf8');
  assert.doesNotMatch(layout,/maxColumns|\.style\.left|\.style\.top/);
  assert.match(layout,/gridRowEnd/);
});

test('preview references are resolved read-only and recursive references are bounded', () => {
  let reads=0;
  const result=readDeskPreview('root',uid=>uid==='root'?[{uid:'line',string:'((source-a))',order:0,open:false}]:[],11,
    uid=>{reads++;return uid==='source-a'?'{{[[DONE]]}} Source ((source-b))':'((source-a))';});
  assert.equal(result.rows[0].status,'DONE');
  assert.match(result.rows[0].text,/Source/);
  assert.equal(reads,2);
});
