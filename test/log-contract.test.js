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
const readmeZh = fs.readFileSync(path.join(__dirname, '..', 'README.zh-CN.md'), 'utf8');
const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'guide.md'), 'utf8');
const guideZh = fs.readFileSync(path.join(__dirname, '..', 'docs', 'guide.zh-CN.md'), 'utf8');
const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const buildScript = fs.readFileSync(path.join(__dirname, '..', 'build.sh'), 'utf8');
const timingTopbar = fs.readFileSync(path.join(__dirname, '..', 'src', 'timing-topbar.js'), 'utf8');
const timingCore = fs.readFileSync(path.join(__dirname, '..', 'src', 'timing-core.js'), 'utf8');
const timingRuntime = fs.readFileSync(path.join(__dirname, '..', 'src', 'timing-runtime.js'), 'utf8');
const timingCommands = fs.readFileSync(path.join(__dirname, '..', 'src', 'timing-commands.js'), 'utf8');
const tidyPlan = fs.readFileSync(path.join(__dirname, '..', 'src', 'tidy-plan.js'), 'utf8');

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

function assertBalancedReaderDelimiters(source) {
  const openers = new Set(['(', '[', '{']);
  const matchingOpener = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  let inString = false;
  let escaped = false;
  let inComment = false;
  let line = 1;
  let column = 0;

  for (const char of source) {
    if (char === '\n') {
      line += 1;
      column = 0;
      inComment = false;
      continue;
    }
    column += 1;

    if (inComment) continue;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === ';') {
      inComment = true;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (openers.has(char)) {
      stack.push({ char, line, column });
      continue;
    }
    if (Object.hasOwn(matchingOpener, char)) {
      const opener = stack.pop();
      assert.ok(opener, `Unexpected ${char} at ${line}:${column}`);
      assert.equal(
        opener.char,
        matchingOpener[char],
        `Unmatched ${char} at ${line}:${column}; expected the delimiter for ${opener.char} opened at ${opener.line}:${opener.column}`,
      );
    }
  }

  assert.equal(inString, false, 'Unterminated string in component.cljs');
  assert.deepEqual(stack, [], `Unclosed delimiter in component.cljs: ${JSON.stringify(stack.at(-1))}`);
}

test('Roam SCI component source keeps reader delimiters balanced', () => {
  assertBalancedReaderDelimiters(component);
  assert.match(buildScript, /LineNumberingPushbackReader/);
  assert.match(buildScript, /read \{:eof eof :read-cond :allow :features #\{:cljs\}\}/);
});

test('README media uses absolute HTTPS URLs for Roam Depot rendering', () => {
  for (const source of [readme, readmeZh]) {
    const media = [...source.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
      .map((match) => match[1])
      .filter((url) => /\.(?:gif|jpe?g|mov|mp4|png|svg|webp)(?:[?#].*)?$/i.test(url));
    assert.ok(media.length > 0, 'README should keep its product image');
    for (const url of media) assert.match(url, /^https:\/\//);
  }
});

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

test('guides define left as current free time over full-day Available', () => {
  assert.match(guide, /`left` percentage = `current free time ÷ full-day Available`/);
  assert.match(guideZh, /`left` 百分比 = `当前剩余灵活时间 ÷ 全天 Available 总量`/);
  assert.doesNotMatch(guide, /Planned ÷ Available now/);
  assert.doesNotMatch(guideZh, /Planned ÷ 当前 Available/);
});

test('the Roam renderer delegates schedule and capacity behavior to the tested Log core', () => {
  assert.match(component, /log-core-call "scheduleTasks"/);
  assert.match(component, /log-core-call "calculateCapacity"/);
  assert.match(component, /log-core-call "historicalDoneSlice"/);
  assert.match(component, /log-core-call "completedTaskClockSummary"/);
  assert.match(component, /:actualDuration actual-duration/);
  assert.match(component, /:lastClockEnd last-clock-end/);
  assert.match(entry, /getClockRenderContext/);
  assert.match(component, /log-core-call "truncateTextToWidth"/);
  assert.match(component, /log-core-call "placeExternalLabels"/);
  assert.match(component, /log-core-call "resolveRendererSettings"/);
  assert.match(component, /log-core-call "hourlyGridSegments"/);
  assert.match(component, /log-core-call "pastTimelineSegments"/);
  assert.match(component, /log-core-call "pastUnplannedSegments"/);
  assert.match(component, /log-core-call "availableSlotGroups"/);
  assert.match(component, /log-core-call "pastItemStatus"/);
  assert.match(component, /log-core-call "spiralCellInnerHour"/);
  assert.match(component, /log-core-call "overlappingFixedEventUids"/);
  assert.match(component, /log-core-call "isCurrentPlannedTask"/);
  assert.match(component, /log-core-call "uiCopy"/);
  assert.match(component, /log-core-call "capacityMetrics"/);
  assert.match(component, /log-core-call "burningCapacityBucket"/);
  assert.match(component, /log-core-call "parseDurationToken"/);
  assert.match(component, /log-core-call "parseTimeRangeToken"/);
  assert.match(component, /nautilus-log:settings-changed/);
  assert.match(component, /\.addEventListener/);
  assert.match(component, /\.removeEventListener/);
  assert.match(entry, /window\.nautilusLogCore = logCore/);
  assert.doesNotMatch(component, /\(abs \(- done-at duration\)\)/);
});

test('the chart resolves daily task instances through the shared reference-precedence core', () => {
  assert.match(entry, /import \* as timingCore from "\.\/timing-core"/);
  assert.match(entry, /window\.nautilusLogTaskCore = timingCore/);
  assert.match(entry, /resolveRendererTaskInstance/);
  assert.match(entry, /resolveTaskInstance: resolveRendererTaskInstance/);
  assert.match(component, /\.\-resolveTaskInstance/);
  assert.match(component, /task-core-call "resolveTaskInstance"/);
  assert.match(component, /:effectiveString/);
  const mappingStart = component.indexOf('mapped (->>');
  const mappingEnd = component.indexOf('clock-context', mappingStart);
  assert.ok(mappingStart >= 0 && mappingEnd > mappingStart);
  const mapping = component.slice(mappingStart, mappingEnd);
  assert.match(mapping, /task-instance-row/);
  assert.match(mapping, /"structure"/);
  assert.doesNotMatch(mapping, /str-with-resolved-block-refs/);
});

test('mounted charts share the extension Plan Pull Watch and release it on cleanup', () => {
  assert.match(component, /\.\-watchPlan/);
  assert.match(component, /watch-plan-children!/);
  assert.match(component, /stop-plan-watch/);
  assert.doesNotMatch(component, /roam\.datascript\.reactive/);
});

test('the spiral exposes slice and available-slot hover targets above an inert grid', () => {
  const gridStart = component.indexOf('(defn snail-blueprint-component');
  const gridEnd = component.indexOf('(defn central-label-component', gridStart);
  const gridComponent = component.slice(gridStart, gridEnd);
  const connectorStart = component.indexOf('(defn bent-line-component');
  const connectorEnd = component.indexOf('(defn calculate-coordinates', connectorStart);
  const connectorComponent = component.slice(connectorStart, connectorEnd);

  assert.match(gridComponent, /\[:g \{:class "nautilus-log-grid" :aria-hidden "true"\}/);
  assert.doesNotMatch(connectorComponent, /nautilus-log-grid/);
  assert.match(component, /nautilus-log-available-slot-hit/);
  assert.match(component, /nautilus-log-hover-tooltip/);
  assert.match(component, /log-core-call "placeFloatingTooltip"/);
  assert.match(component, /log-core-call "radialTooltipGeometry"/);
  assert.match(component, /\.getScreenCTM/);
  assert.match(component, /createPortal/);
  assert.match(component, /nautilus-log-event-slice-group--interactive/);
  assert.match(component, /hover-enabled\? \(not compact\?\)/);
  assert.match(component, /\(when \(and hover-enabled\? \(:showAvailableSlots timeline-state\)\)\s+\[available-slot-component/);
  assert.match(component, /\(when hover-enabled\? \[hover-tooltip-component/);
  assert.match(component, /:on-mouse-enter/);
  assert.match(component, /:on-focus/);
  assert.match(css, /\.nautilus-log-grid\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.nautilus-log-available-slot-hit/);
  assert.match(css, /\.nautilus-log-hover-tooltip\s*\{[^}]*position:\s*fixed;[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.nautilus-log-event-slice-group--interactive:hover/);
  assert.doesNotMatch(css, /\.nautilus-log-event-slice-group:hover/);
});

test('renderer install polling does not invalidate an unchanged chart', () => {
  const pollStart = component.indexOf('check-interval');
  const pollEnd = component.indexOf('settings-state', pollStart);
  const pollBody = component.slice(pollStart, pollEnd);

  assert.match(pollBody, /next-running-state/);
  assert.match(pollBody, /\(not= @\*running\? next-running-state\)/);
  assert.match(pollBody, /\(reset! \*running\? next-running-state\)/);
  assert.doesNotMatch(pollBody, /#\(reset! \*running\? \(is-running\?\)\)/);
});

test('a mounted chart derives historical/today behavior from the shared timeline day state', () => {
  const clockStart = component.indexOf('daily-page-atom? (r/atom (daily-page? block-uid))');
  const clockEnd = component.indexOf('page-title-val', clockStart);
  const clockBody = component.slice(clockStart, clockEnd);
  assert.match(clockBody, /next-daily-page-state/);
  assert.match(clockBody, /daily-page\? block-uid/);
  assert.match(clockBody, /reset! daily-page-atom\?/);
  assert.match(component, /log-core-call "timelineDayState"/);
  assert.match(component, /:capacityFromMinutes/);
  assert.match(component, /:elapsedThroughMinutes/);
  assert.match(component, /:showAvailableSlots/);
});

test('global and overnight windows use continuous minutes and a start-relative spiral profile', () => {
  assert.match(entry, /logCore\.START_HOURS\.map\(hourLabel\)/);
  assert.match(entry, /logCore\.END_HOURS\.map\(endLabel\)/);
  assert.match(entry, /Number\(hour\) <= startHour/);
  assert.match(entry, /labels\.nextDay/);
  assert.match(component, /defn spiral-profile-index/);
  assert.match(component, /windowStartMinutes \(:workday-start settings\)/);
  assert.match(component, /:windowStartMinutes \(:workday-start settings\)/);
  assert.match(component, /:nowMinutes timeline-minute/);
  assert.match(component, /clock-render-context page-title-val \(mapv :uid mapped\) \(:workday-end settings\)/);
  assert.match(guide, /00:00–23:00/);
  assert.match(guide, /21:00–02:00/);
  assert.match(guideZh, /00:00–23:00/);
  assert.match(guideZh, /21:00–02:00/);
  assert.doesNotMatch(guide, /Chart start can be 05:00–08:00/);
  assert.doesNotMatch(guideZh, /开始时间可选择 05:00–08:00/);
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
  assert.match(timingTopbar, /const brandIcon = \(\) => \{[\s\S]*icon\('unresolve'\)/);
  assert.match(timingTopbar, /trigger\.replaceChildren\(\.\.\.triggerNodes\(\)\)/);
  assert.match(timingTopbar, /nautilus-log-timing__identity-name', 'Nautilus'/);
  assert.match(timingTopbar, /identityHint = icon\('chevron-right'\)/);
  assert.match(timingTopbar, /nautilus-log-timing__identity-divider/);
  assert.match(timingTopbar, /identity\.addEventListener\('click',[\s\S]*runtime\.locate\(\)/);
  assert.doesNotMatch(timingTopbar, /iconButton\('locate'/);
  assert.match(timingTopbar, /iconButton\('confirm', text\.actions\.complete/);
  assert.match(timingTopbar, /iconButton\('trash', text\.actions\.deleteClock/);
  assert.match(timingTopbar, /isForgottenClock/);
  assert.doesNotMatch(timingTopbar, /Dashboard|Activity/);
  assert.match(timingCommands, /const palette = extensionAPI\?\.ui\?\.commandPalette/);
  assert.match(timingCommands, /palette\.addCommand/);
  assert.match(timingCommands, /const contextMenu = window\.roamAlphaAPI\?\.ui\?\.blockContextMenu/);
  assert.match(timingCommands, /contextMenu\.addCommand/);
  assert.match(timingCommands, /Nautilus Log: 2\. Clock out Timing Line/);
  assert.match(timingRuntime, /await closeEntriesAt\(before, instant\);[\s\S]*await createRunningClock\(taskUid, instant, taskString\);/);
  assert.match(timingRuntime, /deleteCurrentClock/);
});

test('the topbar trigger preserves normal click and routes modifier clicks to the Primary Plan', () => {
  const listenerStart = timingTopbar.indexOf("trigger.addEventListener('click'");
  const listenerEnd = timingTopbar.indexOf('pomoCloseButton =', listenerStart);
  const listener = timingTopbar.slice(listenerStart, listenerEnd);

  assert.ok(listenerStart >= 0 && listenerEnd > listenerStart);
  assert.match(listener, /if \(event\.shiftKey\)/);
  assert.match(listener, /runtime\.locate\(\{ sidebar: true \}\)/);
  assert.match(listener, /if \(event\.altKey\)/);
  assert.match(listener, /closePopover\(\)/);
  assert.match(listener, /runtime\.locate\(\)/);
  assert.match(listener, /return;/);
  assert.match(listener, /openPopover\(\)/);
  assert.ok(listener.indexOf('event.shiftKey') < listener.indexOf('event.altKey'));
  assert.ok(listener.indexOf('event.altKey') < listener.indexOf('openPopover()'));
});

test('the topbar exposes a stable hover tooltip for its modifier-click shortcuts', () => {
  assert.match(timingTopbar, /SHORTCUT_TOOLTIP_ID = 'nautilus-log-timing-shortcut-tooltip'/);
  assert.match(timingTopbar, /trigger\.setAttribute\('aria-describedby', SHORTCUT_TOOLTIP_ID\)/);
  assert.match(timingTopbar, /shortcutTooltip\.textContent = text\.actions\.openPanelHint/);
  assert.match(timingTopbar, /shortcutTooltip\.setAttribute\('role', 'tooltip'\)/);
  assert.match(css, /\.nautilus-log-timing__shortcut-tooltip\s*\{[^}]*position:\s*absolute;/s);
  assert.match(css, /\.nautilus-log-timing__shortcut-tooltip\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.nautilus-log-timing__shortcut-tooltip\s*\{[^}]*background:\s*var\(--nl-shortcut-tooltip-bg\);[^}]*font-size:\s*12px;[^}]*padding:\s*7px 9px;/s);
  assert.match(css, /\.nautilus-log-timing__shortcut-tooltip::before\s*\{[^}]*transform:\s*rotate\(45deg\);/s);
  assert.match(css, /\.bp3-dark \.nautilus-log-timing__shortcut-tooltip/);
  assert.match(css, /\.nautilus-log-timing__trigger:hover ~ \.nautilus-log-timing__shortcut-tooltip/);
  assert.match(css, /\.nautilus-log-timing__trigger:focus-visible ~ \.nautilus-log-timing__shortcut-tooltip/);
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
  assert.match(timingTopbar, /syncActionAvailability/);
  const renderStart = timingTopbar.indexOf('const renderPopover');
  const renderEnd = timingTopbar.indexOf('const positionPopover', renderStart);
  const renderBody = timingTopbar.slice(renderStart, renderEnd);
  const workingFastPath = renderBody.indexOf("state.status === 'working'");
  const replaceChildren = renderBody.indexOf('popover.replaceChildren()');
  assert.ok(workingFastPath >= 0, 'working state should have a lightweight popover path');
  assert.ok(workingFastPath < replaceChildren, 'working state must bypass the full row rebuild');
  const triggerStart = timingTopbar.indexOf('const renderTrigger');
  const triggerEnd = timingTopbar.indexOf('const ensureMounted', triggerStart);
  assert.doesNotMatch(timingTopbar.slice(triggerStart, triggerEnd), /renderPopover/);
});

test('execution actions do not imitate a blocked application while a graph write settles', () => {
  assert.match(
    css,
    /\.nautilus-log-timing__icon-button:disabled\s*\{[^}]*cursor:\s*default;/s,
    'disabled execution actions should stay visually quiet instead of showing the operating-system wait cursor',
  );
  assert.doesNotMatch(css, /\.nautilus-log-timing__icon-button:disabled\s*\{[^}]*cursor:\s*wait;/s);
});

test('standalone POMO has an independent topbar start/stop contract', () => {
  assert.match(timingCore, /nextStandalonePomodoroState/);
  assert.match(timingCore, /standalonePomodoroElapsed/);
  assert.match(timingCore, /isStandalonePomodoroOverdue/);
  assert.match(timingRuntime, /standalone-pomodoro-state/);
  assert.match(timingRuntime, /startStandalonePomodoro/);
  assert.match(timingRuntime, /stopStandalonePomodoro/);
  assert.match(timingTopbar, /!state\.activeWork\?\.focused && !state\.standalonePomodoro/);
  assert.match(timingTopbar, /iconButton\('stopwatch', text\.actions\.startPomodoro/);
  assert.match(timingTopbar, /runtime\.startStandalonePomodoro\(\)/);
  assert.match(timingTopbar, /runtime\.stopStandalonePomodoro\(\)/);
  assert.match(timingTopbar, /pomoCloseButton\.addEventListener\('click',[\s\S]*event\.stopPropagation\(\)/);
  assert.match(timingTopbar, /pomoCloseButton\.append\(icon\('small-cross'\)\)/);
  assert.match(timingTopbar, /element\('span', 'nautilus-log-timing__pomodoro-label', 'POMO'\)/);
  assert.match(timingTopbar, /trigger\.classList\.toggle\('is-overdue', timingCore\.isStandalonePomodoroOverdue/);
  assert.match(css, /\.nautilus-log-timing__elapsed\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/s);
  assert.match(css, /\.nautilus-log-timing__trigger\.is-overdue \.nautilus-log-timing__pomodoro-label/);
  assert.match(css, /\.nautilus-log-timing__pomodoro-close\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.nautilus-log-timing__pomodoro-close\[hidden\]\s*\{[^}]*display:\s*none;/s);
  const triggerStart = timingTopbar.indexOf('const renderTrigger');
  const triggerEnd = timingTopbar.indexOf('const ensureMounted', triggerStart);
  assert.doesNotMatch(timingTopbar.slice(triggerStart, triggerEnd), /renderPopover/);
});

test('the global capacity token yields topbar space to Roam search', () => {
  assert.match(timingCore, /function topbarDensity/);
  assert.match(timingTopbar, /timingCore\.topbarDensity/);
  assert.match(timingTopbar, /availableWidth: searchRect\.left - controlRect\.left/);
  assert.match(timingTopbar, /planSnapshot\?\.execution/);
  assert.match(timingTopbar, /nautilus-log-timing__capacity-token/);
  assert.match(timingTopbar, /nautilus-log-timing__brand-icon/);
  assert.match(timingTopbar, /new ResizeObserver/);
  assert.match(css, /data-density="compact"/);
  assert.match(css, /data-density="icon"/);
  assert.match(css, /data-density="icon"[^}]*nautilus-log-timing__brand-icon/s);
  assert.doesNotMatch(timingTopbar, /readAllEntries|readPrimaryPlan/);
});

test('the global capacity token stays neutral and shows only the percentage', () => {
  const triggerNodesStart = timingTopbar.indexOf('const triggerNodes');
  const triggerNodesEnd = timingTopbar.indexOf('const updateTriggerCapacity', triggerNodesStart);
  const updateStart = triggerNodesEnd;
  const updateEnd = timingTopbar.indexOf('const clearDeleteConfirmation', updateStart);
  const triggerNodesSource = timingTopbar.slice(triggerNodesStart, triggerNodesEnd);
  const updateSource = timingTopbar.slice(updateStart, updateEnd);

  assert.match(triggerNodesSource, /element\('span', 'nautilus-log-timing__capacity-value'\)/);
  assert.doesNotMatch(triggerNodesSource, /nautilus-log-timing__capacity-label/);
  assert.match(updateSource, /capacity\.classList\.remove\('is-warning'\)/);
  assert.doesNotMatch(updateSource, /capacity\.classList\.toggle\('is-warning'/);
  assert.doesNotMatch(css, /nautilus-log-timing__capacity-token\.is-warning/);
});

test('responsive observers rebind when Roam replaces the topbar or search surface', () => {
  assert.match(timingTopbar, /let observedTopbar = null;/);
  assert.match(timingTopbar, /let observedSearch = null;/);
  assert.match(timingTopbar, /const hostChanged = currentTopbar !== observedTopbar;/);
  assert.match(timingTopbar, /const searchChanged = currentSearch !== observedSearch;/);
  assert.match(timingTopbar, /if \(hostChanged \|\| searchChanged \|\|/);
  assert.match(timingTopbar, /records\.some\(\(record\) => !container\?\.contains\(record\.target\)\)/);
  assert.match(timingTopbar, /hostObserver\.observe\(topbar, \{ childList: true, subtree: true \}\)/);
});

test('the idle capacity strip shares one centered vertical rhythm', () => {
  assert.match(timingTopbar, /mark\.append\(icon\('unresolve'\)\)/);
  assert.match(timingTopbar, /separator\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(css, /\.nautilus-log-timing__brand-icon\s*\{[^}]*align-items:\s*center;[^}]*display:\s*inline-flex;[^}]*justify-content:\s*center;/s);
  assert.match(css, /\.nautilus-log-timing__brand-icon\s*>\s*\.bp3-icon\s*\{[^}]*transform:\s*translateY\(1px\);/s);
  assert.match(css, /\.nautilus-log-timing__trigger-separator\s*\{[^}]*background:\s*currentColor;[^}]*border-radius:\s*999px;[^}]*height:\s*3px;[^}]*width:\s*3px;/s);
  assert.match(css, /\.nautilus-log-timing__capacity-token\s*\{[^}]*align-items:\s*center;[^}]*height:\s*18px;[^}]*line-height:\s*18px;/s);
  assert.match(css, /\.nautilus-log-timing__capacity-value\s*\{[^}]*color:\s*inherit;[^}]*font-weight:\s*500;/s);
  assert.doesNotMatch(css, /\.bp3-dark\s+\.nautilus-log-timing__capacity-value[^}]*#d6dbe2/s);
});

test('icon-only density keeps the Nautilus mark independent from active timer typography', () => {
  const activeRule = css.match(/\.nautilus-log-timing__trigger\.is-active\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(activeRule, /font-(?:size|variant-numeric|weight)/);
  assert.match(css, /\.nautilus-log-timing__brand-icon\s*\{[^}]*color:\s*var\(--nl-exec-muted,\s*#6b7280\);[^}]*font-weight:\s*400;/s);
  assert.match(css, /\.nautilus-log-timing__elapsed\s*\{[^}]*font-size:\s*12px;[^}]*font-variant-numeric:\s*tabular-nums;[^}]*font-weight:\s*600;/s);
  assert.match(css, /data-density="icon"[^}]*nautilus-log-timing__brand-icon/s);
});

test('Pomodoro restoration is pure and stale state is cleared through the awaited lifecycle', () => {
  const restoreStart = timingRuntime.indexOf('function currentPomodoro');
  const restoreEnd = timingRuntime.indexOf('export function createTimingRuntime', restoreStart);
  const restoreBody = timingRuntime.slice(restoreStart, restoreEnd);
  assert.doesNotMatch(restoreBody, /settings\.set/);
  assert.match(timingRuntime, /if \(!snapshot\.activeWork\.focused[\s\S]*await setPomodoro\(null\)/);
});

test('execution popover exposes a lightweight daily Review without another graph reader', () => {
  assert.match(timingTopbar, /\['timing', 'plan', 'review'\]/);
  assert.match(timingTopbar, /tabs\.setAttribute\('role', 'tablist'\)/);
  assert.match(timingTopbar, /button\.setAttribute\('role', 'tab'\)/);
  assert.match(timingTopbar, /button\.setAttribute\('aria-selected', String\(view === name\)\)/);
  assert.match(timingTopbar, /view === 'review'/);
  assert.match(timingTopbar, /nautilus-log-timing__review-summary/);
  assert.match(timingTopbar, /nautilus-log-timing__review-row/);
  assert.match(timingTopbar, /reviewLiveActual/);
  assert.match(css, /\.nautilus-log-timing__review-summary/);
  assert.match(css, /\.nautilus-log-timing__review-row/);
  assert.match(css, /@media \(max-width:\s*320px\)[\s\S]*\.nautilus-log-timing__identity-name\s*\{[^}]*display:\s*none;/);
  assert.match(css, /@media \(max-width:\s*320px\)[\s\S]*\.nautilus-log-timing__tab\s*\{[^}]*padding:\s*0 7px;/);
  assert.doesNotMatch(timingTopbar, /readAllEntries|readPrimaryPlan/);
});

test('execution panel exposes cached capacity and deterministic Plan sections', () => {
  assert.match(timingTopbar, /nautilus-log-timing__capacity/);
  assert.match(timingCore, /function capacitySummary/);
  assert.match(timingTopbar, /timingCore\.capacitySummary/);
  assert.match(timingTopbar, /' · '/);
  assert.match(timingCore, /available: 'Available'/);
  assert.match(timingCore, /remaining: 'Remaining'/);
  assert.match(timingCore, /overload: 'Overload'/);
  assert.match(timingCore, /noSlot: 'No fitting slot'/);
  assert.match(timingCore, /scheduled: 'Scheduled today'/);
  assert.match(timingCore, /unscheduled: 'Unscheduled today'/);
  assert.match(timingTopbar, /aria-expanded/);
  assert.match(timingTopbar, /execution\?\.scheduledTasks/);
  assert.match(timingTopbar, /execution\?\.overflowTasks/);
  assert.match(timingTopbar, /labelNode\.append\(`\$\{label\} · \$\{tasks\.length\}`\)/);
  assert.doesNotMatch(timingTopbar, /nautilus-log-timing__plan-total/);
  assert.doesNotMatch(timingTopbar, /taskMinutes/);
  assert.match(timingTopbar, /element\('div', 'nautilus-log-timing__capacity'\)/);
  assert.match(timingTopbar, /document\.querySelector\('\.nautilus-log-metric'\)/);
  assert.match(timingTopbar, /getComputedStyle\(source\)\.fontFamily/);
  assert.match(timingTopbar, /--nl-exec-font-family/);
  assert.match(timingTopbar, /element\('div', 'nautilus-log-timing__popover'\)/);
  assert.match(css, /\.nautilus-log-timing__capacity/);
  assert.match(css, /\.nautilus-log-timing__capacity\s*\{[^}]*font-family:\s*inherit;[^}]*font-style:\s*normal;/s);
  assert.match(css, /\.nautilus-log-timing__popover\s*\{[^}]*font-family:\s*var\(--nl-exec-font-family,/s);
  assert.match(css, /\.nautilus-log-timing__capacity\s*\{[^}]*justify-content:\s*flex-start;/s);
  assert.doesNotMatch(css, /\.nautilus-log-timing__capacity-metric:last-child\s*\{[^}]*text-align:\s*right;/s);
  assert.match(css, /\.nautilus-log-timing__plan-heading/);
  assert.match(css, /\.nautilus-log-timing__row\.is-unscheduled \.nautilus-log-timing__row-meta/);
  assert.doesNotMatch(
    css,
    /\.nautilus-log-timing__row\.is-unscheduled\s*\{[^}]*(?:box-shadow|border(?:-left|-inline-start)?):/s,
    'Unscheduled rows should not gain a decorative edge or card border',
  );
  assert.doesNotMatch(timingTopbar, /readAllEntries|readPrimaryPlan/);
});

test('Plan projections keep their scheduled interval while Timing ticks update', () => {
  assert.match(
    timingTopbar,
    /const liveMeta = focused && !planState;/,
    'only Timing rows should opt into live elapsed metadata',
  );
  assert.match(
    timingTopbar,
    /const updateLiveElapsed = \(\) => \{[\s\S]*?if \(!popover \|\| view === 'plan'\) return;/,
    'the one-second updater must not rewrite deterministic Plan labels',
  );
});

test('execution lists stay scrollable without visible scrollbar chrome', () => {
  assert.match(css, /\.nautilus-log-timing__list\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-width:\s*none;[^}]*-ms-overflow-style:\s*none;/s);
  assert.match(css, /\.nautilus-log-timing__list::-webkit-scrollbar\s*\{[^}]*display:\s*none;[^}]*width:\s*0;[^}]*height:\s*0;/s);
});

test('Log owns the previously tested controls and collapses without reserving chart space', () => {
  assert.match(component, /M3 9h18/);
  assert.match(component, /m9 13 3 3 3-3/);
  assert.doesNotMatch(component, /"▸" "▾"/);
  assert.match(css, /\.nautilus-log-collapsed\s*\{[^}]*height:\s*0;/s);
  assert.match(css, /\.nautilus-log-collapsed \.nautilus-log-controls-top\s*\{[^}]*top:\s*-26px;/s);
  assert.doesNotMatch(css, /#roam-right-sidebar-content \.nautilus-log-container/);
});

test('Tidy is a stable, reversible direct-child action that does not rewrite schedule inputs', () => {
  assert.match(component, /nautilus-log-tidy-btn/);
  assert.match(component, /Keep one 18px control canvas while optically reducing this dense glyph/);
  assert.match(component, /translate\(1 1\) scale\(0\.9166667\)/);
  assert.match(component, /m16 22-1-4/);
  assert.match(component, /M19 14a1 1 0 0 0 1-1v-1a2 2/);
  assert.match(component, /M19 14H5l-1\.973 6\.767/);
  assert.match(component, /m8 22 1-4/);
  const visibilitySource = component.slice(
    component.indexOf('(defn switch-done-visibility-button'),
    component.indexOf('(defn tidy-button')
  );
  const playbackSource = component.slice(
    component.indexOf('(defn playback-button'),
    component.indexOf('(defn switch-debug-button')
  );
  assert.doesNotMatch(visibilitySource, /:width "16" :height "16"/);
  assert.match(visibilitySource, /:width "18" :height "18"/);
  assert.doesNotMatch(playbackSource, /:width "16" :height "16"/);
  assert.match(playbackSource, /:width "18" :height "18"/);
  assert.match(component, /:settledUids settled-uids/);
  assert.match(component, /\(filter :done\)/);
  assert.doesNotMatch(component, /not= "source" \(:status-origin %\)/);
  assert.match(component, /<= \(:end event\) \(:elapsedThroughMinutes timeline-state\)/);
  assert.match(entry, /tidyPlan: planTidy\.run/);
  assert.match(tidyPlan, /stableTidyOrder/);
  assert.match(tidyPlan, /childOrderMoves/);
  assert.match(tidyPlan, /setOpen/);
  assert.match(tidyPlan, /applyOpenTarget/);
  assert.match(tidyPlan, /collapsedUids/);
  assert.match(tidyPlan, /runningTaskUid/);
  assert.match(tidyPlan, /The Plan changed after Tidy/);
  assert.match(css, /\.nautilus-log-toast-action/);
  assert.match(tidyPlan, /updateGraphBlockOpen/);
  assert.doesNotMatch(tidyPlan, /deleteGraphBlock|createGraphBlock/);
});

test('Log uses an action-first two-row capacity ledger with controls plus legend right', () => {
  assert.match(component, /nautilus-log-header/);
  assert.match(component, /nautilus-log-metrics/);
  assert.match(component, /nautilus-log-metrics-summary/);
  assert.match(component, /nautilus-log-metrics-capacity/);
  assert.match(component, /nautilus-log-metric-separator/);
  assert.match(component, /:summaryLabel/);
  assert.match(component, /:percentLabel/);
  assert.match(component, /nautilus-log-metric-percent/);
  assert.match(component, /nautilus-log-metric-total/);
  assert.match(component, /nautilus-log-header-actions/);
  assert.match(component, /nautilus-log-html-legend/);
  assert.doesNotMatch(component, /\[log-legend-component/);
  assert.doesNotMatch(css, /filter:\s*drop-shadow\(0 4px 12px/);
  assert.doesNotMatch(css, /border:\s*1px dashed/);
  assert.match(css, /\.nautilus-log-metric--event/);
  assert.match(css, /\.nautilus-log-metrics\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*32px 16px;/s);
  assert.match(css, /\.nautilus-log-metrics-summary\s*\{[^}]*display:\s*inline-flex;/s);
  assert.match(css, /\.nautilus-log-metrics-capacity\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, max-content\);/s);
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
  const compactOverviewStart = component.indexOf('(defn compact-overview-component');
  const compactOverviewEnd = component.indexOf('(defn localized-warning', compactOverviewStart);
  const compactOverview = component.slice(compactOverviewStart, compactOverviewEnd);

  assert.match(component, /nautilus-log-compact-overview/);
  assert.match(component, /nautilus-log-compact-overview-summary/);
  assert.match(component, /compact-overview-open-state/);
  assert.match(component, /compact-overview-component/);
  assert.match(component, /:open @compact-open-state/);
  assert.match(compactOverview, /metric-summary-component planned/);
  assert.match(compactOverview, /metric-summary-component status/);
  assert.match(compactOverview, /:percent planned/);
  assert.match(compactOverview, /:percentLabel planned/);
  assert.match(compactOverview, /metrics-capacity-component \(:available metrics\) \(:events metrics\)/);
  assert.doesNotMatch(compactOverview, /\[metrics-component metrics\]/);
  assert.doesNotMatch(compactOverview, /burning-label|burning-aria|nautilus-log-burning-summary/);
  assert.match(css, /\.nautilus-log-compact-overview\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-log-compact-overview\s*\{[^}]*display:\s*block;/);
  assert.match(css, /@container \(max-width:\s*520px\)[\s\S]*\.nautilus-log-header--compact\s*\{[^}]*justify-content:\s*flex-end;/);
  assert.match(css, /\.nautilus-log-compact-overview-summary\s*\{[^}]*justify-content:\s*flex-start;/s);
  assert.match(css, /\.nautilus-log-compact-overview-summary-content\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*baseline;/s);
  assert.match(css, /\.nautilus-log-compact-overview-summary::after\s*\{[^}]*margin-left:\s*auto;/s);
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
