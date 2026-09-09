#!/usr/bin/env python3
"""Local energy-bar settlement checks against the real topbar module + extension.css."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path("/tmp/nautilus-energy-bar-verify")
CSS = ROOT / "extension.css"


def readings_js() -> str:
    return """() => {
      const value = document.querySelector('.nautilus-log-timing__energy-planned-value');
      const label = document.querySelector('.nautilus-log-timing__energy-planned-label');
      const planned = document.querySelector('.nautilus-log-timing__energy-planned');
      const capacity = document.querySelector('.nautilus-log-timing__capacity-token');
      const reserve = document.querySelector('.nautilus-log-timing__energy-reserve');
      const committed = document.querySelector('.nautilus-log-timing__energy-committed');
      const cs = (el) => el ? getComputedStyle(el) : null;
      const valueCs = cs(value);
      const labelCs = cs(label);
      return {
        valueText: value ? value.textContent : '',
        labelText: label ? label.textContent : '',
        valueOpacity: valueCs ? valueCs.opacity : null,
        labelOpacity: labelCs ? labelCs.opacity : null,
        valueColor: valueCs ? valueCs.color : null,
        valueFontWeight: valueCs ? valueCs.fontWeight : null,
        valueVisibility: valueCs ? valueCs.visibility : null,
        labelVisibility: labelCs ? labelCs.visibility : null,
        confirming: Boolean(value && value.classList.contains('is-confirming')),
        warning: Boolean(planned && planned.classList.contains('is-warning')),
        statusCue: Boolean(capacity && capacity.classList.contains('is-status-cue')),
        damage: Boolean(document.querySelector('.nautilus-log-timing__energy-damage')),
        settling: Boolean(capacity && capacity.classList.contains('is-settling')),
        reserveDelay: cs(reserve) && cs(reserve).transitionDelay,
        committedDelay: cs(committed) && cs(committed).transitionDelay,
        reserveDuration: cs(reserve) && cs(reserve).transitionDuration,
        committedDuration: cs(committed) && cs(committed).transitionDuration,
        reserveWidth: cs(reserve) && cs(reserve).width,
        committedWidth: cs(committed) && cs(committed).width,
        reserveBg: cs(reserve) && cs(reserve).backgroundColor,
        committedBg: cs(committed) && cs(committed).backgroundColor,
        animationName: valueCs ? valueCs.animationName : null,
        hidden: Boolean(value && value.hidden),
      };
    }"""


def read(page):
    return page.evaluate(readings_js())


def assert_true(condition, message, failures):
    if not condition:
        failures.append(message)


def assert_readable(info, failures, prefix):
    assert_true(info["damage"] is False, f"{prefix}: damage node present", failures)
    assert_true(info["settling"] is False, f"{prefix}: is-settling present", failures)
    assert_true(info["valueText"] != "", f"{prefix}: planned-value empty", failures)
    assert_true(info["valueOpacity"] == "1", f"{prefix}: planned-value opacity {info['valueOpacity']}", failures)
    assert_true(info["labelOpacity"] == "1", f"{prefix}: planned-label opacity {info['labelOpacity']}", failures)
    assert_true(info["valueVisibility"] == "visible", f"{prefix}: planned-value visibility {info['valueVisibility']}", failures)
    assert_true(info["labelVisibility"] == "visible", f"{prefix}: planned-label visibility {info['labelVisibility']}", failures)
    assert_true(info["hidden"] is False, f"{prefix}: planned-value hidden", failures)


def write_html(path: Path) -> None:
    path.write_text(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Nautilus energy bar settlement</title>
  <link rel="stylesheet" href="{CSS.as_uri()}">
  <style>
    body {{ margin: 0; background: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    .rm-topbar {{
      align-items: center;
      background: #fff;
      border-bottom: 1px solid #e4e8ec;
      display: flex;
      gap: 8px;
      height: 45px;
      padding: 0 12px;
    }}
    .rm-find-or-create-wrapper {{ margin-left: auto; width: 280px; }}
    body.bp3-dark, body.rm-dark-theme {{ background: #202b33; }}
    .bp3-dark .rm-topbar, .rm-dark-theme .rm-topbar {{
      background: #293742;
      border-bottom-color: #394b59;
    }}
  </style>
</head>
<body>
  <div class="rm-topbar">
    <button type="button" aria-label="back">Back</button>
    <button type="button" aria-label="forward">Forward</button>
    <div class="rm-find-or-create-wrapper">
      <input placeholder="Find or create...">
    </div>
  </div>
  <script src="{(OUT / 'harness.js').as_uri()}"></script>
</body>
</html>
""",
        encoding="utf-8",
    )


def screenshot(page, name: str) -> None:
    page.locator(".rm-topbar").screenshot(path=str(OUT / name))


def open_plan(page) -> None:
    page.locator(".nautilus-log-timing__capacity-token").click()
    page.wait_for_selector(".nautilus-log-timing__popover")
    if page.locator(".nautilus-log-timing__icon-button.is-complete").count() == 0:
        page.get_by_role("tab", name="Plan").click()
        collapsed = page.locator('.nautilus-log-timing__plan-heading[aria-expanded="false"]')
        if collapsed.count():
            collapsed.click()
        page.wait_for_selector(".nautilus-log-timing__icon-button.is-complete")


def bundle() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(
        ["node", str(ROOT / "test" / "energy-bar-bundle.js"), str(OUT)],
        cwd=str(ROOT),
    )
    write_html(OUT / "index.html")


def run() -> int:
    bundle()
    failures: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.goto((OUT / "index.html").as_uri())
        page.wait_for_function("() => window.energyBarHarness && window.energyBarHarness.mount")

        page.evaluate("() => energyBarHarness.mount()")
        page.wait_for_selector(".nautilus-log-timing__energy-planned-value")
        before = read(page)
        screenshot(page, "01-before-complete.png")
        assert_readable(before, failures, "before")
        assert_true(before["labelText"] == "planned", f"before: label {before['labelText']!r}", failures)
        assert_true("h" in before["valueText"] or "m" in before["valueText"], f"before: value {before['valueText']!r}", failures)
        assert_true(before["confirming"] is False, "before: unexpected confirming", failures)
        assert_true(before["reserveBg"] == "rgb(92, 112, 128)", f"before: reserve bg {before['reserveBg']}", failures)
        assert_true(before["committedBg"] == "rgb(168, 207, 186)", f"before: committed bg {before['committedBg']}", failures)
        assert_true(before["reserveDelay"] in ("0s", "0ms"), f"before: reserve delay {before['reserveDelay']}", failures)
        assert_true(before["committedDelay"] in ("0s", "0ms"), f"before: committed delay {before['committedDelay']}", failures)
        assert_true(before["reserveDuration"] == "0.36s", f"before: reserve duration {before['reserveDuration']}", failures)
        assert_true(before["committedDuration"] == "0.36s", f"before: committed duration {before['committedDuration']}", failures)
        assert_true(before["valueColor"] == "rgb(95, 111, 127)", f"before: value color {before['valueColor']}", failures)

        open_plan(page)
        planned_before = before["valueText"]
        reserve_before = before["reserveWidth"]
        page.locator(".nautilus-log-timing__icon-button.is-complete").first.click()
        page.wait_for_timeout(50)
        during = read(page)
        screenshot(page, "02-during-confirm.png")
        assert_readable(during, failures, "during")
        assert_true(during["valueText"] != planned_before, f"during: planned did not update ({during['valueText']!r})", failures)
        assert_true(during["labelText"] == "planned", f"during: label missing {during['labelText']!r}", failures)
        assert_true(during["confirming"] is True, "during: missing in-place confirm", failures)
        assert_true(during["animationName"] == "nautilus-log-energy-confirm", f"during: animation {during['animationName']}", failures)
        assert_true(during["valueColor"] == "rgb(95, 111, 127)", f"during: color changed {during['valueColor']}", failures)
        assert_true(during["reserveDelay"] in ("0s", "0ms"), f"during: reserve delay {during['reserveDelay']}", failures)
        assert_true(during["reserveWidth"] != reserve_before, "during: reserve width still waiting on delay", failures)

        page.wait_for_timeout(360)
        after = read(page)
        screenshot(page, "03-after-confirm.png")
        assert_readable(after, failures, "after")
        assert_true(after["confirming"] is False, "after: confirming class lingered", failures)
        assert_true(after["valueText"] == during["valueText"], "after: planned value changed again", failures)

        page.evaluate("() => energyBarHarness.destroy()")
        page.wait_for_timeout(50)
        assert_true(
            page.evaluate("() => energyBarHarness.api.pendingTimeouts()") == 0,
            "destroy left hanging timeouts",
            failures,
        )
        assert_true(
            page.locator(".nautilus-log-timing__capacity-token").count() == 0,
            "destroy left capacity token",
            failures,
        )

        page.evaluate("() => energyBarHarness.mount()")
        page.wait_for_selector(".nautilus-log-timing__energy-planned-value")
        open_plan(page)
        page.evaluate("() => energyBarHarness.api.failNextComplete()")
        failed_before = read(page)
        page.locator(".nautilus-log-timing__icon-button.is-complete").first.click()
        page.wait_for_timeout(80)
        failed = read(page)
        screenshot(page, "04-failed-complete.png")
        assert_readable(failed, failures, "failed")
        assert_true(failed["confirming"] is False, "failed: success confirm appeared", failures)
        assert_true(failed["valueText"] == failed_before["valueText"], "failed: planned value changed", failures)

        page.evaluate("() => energyBarHarness.destroy()")
        page.evaluate("() => energyBarHarness.mount()")
        page.wait_for_selector(".nautilus-log-timing__energy-planned-value")
        external_before = read(page)
        page.evaluate("() => energyBarHarness.api.externalComplete('task-a')")
        page.wait_for_timeout(80)
        external = read(page)
        screenshot(page, "05-external-done.png")
        assert_readable(external, failures, "external")
        assert_true(external["confirming"] is False, "external: completion cue appeared", failures)
        assert_true(external["valueText"] != external_before["valueText"], "external: numbers did not redraw", failures)
        assert_true(
            page.evaluate("() => energyBarHarness.api.completeCalls().length") == 0,
            "external: completeTask was called",
            failures,
        )

        page.evaluate("() => energyBarHarness.api.tickMinute()")
        page.wait_for_timeout(40)
        ticked = read(page)
        assert_true(ticked["confirming"] is False, "tick: completion cue appeared", failures)

        page.evaluate("() => energyBarHarness.destroy()")
        page.evaluate("() => energyBarHarness.mount({ tasks: energyBarHarness.tasks.WARNING_TASKS })")
        page.wait_for_selector(".nautilus-log-timing__energy-planned-value")
        warning = read(page)
        screenshot(page, "06-warning.png")
        assert_readable(warning, failures, "warning")
        assert_true(warning["warning"] is True, "warning: missing is-warning", failures)
        assert_true(warning["statusCue"] is True, "warning: missing is-status-cue", failures)
        assert_true(
            warning["valueText"].startswith("OVER") or warning["valueText"].startswith("NO SLOT"),
            f"warning: cue {warning['valueText']!r}",
            failures,
        )
        assert_true(warning["labelText"] == "", f"warning: label should be empty, got {warning['labelText']!r}", failures)
        assert_true(warning["valueColor"] == "rgb(201, 108, 0)", f"warning: color {warning['valueColor']}", failures)
        assert_true(warning["confirming"] is False, "warning: confirming before complete", failures)
        open_plan(page)
        page.locator(".nautilus-log-timing__icon-button.is-complete").last.click()
        page.wait_for_timeout(80)
        warning_after = read(page)
        screenshot(page, "07-warning-after-complete.png")
        assert_readable(warning_after, failures, "warning-after")
        assert_true(warning_after["warning"] is True, "warning-after: lost warning", failures)
        assert_true(
            warning_after["valueText"].startswith("OVER") or warning_after["valueText"].startswith("NO SLOT"),
            f"warning-after: cue {warning_after['valueText']!r}",
            failures,
        )
        assert_true(warning_after["confirming"] is False, "warning-after: success confirm covered warning", failures)
        assert_true(warning_after["valueColor"] == "rgb(201, 108, 0)", f"warning-after: color {warning_after['valueColor']}", failures)
        assert_true(warning_after["animationName"] in ("none", ""), f"warning-after: animation {warning_after['animationName']}", failures)

        page.evaluate("() => energyBarHarness.destroy()")
        page.evaluate("() => energyBarHarness.mount()")
        page.wait_for_selector(".nautilus-log-timing__energy-planned-value")
        open_plan(page)
        page.locator(".nautilus-log-timing__icon-button.is-complete").first.click()
        page.wait_for_timeout(40)
        first_confirm = read(page)
        assert_true(first_confirm["confirming"] is True, "repeat: first confirm missing", failures)
        if page.locator(".nautilus-log-timing__icon-button.is-complete").count() > 0:
            page.locator(".nautilus-log-timing__icon-button.is-complete").first.click()
            page.wait_for_timeout(40)
            second_confirm = read(page)
            assert_readable(second_confirm, failures, "repeat")
            pending = page.evaluate("() => energyBarHarness.api.pendingTimeouts()")
            assert_true(pending >= 1, f"repeat: expected a live confirm timer, got {pending}", failures)
        page.evaluate("() => energyBarHarness.destroy()")
        page.wait_for_timeout(20)
        assert_true(
            page.evaluate("() => energyBarHarness.api.pendingTimeouts()") == 0,
            "repeat/unload: hanging timeouts",
            failures,
        )

        # Fragmentation is a distinct warning: demand fits the total capacity,
        # but the long task cannot fit any continuous slot.
        page.evaluate("""() => energyBarHarness.mount({
          tasks: [
            { uid: 'long', title: 'Long', plannedMinutes: 330 },
            { uid: 'short', title: 'Short', plannedMinutes: 25 },
          ],
          fixedEvents: [
            { meeting: true, start: 720, end: 780 },
            { meeting: true, start: 900, end: 960 },
          ],
        })""")
        page.wait_for_selector(".nautilus-log-timing__energy-planned-value")
        no_slot = read(page)
        # Ordered scheduling leaves the following short task unplaced too.
        assert_true(no_slot["valueText"] == "NO SLOT 5h55m", f"no-slot: cue {no_slot['valueText']!r}", failures)
        open_plan(page)
        page.locator(".nautilus-log-timing__icon-button.is-complete").last.click()
        page.wait_for_timeout(80)
        no_slot_after = read(page)
        assert_readable(no_slot_after, failures, "no-slot-after")
        assert_true(no_slot_after["valueText"] == "NO SLOT 5h30m", f"no-slot-after: cue {no_slot_after['valueText']!r}", failures)
        assert_true(no_slot_after["confirming"] is False, "no-slot-after: success cue covered warning", failures)
        assert_true(no_slot_after["animationName"] == "none", "no-slot-after: warning animated", failures)
        assert_true(no_slot_after["valueColor"] == "rgb(201, 108, 0)", "no-slot-after: warning color changed", failures)
        screenshot(page, "09-no-slot-after-complete.png")

        for index, theme in enumerate(("bp3-dark", "roam-app rm-dark-theme"), start=10):
            page.evaluate("theme => document.body.className = theme", theme)
            page.evaluate("() => energyBarHarness.mount()")
            page.wait_for_selector(".nautilus-log-timing__energy-planned-value")
            dark_before = read(page)
            open_plan(page)
            page.locator(".nautilus-log-timing__icon-button.is-complete").first.click()
            page.wait_for_timeout(50)
            dark_after = read(page)
            assert_readable(dark_after, failures, theme)
            assert_true(dark_after["confirming"] is True, f"{theme}: missing confirmation", failures)
            assert_true(dark_after["valueText"] == "1h", f"{theme}: planned value did not update", failures)
            assert_true(dark_after["valueColor"] == dark_before["valueColor"], f"{theme}: text color changed", failures)
            assert_true(dark_after["reserveBg"] == "rgb(191, 204, 214)", f"{theme}: reserve color changed", failures)
            assert_true(dark_after["committedBg"] == "rgb(143, 191, 166)", f"{theme}: planned color changed", failures)
            screenshot(page, f"{index}-dark-confirm.png")
            page.evaluate("() => energyBarHarness.destroy()")
            assert_true(page.evaluate("() => energyBarHarness.api.pendingTimeouts()") == 0, f"{theme}: unload left timer", failures)
        page.close()
        reduced = browser.new_page(viewport={"width": 1280, "height": 720})
        reduced.emulate_media(reduced_motion="reduce")
        reduced.goto((OUT / "index.html").as_uri())
        reduced.wait_for_function("() => window.energyBarHarness && window.energyBarHarness.mount")
        reduced.evaluate("() => energyBarHarness.mount()")
        reduced.wait_for_selector(".nautilus-log-timing__energy-planned-value")
        reduced_before = read(reduced)
        open_plan(reduced)
        reduced.locator(".nautilus-log-timing__icon-button.is-complete").first.click()
        reduced.wait_for_timeout(80)
        reduced_after = read(reduced)
        screenshot(reduced, "08-reduced-motion.png")
        assert_readable(reduced_after, failures, "reduced")
        assert_true(reduced_after["confirming"] is False, "reduced: confirm class/animation applied", failures)
        assert_true(
            reduced_after["animationName"] in ("none", ""),
            f"reduced: animation {reduced_after['animationName']}",
            failures,
        )
        assert_true(reduced_after["reserveDuration"] == "0s", f"reduced: reserve duration {reduced_after['reserveDuration']}", failures)
        assert_true(reduced_after["committedDuration"] == "0s", f"reduced: committed duration {reduced_after['committedDuration']}", failures)
        assert_true(reduced_after["valueText"] != reduced_before["valueText"], "reduced: numbers did not update", failures)
        reduced.close()
        browser.close()

    (OUT / "results.json").write_text(json.dumps({"failures": failures}, indent=2), encoding="utf-8")
    if failures:
        print("FAILED")
        for item in failures:
            print(f"- {item}")
        return 1
    print("PASSED")
    print(f"artifacts: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
