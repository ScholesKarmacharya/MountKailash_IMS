"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pencil, Plus, X } from "lucide-react";
import { Button } from "./ui/button";
import { T, useLocale, LanguageSwitcher } from "./localization";

const CloseContext = createContext<(() => void) | null>(null);
export function DialogClose({
  label = "Cancel",
  disabled = false,
}: {
  label?: string;
  disabled?: boolean;
}) {
  const close = useContext(CloseContext);
  return close ? (
    <Button type="button" variant="outline" disabled={disabled} onClick={close}>
      <T k={label} />
    </Button>
  ) : null;
}

export function AdminDialog({
  title,
  triggerLabel,
  context,
  primary = false,
  icon,
  languageSwitch = false,
  children,
}: {
  title: string;
  triggerLabel: string;
  context?: string;
  primary?: boolean;
  icon?: ReactNode;
  languageSwitch?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId(),
    { t } = useLocale();
  const busy = () => !!dialog.current?.querySelector('form[aria-busy="true"]');
  const close = () => {
    if (!busy()) dialog.current?.close();
  };
  useEffect(() => {
    if (!open || !dialog.current) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.current.open) dialog.current.showModal();
    dialog.current
      .querySelector<HTMLInputElement>(
        'input:not([type="hidden"]):not([readonly]):not([disabled])',
      )
      ?.focus();
    dialog.current.scrollTop = 0;
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant={primary ? "default" : "outline"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {icon ??
          (primary ? (
            <Plus className="size-4" aria-hidden="true" />
          ) : (
            <Pencil className="size-4" aria-hidden="true" />
          ))}
        <T k={triggerLabel} />
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={id}
        aria-describedby={context ? id + "-context" : undefined}
        className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/35"
        onCancel={(e) => {
          if (busy()) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'button, input:not([type="hidden"]), select, textarea, a[href], [tabindex]',
            ),
          ).filter(
            (el) =>
              el.tabIndex >= 0 &&
              !el.matches(":disabled") &&
              el.getClientRects().length > 0,
          );
          const first = controls[0],
            last = controls.at(-1);
          if (!first || !last) return;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        {open && (
          <CloseContext.Provider value={close}>
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 id={id} className="text-xl font-bold">
                  <T k={title} />
                </h2>
                {context && (
                  <p
                    id={id + "-context"}
                    className="mt-1 break-words text-sm text-muted-foreground"
                  >
                    {context}
                  </p>
                )}
              </div>
              {languageSwitch && <LanguageSwitcher />}
              <Button
                type="button"
                variant="ghost"
                aria-label={t("Close dialog")}
                className="shrink-0 px-3"
                onClick={close}
              >
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>
            <div className="p-4 sm:p-5">{children}</div>
          </CloseContext.Provider>
        )}
      </dialog>
    </>
  );
}
