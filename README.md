# Nautilus Log

> **Give every minute a job.**
>
> **给每一分钟分配一份工作。**

[English](#english) · [中文](#中文)

## English

Nautilus Log is a transparent, dynamic day-planning view for Roam Research. It
starts from the current moment on today's Daily Note, places unfinished work in
the remaining free time, and makes overload visible instead of silently
dropping tasks.

The spiral is a visual timeline, not a claim that it can measure human energy.
Its scheduling rules are deliberately simple and inspectable:

- fixed events occupy their stated time first;
- flexible tasks are placed in Roam block order;
- completed work is excluded from today's demand;
- unfinished work moves forward as the clock advances;
- work that cannot fit before the selected end time appears in the dashed
  **Today won't fit** section.

### Quick start

1. Install **Nautilus Log**.
2. Type `;;` and choose **Nautilus Log** from the template menu.
3. Put today's tasks as children of the rendered component.
4. Write a fixed event with a range such as `12:30-14:00 Lunch`.
5. Write a flexible task with an estimate such as `Read 30m`. Untimed tasks
   use the configured default duration.

Todo Trigger remains optional. It can append completion timestamps, but Log
does not require it to draw the schedule.

### Settings

- Chart start: 05:00, 06:00, 07:00, or 08:00 (default 05:00).
- Chart end: 18:00 through 24:00 (default 21:00). If selected, 24:00 is minute
  1440 and the final boundary is labelled `0`.
- Component prefix defaults to `[[Nautilus Log]]`, so the active daily plan is
  easy to find and navigate.
- Default duration, label length, an optional urgent trigger word, and a
  bilingual settings panel.
- Language defaults to English on a fresh or upgraded preview install; select
  `zh` only when a Chinese interface is preferred. That choice is then preserved.

### Optional Actual Time Tracking

Actual Time Tracking defaults to **off**. While it is off, Nautilus Log does not
mount a topbar trigger or panel, run a timing poller, register timer commands, or
write `CLOCK:` records. Enabling it adds a compact execution layer without
changing the spiral's estimated scheduling rules:

- the first Nautilus Log component on today's Daily Note is the Primary Plan;
- Plan shows only unfinished direct-child TODO blocks, in Roam order;
- one `CLOCK:` can run at a time, and switching closes the old task before
  starting the new task at the same instant;
- Timing shows the focused task plus distinct recently closed tasks. Recent
  retention is a numeric minute setting (45 by default; 0 disables Recent),
  and each Recent row shows its remaining retention time;
- Clock In begins opening or moving the selected task to the top of Roam's
  native right sidebar before graph validation or CLOCK confirmation; previously
  confirmed windows are previewed immediately and reconciled in the background;
- each row can Clock In, explicitly Clock Out with Blueprint's `log-out`
  control, or complete the task with Blueprint's filled `tick-circle` control,
  whose check is rendered as negative white space. The
  focused row also has a two-click `trash` action that deletes only its current
  open CLOCK, never the task or older CLOCK history;
- Actual time is shown when today's CLOCK history exists; otherwise the row
  falls back to its Planned estimate;
- the shared Pomodoro threshold defaults to 45 minutes, survives task switches,
  turns the live elapsed value red, and never stops work automatically.
- the forgotten-timer threshold is a separate numeric setting (120 minutes by
  default; 0 disables it) that marks an unusually long open CLOCK in the
  topbar and Timing row without stopping or deleting it.

The idle topbar entry uses Blueprint's native `unresolve` icon. The `locate` action
opens the Primary Plan in Roam's main window. Task titles open in the main
window; Shift+Click opens them in the right sidebar. The Command Palette exposes
**Nautilus Log: Focus current block**, **Nautilus Log: Clock out Timing Line**,
and **Nautilus Log: Locate Primary Plan**. Assign any preferred shortcuts in
**Roam Settings → Hotkeys**; Nautilus Log installs no conflicting global key
listener. TODO block context menus also expose Clock In and Clock Out.

The panel paints its last confirmed snapshot immediately, refreshes graph data
after the first browser paint, and updates only live elapsed text on one-second
ticks. Timing/Plan switching therefore performs no graph scan or full-list
rebuild. Disabling tracking first closes and confirms any running CLOCK; if
that cannot be confirmed, tracking remains enabled so uncertain graph state is
never hidden. Disabling also unregisters all Nautilus Log timing commands and
context-menu actions.

Nautilus Log reads and writes the compatible Org-style graph record:

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

Disable the separate Roam Logbook extension before enabling this layer. Nautilus
Log refuses to start a second CLOCK writer when it detects that runtime.

The chart header puts the changing remainder beside a stable full-day baseline:

`Planned 1h45m / 19% · Remaining 5h46m · Available 7h31m / 9h · Events 3h15m / 7h`

For Available and Events, the value before `/` is the time still remaining from
now; the muted value after `/` is the full configured-day total and stays stable
as the clock advances. Full-day event time uses the union of fixed intervals, so
overlapping events are not double-counted. Full-day available time is the selected
chart range minus that event union. The planning pair (`Planned · Remaining` or
warning) is shown first, followed by its capacity inputs (`Available · Events`).
The Chinese UI uses the same order. If aggregate free time exists but an atomic task cannot fit any
continuous slot, it instead reports `空档不足`. Partially completed tasks count
only their remaining duration.

An event that crosses midnight is clipped at the selected day's `24:00`
boundary and shown in a visible warning panel; Log does not silently schedule
the next day's portion.

When a completed task has an explicit `dHH:MM` completion marker, its historical
slice ends at that time and starts by subtracting the original estimate. For
example, a 60-minute task completed at 21:50 is shown as 20:50–21:50, regardless
of when the previous task ended. A `DONE` item without `dHH:MM` produces no
inferred historical interval; an untimed task uses the configured default
duration.

The legend is intentionally minimal: a red dot means **urgent**, yellow means
**event**, and blue means **task**. The red line is the current-time pointer.
Past time on today's page stays subdued, but it no longer collapses into one
undifferentiated gray: completed work uses a muted solid fill, elapsed events
retain a muted yellow, and elapsed gaps without a recorded item use diagonal
hatching. Unfinished flexible tasks simply reflow forward; Log does not add a
separate “missed” state. An unplanned gap is factual schedule data, not a claim
that the time was wasted.

### Compatibility and safety

Nautilus Log uses its own render UID, template, CSS namespace, runtime global,
and local collapse-state key. It can be tested beside Nautilus Enhanced. It
does not perform a graph-wide replacement or rewrite old Nautilus blocks.
Unloading the extension leaves user blocks untouched.

## 中文

Nautilus Log（鹦鹉螺时间流）是一个面向 Roam Research 的透明动态日程视图。
它从今天的此刻开始，将未完成任务放入剩余空闲时间，并把时间超载明确显示出来，
而不是让任务悄悄消失。

螺旋图表达的是一天的时间轴，不声称能够准确测量人的精力。排程规则保持简单、
可理解、可预测：

- 固定事件优先占用它声明的时间；
- 弹性任务按照 Roam block 顺序安排；
- 已完成事项不再计入今日需求；
- 时间流逝后，未完成任务向未来空闲时段移动；
- 在选定结束时间前放不下的任务，显示在虚线“今日放不下”区域。

### 快速开始

1. 安装 **Nautilus Log**。
2. 输入 `;;`，在模板菜单中选择 **Nautilus Log**。
3. 将今天的任务缩进放在渲染组件下面。
4. 固定事件可以写成 `12:30-14:00 午餐`。
5. 弹性任务可以写成 `阅读 30m`；没有写时长的任务使用设置中的默认时长。

Todo Trigger 仍然是可选工具：它可以在完成时追加时间戳，但 Log 不依赖它才能绘图。

### 设置

- 图表开始时间：5、6、7、8 点（默认 5 点）。
- 图表结束时间：18 点至 24 点（默认 21 点）。选择 24 点时，内部将其表示为第 1440 分钟，
  最后一根边界线标为 `0`。
- 组件前缀默认使用 `[[Nautilus Log]]`，便于定位每天的主计划。
- 默认待办时长、标签长度、可选的紧急触发词，以及中英文设置面板。
- 首次安装或升级预览版时默认显示英文；需要中文界面时，在 Language 设置中选择
  `zh`，选择后会持续保留。

### 可选的实际时间记录

“实际时间记录”默认**关闭**。关闭时，Nautilus Log 不会挂载任何顶栏入口或面板，
不会运行计时轮询、注册计时命令，也不会写入 `CLOCK:`。开启后才会加载精简执行层：

- 当天 Daily Note 中按 Roam 顺序出现的第一个 Nautilus Log 是 Primary Plan；
- Plan 只显示它的直接子级、尚未完成的 TODO，不提供父子层级折叠；
- 任意时刻只允许一个 CLOCK；切换任务时，用同一时刻先关旧任务、再启动新任务；
- Timing 显示当前聚焦任务和最近离开的去重任务；Recent 保留时间使用数字分钟设置，
  默认 45，填写 0 可关闭，并在每一行显示剩余保留时间；
- Clock In 会在图谱校验与 CLOCK 确认前开始打开或置顶右侧边栏任务；已确认过的窗口会先
  即时显示，再在后台按 Roam 的真实窗口列表去重；
- 每一行都可以直接 Clock In、用 Blueprint `log-out` 明确 Clock Out，或用更饱满的
  `tick-circle` 图标完成任务；圆形主体沿用灰色，内部勾以白色留白呈现。当前 Timing
  行还提供两次点击确认的 `trash`，只删除本次
  未闭合 CLOCK，不删除任务和旧历史；
- 当天存在有效 CLOCK 时显示 Actual，否则回退到 Planned 预计时长；
- 番茄钟阈值默认 45 分钟，任务切换不会重置，达到阈值只把顶栏计时变红，绝不自动停止。
- 遗忘计时阈值是独立的数字设置，默认 120 分钟，填写 0 可关闭；达到阈值只在顶栏和
  Timing 行显示警告，不会自动停止或删除 CLOCK。

空闲时使用 Blueprint 原生 `unresolve` 图标；`locate` 会把当天 Primary Plan 定位到主界面。
点击任务标题在主界面打开，Shift+Click 在右侧边栏打开。命令面板提供“聚焦当前
block”“Clock out Timing Line”和“定位 Primary Plan”三项操作，可在 **Roam Settings
→ Hotkeys** 自行绑定快捷键；插件不会安装可能冲突的全局按键监听。TODO 右键菜单也会
提供 Clock In 和 Clock Out。

面板先立即显示最近一次确认的缓存，再在浏览器完成首帧后刷新图谱。每秒 tick 只更新
计时文字，不重建整个任务列表，因此 Timing/Plan 切换不再触发图谱扫描，也不会与整表
重绘竞争。

关闭开关前会先关闭并确认运行中的 CLOCK；如果确认失败，开关会保持开启，避免把不确定
状态藏起来。开启前请先关闭独立的 Roam Logbook 插件，Nautilus Log 检测到第二个
CLOCK 写入者时会拒绝启动。

图表上方把动态变化的剩余时间与当天稳定基准放在一起显示：

`可安排 7h31m / 9h · 事件 3h15m / 7h · 已计划 1h45m / 19%`

“可安排”和“事件”中，斜杠左侧是从现在起还剩多少，右侧弱化显示所选完整时间范围
内的当日总量，并且不会随着时钟推进而改变。事件重叠时按时间并集计算，不会重复统计；
可安排总量等于完整时间范围减去事件并集。如果没有超载，最后一项显示为“余量”；
如果总空闲时间足够、但某个完整任务无法放进任何连续空档，则显示“空档不足”。
部分完成的任务只计算剩余时长。

跨越午夜的固定事件会在当天 `24:00` 截断，并进入可见的时间范围提醒；Log 不会
悄悄把次日部分排进今天。

已完成任务如果带有明确的 `d小时:分钟` 完成时间标记，历史切片以该时间结束，
并按任务原始预计时长倒推开始时间。例如，预计 60 分钟、21:50 完成的任务会显示为
20:50–21:50，不会根据上一个任务的完成时间推断开始。没有 `d小时:分钟` 的 DONE
事项不会制造推断出的历史区间；未填写时长的任务使用设置中的默认时长。

图例保持简洁：红色圆点表示“紧急”，黄色表示“事件”，蓝色表示“任务”。
红色细线代表当前时间，不额外加入 NOW 图标。今天已经过去的时间会降低视觉权重，
但不再全部混成同一种灰色：已完成事项使用灰色实心，已过去事件保留弱黄色，
未记录事项的过去空档使用斜纹。未完成的弹性任务只会继续向后顺延，不再增加
“错过”状态。这里的“未安排”只陈述排程事实，插件不会直接把它判断为“浪费”。

### 兼容与安全

Nautilus Log 使用独立的渲染 UID、模板、CSS 命名空间、运行时全局变量和折叠状态键，
可以与 Nautilus Enhanced 并行测试。它不会全图替换或重写旧 Nautilus block，插件卸载时
也不会修改用户 block。

## Credits and license

Nautilus Log is an independent fork of the Nautilus concept and retains the
original MIT license. Thanks to Tomas Barys for the spiral planner concept,
hopeserena for Nautilus Enhanced, and everyone who contributed fixes upstream.
