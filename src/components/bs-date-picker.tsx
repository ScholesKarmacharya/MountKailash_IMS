"use client";
import { useId, useState, useRef, useEffect } from "react";
import { getWeekdayLabels } from "@inicrea/bikram-sambat-core";
import {
  adToBs,
  bsToAdIso,
  bsWeekday,
  currentBs,
  daysInBsMonth,
  months,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
  EPOCH_AD_ISO,
  MAX_AD_ISO,
  presets,
  presetRange,
  type DatePreset,
} from "@/domain/localization/calendar";
import { useLocale, T } from "./localization";
export function BsDatePicker({
  name,
  value,
  defaultValue,
  onChange,
  min = EPOCH_AD_ISO,
  max = MAX_AD_ISO,
  label = "Choose BS date",
  disabled = false,
  required = false,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
  label?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const { locale, t, number, date } = useLocale(),
    id = useId(),
    container = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(
    () => defaultValue ?? bsToAdIso(currentBs()),
  );
  const chosen = value ?? selected;
  const [view, setView] = useState(() =>
    chosen ? adToBs(chosen) : currentBs(),
  );
  const [open, setOpen] = useState(false);
  const [popupLeft, setPopupLeft] = useState(0);
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLSelectElement>("select")?.focus();
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const pick = (canonical: string) => {
    if (canonical < min || canonical > max) return;
    setSelected(canonical);
    onChange?.(canonical);
    setView(adToBs(canonical));
    setOpen(false);
    container.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const navigate = (step: number) => {
    let month = view.month + step,
      year = view.year;
    if (month === 0) {
      month = 12;
      year--;
    }
    if (month === 13) {
      month = 1;
      year++;
    }
    if (year < MIN_BS_YEAR || year > MAX_BS_YEAR) return;
    setView({ year, month, day: 1 });
  };
  const count = daysInBsMonth(view.year, view.month),
    offset = bsWeekday({ ...view, day: 1 });
  return (
    <div
      ref={container}
      className="relative min-w-0"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          container.current
            ?.querySelector<HTMLButtonElement>("button")
            ?.focus();
        }
      }}
    >
      {name && (
        <input type="hidden" name={name} value={chosen} disabled={disabled} />
      )}
      <button
        type="button"
        aria-label={t(label)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        className="min-h-12 w-full rounded-lg border border-input bg-background px-3 text-left font-normal"
        onClick={() => {
          if (!open) {
            setView(chosen ? adToBs(chosen) : currentBs());
            const left = container.current?.getBoundingClientRect().left ?? 24;
            setPopupLeft(
              Math.max(
                24 - left,
                Math.min(
                  0,
                  window.innerWidth -
                    24 -
                    left -
                    Math.min(350, window.innerWidth - 48),
                ),
              ),
            );
          }
          setOpen((o) => !o);
        }}
      >
        {chosen ? date(chosen) : t("Choose BS date")}{" "}
        <span className="text-xs text-muted-foreground">BS</span>
      </button>
      {required && !chosen && (
        <span role="alert">
          <T k="Choose a valid date." />
        </span>
      )}
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={t("BS calendar")}
          style={{ left: popupLeft }}
          className="absolute top-full z-40 mt-2 w-[min(350px,calc(100vw-3rem))] rounded-xl border border-border bg-card p-3 shadow-xl"
        >
          <div className="mb-3 grid grid-cols-[44px_1fr_44px] items-center gap-1">
            <button
              type="button"
              aria-label={t("Previous month")}
              className="min-h-11 rounded-lg hover:bg-muted"
              disabled={view.year === MIN_BS_YEAR && view.month === 1}
              onClick={() => navigate(-1)}
            >
              ‹
            </button>
            <div className="flex min-w-0 gap-1">
              <select
                aria-label={t("BS month")}
                value={view.month}
                className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-1"
                onChange={(e) =>
                  setView({ ...view, month: Number(e.target.value), day: 1 })
                }
              >
                {months[locale].map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("BS year")}
                value={view.year}
                className="min-h-11 min-w-0 rounded-lg border bg-background px-1"
                onChange={(e) =>
                  setView({ ...view, year: Number(e.target.value), day: 1 })
                }
              >
                {Array.from(
                  { length: MAX_BS_YEAR - MIN_BS_YEAR + 1 },
                  (_, i) => MIN_BS_YEAR + i,
                ).map((y) => (
                  <option key={y} value={y}>
                    {number(y)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              aria-label={t("Next month")}
              className="min-h-11 rounded-lg hover:bg-muted"
              disabled={view.year === MAX_BS_YEAR && view.month === 12}
              onClick={() => navigate(1)}
            >
              ›
            </button>
          </div>
          <div
            role="group"
            aria-label={
              months[locale][view.month - 1] + " " + number(view.year)
            }
            className="grid grid-cols-7 gap-0.5"
          >
            {getWeekdayLabels(locale).map((w) => (
              <span key={w} className="py-2 text-center text-xs font-semibold">
                {w}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={"blank" + i} />
            ))}
            {Array.from({ length: count }, (_, i) => i + 1).map((day) => {
              const canonical = bsToAdIso({ ...view, day });
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={date(canonical)}
                  aria-pressed={chosen === canonical}
                  disabled={canonical < min || canonical > max}
                  className={
                    "min-h-11 rounded-lg text-sm font-medium disabled:opacity-30 " +
                    (chosen === canonical
                      ? "bg-primary text-white"
                      : "hover:bg-muted")
                  }
                  onClick={() => pick(canonical)}
                >
                  {number(day)}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between border-t pt-2">
            <button
              type="button"
              className="min-h-11 px-2 text-primary"
              disabled={
                bsToAdIso(currentBs()) < min || bsToAdIso(currentBs()) > max
              }
              onClick={() => pick(bsToAdIso(currentBs()))}
            >
              <T k="Today" />
            </button>
            {!required && (
              <button
                type="button"
                className="min-h-11 px-2"
                onClick={() => {
                  setSelected("");
                  onChange?.("");
                  setOpen(false);
                }}
              >
                <T k="Clear" />
              </button>
            )}
            <button
              type="button"
              className="min-h-11 px-2"
              onClick={() => setOpen(false)}
            >
              <T k="Done" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
const presetLabels: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  month: "This BS Month",
  "previous-month": "Previous BS Month",
  year: "This BS Year",
  custom: "Custom BS Date Range",
};
export function BsDateRange({
  from = "",
  to = "",
  onChange,
  controlled = false,
  namePrefix = "",
}: {
  from?: string;
  to?: string;
  onChange?: (from: string, to: string) => void;
  controlled?: boolean;
  namePrefix?: string;
}) {
  const { t } = useLocale();
  const [localStart, setStart] = useState(from),
    [localEnd, setEnd] = useState(to),
    [preset, setPreset] = useState<DatePreset>("custom");
  const start = controlled ? from : localStart,
    end = controlled ? to : localEnd;
  return (
    <div className="grid w-full min-w-0 gap-3 sm:grid-cols-3">
      <label className="grid gap-2 text-sm">
        <T k="Date range" />
        <select
          aria-label={t("Date range")}
          value={preset}
          className="min-h-12 rounded-lg border bg-background px-3"
          onChange={(e) => {
            const p = e.target.value as DatePreset;
            setPreset(p);
            if (p !== "custom") {
              const r = presetRange(p);
              setStart(r.from);
              setEnd(r.to);
              onChange?.(r.from, r.to);
            }
          }}
        >
          {presets.map((p) => (
            <option key={p} value={p}>
              {t(presetLabels[p])}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2 text-sm">
        <span>
          <T k="From date" />
        </span>
        <BsDatePicker
          name={onChange ? undefined : namePrefix + "from"}
          label="From date"
          required={controlled}
          value={start}
          onChange={(v) => {
            setStart(v);
            setPreset("custom");
            onChange?.(v, end);
          }}
          max={end || MAX_AD_ISO}
        />
      </div>
      <div className="grid gap-2 text-sm">
        <span>
          <T k="To date" />
        </span>
        <BsDatePicker
          name={onChange ? undefined : namePrefix + "to"}
          label="To date"
          required={controlled}
          value={end}
          onChange={(v) => {
            setEnd(v);
            setPreset("custom");
            onChange?.(start, v);
          }}
          min={start || EPOCH_AD_ISO}
        />
      </div>
    </div>
  );
}
