const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const component = fs.readFileSync(path.join(__dirname, '..', 'src', 'component.cljs'), 'utf8');
const entry = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const helpers = fs.readFileSync(path.join(__dirname, '..', 'src', 'entry-helpers.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'extension.css'), 'utf8');

function parenDepthBefore(source, targetIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;

  for (let index = 0; index < targetIndex; index += 1) {
    const char = source[index];

    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === ';') inComment = true;
    else if (char === '"') inString = true;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
  }

  return depth;
}

test('the Roam renderer delegates schedule and capacity behavior to the tested Flow core', () => {
  assert.match(component, /flow-core-call "scheduleTasks"/);
  assert.match(component, /flow-core-call "calculateCapacity"/);
  assert.match(component, /flow-core-call "historicalDoneSlice"/);
  assert.match(component, /flow-core-call "truncateTextToWidth"/);
  assert.match(component, /flow-core-call "placeExternalLabels"/);
  assert.match(component, /flow-core-call "resolveRendererSettings"/);
  assert.match(component, /flow-core-call "hourlyGridSegments"/);
  assert.match(component, /flow-core-call "uiCopy"/);
  assert.match(component, /flow-core-call "capacityMetrics"/);
  assert.match(component, /nautilus-flow:settings-changed/);
  assert.match(component, /\.addEventListener/);
  assert.match(component, /\.removeEventListener/);
  assert.match(entry, /window\.nautilusFlowCore = flowCore/);
  assert.doesNotMatch(component, /\(abs \(- done-at duration\)\)/);
});
test('Flow scaffolding is isolated and unload is graph-safe', () => {
  assert.match(entry, /Nautilus Flow/);
  assert.match(entry, /roam-render-Nautilus-Flow-cljs/);
  assert.match(entry, /workday-end/);
  assert.match(helpers, /state !== true/);
  assert.doesNotMatch(helpers, /replaceRenderString\(/);
  assert.doesNotMatch(helpers, /deleteBlock\(/);
});

test('Flow owns the previously tested controls and collapses without reserving chart space', () => {
  assert.match(component, /M3 9h18/);
  assert.match(component, /m9 13 3 3 3-3/);
  assert.doesNotMatch(component, /"▸" "▾"/);
  assert.match(css, /\.nautilus-flow-collapsed\s*\{[^}]*height:\s*0;/s);
  assert.match(css, /\.nautilus-flow-collapsed \.nautilus-flow-controls-top\s*\{[^}]*top:\s*-26px;/s);
  assert.doesNotMatch(css, /#roam-right-sidebar-content \.nautilus-flow-container/);
});

test('Flow uses a flat Linear-style header with left-aligned metrics and legend', () => {
  assert.match(component, /nautilus-flow-header/);
  assert.match(component, /nautilus-flow-metrics/);
  assert.match(component, /nautilus-flow-html-legend/);
  assert.doesNotMatch(component, /\[flow-legend-component/);
  assert.doesNotMatch(css, /filter:\s*drop-shadow\(0 4px 12px/);
  assert.doesNotMatch(css, /border:\s*1px dashed/);
});

test('Flow suppresses breadcrumb and collapsed-path replicas before mounting the chart', () => {
  assert.match(component, /shouldSuppressRenderContext/);
  assert.match(component, /nautilus-flow-context-probe/);
  assert.match(css, /\.nautilus-flow-context-probe\s*\{[^}]*display:\s*none\s*!important;[^}]*height:\s*0\s*!important;/s);
  assert.match(css, /\.rm-zoom\.zoom-path-view \.nautilus-flow-container/);
  assert.match(css, /\.parent-path-wrapper \.nautilus-flow-container/);
  assert.match(css, /\.rm-zoom-item-content\.rm-zoom-collapsed-item \.nautilus-flow-container/);
});

test('Flow renders a below-chart label list in narrow containers', () => {
  assert.match(component, /ResizeObserver/);
  assert.match(component, /isCompactChartWidth/);
  assert.match(component, /nautilus-flow-compact-list/);
  assert.match(css, /\.nautilus-flow-compact-list\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-flow-slice-group\s*\{[^}]*display:\s*none\s*!important;/);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-flow-compact-list\s*\{[^}]*display:\s*(?:grid|flex);/);
});

test('the Roam renderer cleanup remains a sibling of the render body inside with-let', () => {
  const withLetIndex = component.indexOf('(r/with-let');
  const finallyIndex = component.indexOf('(finally', withLetIndex);

  assert.notEqual(withLetIndex, -1);
  assert.notEqual(finallyIndex, -1);
  assert.equal(
    parenDepthBefore(component, finallyIndex),
    parenDepthBefore(component, withLetIndex) + 1,
    'finally must be directly nested in r/with-let, not inside case'
  );
});
