# Nautilus Flow

> **Give every minute a job.**
>
> **给每一分钟分配一份工作。**

[English](#english) · [中文](#中文)

## English

Nautilus Flow is a transparent, dynamic day-planning view for Roam Research. It
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

1. Install **Nautilus Flow**.
2. Type `;;` and choose **Nautilus Flow** from the template menu.
3. Put today's tasks as children of the rendered component.
4. Write a fixed event with a range such as `12:30-14:00 Lunch`.
5. Write a flexible task with an estimate such as `Read 30m`. Untimed tasks
   use the configured default duration.

Todo Trigger remains optional. It can append completion timestamps, but Flow
does not require it to draw the schedule.

### Settings

- Chart start: 05:00, 06:00, 07:00, or 08:00 (default 05:00).
- Chart end: 18:00 through 24:00 (default 24:00). Internally, 24:00 is minute
  1440 and the final boundary is labelled `0`.
- Default duration, label length, an optional urgent trigger word, and a
  bilingual settings panel.

The chart header reports the same three quantities every time:

`Available 3h20m · Demand 4h05m · Overload 45m`

The Chinese UI displays `可安排 · 待办需求 · 超载/余量`. If aggregate free time
exists but an atomic task cannot fit any continuous slot, it instead reports
`空档不足`. Future fixed events are subtracted from available time, and partially
completed tasks count only their remaining duration.

An event that crosses midnight is clipped at the selected day's `24:00`
boundary and shown in a visible warning panel; Flow does not silently schedule
the next day's portion.

When a completed task has an explicit `dHH:MM` completion marker, its historical
slice ends at that time and starts by subtracting the original estimate. For
example, a 60-minute task completed at 21:50 is shown as 20:50–21:50, regardless
of when the previous task ended. A `DONE` item without `dHH:MM` produces no
inferred historical interval; an untimed task uses the configured default
duration.

The legend is intentionally minimal: a red dot means **urgent**, yellow means
**event**, and blue means **task**. The red line is the current-time pointer.
Past time on today's page is subdued so the remaining day stays readable.

### Compatibility and safety

Nautilus Flow uses its own render UID, template, CSS namespace, runtime global,
and local collapse-state key. It can be tested beside Nautilus Enhanced. It
does not perform a graph-wide replacement or rewrite old Nautilus blocks.
Unloading the extension leaves user blocks untouched.

## 中文

Nautilus Flow（鹦鹉螺时间流）是一个面向 Roam Research 的透明动态日程视图。
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

1. 安装 **Nautilus Flow**。
2. 输入 `;;`，在模板菜单中选择 **Nautilus Flow**。
3. 将今天的任务缩进放在渲染组件下面。
4. 固定事件可以写成 `12:30-14:00 午餐`。
5. 弹性任务可以写成 `阅读 30m`；没有写时长的任务使用设置中的默认时长。

Todo Trigger 仍然是可选工具：它可以在完成时追加时间戳，但 Flow 不依赖它才能绘图。

### 设置

- 图表开始时间：5、6、7、8 点（默认 5 点）。
- 图表结束时间：18 点至 24 点（默认 24 点）。内部将 24 点表示为第 1440 分钟，
  最后一根边界线标为 `0`。
- 默认待办时长、标签长度、可选的紧急触发词，以及中英文设置面板。

图表上方显示：

`可安排 3h20m · 待办需求 4h05m · 超载 45m`

如果没有超载，最后一项显示为“余量”；如果总空闲时间足够、但某个完整任务无法放进
任何连续空档，则显示“空档不足”。未来固定事件会从可安排时间中扣除，部分完成的
任务只计算剩余时长。

跨越午夜的固定事件会在当天 `24:00` 截断，并进入可见的时间范围提醒；Flow 不会
悄悄把次日部分排进今天。

已完成任务如果带有明确的 `d小时:分钟` 完成时间标记，历史切片以该时间结束，
并按任务原始预计时长倒推开始时间。例如，预计 60 分钟、21:50 完成的任务会显示为
20:50–21:50，不会根据上一个任务的完成时间推断开始。没有 `d小时:分钟` 的 DONE
事项不会制造推断出的历史区间；未填写时长的任务使用设置中的默认时长。

图例保持简洁：红色圆点表示“紧急”，黄色表示“事件”，蓝色表示“任务”。
红色细线代表当前时间，不额外加入 NOW 图标。今天已经过去的时间会降低视觉权重。

### 兼容与安全

Nautilus Flow 使用独立的渲染 UID、模板、CSS 命名空间、运行时全局变量和折叠状态键，
可以与 Nautilus Enhanced 并行测试。它不会全图替换或重写旧 Nautilus block，插件卸载时
也不会修改用户 block。

## Credits and license

Nautilus Flow is an independent fork of the Nautilus concept and retains the
original MIT license. Thanks to Tomas Barys for the spiral planner concept,
hopeserena for Nautilus Enhanced, and everyone who contributed fixes upstream.
