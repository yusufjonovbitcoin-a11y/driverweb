import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../i18n/format";
import "./accounting.css";

const dayKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export default function AccountingDateFilter({
  value,
  onChange,
  iconOnly = false,
  allowReset = true,
  periodForDate,
}) {
  const { t } = useTranslation();
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [choosingEnd, setChoosingEnd] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (day) => {
    if (periodForDate) {
      setDraft(periodForDate(day));
      setChoosingEnd(false);
      return;
    }
    if (!choosingEnd) {
      setDraft({ from: day, to: "" });
      setChoosingEnd(true);
    } else {
      setDraft({
        from: day < draft.from ? day : draft.from,
        to: day < draft.from ? draft.from : day,
      });
      setChoosingEnd(false);
    }
  };
  const active = value.from || value.to;
  return (
    <div
      className={`accounting-date-filter${iconOnly ? " accounting-date-icon-only" : ""}`}
      ref={root}
    >
      {!iconOnly && (
        <span className="accounting-date-label">
          {t("accounting.period.title")}
        </span>
      )}
      <button
        ref={trigger}
        type="button"
        className="accounting-date-trigger"
        aria-label={
          iconOnly
            ? `${t("accounting.period.title")}: ${value.from} — ${value.to}`
            : undefined
        }
        title={iconOnly ? `${value.from} — ${value.to}` : undefined}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setDraft(value);
          setChoosingEnd(false);
          if (!open && value.from) {
            const [year, month] = value.from.split("-").map(Number);
            setMonth(new Date(year, month - 1, 1));
          }
          setOpen(!open);
        }}
      >
        <CalendarDays size={iconOnly ? 20 : 16} aria-hidden="true" />
        {!iconOnly && (
          <span>
            {active
              ? `${value.from || "…"} — ${value.to || "…"}`
              : t("drivers.allDates")}
          </span>
        )}
      </button>
      {open && (
        <section
          id={id}
          className="accounting-calendar"
          aria-label={t("accounting.period.title")}
        >
          <strong>{t("accounting.period.title")}</strong>
          <div className="accounting-calendar-month">
            <button
              type="button"
              aria-label={t("loads.previousMonth")}
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
            >
              <ChevronLeft size={16} />
            </button>
            <strong>
              {formatDate(dayKey(month), { month: "long", year: "numeric" })}
            </strong>
            <button
              type="button"
              aria-label={t("loads.nextMonth")}
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="accounting-calendar-grid">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={`weekday-${i}`}>
                {formatDate(dayKey(new Date(2026, 0, 5 + i)), {
                  weekday: "short",
                })}
              </span>
            ))}
            {Array.from({ length: (month.getDay() + 6) % 7 }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from(
              {
                length: new Date(
                  month.getFullYear(),
                  month.getMonth() + 1,
                  0,
                ).getDate(),
              },
              (_, i) => {
                const date = new Date(
                    month.getFullYear(),
                    month.getMonth(),
                    i + 1,
                  ),
                  key = dayKey(date);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={formatDate(key, { dateStyle: "full" })}
                    aria-pressed={key === draft.from || key === draft.to}
                    data-in-range={
                      !!(
                        draft.from &&
                        draft.to &&
                        key > draft.from &&
                        key < draft.to
                      )
                    }
                    onClick={() => pick(key)}
                  >
                    {i + 1}
                  </button>
                );
              },
            )}
          </div>
          <div className="accounting-calendar-inputs">
            <label>
              {t("accounting.period.from")}
              <input
                type="date"
                value={draft.from}
                max={periodForDate ? undefined : draft.to || undefined}
                onChange={(event) => {
                  setDraft(
                    periodForDate && event.target.value
                      ? periodForDate(event.target.value)
                      : { ...draft, from: event.target.value },
                  );
                  setChoosingEnd(false);
                }}
              />
            </label>
            <label>
              {t("accounting.period.to")}
              <input
                type="date"
                value={draft.to}
                readOnly={!!periodForDate}
                min={draft.from || undefined}
                onChange={(event) => {
                  setDraft({ ...draft, to: event.target.value });
                  setChoosingEnd(false);
                }}
              />
            </label>
          </div>
          <div className="accounting-calendar-actions">
            {allowReset && (
              <button
                type="button"
                onClick={() => {
                  onChange({ from: "", to: "" });
                  close();
                }}
              >
                {t("accounting.period.reset")}
              </button>
            )}
            <button
              type="button"
              disabled={!draft.from || !draft.to || draft.from > draft.to}
              onClick={() => {
                onChange(draft);
                close();
              }}
            >
              {t("accounting.period.apply")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
