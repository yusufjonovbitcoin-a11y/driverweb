import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localeTag } from '../i18n/locales';
import { displayDayKey } from '../i18n/timeZone';
import { calendarDate, calendarDays, calendarMonth, calendarRange, formatCalendarDay, shiftCalendarDay, shiftCalendarMonth, validCalendarDay } from './calendarModel.js';
import './calendar-picker.css';

function CalendarPicker({ range, onPick, mode, title, hint, className = '', iconOnly = false, triggerLabel, allowClear = true, periodForDate, min, max, disabled = false, readOnly = false, fieldProps }) {
  const { t, i18n } = useTranslation(), locale = localeTag(i18n.resolvedLanguage || i18n.language), id = useId();
  const root = useRef(null), popup = useRef(null), trigger = useRef(null), input = useRef(null), cells = useRef(new Map());
  const [open, setOpen] = useState(false), [portal, setPortal] = useState(null);
  const [draft, setDraft] = useState(range), [choosingEnd, setChoosingEnd] = useState(false);
  const [today, setToday] = useState(() => displayDayKey(new Date()));
  const [month, setMonth] = useState(() => calendarMonth(calendarDate(range.from) ? range.from : displayDayKey(new Date())));
  const [focusedDay, setFocusedDay] = useState(range.from || today), [keyboardFocus, setKeyboardFocus] = useState(false);
  const [position, setPosition] = useState({ top: 12, left: 12 });
  const heading = title || t(mode === 'range' ? 'loads.tripDate' : 'calendar.title');
  const isField = Boolean(fieldProps);
  const unavailable = () => disabled || readOnly || Boolean(input.current?.matches(':disabled')) || Boolean(trigger.current?.matches(':disabled'));
  const close = useCallback((restoreFocus = false) => { setOpen(false); if (restoreFocus) (isField ? input.current : trigger.current)?.focus(); }, [isField]);
  function show(focusGrid = false) {
    if (unavailable()) return;
    if (open) { close(); return; }
    let day = calendarDate(range.from) ? range.from : displayDayKey(new Date());
    if (calendarDate(min) && day < min) day = min;
    if (calendarDate(max) && day > max) day = max;
    setToday(displayDayKey(new Date())); setDraft(range); setChoosingEnd(false); setMonth(calendarMonth(day)); setFocusedDay(day); setKeyboardFocus(focusGrid === true);
    setPortal(root.current.closest('dialog,[role="dialog"],.ds-modal') || document.body); setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open) return;
    const align = () => {
      const rect = (isField ? input.current : trigger.current)?.getBoundingClientRect(), box = popup.current?.getBoundingClientRect();
      if (!rect || !box) return;
      const left = Math.max(12, Math.min(rect.right - box.width, window.innerWidth - box.width - 12));
      const below = window.innerHeight - rect.bottom;
      const top = below < box.height + 8 && rect.top > below ? rect.top - box.height - 8 : rect.bottom + 8;
      setPosition(previous => previous.top === Math.max(12, Math.min(top, window.innerHeight - box.height - 12)) && previous.left === left ? previous : { left, top: Math.max(12, Math.min(top, window.innerHeight - box.height - 12)) });
    };
    align(); window.addEventListener('resize', align); window.addEventListener('scroll', align, true);
    return () => { window.removeEventListener('resize', align); window.removeEventListener('scroll', align, true); };
  }, [open, month, isField, draft.from, draft.to]);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target) && !popup.current?.contains(event.target)) close(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape, true); };
  }, [open, close]);
  useLayoutEffect(() => { if (open && keyboardFocus) cells.current.get(focusedDay)?.focus(); }, [open, month, focusedDay, keyboardFocus]);
  useLayoutEffect(() => {
    if (isField) input.current?.setCustomValidity(range.from && !validCalendarDay(range.from, min, max) ? t('calendar.invalid') : '');
  }, [isField, range.from, min, max, t]);
  function choose(day) {
    if (unavailable() || !validCalendarDay(day, min, max)) return;
    if (mode === 'single') setDraft({ from: day, to: day });
    else if (periodForDate) { setDraft(periodForDate(day)); setChoosingEnd(false); }
    else if (!choosingEnd) { setDraft({ from: day, to: day }); setChoosingEnd(true); }
    else { setDraft(calendarRange(draft.from, day)); setChoosingEnd(false); }
    setFocusedDay(day);
  }
  function dayKeys(event, day) {
    const movement = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next;
    if (event.key in movement) next = shiftCalendarDay(day, movement[event.key]);
    if (event.key === 'PageUp' || event.key === 'PageDown') next = shiftCalendarMonth(day, event.key === 'PageUp' ? -1 : 1);
    if (event.key === 'Home' || event.key === 'End') { const offset = (calendarDate(day).getUTCDay() + 6) % 7; next = shiftCalendarDay(day, event.key === 'Home' ? -offset : 6 - offset); }
    if (next) { event.preventDefault(); if (validCalendarDay(next, min, max)) { setKeyboardFocus(true); setFocusedDay(next); setMonth(calendarMonth(next)); } }
  }
  const canApply = validCalendarDay(draft.from, min, max) && (mode === 'single' || validCalendarDay(draft.to, min, max) && draft.from <= draft.to);
  const label = range.from || range.to ? range.from === range.to || mode === 'single' ? range.from || range.to : `${range.from || '…'} — ${range.to || '…'}` : t('drivers.allDates');
  return <div className={`workspace-date-picker ${fieldProps ? 'workspace-date-field' : 'workspace-date-range'} ${className}`} ref={root}>
    {fieldProps ? <><input {...fieldProps} ref={input} type="text" role="combobox" placeholder={fieldProps.placeholder || 'YYYY-MM-DD'} autoComplete="off" pattern="\d{4}-\d{2}-\d{2}" value={range.from} disabled={disabled} readOnly={readOnly} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-invalid={range.from && !validCalendarDay(range.from, min, max) ? true : undefined}
      onClick={event => { event.preventDefault(); show(); }} onKeyDown={event => { if (event.key === 'ArrowDown' && event.altKey || event.key === 'F4') { event.preventDefault(); show(true); } }}
      onChange={event => { fieldProps.onChange?.(event); setDraft({ from: event.target.value, to: event.target.value }); if (calendarDate(event.target.value)) setMonth(calendarMonth(event.target.value)); }} />
      <button ref={trigger} type="button" className="workspace-date-icon" aria-label={t('calendar.open')} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" disabled={disabled || readOnly} onClick={event => { event.preventDefault(); show(event.detail === 0); }}><CalendarDays size={16} aria-hidden="true" /></button></>
      : <button ref={trigger} type="button" className="workspace-date-trigger" aria-label={triggerLabel} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" disabled={disabled || readOnly} onClick={event => show(event.detail === 0)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(true); } }}><CalendarDays size={16} aria-hidden="true" />{!iconOnly && <span>{label}</span>}</button>}
    {open && portal && createPortal(<section ref={popup} id={id} role="dialog" aria-labelledby={`${id}-title`} className="workspace-calendar" data-workspace-calendar="true" data-mode={mode} style={position}>
      <header><strong id={`${id}-title`}>{heading}</strong><p>{hint || t(mode === 'range' ? 'loads.dateRangeHint' : 'calendar.chooseDate')}</p></header>
      <div className="workspace-calendar-box"><div className="workspace-calendar-month"><button type="button" aria-label={t('loads.previousMonth')} disabled={month <= calendarMonth(min || '0001-01-01')} onClick={() => { setMonth(calendarMonth(shiftCalendarMonth(month, -1))); setKeyboardFocus(false); }}><ChevronLeft size={16} /></button><strong>{formatCalendarDay(month, locale, { month: 'long', year: 'numeric' })}</strong><button type="button" aria-label={t('loads.nextMonth')} disabled={month >= calendarMonth(max || '9999-12-31')} onClick={() => { setMonth(calendarMonth(shiftCalendarMonth(month, 1))); setKeyboardFocus(false); }}><ChevronRight size={16} /></button></div>
        <div className="workspace-calendar-grid" role="group" aria-label={heading}>{Array.from({ length: 7 }, (_, index) => <span key={index} aria-hidden="true">{formatCalendarDay(`2026-01-${String(5 + index).padStart(2, '0')}`, locale, { weekday: 'short' })}</span>)}
          {calendarDays(month).map((day, index) => day ? <button key={day} ref={element => { if (element) cells.current.set(day, element); else cells.current.delete(day); }} type="button" aria-label={day} title={formatCalendarDay(day, locale, { dateStyle: 'full' })} aria-pressed={day === draft.from || day === draft.to} aria-current={day === today ? 'date' : undefined} data-in-range={Boolean(draft.from && draft.to && day > draft.from && day < draft.to)} disabled={!validCalendarDay(day, min, max)} tabIndex={day === focusedDay || !focusedDay.startsWith(month.slice(0, 7)) && day.endsWith('-01') ? 0 : -1} onClick={() => choose(day)} onKeyDown={event => dayKeys(event, day)}>{Number(day.slice(-2))}</button> : <span key={`blank-${index}`} aria-hidden="true" />)}
        </div></div>
      {(draft.from || draft.to) && <p className="workspace-calendar-selection">{draft.from}{draft.to && draft.from !== draft.to ? ` — ${draft.to}` : ''}</p>}
      <footer>{allowClear ? <button type="button" className="workspace-calendar-clear" disabled={!range.from && !range.to && !draft.from} onClick={() => { if (!unavailable()) onPick({ from: '', to: '' }); close(true); }}>{t('loads.clear')}</button> : <span />}
        <button type="button" className="workspace-calendar-apply" disabled={!canApply} onClick={() => { if (!unavailable()) onPick(mode === 'single' ? { from: draft.from, to: draft.from } : draft); close(true); }}>{t('loads.view')}</button></footer>
    </section>, portal)}
  </div>;
}

export function DateRangePicker({ value = { from: '', to: '' }, onChange, ...props }) {
  return <CalendarPicker {...props} mode="range" range={value} onPick={onChange} />;
}
export default function DatePicker({ value = '', onChange, min, max, disabled, readOnly, className = '', calendarTitle, ...inputProps }) {
  return <CalendarPicker mode="single" title={calendarTitle} range={{ from: value || '', to: value || '' }} min={min} max={max} disabled={disabled} readOnly={readOnly} fieldProps={{ ...inputProps, onChange }} className={className} onPick={range => onChange?.({ target: { value: range.from, name: inputProps.name }, currentTarget: { value: range.from, name: inputProps.name } })} />;
}
