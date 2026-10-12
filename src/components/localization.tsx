"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  Fragment,
  type ReactNode,
  type ComponentProps,
} from "react";
import { digits, type Locale } from "@/domain/localization/locale";
import { formatBusinessDate } from "@/domain/localization/calendar";
import { message, translateMessage } from "@/lib/i18n/messages";
type LocaleContext = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  saving: boolean;
  failed: boolean;
};
const Context = createContext<LocaleContext>({
  locale: "en",
  setLocale: () => {},
  saving: false,
  failed: false,
});
export function LocaleProvider({
  initialLocale,
  userId,
  children,
}: {
  initialLocale: Locale;
  userId?: string;
  children: ReactNode;
}) {
  const [locale, setCurrent] = useState(initialLocale);
  const [saving, setSaving] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    if (
      !userId &&
      /^\/(admin|driver|account)(\/|$)/.test(window.location.pathname)
    )
      return;
    document.documentElement.lang = locale;
    // Allow the root accessibility-text provider to register its listener first.
    if (userId)
      queueMicrotask(() =>
        window.dispatchEvent(
          new CustomEvent("mk-locale-changed", { detail: locale }),
        ),
      );
  }, [locale, userId]);
  useEffect(() => {
    if (userId) return;
    const sync = (event: Event) =>
      setCurrent((event as CustomEvent<Locale>).detail);
    window.addEventListener("mk-locale-changed", sync);
    return () => window.removeEventListener("mk-locale-changed", sync);
  }, [userId]);
  async function setLocale(next: Locale) {
    if (saving) return;
    setCurrent(next);
    setFailed(false);
    window.dispatchEvent(
      new CustomEvent("mk-locale-changed", { detail: next }),
    );
    if (!userId) {
      document.cookie = `mk-locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/preferences", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Context.Provider value={{ locale, setLocale, saving, failed }}>
      {children}
    </Context.Provider>
  );
}
export function useLocale() {
  const context = useContext(Context);
  return {
    ...context,
    t: (value: string) => translateMessage(context.locale, value),
    number: (value: string | number) => digits(value, context.locale),
    date: (value: string, time = false) =>
      formatBusinessDate(value, context.locale, time),
  };
}
export function LanguageSwitcher() {
  const { locale, setLocale, saving, failed, t } = useLocale();
  return (
    <div className="space-y-1 print:hidden">
      <div
        role="group"
        aria-label={t("Language")}
        className="inline-flex rounded-lg border border-border bg-card p-1"
      >
        {(["en", "ne"] as const).map((option) => (
          <button
            key={option}
            type="button"
            lang={option}
            aria-label={option === "en" ? "English" : "नेपाली"}
            aria-pressed={locale === option}
            disabled={saving}
            onClick={() => setLocale(option)}
            className={
              "min-h-11 min-w-12 rounded-md px-3 font-semibold " +
              (locale === option ? "bg-primary text-white" : "hover:bg-muted")
            }
          >
            {option === "en" ? "EN" : "ने"}
          </button>
        ))}
      </div>
      {failed && (
        <p role="alert" className="max-w-64 text-xs text-red-800">
          {t(
            "Language changed on this page. Could not save preference; choose the language again to retry.",
          )}
        </p>
      )}
    </div>
  );
}
export function T({ k, values = [] }: { k: string; values?: ReactNode[] }) {
  const { locale } = useLocale();
  return (
    <>
      {message(locale, k)
        .split(/(\{\d+\})/)
        .map((part, i) => {
          const match = /^\{(\d+)\}$/.exec(part);
          const value = match ? values[Number(match[1])] : part;
          return (
            <Fragment key={i}>
              {typeof value === "number" ? digits(value, locale) : value}
            </Fragment>
          );
        })}
    </>
  );
}
export function Message({ value }: { value: ReactNode }) {
  const { t } = useLocale();
  return <>{typeof value === "string" ? t(value) : value}</>;
}
export function Value({ value }: { value: ReactNode }) {
  const { number } = useLocale();
  return (
    <>
      {typeof value === "number" ||
      (typeof value === "string" &&
        /^(?:NPR\s*)?-?[\d,.]+(?:\s*%)?$/.test(value))
        ? number(value)
        : value}
    </>
  );
}
export function DateValue({
  value,
  time = false,
}: {
  value?: string | null;
  time?: boolean;
}) {
  const { date, t } = useLocale();
  return (
    <>
      {value && /^\d{4}-\d{2}-\d{2}/.test(value)
        ? date(value, time)
        : t(value ?? "Unconfigured")}
    </>
  );
}
export function LocalizedSelect(props: ComponentProps<"select">) {
  const { t } = useLocale();
  return (
    <select
      {...props}
      aria-label={props["aria-label"] ? t(props["aria-label"]) : undefined}
      onChange={(e) => {
        e.currentTarget.setCustomValidity("");
        props.onChange?.(e);
      }}
      onInvalid={(e) => {
        e.currentTarget.setCustomValidity(t("This field is required."));
        props.onInvalid?.(e);
      }}
    />
  );
}
export function LocalizedTextarea(props: ComponentProps<"textarea">) {
  const { t } = useLocale();
  return (
    <textarea
      {...props}
      aria-label={props["aria-label"] ? t(props["aria-label"]) : undefined}
      placeholder={props.placeholder ? t(props.placeholder) : undefined}
      onChange={(e) => {
        e.currentTarget.setCustomValidity("");
        props.onChange?.(e);
      }}
      onInvalid={(e) => {
        e.currentTarget.setCustomValidity(
          t("Enter a valid value within the allowed range."),
        );
        props.onInvalid?.(e);
      }}
    />
  );
}
export function LocalizedNav(props: ComponentProps<"nav">) {
  const { t } = useLocale();
  return (
    <nav
      {...props}
      aria-label={props["aria-label"] ? t(props["aria-label"]) : undefined}
    />
  );
}
export function LocalizedSection(props: ComponentProps<"section">) {
  const { t } = useLocale();
  return (
    <section
      {...props}
      aria-label={props["aria-label"] ? t(props["aria-label"]) : undefined}
    />
  );
}
