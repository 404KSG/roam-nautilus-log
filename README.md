# Nautilus Log

> **Give every minute a job.**
>
> **给每一分钟分配一份工作。**

A transparent visual day planner for Roam Research that connects time blocking,
timeboxing, and optional Actual time tracking in one daily workflow.

[English](#english) · [中文](#中文)

## English

### Plan the day in time, not only in lists

A to-do list tells you what matters, but not whether it fits. A calendar protects
fixed commitments, but often becomes too rigid for flexible work. A timer records
reality, but usually starts only after the planning decision has already been made.

Nautilus Log connects these three views. It turns a plan on today's Daily Note into
a transparent spiral timeline, continuously moves unfinished work into the remaining
free time, and shows overload instead of silently hiding it.

Its rules are deterministic and inspectable. There is no black-box scheduler and
no AI-generated estimate: Roam block order expresses priority, written durations
express commitment, and the clock simply moves the plan forward.

### Why Nautilus Log

- **See whether the day fits.** Planned demand, remaining capacity, fixed events,
  overload, fragmented gaps, and work that will not fit remain visible.
- **Keep flexibility without losing structure.** Fixed events stay fixed; flexible
  tasks move forward around them as the day changes.
- **Connect estimates with reality.** Plan with low-friction estimates, then
  optionally record Actual time with compatible `LOGBOOK::` / `CLOCK:` blocks.
- **Focus without managing another app.** Clock In can bring the active task to
  the top of Roam's right sidebar and keep task switching inside Roam.
- **Learn from the day without building a heavy dashboard.** A lightweight daily
  Review compares Planned and Actual only where valid tracking data exists.
- **Keep the graph understandable.** Tasks, events, completion markers, and CLOCK
  history remain ordinary Roam blocks that you can inspect and edit.

### The time-management model

| Layer | Nautilus Log representation | Method | What it solves |
| --- | --- | --- | --- |
| Commitments | Fixed time ranges | Time blocking | Protects meetings, meals, routines, and other immovable time |
| Intentions | Ordered tasks with estimated durations | Timeboxing | Gives every flexible task a visible cost and place in the day |
| Reality | Optional `CLOCK:` sessions | Actual time tracking | Shows how long the work really took and improves future estimates |

This is deliberately a middle path. It is less rigid than manually dragging every
task into a calendar and less demanding than starting and stopping a timer for
everything. You can use Planned time alone for a low-friction day, or enable Actual
Time Tracking when precise feedback is worth the extra interaction.

### How the spiral works

1. Fixed events occupy their written time ranges first.
2. Unfinished direct-child TODO tasks are read in Roam block order.
3. Each task uses its written estimate, or the configured default duration.
4. From the current moment, tasks fill the available gaps between events.
5. As time passes, unfinished tasks move forward without changing their block order.
6. A task that cannot fit in one continuous gap moves to the next suitable gap.
7. Work that still cannot fit before the configured end time appears in
   **Today won't fit** instead of disappearing.

The spiral is a timeline, not a claim that it can measure human energy. It makes
the cost of a plan visible while leaving priority and estimation under your control.

### Reading the header

The header answers two questions: **What have I committed to?** and **How much
capacity remains?**

| Metric | Meaning |
| --- | --- |
| Planned | Total remaining flexible-task demand; the percentage is `Planned ÷ Available now` and is not capped at 100% |
| Remaining | Available time left after Planned demand |
| Overload | Demand that exceeds remaining available time |
| Fragmented | Time that exists in total, but not as a continuous gap large enough for an atomic task |
| Available | Flexible time remaining now / total flexible time in the configured day |
| Events | Fixed-event time remaining now / total fixed-event time in the configured day |

The small flame marks the type of time currently being consumed: Available time or
Event time. Overlapping events are counted as a union, so the same minute is never
counted twice.

### Quick start

1. Install **Nautilus Log** in Roam.
2. On today's Daily Note, type `;;` and choose **Nautilus Log**.
3. Add fixed events and TODO tasks as direct children of the component.
4. Put tasks in the order you want them attempted.
5. Adjust estimates until the header shows a day you are willing to commit to.

Example children:

```text
05:00-06:00 Morning routine
06:00-08:00 Fitness
{{[[TODO]]}} Write project brief 45m
{{[[TODO]]}} Review notes 30m
11:45-12:30 Lunch
13:00-13:30 Nap
18:00-19:00 Yoga + shower
20:00-21:00 Review
```

- A time range such as `11:45-12:30 Lunch` is a fixed event.
- An unfinished task such as `{{[[TODO]]}} Review notes 30m` is flexible.
- `30m`, `90m`, and `30min` are valid planning durations.
- An untimed task uses **Default Todo Duration**.
- The optional **Urgent Trigger Word** colors a matching task red; urgency changes
  emphasis, not scheduling order.

### A practical daily workflow

**At the start of the day**

1. Insert a fresh Nautilus Log on today's Daily Note.
2. Add routines, appointments, meals, and other fixed events.
3. Add only the work you may realistically do today, in priority order.
4. Give each task a rough duration and resolve overload before starting.

**During the day**

- Leave unfinished tasks in place; the plan moves them forward automatically.
- When something urgent arrives, insert or move it to the appropriate position and
  immediately see what it displaces.
- If Actual Time Tracking is enabled, Clock In to the task you are doing and switch
  focus from the Timing or Plan view.

**At the end of the day**

- Complete finished tasks and inspect **Today won't fit** for deliberate carryover.
- Open Review to compare Planned with Actual for properly tracked completed tasks.
- Create a new plan on the next Daily Note. Nautilus Log does not silently roll
  unfinished work into tomorrow; carryover remains an explicit decision.

### Optional Actual Time Tracking

Actual Time Tracking defaults to **off**. While disabled, Nautilus Log mounts no
topbar panel, timing poller, commands, or CLOCK writer. The visual planner works
fully from estimates alone.

When enabled, the Blueprint-native topbar panel provides three focused views:

| View | Purpose |
| --- | --- |
| Timing | Current Timing Line plus distinct recently closed tasks |
| Plan | Unfinished direct-child tasks from today's Primary Plan |
| Review | Today's direct-child tasks with Planned, Actual, and valid variance states |

Key behavior:

- The first Nautilus Log on today's Daily Note is the **Primary Plan** used by the panel.
- Only one CLOCK can run at a time. Switching closes the previous CLOCK and starts
  the next one at the same instant.
- Clock In opens or moves the active task to the top of Roam's right sidebar when
  **Keep Timing Line first in right sidebar** is enabled.
- Each row can Clock In/Out, complete the task, or—on the focused row—delete only
  the current open CLOCK with two-step confirmation.
- Recent retention defaults to 45 minutes; `0` disables Recent.
- The Pomodoro threshold defaults to 45 minutes. Reaching it changes the live
  signal but never stops work automatically, and switching tasks preserves the cycle.
- The forgotten-timer warning defaults to 120 minutes; `0` disables it. A warning
  never stops or deletes time automatically.

The panel paints its last confirmed snapshot first, keeps tab switching free of
graph reads, and begins native right-sidebar navigation before graph validation.
This keeps the most important interaction—starting focus—close to Roam's native
Shift+Click behavior even in a large graph.

### Planned and Actual time

Planned and Actual serve different jobs and are never treated as interchangeable
without evidence:

- An unfinished task is scheduled from its Planned estimate.
- A completed task with valid same-day CLOCK history uses the total Actual duration.
- Multiple sessions remain separate in `LOGBOOK::`, but the spiral combines their
  total into one historical slice; it does not draw artificial scattered fragments.
- Actual time is never capped at Planned time.
- If no Actual exists, a completed historical slice may fall back to Planned only
  when an explicit completion marker such as `d18:21` provides an anchor.
- Without an Actual end or explicit completion anchor, Nautilus Log does not invent
  a historical interval.
- Cross-midnight sessions contribute only the portion inside the displayed date.

Todo Trigger is optional. Its completion timestamp can provide the `dHH:MM` anchor,
but Nautilus Log does not require Todo Trigger for normal planning or completion.

### Daily Review

Review is intentionally daily and lightweight rather than a permanent analytics
dashboard:

- **Completed** counts completed direct-child tasks.
- **Compared** counts completed tasks with positive same-day Actual time.
- Planned, Actual, and Variance totals use only that same comparable subset.
- Live, Paused, Not tracked, and Not started remain visible at row level without
  turning missing tracking into a false zero.

This makes Review useful as an estimation feedback loop: compare what you expected
with what happened, then improve tomorrow's estimates.

### Visual language

- Red dot / red task: urgent.
- Yellow: fixed event.
- Blue: flexible task.
- Red needle: current time.
- Muted solid past slice: completed work.
- Muted yellow past slice: elapsed event.
- Hatched past slice: elapsed time without a recorded item.

Past gaps are factual schedule data, not a judgment that the time was “wasted.”
Unfinished tasks simply reflow forward; Nautilus Log does not create a separate
“missed task” category.

### Settings reference

| Setting | Default | Purpose |
| --- | --- | --- |
| Language | English | Switch the settings and rendered UI between `en` and `zh` |
| Chart Start Time | 05:00 | Start at 05:00, 06:00, 07:00, or 08:00 |
| Chart End Time | 21:00 | End from 18:00 through 24:00 |
| Component Prefix | `[[Nautilus Log]]` | Text inserted before a new component |
| Legend Max Length | 22 | Measure and truncate long external labels |
| Default Todo Duration | 15 minutes | Duration for an untimed flexible task |
| Urgent Trigger Word | Empty | Color matching tasks urgent red |
| Actual Time Tracking | Off | Load the execution panel and CLOCK writer |
| Keep Timing Line first | On | Front the active task in Roam's right sidebar |
| Pomodoro Threshold | 45 minutes | Change the live signal after continuous focus |
| Recent Retention | 45 minutes | Keep recently closed tasks in Timing; `0` disables |
| Forgotten Timer Warning | 120 minutes | Warn about a long open CLOCK; `0` disables |

At `24:00`, the last chart boundary is represented internally as minute 1440 and
labelled `0`. Events that cross midnight are clipped at today's boundary and shown
in the visible warning panel rather than silently scheduled into tomorrow.

### Commands and shortcuts

The Command Palette exposes:

- **Nautilus Log: Focus current block**
- **Nautilus Log: Clock out Timing Line**
- **Nautilus Log: Locate Primary Plan**

Bind them in **Roam Settings → Hotkeys**. Nautilus Log installs no conflicting
global keyboard listener. TODO block context menus also expose Clock In and Clock Out.

### Data, compatibility, and safety

Nautilus Log stores Actual time in compatible Org-style graph records:

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

- Disable the separate Roam Logbook extension before enabling Actual Time Tracking;
  Nautilus Log refuses to start when it detects a second CLOCK writer.
- The extension uses its own render UID, template, CSS namespace, runtime global,
  and per-instance collapse state.
- Multiple visual components can exist on a page; only the first on today's Daily
  Note becomes the execution panel's Primary Plan.
- Sidebar, breadcrumb, and collapsed replicas suppress expensive chart rendering.
- Disabling tracking first closes and confirms the active CLOCK. If confirmation
  fails, tracking remains enabled so uncertain state is not hidden.
- Unloading the extension does not rewrite or delete user blocks.

## 中文

### 不只是列任务，而是把任务真正放进时间里

待办清单告诉你“要做什么”，却不告诉你“今天是否放得下”；日历能保护固定承诺，
但把所有弹性任务都拖进日历又过于僵硬；计时器记录真实用时，却往往只在计划已经
做完之后才开始工作。

Nautilus Log 把这三种视角连接起来：它把今天 Daily Note 中的计划绘制成透明、动态的
螺旋时间线，从当前时刻开始把未完成工作放入剩余空档，并明确显示超载，
而不是让放不下的任务悄悄消失。

它的规则完全可检查、可预测。没有黑盒排程，也不会由 AI 擅自生成时长：Roam block
顺序表达优先级，用户填写的时长表达承诺，时钟只负责让计划随现实向前移动。

### 为什么使用 Nautilus Log

- **一眼看出今天是否放得下。** 已计划、余量、固定事件、超载、碎片空档和今日
  放不下的工作都会明确显示。
- **既有结构，又不失弹性。** 固定事件保持固定，弹性任务会随着时间经过自动绕开
  事件向后顺延。
- **把预计与现实连接起来。** 平时用预计时长低摩擦规划；需要精确反馈时，再开启
  兼容的 `LOGBOOK::` / `CLOCK:` 实际计时。
- **不离开 Roam 就能进入工作。** Clock In 可以把当前任务置顶到右侧边栏，任务切换、
  计时和完成都留在 Roam 内部。
- **得到反馈，但不背负沉重 Dashboard。** 每日 Review 只在存在有效数据时比较
  Planned 与 Actual，不把漏记时间误当成零分钟。
- **数据始终属于你的图谱。** 任务、事件、完成标记和 CLOCK 历史都是普通 Roam block，
  可以直接查看、编辑和引用。

### 三层时间管理模型

| 层级 | Nautilus Log 中的表达 | 方法 | 解决的问题 |
| --- | --- | --- | --- |
| 固定承诺 | 明确的起止时间 | Time Blocking 时间块 | 保护会议、吃饭、作息和其他不可移动时间 |
| 行动意图 | 按顺序排列并带预计时长的任务 | Timeboxing 时间盒 | 让每项弹性工作都有可见的时间成本和位置 |
| 真实执行 | 可选的 `CLOCK:` 计时段 | Actual Time Tracking | 看见真实用时，反过来校准下一次估算 |

这是一种刻意选择的折中：它比把每项任务手工拖进日历更灵活，也比所有事情都严格
开关计时器更轻。你可以只用 Planned 时长完成低摩擦规划；当真实反馈值得额外交互时，
再开启 Actual Time Tracking。

### 海螺图如何排程

1. 固定事件先占用它声明的时间范围。
2. 只读取组件下面尚未完成的直接子级 TODO，并保持 Roam block 顺序。
3. 每项任务使用自己填写的预计时长；未填写时使用默认时长。
4. 从当前时刻开始，把任务依次填入事件之间的可用空档。
5. 时间经过后，未完成任务自动向前推进，但不会改变原始优先顺序。
6. 如果一个完整任务放不进当前连续空档，就跳到下一个足够大的空档。
7. 到设定结束时间仍放不下的任务进入 **今日放不下**，不会消失。

螺旋图表达的是一天的时间线，不声称能够精确测量人的精力。它负责把计划的成本
变得可见，优先级和估算仍由你决定。

### 如何阅读顶部数据

顶部数据回答两个问题：**我承诺了多少？还剩多少容量？**

| 指标 | 含义 |
| --- | --- |
| 已计划 Planned | 剩余弹性任务总需求；百分比为 `已计划 ÷ 当前可安排时间`，超载时可超过 100% |
| 余量 Remaining | 安排完 Planned 后还剩多少可用时间 |
| 超载 Overload | 超出当前可用时间的任务需求 |
| 空档不足 Fragmented | 总时间看似足够，但没有任何连续空档能容纳某个完整任务 |
| 可安排 Available | 从现在起剩余弹性时间 / 所选完整时段的弹性时间总量 |
| 事件 Events | 从现在起剩余事件时间 / 所选完整时段的事件时间总量 |

小火焰表示当前正在消耗的是“可安排时间”还是“事件时间”。重叠事件按时间并集计算，
同一分钟不会被重复统计。

### 快速开始

1. 在 Roam 中安装 **Nautilus Log**。
2. 在今天的 Daily Note 输入 `;;`，选择 **Nautilus Log**。
3. 把固定事件和 TODO 作为组件的直接子级写在下面。
4. 按照希望执行的顺序排列任务。
5. 调整预计时长，直到顶部显示的是一个你愿意承诺的计划。

示例子清单：

```text
05:00-06:00 Morning routine
06:00-08:00 Fitness
{{[[TODO]]}} 撰写项目简报 45m
{{[[TODO]]}} 复习笔记 30m
11:45-12:30 Lunch
13:00-13:30 Nap
18:00-19:00 Yoga + shower
20:00-21:00 Review
```

- `11:45-12:30 Lunch` 这样的时间范围会被识别为固定事件。
- `{{[[TODO]]}} 复习笔记 30m` 是弹性任务。
- `30m`、`90m`、`30min` 都可以作为预计时长。
- 没有时长的任务使用 **Default Todo Duration**。
- 可选的 **Urgent Trigger Word** 会把匹配任务显示为红色；紧急色只改变强调程度，
  不会取代 block 顺序成为隐藏的排程规则。

### 推荐的每日工作流

**一天开始时**

1. 在今天的 Daily Note 插入一个新的 Nautilus Log。
2. 先写作息、预约、吃饭和其他固定事件。
3. 按优先顺序写入今天真正可能完成的任务。
4. 给每项任务一个粗略时长，并在开始前主动处理超载。

**一天进行中**

- 未完成任务保持原位，让计划自动随时间向后流动。
- 突发任务到来时，把它插入合适顺序，立即看见它挤掉了什么。
- 如果开启 Actual Time Tracking，就对正在做的任务 Clock In，并在 Timing 或 Plan
  中切换聚焦任务。

**一天结束时**

- 勾选已完成任务，检查 **今日放不下**，有意识地决定哪些任务需要结转。
- 打开 Review，只对有效计时的已完成任务比较 Planned 与 Actual。
- 第二天在新的 Daily Note 建立新计划。Nautilus Log 不会把未完成事项悄悄自动滚入
  明天，结转仍然是一个明确决定。

### 可选的实际时间记录

Actual Time Tracking 默认**关闭**。关闭时不会加载顶栏面板、计时轮询、命令或 CLOCK
写入者；只依赖预计时长的可视化规划仍可完整使用。

开启后，Blueprint 风格的顶栏面板提供三个聚焦视图：

| 视图 | 用途 |
| --- | --- |
| Timing | 当前 Timing Line，以及去重后的最近关闭任务 |
| Plan | 当天 Primary Plan 中尚未完成的直接子级任务 |
| Review | 当天直接子任务的 Planned、Actual 和有效偏差状态 |

核心交互：

- 当天 Daily Note 中出现的第一个 Nautilus Log 是面板使用的 **Primary Plan**。
- 任意时刻只运行一个 CLOCK；切换任务时，以同一时刻先关旧 CLOCK、再开新 CLOCK。
- 开启 **Keep Timing Line first in right sidebar** 后，Clock In 会打开或置顶右侧边栏任务。
- 每一行都可以 Clock In/Out 或完成任务；当前聚焦行还可通过两次确认，只删除本次
  未关闭 CLOCK，不删除任务或历史记录。
- Recent 默认保留 45 分钟；填写 `0` 可关闭。
- Pomodoro 阈值默认 45 分钟，只改变实时提示，不会自动停止；切换任务会保留同一周期。
- 遗忘计时提醒默认 120 分钟；填写 `0` 可关闭。提醒不会自动停止或删除时间。

面板会先显示最近一次确认的快照，切换 Timing / Plan / Review 不发起图谱读取；Clock In
在图谱校验前先启动 Roam 原生右侧边栏导航。即使图谱很大，最关键的“开始聚焦”交互也
尽可能接近原生 Shift+Click。

### Planned 与 Actual 如何配合

Planned 和 Actual 各自承担不同职责，只有存在证据时才会转换：

- 未完成任务始终使用 Planned 预计时长排程。
- 已完成任务如果存在当天有效 CLOCK，就使用 Actual 总时长。
- 多段 CLOCK 继续分别保留在 `LOGBOOK::`，海螺图只把总时长合并成一个历史切片，
  不绘制没有决策价值的零散片段。
- Actual 即使超过 Planned 也不会被截断。
- 没有 Actual 时，只有存在 `d18:21` 这类明确完成锚点，历史切片才会回退到 Planned。
- 没有 Actual 结束点，也没有明确完成锚点时，插件不会凭空制造历史区间。
- 跨午夜 CLOCK 只统计落在当前展示日期内的部分。

Todo Trigger 是可选工具。它追加的完成时间可以提供 `dHH:MM` 锚点，但普通规划、
勾选完成和海螺图绘制都不依赖 Todo Trigger。

### 每日 Review

Review 刻意保持轻量和当天范围，不做沉重的永久分析 Dashboard：

- **Completed** 统计已完成的直接子级任务。
- **Compared** 统计其中当天 Actual 大于 0 的已完成任务。
- Planned、Actual 和 Variance 总计只使用同一批可比任务。
- Live、Paused、Not tracked 和 Not started 仍显示在任务行中，但不会把漏记时间伪装成 0。

它的价值是形成估算反馈循环：看见原本以为需要多久、实际用了多久，再改进明天的估算。

### 视觉语言

- 红色圆点或红色任务：紧急。
- 黄色：固定事件。
- 蓝色：弹性任务。
- 红色指针：当前时间。
- 弱化实心历史切片：已完成工作。
- 弱黄色历史切片：已经过去的事件。
- 斜纹历史切片：没有记录事项的过去时间。

过去空档只是排程事实，不等于插件在判断那段时间“被浪费”。未完成任务只会继续向后
流动，不会被额外标记成“错过任务”。

### 设置速查

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| Language | English | 在 `en` 与 `zh` 之间切换设置和绘制界面 |
| Chart Start Time | 05:00 | 可选择 05:00、06:00、07:00 或 08:00 |
| Chart End Time | 21:00 | 可选择 18:00 至 24:00 |
| Component Prefix | `[[Nautilus Log]]` | 新组件前默认插入的文本 |
| Legend Max Length | 22 | 测量并截断过长的外部标签 |
| Default Todo Duration | 15 分钟 | 没有时长的弹性任务使用的默认值 |
| Urgent Trigger Word | 空 | 将匹配任务显示为紧急红色 |
| Actual Time Tracking | 关闭 | 加载执行面板与 CLOCK 写入 |
| Keep Timing Line first | 开启 | 把当前任务置顶到 Roam 右侧边栏 |
| Pomodoro Threshold | 45 分钟 | 连续聚焦到达阈值后改变实时提示 |
| Recent Retention | 45 分钟 | 在 Timing 保留最近任务；`0` 为关闭 |
| Forgotten Timer Warning | 120 分钟 | 提醒长时间未关闭 CLOCK；`0` 为关闭 |

选择 `24:00` 时，内部按第 1440 分钟处理，最后一根边界线标为 `0`。跨越午夜的事件
会在今天的边界截断并进入可见提醒，不会被悄悄排入明天。

### 命令与快捷键

命令面板提供：

- **Nautilus Log: Focus current block**
- **Nautilus Log: Clock out Timing Line**
- **Nautilus Log: Locate Primary Plan**

可以在 **Roam Settings → Hotkeys** 自行绑定快捷键。Nautilus Log 不安装可能冲突的
全局键盘监听；TODO block 右键菜单也提供 Clock In 与 Clock Out。

### 数据、兼容与安全

Nautilus Log 使用兼容的 Org 风格图谱记录保存 Actual：

```text
{{[[TODO]]}} Task 30m
  - LOGBOOK::
    - CLOCK: [2026-08-22 Sat 10:00]--[2026-08-22 Sat 10:18] => 0:18
```

- 开启 Actual Time Tracking 前请关闭独立的 Roam Logbook；检测到第二个 CLOCK 写入者时，
  Nautilus Log 会拒绝启动。
- 插件使用独立的渲染 UID、模板、CSS 命名空间、运行时全局变量和实例折叠状态。
- 一个页面可以存在多个可视组件；只有今天 Daily Note 中的第一个会成为执行面板的
  Primary Plan。
- 右侧边栏、面包屑和折叠路径副本会跳过昂贵的图表渲染。
- 关闭计时功能前会先关闭并确认活动 CLOCK；确认失败时保持开启，避免隐藏不确定状态。
- 卸载插件不会重写或删除用户 block。

## Credits and license

Nautilus Log is an independent fork of the Nautilus concept and retains the
original MIT license. Thanks to Tomas Barys for the spiral planner concept,
hopeserena for Nautilus Enhanced, and everyone who contributed fixes upstream.
