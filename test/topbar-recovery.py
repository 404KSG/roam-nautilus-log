#!/usr/bin/env python3
"""Bounded DOM feedback regression, using the launcher and execution bar fixture."""

import base64
import importlib.util
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location('today_plan', Path(__file__).with_name('today-plan-launcher.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.OUT = Path(os.environ.get('NAUTILUS_TOPBAR_OUT', '/tmp/nautilus-topbar-recovery'))


def module_url(env):
    path = os.environ.get(env)
    return 'data:text/javascript;base64,' + base64.b64encode(Path(path).read_bytes()).decode() if path else None


PROBE = """async ({mount, duplicate, first, second, contribution, eject, boot}) => {
  const harness = todayPlanHarness;
  const bar = document.querySelector('.rm-topbar');
  const shell = document.createElement('div');
  shell.id = 'app';
  bar.replaceWith(shell);
  shell.append(bar);
  const nativeInput = document.createElement('input');
  nativeInput.id = 'native-input';
  shell.append(nativeInput);
  const nativeMO = window.MutationObserver;
  const observers = [];
  let creatingContributionObserver = false;
  let contributionCallbacks = 0;
  window.MutationObserver = class extends nativeMO {
    constructor(callback) {
      const fromContribution = creatingContributionObserver;
      super((records, observer) => {
        if (fromContribution) contributionCallbacks++;
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  const id = 'nautilus-log-timing-topbar';
  const select = () => [...document.querySelectorAll(`[id="${id}"]`)];
  const create = url => url ? import(url).then(mod => mod.createTodayPlanLauncher) : Promise.resolve(undefined);
  const firstFactory = await create(first);
  const secondFactory = await create(second);
  const peerModule = contribution ? (await import(contribution)).default : null;
  if (boot) bar.remove();
  const primary = first ? harness.mountPeerLauncher(firstFactory) :
    (harness[mount]({status: 'ready-absent'}), null);
  if (boot) shell.prepend(bar);
  const settle = () => new Promise(resolve => setTimeout(resolve, 70));
  await settle();
  let duplicateOwner;
  let writes = 0, ejections = 0, peerAdds = 0, capped = false, firstInput = null;
  const targets = {};
  const trace = [];
  const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(Node.prototype, 'textContent', {...text, set(value) {
    if (trace.length < 4 && this.closest?.(`[id="${id}"]`) && value === text.get.call(this)) {
      trace.push({target: this.className, stack: new Error().stack.split('\\n').slice(2, 6)
        .map(frame => frame.replace(/data:text\\/javascript;base64,[A-Za-z0-9+/=]+/g, 'bundle.js'))});
    }
    text.set.call(this, value);
  }});
  const probe = new nativeMO(records => {
    for (const record of records) {
      if (record.target.closest?.(`[id="${id}"]`)) {
        writes++;
        targets[record.target.className] = (targets[record.target.className] || 0) + 1;
      }
      for (const node of record.addedNodes) {
        if (node.classList?.contains('rcg-topbar-button')) peerAdds++;
        if (eject && node.id === id && node.isConnected) { ejections++; node.remove(); }
      }
    }
    if (writes + ejections >= 64) {
      capped = true;
      observers.forEach(observer => observer.disconnect());
    }
  });
  probe.observe(shell, {childList: true, subtree: true});
  nativeInput.addEventListener('input', () => { firstInput ??= {writes, ejections, capped}; });
  setTimeout(() => nativeInput.dispatchEvent(new Event('input')), 0);
  if (peerModule) {
    creatingContributionObserver = true;
    peerModule.onload({extensionAPI: {
      settings: {get: () => true, set() {}, panel: {create() {}}},
      ui: {commandPalette: {addCommand() {}, removeCommand() {}}},
    }});
    creatingContributionObserver = false;
  }
  if (duplicate) duplicateOwner = harness.mountPeerLauncher(secondFactory);
  const unrelated = document.createElement('button');
  bar.append(unrelated);
  if (eject) select()[0].remove();
  await settle();
  const after = {writes, ejections, peerAdds, contributionCallbacks, capped, firstInput, targets: {...targets},
    trace: [...trace], owners: select().length};
  if (eject && !capped) {
    eject = false;
    const replacement = bar.cloneNode(true);
    bar.replaceWith(replacement);
    await settle();
    after.recoveredFromContention = replacement.contains(select()[0]);
  } else if (!capped && !duplicate && !eject && !first) {
    const widget = select()[0];
    const trigger = widget.querySelector('button');
    const search = bar.querySelector('.rm-find-or-create-wrapper');
    const nextSearch = search.cloneNode(true);
    search.replaceWith(nextSearch);
    await settle();
    const sameSearchOwner = select()[0] === widget && nextSearch.isConnected;
    const replacement = bar.cloneNode(false);
    replacement.append(...[...bar.children].filter(child => child !== widget));
    bar.replaceWith(replacement);
    await settle();
    const recovered = widget.isConnected && replacement.contains(widget) && widget.querySelector('button') === trigger;
    const navPosition = widget.previousElementSibling?.getAttribute('aria-label');
    if (recovered) trigger.click();
    await settle();
    const calls = harness.api.ensureCalls().length;
    // An already queued recovery must not revive the owner on unload.
    widget.remove();
    await Promise.resolve();
    harness.destroy();
    await settle();
    Object.assign(after, {sameSearchOwner, recovered, navPosition, calls, staysDestroyed: select().length === 0});
  }
  probe.disconnect();
  peerModule?.onunload();
  primary?.destroy();
  duplicateOwner?.destroy();
  harness.destroy();
  return after;
}"""


def run():
    fixture.bundle()
    first = module_url('NAUTILUS_TOPBAR_FIRST_JS')
    second = module_url('NAUTILUS_TOPBAR_SECOND_JS')
    contribution = module_url('NAUTILUS_TOPBAR_CONTRIBUTION_JS')
    cases = [
        dict(name='launcher', mount='mountLauncher'),
        dict(name='execution', mount='mountTopbar'),
        dict(name='launcher-late-host', mount='mountLauncher', boot=True),
        dict(name='execution-late-host', mount='mountTopbar', boot=True),
        dict(name='duplicate-launchers', mount='mountLauncher', duplicate=True),
        dict(name='execution-plus-launcher', mount='mountTopbar', duplicate=True),
        dict(name='contested-host', mount='mountLauncher', eject=True),
    ]
    if contribution:
        cases.extend([
            dict(name='contribution-single', mount='mountLauncher', contribution=contribution),
            dict(name='contribution-duplicate', mount='mountLauncher', duplicate=True, contribution=contribution),
        ])
    if first:
        cases.append(dict(name='production-artifact', mount='mountLauncher', first=first,
                          second=second, duplicate=bool(second), contribution=contribution))
    results = []
    failures = []
    record_only = bool(os.environ.get('NAUTILUS_TOPBAR_RECORD_ONLY'))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for case in cases:
            page = browser.new_page(viewport={'width': 1280, 'height': 720})
            page.on('pageerror', lambda e: failures.append(str(e)))
            page.goto((fixture.OUT / 'index.html').as_uri())
            result = page.evaluate(PROBE, case)
            results.append({'case': case['name'], **result})
            if not record_only:
                if result['capped'] or result['firstInput'] is None:
                    failures.append(f"{case['name']} failed to yield to input")
                if case.get('eject'):
                    if result['ejections'] > 1 or not result.get('recoveredFromContention'):
                        failures.append(f"{case['name']} failed to settle and recover on a fresh host")
                elif case.get('duplicate'):
                    if result['writes'] > 4 or result['owners'] != 2:
                        failures.append(f"{case['name']} did not settle")
                elif result['writes'] != 0:
                    failures.append(f"{case['name']} rewrote a healthy toolbar")
                if case.get('contribution') and (result['peerAdds'] != 1 or not result['contributionCallbacks']):
                    failures.append(f"{case['name']} did not exercise Contribution Graph's observer")
                if 'recovered' in result and not (result['sameSearchOwner'] and result['recovered'] and
                        result['navPosition'] == 'forward' and result['calls'] == 1 and result['staysDestroyed']):
                    failures.append(f"{case['name']} failed replacement/action/teardown: {result}")
            page.close()
        browser.close()
    (fixture.OUT / 'recovery.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps([{k: r[k] for k in ('case', 'writes', 'ejections', 'peerAdds', 'capped', 'firstInput', 'owners')}
                      for r in results], indent=2))
    assert not failures, '\n'.join(failures)


if __name__ == '__main__':
    run()
