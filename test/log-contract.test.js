const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const component = fs.readFileSync(path.join(__dirname, '..', 'src', 'component.cljs'), 'utf8');
const entry = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const helpers = fs.readFileSync(path.join(__dirname, '..', 'src', 'entry-helpers.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'extension.css'), 'utf8');
const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const timingTopbar = fs.readFileSync(path.join(__dirname, '..', 'src', 'timing-topbar.js'), 'utf8');
const timingRuntime = fs.readFileSync(path.join(__dirname, '..', 'src', 'timing-runtime.js'), 'utf8');
const timingCommands = fs.readFileSync(path.join(__dirname, '..', 'src', 'timing-commands.js'), 'utf8');

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

test('Nautilus Log is the only active product identity', () => {
  const activeSurface = [component, entry, css, packageJson, readme, changelog].join('\n');
  const legacyVariants = [
    ['Nautilus', 'Flow'].join(' '),
    ['Nautilus', 'Flow'].join('-'),
    ['nautilus', 'flow'].join('-'),
    ['nautilus', 'Flow'].join(''),
  ];

  assert.match(entry, /const componentName = "Nautilus Log"/);
  assert.match(entry, /roam-render-Nautilus-Log-cljs/);
  assert.match(packageJson, /"name": "nautilus-log"/);
  for (const legacy of legacyVariants) assert.equal(activeSurface.includes(legacy), false);
});

test('the Roam renderer delegates schedule and capacity behavior to the tested Log core', () => {
  assert.match(component, /log-core-call "scheduleTasks"/);
  assert.match(component, /log-core-call "calculateCapacity"/);
  assert.match(component, /log-core-call "historicalDoneSlice"/);
  assert.match(component, /log-core-call "truncateTextToWidth"/);
  assert.match(component, /log-core-call "placeExternalLabels"/);
  assert.match(component, /log-core-call "resolveRendererSettings"/);
  assert.match(component, /log-core-call "hourlyGridSegments"/);
  assert.match(component, /log-core-call "pastTimelineSegments"/);
  assert.match(component, /log-core-call "pastUnplannedSegments"/);
  assert.match(component, /log-core-call "pastItemStatus"/);
  assert.match(component, /log-core-call "spiralCellInnerHour"/);
  assert.match(component, /log-core-call "overlappingFixedEventUids"/);
  assert.match(component, /log-core-call "isCurrentPlannedTask"/);
  assert.match(component, /log-core-call "uiCopy"/);
  assert.match(component, /log-core-call "capacityMetrics"/);
  assert.match(component, /log-core-call "burningCapacityBucket"/);
  assert.match(component, /nautilus-log:settings-changed/);
  assert.match(component, /\.addEventListener/);
  assert.match(component, /\.removeEventListener/);
  assert.match(entry, /window\.nautilusLogCore = logCore/);
  assert.doesNotMatch(component, /\(abs \(- done-at duration\)\)/);
});
test('Log scaffolding is isolated and unload is graph-safe', () => {
  assert.match(entry, /Nautilus Log/);
  assert.match(entry, /roam-render-Nautilus-Log-cljs/);
  assert.match(entry, /workday-end/);
  assert.match(helpers, /state !== true/);
  assert.doesNotMatch(helpers, /replaceRenderString\(/);
  assert.doesNotMatch(helpers, /deleteBlock\(/);
});

test('Actual Time Tracking is opt-in and owns no disabled topbar interaction', () => {
  assert.match(entry, /"actual-time-tracking": false/);
  assert.match(entry, /if \(extensionAPI\.settings\.get\("actual-time-tracking"\) === true\)/);
  assert.match(entry, /stopTiming\(\{ closeActive: false \}\)/);
  assert.match(timingTopbar, /bp3-icon-\$\{name\}/);
  assert.match(timingTopbar, /trigger\.replaceChildren\(icon\('unresolve'\)\)/);
  assert.match(timingTopbar, /iconButton\('locate'/);
  assert.match(timingTopbar, /iconButton\('tick-circle', 'Complete task'/);
  assert.match(timingTopbar, /iconButton\('trash', 'Delete current CLOCK'/);
  assert.match(timingTopbar, /isForgottenClock/);
  assert.doesNotMatch(timingTopbar, /Dashboard|Activity/);
  assert.match(timingCommands, /const palette = extensionAPI\?\.ui\?\.commandPalette/);
  assert.match(timingCommands, /palette\.addCommand/);
  assert.match(timingCommands, /const contextMenu = window\.roamAlphaAPI\?\.ui\?\.blockContextMenu/);
  assert.match(timingCommands, /contextMenu\.addCommand/);
  assert.match(timingCommands, /Nautilus Log: Clock out Timing Line/);
  assert.match(timingRuntime, /await closeEntriesAt\(before, instant\);[\s\S]*await createRunningClock\(taskUid, instant\);/);
  assert.match(timingRuntime, /deleteCurrentClock/);
});

test('execution popover paints cached state before refreshing and does not rebuild on every tick', () => {
  const openStart = timingTopbar.indexOf('const openPopover');
  const openEnd = timingTopbar.indexOf('const renderTrigger', openStart);
  const openBody = timingTopbar.slice(openStart, openEnd);
  const appendIndex = openBody.indexOf('document.body.append(popover)');
  const refreshIndex = openBody.indexOf('runtime.requestRefresh');

  assert.ok(appendIndex >= 0, 'popover should be appended synchronously');
  assert.ok(refreshIndex > appendIndex, 'graph refresh must be scheduled after the cached shell is visible');
  assert.doesNotMatch(openBody, /runtime\.refresh\(\)/);
  assert.match(timingTopbar, /executionStructureKey/);
  assert.match(timingTopbar, /updateLiveElapsed/);
  const triggerStart = timingTopbar.indexOf('const renderTrigger');
  const triggerEnd = timingTopbar.indexOf('const ensureMounted', triggerStart);
  assert.doesNotMatch(timingTopbar.slice(triggerStart, triggerEnd), /renderPopover/);
});

test('Log owns the previously tested controls and collapses without reserving chart space', () => {
  assert.match(component, /M3 9h18/);
  assert.match(component, /m9 13 3 3 3-3/);
  assert.doesNotMatch(component, /"▸" "▾"/);
  assert.match(css, /\.nautilus-log-collapsed\s*\{[^}]*height:\s*0;/s);
  assert.match(css, /\.nautilus-log-collapsed \.nautilus-log-controls-top\s*\{[^}]*top:\s*-26px;/s);
  assert.doesNotMatch(css, /#roam-right-sidebar-content \.nautilus-log-container/);
});

test('Log uses a flat two-row header with metrics left and controls plus legend right', () => {
  assert.match(component, /nautilus-log-header/);
  assert.match(component, /nautilus-log-metrics/);
  assert.match(component, /nautilus-log-metric-percent/);
  assert.match(component, /nautilus-log-metric-total/);
  assert.match(component, /nautilus-log-header-actions/);
  assert.match(component, /nautilus-log-html-legend/);
  assert.doesNotMatch(component, /\[log-legend-component/);
  assert.doesNotMatch(css, /filter:\s*drop-shadow\(0 4px 12px/);
  assert.doesNotMatch(css, /border:\s*1px dashed/);
  assert.match(css, /\.nautilus-log-metric--event/);
  assert.match(css, /\.nautilus-log-metrics\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, max-content\);/s);
  assert.match(css, /\.nautilus-log-header-actions\s*\{[^}]*align-items:\s*flex-end;/s);
  assert.match(css, /\.nautilus-log-metric-total,[\s\S]*\.nautilus-log-metric-percent\s*\{[^}]*color:\s*var\(--nautilus-log-text-sub\);/s);
});

test('Log supplies all fixed events for stable totals and keeps the flame after the ratio', () => {
  assert.match(component, /all-fixed-events/);
  assert.match(component, /:allFixedEvents all-fixed-events/);
  assert.match(component, /:start \(if range \(first range\) \(:start done-slice\)\)/);
  assert.match(component, /:end \(if range \(second range\) \(:end done-slice\)\)/);

  const totalIndex = component.indexOf('(when-let [total (:total metric)]');
  const flameIndex = component.indexOf('(when (:burning metric)', totalIndex);
  assert.notEqual(totalIndex, -1);
  assert.ok(flameIndex > totalIndex, 'the flame should follow the complete current / total reading');
});

test('Log suppresses breadcrumb and collapsed-path replicas before mounting the chart', () => {
  assert.match(component, /shouldSuppressRenderContext/);
  assert.match(component, /nautilus-log-context-probe/);
  assert.match(css, /\.nautilus-log-context-probe\s*\{[^}]*display:\s*none\s*!important;[^}]*height:\s*0\s*!important;/s);
  assert.match(css, /\.rm-zoom\.zoom-path-view \.nautilus-log-container/);
  assert.match(css, /\.parent-path-wrapper \.nautilus-log-container/);
  assert.match(css, /\.rm-zoom-item-content\.rm-zoom-collapsed-item \.nautilus-log-container/);
});

test('Log renders a collapsible below-chart label list in narrow containers', () => {
  assert.match(component, /ResizeObserver/);
  assert.match(component, /isCompactChartWidth/);
  assert.match(component, /nautilus-log-compact-details/);
  assert.match(component, /nautilus-log-compact-summary/);
  assert.match(component, /nautilus-log-compact-list/);
  assert.match(component, /compact-list-open-state/);
  assert.match(component, /:open @compact-open-state/);
  assert.match(component, /:on-toggle/);
  assert.doesNotMatch(component, /nautilus-log-compact-details" :open true/);
  assert.match(helpers, /isRightSidebarRenderContext/);
  assert.match(css, /\.nautilus-log-compact-details\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.nautilus-log-compact-list\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-log-slice-group\s*\{[^}]*display:\s*none\s*!important;/);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-log-compact-details\s*\{[^}]*display:\s*block;/);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-log-compact-list\s*\{[^}]*display:\s*(?:grid|flex);/);
});

test('Log moves metrics and the legend into a folded Overview in narrow containers', () => {
  assert.match(component, /nautilus-log-compact-overview/);
  assert.match(component, /nautilus-log-compact-overview-summary/);
  assert.match(component, /compact-overview-open-state/);
  assert.match(component, /compact-overview-component/);
  assert.match(component, /:open @compact-open-state/);
  assert.match(component, /\(when warning\?/);
  assert.match(css, /\.nautilus-log-compact-overview\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-log-compact-overview\s*\{[^}]*display:\s*block;/);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-log-header--compact\s*\{[^}]*justify-content:\s*flex-end;/);
});

test('Log marks the active capacity bucket with an accessible static flame', () => {
  assert.match(component, /nautilus-log-burning-icon/);
  assert.match(component, /viewBox "0 0 24 24"/);
  assert.match(component, /:width "16"/);
  assert.match(component, /:fill "none"/);
  assert.match(component, /:stroke "currentColor"/);
  assert.match(component, /burningLabel/);
  assert.match(component, /burningBucket/);
  assert.match(component, /burningAvailable/);
  assert.match(component, /burningEvents/);
  assert.doesNotMatch(component, /🔥/);
  assert.doesNotMatch(css, /--nautilus-log-burning:/);
  assert.match(css, /\.nautilus-log-burning-icon\s*\{[^}]*color:\s*var\(--nautilus-log-control-icon\);/s);
  assert.match(css, /\.nautilus-log-burning-icon\s*\{[^}]*align-self:\s*center;/s);
  assert.doesNotMatch(css, /\.nautilus-log-burning-icon\s*\{[^}]*vertical-align:\s*-3px;/s);
});

test('Log replaces the center year with an in-range 24-hour now value', () => {
  assert.match(component, /nautilus-log-now-needle/);
  assert.match(component, /nautilus-log-center-now/);
  assert.match(component, /center-now-label/);
  assert.match(component, /\(defn central-label-component \[\[first-row _\] center center-now-label\]/);
  assert.match(component, /minutes->time @now-time-atom/);
  assert.match(component, /:workday-start settings/);
  assert.match(component, /:workday-end settings/);
  assert.doesNotMatch(component, /nautilus-log-now-label/);
  assert.doesNotMatch(component, /needle-label-radius/);
  assert.doesNotMatch(css, /nautilus-log-now-label/);
  assert.doesNotMatch(css, /--nautilus-log-now-label-bg:/);
  assert.match(component, /:font-size \(str \(\* font-size 0\.82\)\)/);
  assert.match(css, /--nautilus-log-now:/);
  assert.match(css, /\.nautilus-log-center-now\s*\{[^}]*fill:\s*var\(--nautilus-log-now\);[^}]*font-variant-numeric:\s*tabular-nums;/s);
});

test('Log shades elapsed time continuously behind slices and through the current minute', () => {
  assert.match(component, /past-time-overlay-component/);
  assert.match(component, /nautilus-log-past-overlay/);
  assert.match(component, /log-core-call "pastTimelineSegments"/);
  assert.match(component, /create-arc-path/);
  assert.match(component, /\[past-time-overlay-component[^\n]+\]\)\s*\(when [\s\S]+\[past-unplanned-overlay-component[^\n]+\]\)\s*\(when @show-done-atom\?/s);
  assert.match(css, /--nautilus-log-past-overlay:/);
  assert.match(css, /\.nautilus-log-past-overlay\s*\{[^}]*fill:\s*var\(--nautilus-log-past-overlay\);[^}]*pointer-events:\s*none;/s);
});

test('Log separates recorded and unplanned past time without a missed-task category', () => {
  assert.match(component, /past-unplanned-overlay-component/);
  assert.match(component, /nautilus-log-unplanned-pattern/);
  assert.match(component, /nautilus-log-past--completed/);
  assert.match(component, /nautilus-log-past--event/);
  assert.match(component, /:data-past-status past-status/);
  assert.match(css, /--nautilus-log-unplanned-stripe:/);
  assert.match(css, /\.nautilus-log-unplanned-stripe\s*\{[^}]*stroke:\s*var\(--nautilus-log-unplanned-stripe\);/s);
  assert.match(css, /\.nautilus-log-past--completed \.nautilus-log-slice\s*\{[^}]*fill:\s*var\(--nautilus-log-completed-fill\);/s);
  assert.match(css, /\.nautilus-log-past--event \.nautilus-log-slice\s*\{[^}]*fill:\s*var\(--nautilus-log-past-event-fill\);/s);
  assert.doesNotMatch(component, /nautilus-log-past--missed/);
  assert.doesNotMatch(css, /nautilus-log-past--missed/);
  assert.doesNotMatch(component, /浪费|waste/i);
  assert.doesNotMatch(css, /\.nautilus-log-past \.nautilus-log-slice/);
});

test('Log clips paired morning and evening hours into independent spiral cells', () => {
  assert.match(component, /defn spiral-cell-inner-radius/);
  assert.match(component, /log-core-call "spiralCellInnerHour"/);
  assert.match(component, /past-time-overlay-component[\s\S]*spiral-cell-inner-radius start settings inner-radius/);
  assert.match(component, /snail-blueprint-component[\s\S]*spiral-cell-inner-radius start settings inner-radius/);
  assert.match(component, /event-slice-component[\s\S]*spiral-cell-inner-radius s settings inner-radius/);
});

test('Log gives normal fixed events one semantic yellow and marks real conflicts separately', () => {
  assert.doesNotMatch(component, /meeting-color-palette/);
  assert.match(component, /meeting-fill-color "var\(--nautilus-log-event-fill\)"/);
  assert.match(component, /log-core-call "overlappingFixedEventUids"/);
  assert.match(component, /nautilus-log-event-conflict/);
  assert.match(component, /\(when @show-done-atom\? done-slice-components\)\s*all-slice-components[^\n]*\n\s*\[snail-blueprint-component/s);
  assert.match(css, /--nautilus-log-event-fill:\s*#[0-9a-f]{6};/i);
  assert.match(css, /\.nautilus-log-event-conflict \.nautilus-log-slice\s*\{[^}]*stroke:\s*var\(--nautilus-log-warning\);[^}]*stroke-dasharray:/s);
});

test('Log feature-detects ResizeObserver with syntax supported by Roam SCI', () => {
  assert.doesNotMatch(component, /\(exists\?/);
  assert.match(component, /\(\.-ResizeObserver js\/window\)/);
});

test('Log prefers horizontal label rails and keeps past leader lines legible', () => {
  assert.match(component, /:layout "side-rails"/);
  assert.match(component, /:maxVerticalOffset \(\* max-spiral-radius 0\.92\)/);
  assert.match(component, /:rowGap 26/);
  assert.match(component, /legend-color \(update-opacity-str bg-color "1"\)/);
  assert.match(component, /:anchorY anchor-y/);
  assert.match(component, /:sortKey order-key/);
  assert.match(component, /:connector-knee-x/);
  assert.match(component, /:connector-rail-x/);
  assert.doesNotMatch(css, /\.nautilus-log-event-slice-group\s*\{[^}]*opacity:/s);
  assert.match(css, /\.nautilus-log-past--completed \.nautilus-log-link-line\s*\{[^}]*opacity:\s*0\.[4-9]/s);
});

test('flexible task labels and connectors use one semantic blue', () => {
  assert.match(component, /def task-legend-color "var\(--nautilus-log-task\)"/);
  assert.match(component, /def task-fill-color "var\(--nautilus-log-task-fill\)"/);
  assert.doesNotMatch(component, /todo-color-palette/);
  assert.match(component, /\(and \(:todo event\) \(not done\) \(nil\? \(:bg-color event\)\)\) task-legend-color/);
  assert.match(component, /:legend-color legend-color/);
  assert.match(component, /:fill \(if-not done\? legend-color/);
  assert.match(css, /--nautilus-log-task:\s*#0899c8/);
  assert.match(css, /--nautilus-log-task-fill:\s*rgba\(8,\s*153,\s*200,/);
  assert.match(css, /\.nautilus-log-legend-dot--task\s*\{\s*background:\s*var\(--nautilus-log-task\);\s*\}/);
});

test('the current planned task is outlined and its label receives stronger emphasis', () => {
  assert.match(component, /log-core-call "isCurrentPlannedTask"/);
  assert.match(component, /nautilus-log-current-task/);
  assert.match(component, /:aria-current \(when current\? "true"\)/);
  assert.match(css, /\.nautilus-log-current-task \.nautilus-log-slice\s*\{[^}]*stroke:\s*var\(--nautilus-log-task\);[^}]*stroke-width:\s*2px;/s);
  assert.match(css, /\.nautilus-log-current-task \.nautilus-log-slice-group text\s*\{[^}]*font-weight:\s*800;/s);
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
