#!/usr/bin/env python3
"""Local today-plan launcher and create-mode trigger checks. No real Roam graph."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path("/tmp/nautilus-today-plan-verify")
CSS = ROOT / "extension.css"


def assert_true(condition, message, failures):
    if not condition:
        failures.append(message)


def write_html(path: Path) -> None:
    path.write_text(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Nautilus today plan launcher</title>
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


def trigger_info(page):
    return page.evaluate(
        """() => {
          const trigger = document.querySelector('.nautilus-log-timing__trigger');
          const track = document.querySelector('.nautilus-log-timing__energy-track');
          const label = document.querySelector('.nautilus-log-timing__create-label');
          const cs = trigger ? getComputedStyle(trigger) : null;
          const trackCs = track ? getComputedStyle(track) : null;
          return {
            height: cs ? cs.height : null,
            text: trigger ? trigger.textContent : '',
            aria: trigger ? trigger.getAttribute('aria-label') : '',
            labelText: label ? label.textContent : '',
            labelInsideTrack: Boolean(track && label && track.contains(label)),
            hasTrack: Boolean(track),
            trackDisplay: trackCs ? trackCs.display : null,
            trackHeight: trackCs ? trackCs.height : null,
            outlineSlot: Boolean(document.querySelector('.nautilus-log-timing__create-slot')),
            disabled: Boolean(trigger && trigger.disabled),
          };
        }"""
    )


def energy_info(page):
    return page.evaluate(
        """() => {
          const track = document.querySelector('.nautilus-log-timing__energy-track');
          const reserve = document.querySelector('.nautilus-log-timing__energy-reserve');
          const committed = document.querySelector('.nautilus-log-timing__energy-committed');
          const value = document.querySelector('.nautilus-log-timing__energy-planned-value');
          const cs = (el) => el ? getComputedStyle(el) : null;
          const trackCs = cs(track);
          return {
            trackWidth: trackCs ? trackCs.width : null,
            trackHeight: trackCs ? trackCs.height : null,
            radius: trackCs ? trackCs.borderRadius : null,
            reserveBg: cs(reserve) && cs(reserve).backgroundColor,
            committedBg: cs(committed) && cs(committed).backgroundColor,
            reserveDuration: cs(reserve) && cs(reserve).transitionDuration,
            valueText: value ? value.textContent : '',
            hidden: Boolean(track && track.hidden),
          };
        }"""
    )


def bundle() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(
        ["node", str(ROOT / "test" / "today-plan-bundle.js"), str(OUT)],
        cwd=str(ROOT),
    )
    write_html(OUT / "index.html")


def run() -> int:
    bundle()
    failures: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda error: failures.append(f"browser error: {error}"))
        page.goto((OUT / "index.html").as_uri())
        page.wait_for_function("() => window.todayPlanHarness && window.todayPlanHarness.mountLauncher")

        page.evaluate("() => todayPlanHarness.mountLauncher({ status: 'ready-absent', language: 'zh' })")
        page.wait_for_selector(".nautilus-log-timing__trigger")
        absent = trigger_info(page)
        screenshot(page, "01-absent-create.png")
        assert_true(absent["height"] == "30px", f"absent: height {absent['height']}", failures)
        assert_true("创建今日计划" in (absent["aria"] or ""), f"absent: aria {absent['aria']!r}", failures)
        assert_true(absent["labelInsideTrack"] is False, "absent: create label inside energy-track", failures)
        assert_true(absent["outlineSlot"] is False, "absent: fake outline slot", failures)
        assert_true(absent["hasTrack"] is False, "absent: energy track present on launcher", failures)

        page.evaluate("() => todayPlanHarness.mountTopbar({ status: 'ready-absent', energyBarEnabled: true })")
        page.wait_for_selector(".nautilus-log-timing__create-label")
        top_absent = trigger_info(page)
        assert_true(top_absent["height"] == "30px", f"top-absent: height {top_absent['height']}", failures)
        assert_true("Create today's plan" in (top_absent["aria"] or ""), f"top-absent: aria {top_absent['aria']!r}", failures)
        page.locator(".nautilus-log-timing__trigger").click()
        page.wait_for_selector(".nautilus-log-timing__energy-track")
        after = energy_info(page)
        screenshot(page, "02-after-create-energy.png")
        assert_true(after["trackWidth"] == "136px", f"after: width {after['trackWidth']}", failures)
        assert_true(after["trackHeight"] == "6px", f"after: height {after['trackHeight']}", failures)
        assert_true(after["radius"] == "999px", f"after: radius {after['radius']}", failures)
        assert_true(after["reserveBg"] == "rgb(92, 112, 128)", f"after: reserve {after['reserveBg']}", failures)
        assert_true(after["committedBg"] == "rgb(168, 207, 186)", f"after: committed {after['committedBg']}", failures)
        assert_true(after["reserveDuration"] == "0.36s", f"after: duration {after['reserveDuration']}", failures)
        assert_true(after["valueText"] != "", "after: planned reading missing", failures)
        assert_true(after["hidden"] is False, "after: energy track hidden", failures)

        page.evaluate("() => todayPlanHarness.mountTopbar({ status: 'ready-absent', clock: true, energyBarEnabled: false })")
        page.wait_for_selector(".nautilus-log-timing__elapsed")
        clock = page.evaluate(
            """() => ({
              elapsed: Boolean(document.querySelector('.nautilus-log-timing__elapsed')),
              createOnTrigger: Boolean(document.querySelector('.nautilus-log-timing__trigger .nautilus-log-timing__create-label')),
            })"""
        )
        screenshot(page, "03-clock-absent.png")
        assert_true(clock["elapsed"] is True, "clock: elapsed missing", failures)
        assert_true(clock["createOnTrigger"] is False, "clock: create label covered timer", failures)
        page.locator(".nautilus-log-timing__trigger").click()
        page.wait_for_selector(".nautilus-log-timing__popover")
        page.get_by_role("tab", name="Plan").click()
        assert_true(
            page.locator(".nautilus-log-timing__plan-create").count() == 1,
            "clock: create CTA missing from Plan empty",
            failures,
        )

        for mode in ("clock", "pomo"):
            page.evaluate("mode => todayPlanHarness.mountTopbar({ status: 'ready-absent', [mode]: true, energyBarEnabled: true })", mode)
            assert_true(page.locator(".nautilus-log-timing__elapsed").is_visible(), f"{mode}: energy mode hid timer without a plan", failures)
            page.locator(".nautilus-log-timing__trigger").click()
            page.get_by_role("tab", name="Plan").click()
            assert_true(page.locator(".nautilus-log-timing__plan-create").is_visible(), f"{mode}: missing Plan CTA", failures)
            if mode == "pomo":
                assert_true(page.locator(".nautilus-log-timing__pomodoro-close").is_visible(), "pomo: stop control hidden", failures)

        for mount in ("mountLauncher", "mountTopbar"):
            page.evaluate("mount => todayPlanHarness[mount]({ status: 'checking' })", mount)
            assert_true(page.locator(".nautilus-log-timing__trigger").is_disabled(), f"{mount}: checking is actionable", failures)
            page.evaluate("mount => todayPlanHarness[mount]({ status: 'read-failed' })", mount)
            page.locator(".nautilus-log-timing__trigger").click()
            page.get_by_role("button", name="Check again", exact=True).click()
            page.wait_for_function("() => todayPlanHarness.api.discoverCalls().length === 1")
            assert_true(page.evaluate("() => todayPlanHarness.api.ensureCalls().length") == 0, f"{mount}: read retry tried to create", failures)
            assert_true(page.evaluate("() => todayPlanHarness.api.discoverCalls().length") == 1, f"{mount}: retry did not re-read", failures)

        page.evaluate("() => todayPlanHarness.mountTopbar({ status: 'read-failed' })")
        failed = trigger_info(page)
        screenshot(page, "04-read-failed.png")
        assert_true("Create today's plan" not in (failed["aria"] or ""), f"failed: create CTA {failed['aria']!r}", failures)
        page.locator(".nautilus-log-timing__trigger").click()
        if page.locator(".nautilus-log-timing__popover").count():
            page.get_by_role("tab", name="Plan").click()
            assert_true(
                page.locator(".nautilus-log-timing__plan-create").count() == 0,
                "failed: create button in Plan",
                failures,
            )

        page.evaluate("() => todayPlanHarness.mountTopbar({ status: 'ready-present', tasks: [] })")
        page.locator(".nautilus-log-timing__trigger").click()
        page.wait_for_selector(".nautilus-log-timing__popover")
        page.get_by_role("tab", name="Plan").click()
        empty = page.locator(".nautilus-log-timing__empty").inner_text()
        screenshot(page, "05-present-empty.png")
        assert_true("Create today's plan" not in empty, f"present-empty: create CTA {empty!r}", failures)
        assert_true("no unfinished" in empty.lower() or "noPlanTasks" not in empty, f"present-empty: {empty!r}", failures)

        page.evaluate("() => todayPlanHarness.mountLauncher({ status: 'ready-absent' })")
        page.evaluate("""() => {
          const host = document.getElementById('nautilus-log-timing-topbar');
          host.dataset.density = 'icon';
        }""")
        icon = trigger_info(page)
        screenshot(page, "06-icon-density.png")
        assert_true(icon["height"] == "30px", f"icon: height {icon['height']}", failures)
        page.locator(".nautilus-log-timing__trigger").click()
        assert_true(
            page.evaluate("() => todayPlanHarness.api.ensureCalls().length") >= 1,
            "icon: click did not reach ensureToday",
            failures,
        )

        page.close()
        reduced = browser.new_page(viewport={"width": 1280, "height": 720})
        reduced.on("pageerror", lambda error: failures.append(f"reduced-motion browser error: {error}"))
        reduced.emulate_media(reduced_motion="reduce")
        reduced.goto((OUT / "index.html").as_uri())
        reduced.wait_for_function("() => window.todayPlanHarness && window.todayPlanHarness.mountLauncher")
        reduced.evaluate("() => todayPlanHarness.mountLauncher({ status: 'ready-absent' })")
        reduced.wait_for_selector(".nautilus-log-timing__trigger")
        reduced_info = trigger_info(reduced)
        screenshot(reduced, "07-reduced-motion.png")
        assert_true(reduced_info["height"] == "30px", f"reduced: height {reduced_info['height']}", failures)
        reduced.locator(".nautilus-log-timing__trigger").focus()
        reduced.keyboard.press("Enter")
        assert_true(
            reduced.evaluate("() => todayPlanHarness.api.ensureCalls().length") >= 1,
            "reduced: keyboard did not activate",
            failures,
        )
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
