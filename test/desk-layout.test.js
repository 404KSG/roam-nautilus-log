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

test('Desk styling adds no custom typography or fixed column cap', () => {
  const css=fs.readFileSync(path.join(__dirname,'../extension.css'),'utf8').split('/* Desk deliberately uses Roam')[1];
  assert.ok(css);
  assert.doesNotMatch(css,/font(?:-size|-family|-weight)?\s*:/);
  assert.doesNotMatch(css,/grid-template-columns/);
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
