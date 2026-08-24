# Global and overnight chart windows

## Goal

Remove the fixed 05:00–08:00 start and 18:00–24:00 end restrictions without changing the default 05:00–21:00 experience. A Nautilus Log may begin at any whole hour and may continue through midnight into the next calendar day.

## Public behavior

- Chart Start Time offers 00:00–23:00.
- Chart End Time offers 01:00–24:00.
- An end hour at or before the start hour is labeled as next day and represented on one continuous timeline. For example, 21:00–02:00 becomes minute 1260–1560.
- A window may be at most 24 hours. Existing settings and render arguments remain valid.
- The Daily Note containing the component owns the whole window, including its next-day portion.
- Event ranges crossing midnight are continuous instead of being truncated at 24:00.

## Rendering and time model

All scheduling, capacity, elapsed, and hover calculations use continuous minutes relative to the owning Daily Note. Displayed clock labels wrap modulo 24. The spiral radius profile is based on elapsed hours from the configured start, which preserves the existing 05:00 default shape while making starts before 05:00 visible.

On the owning calendar date, the component behaves as today's plan. During the next-day carryover portion, the previous Daily Note remains interactive and its current minute is offset by 1440. Once the configured end is reached, that plan becomes historical.

## Compatibility and verification

The stored setting values remain numeric hours and the render argument order does not change. Tests cover 09:00 starts, midnight endings, 21:00–02:00 windows, next-day events, carryover current time, hour labels, radius indices, invalid values, and unchanged defaults.
