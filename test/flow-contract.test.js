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
  assert.match(component, /flow-core-call "burningCapacityBucket"/);
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

test('Flow uses a flat two-row header with metrics left and controls plus legend right', () => {
  assert.match(component, /nautilus-flow-header/);
  assert.match(component, /nautilus-flow-metrics/);
  assert.match(component, /nautilus-flow-metric-percent/);
  assert.match(component, /nautilus-flow-header-actions/);
  assert.match(component, /nautilus-flow-html-legend/);
  assert.doesNotMatch(component, /\[flow-legend-component/);
  assert.doesNotMatch(css, /filter:\s*drop-shadow\(0 4px 12px/);
  assert.doesNotMatch(css, /border:\s*1px dashed/);
  assert.match(css, /\.nautilus-flow-metric--event/);
  assert.match(css, /\.nautilus-flow-metrics\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, max-content\);/s);
  assert.match(css, /\.nautilus-flow-header-actions\s*\{[^}]*align-items:\s*flex-end;/s);
});

test('Flow suppresses breadcrumb and collapsed-path replicas before mounting the chart', () => {
  assert.match(component, /shouldSuppressRenderContext/);
  assert.match(component, /nautilus-flow-context-probe/);
  assert.match(css, /\.nautilus-flow-context-probe\s*\{[^}]*display:\s*none\s*!important;[^}]*height:\s*0\s*!important;/s);
  assert.match(css, /\.rm-zoom\.zoom-path-view \.nautilus-flow-container/);
  assert.match(css, /\.parent-path-wrapper \.nautilus-flow-container/);
  assert.match(css, /\.rm-zoom-item-content\.rm-zoom-collapsed-item \.nautilus-flow-container/);
});

test('Flow renders a collapsible below-chart label list in narrow containers', () => {
  assert.match(component, /ResizeObserver/);
  assert.match(component, /isCompactChartWidth/);
  assert.match(component, /nautilus-flow-compact-details/);
  assert.match(component, /nautilus-flow-compact-summary/);
  assert.match(component, /nautilus-flow-compact-list/);
  assert.match(component, /compact-list-open-state/);
  assert.match(component, /:open @compact-open-state/);
  assert.match(component, /:on-toggle/);
  assert.doesNotMatch(component, /nautilus-flow-compact-details" :open true/);
  assert.match(helpers, /isRightSidebarRenderContext/);
  assert.match(css, /\.nautilus-flow-compact-details\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.nautilus-flow-compact-list\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-flow-slice-group\s*\{[^}]*display:\s*none\s*!important;/);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-flow-compact-details\s*\{[^}]*display:\s*block;/);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-flow-compact-list\s*\{[^}]*display:\s*(?:grid|flex);/);
});

test('Flow moves metrics and the legend into a folded Overview in narrow containers', () => {
  assert.match(component, /nautilus-flow-compact-overview/);
  assert.match(component, /nautilus-flow-compact-overview-summary/);
  assert.match(component, /compact-overview-open-state/);
  assert.match(component, /compact-overview-component/);
  assert.match(component, /:open @compact-open-state/);
  assert.match(component, /\(when warning\?/);
  assert.match(css, /\.nautilus-flow-compact-overview\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-flow-compact-overview\s*\{[^}]*display:\s*block;/);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-flow-header--compact\s*\{[^}]*justify-content:\s*flex-end;/);
});

test('Flow marks the active capacity bucket with an accessible static flame', () => {
  assert.match(component, /nautilus-flow-burning-icon/);
  assert.match(component, /viewBox "0 0 24 24"/);
  assert.match(component, /:width "16"/);
  assert.match(component, /:fill "none"/);
  assert.match(component, /:stroke "currentColor"/);
  assert.match(component, /burningLabel/);
  assert.match(component, /burningBucket/);
  assert.match(component, /burningAvailable/);
  assert.match(component, /burningEvents/);
  assert.doesNotMatch(component, /🔥/);
  assert.doesNotMatch(css, /--nautilus-flow-burning:/);
  assert.match(css, /\.nautilus-flow-burning-icon\s*\{[^}]*color:\s*var\(--nautilus-flow-control-icon\);/s);
});

test('Flow replaces the center year with an in-range 24-hour now value', () => {
  assert.match(component, /nautilus-flow-now-needle/);
  assert.match(component, /nautilus-flow-center-now/);
  assert.match(component, /center-now-label/);
  assert.match(component, /\(defn central-label-component \[\[first-row _\] center center-now-label\]/);
  assert.match(component, /minutes->time @now-time-atom/);
  assert.match(component, /:workday-start settings/);
  assert.match(component, /:workday-end settings/);
  assert.doesNotMatch(component, /nautilus-flow-now-label/);
  assert.doesNotMatch(component, /needle-label-radius/);
  assert.doesNotMatch(css, /nautilus-flow-now-label/);
  assert.doesNotMatch(css, /--nautilus-flow-now-label-bg:/);
  assert.match(css, /\.nautilus-flow-center-now\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/s);
});

test('Flow feature-detects ResizeObserver with syntax supported by Roam SCI', () => {
  assert.doesNotMatch(component, /\(exists\?/);
  assert.match(component, /\(\.-ResizeObserver js\/window\)/);
});

test('Flow prefers horizontal label rails and keeps past leader lines legible', () => {
  assert.match(component, /:layout "side-rails"/);
  assert.match(component, /:maxVerticalOffset \(\* max-spiral-radius 0\.92\)/);
  assert.match(component, /:rowGap 26/);
  assert.match(component, /legend-color \(update-opacity-str bg-color "1"\)/);
  assert.match(component, /:anchorY anchor-y/);
  assert.match(component, /:sortKey order-key/);
  assert.match(component, /:connector-knee-x/);
  assert.match(component, /:connector-rail-x/);
  assert.doesNotMatch(css, /\.nautilus-flow-past\s*\{[^}]*opacity:/s);
  assert.match(css, /\.nautilus-flow-past \.nautilus-flow-link-line\s*\{[^}]*opacity:\s*0\.[4-9]/s);
});

test('flexible task labels and connectors use one semantic blue', () => {
  assert.match(component, /def task-legend-color "var\(--nautilus-flow-task\)"/);
  assert.match(component, /legend-color \(when \(and \(:todo event\)[\s\S]*task-legend-color\)/);
  assert.match(component, /:legend-color legend-color/);
  assert.match(component, /:fill \(if-not done\? legend-color/);
  assert.match(css, /--nautilus-flow-task:\s*#0899c8/);
  assert.match(css, /\.nautilus-flow-legend-dot--task\s*\{\s*background:\s*var\(--nautilus-flow-task\);\s*\}/);
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
