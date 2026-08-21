# ꩜ Nautilus Enhanced

[English](#english) | [中文](#中文)

---

<h2 id="english">English</h2>

**Nautilus Enhanced** is an optimized, high-performance daily planner extension for Roam Research, inspired by the original Nautilus created by Tomas Barys. 

### Acknowledgements
This project is an enhanced fork of the original [roam-depot-nautilus](https://github.com/tombarys/roam-depot-nautilus) repository. A huge thank you to the original author, **Tomas Barys**, for his brilliant concept of using a spiral timeline to visualize energy and tasks throughout the day! This *Enhanced* version introduces deep performance optimizations (eliminating memory leaks), fully localized bilingual Settings, Bezier curve typography connectors, and visual UI/UX spacing fixes.

### Quick Start Guide

**One-time Setup:**
1. Install **Nautilus Enhanced**.
2. (Optional but Recommended) Install [Todo Trigger](https://github.com/dvargas92495/roamjs-todo-trigger) from Roam Depot to automatically append timestamps to completed tasks.
3. Configure your preferences (including a 5, 6, 7, or 8 AM workday start, colors, and lengths) in the Settings panel.

**Daily Routine:**
1. Type `;;` and select `Nautilus Enhanced` to insert the spiral component into today's Daily Note.
2. Indent your tasks and meetings strictly underneath the component block.
3. **Events (Fixed time)**: Add a time range anywhere in the text (e.g., `12:30-14:00 Lunch`).
4. **Tasks (Flexible)**: Write your regular to-dos (e.g., `Read a book 30m`). If no time is set, they fall into the default setup.
5. Watch the red pointer act as your dynamic clock, pushing unfinished, un-timed tasks forward into the future as the day goes on!

---

<h2 id="中文">中文 (Chinese)</h2>

**Nautilus Enhanced（鹦鹉螺行程图增强版）** 是为 Roam Research 专门优化的每日行程与精力可视化插件。

### 致谢与鸣谢
本项目基于 **Tomas Barys** 开发的原生开源项目 [roam-depot-nautilus](https://github.com/tombarys/roam-depot-nautilus) 进行了深度重构与增强。非常感谢原作者卓越的设计理念（使用螺旋形状映射人在一天中不断衰减的精力曲线）。本“增强版”解决了原版的由于计时器导致的严重内存泄露问题，重新设计了具备原生中英双语的设置面板，优化了连接线的贝塞尔曲线动画以及汉字的精准排版，让它真正成为了一个高可用、高颜值的生产力工具。

### 极简使用教程

**首次配置（只需做一次）：**
1. 安装本插件。
2. （建议配合使用）在 Roam 商店中安装 [Todo Trigger](https://github.com/dvargas92495/roamjs-todo-trigger) 插件，以实现当你勾选 TODO 为 DONE 时，系统能自动在句尾打上完成时间戳。
3. 在插件设置页中，按你的习惯配置“工作开始时间”（支持 5、6、7、8 点）、“高亮触发词”、“默认时长”等内容。

**日常使用工作流：**
1. 每天在你的 **Daily Note（每日笔记）** 页面通过输入 `;;` 唤出模板菜单，选择 `Nautilus Enhanced` 组件。
2. 在渲染出的组件**下方缩进一级作为子块（Children Block）**，把你今天想做的事情全部列出来。
3. **固定日程**：在你记录的事项文字任何一处输入时间段（如：`12:30-14:00 午餐会议`），它就会被固定分配在表盘特定时段上。
4. **弹性待办**：直接记录没有写绝对时间的待办事项（如：`回复邮件 30m`，默认占据时长在设置里可调）。
5. **动态推移**：随着现实时间流逝，图表上的红色实时指针会无情地前进；所有没打勾的弹性待办事项，总是会被红针自动“推”到未来的空白时间段中。

享受免焦虑时间管理的乐趣吧！
