# Shared calendar

All editable date fields and date-range filters use `CalendarPicker.jsx`: the trip board, accounting periods/history, Analytics, finance documents/payments/recurring charges and PDF period editors.

`DateRangePicker` accepts `{from,to}` and applies its draft with the View button. Clear resets both dates. Accounting's `periodForDate` callback continues to derive a complete week/month from a selected day. `allowClear=false` preserves required periods.

`DatePicker` supplies a date-only text field with the same calendar. It forwards controlled value changes as `event.target.value`, and preserves required, disabled, read-only, name and min/max behavior. Manual entry uses `YYYY-MM-DD`; real-date/bounds validation uses browser form validity. No browser-specific native date popup is used.

Calendar days, weekdays and month labels are computed/formatted as UTC date-only values so app/browser timezone offsets cannot move a calendar header into the previous month. Today follows the workspace display timezone. Month/day movement is bounded to years 0001–9999.

The 320 px popup uses shared workspace tokens, including light/dark selection contrast and 14 px controls. It portals into the active modal or body and stays within the viewport. Arrow keys, Home/End and PageUp/PageDown move focus. Escape cancels the popup draft and restores the trigger; an enclosing modal receives the next Escape. Pointer/focus outside closes without applying.

Checks: `node --test src/components/calendarModel.test.js`; `npx playwright test --config playwright.calendar.config.js`; financial/settlement UI suites and the build.
