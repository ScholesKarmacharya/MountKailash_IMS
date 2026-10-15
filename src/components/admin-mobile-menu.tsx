"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X, Droplets, UserRound } from "lucide-react";
import Link from "next/link";
import type { Profile } from "@/domain/auth/roles";
import { Navigation } from "./navigation";
import { SignOutButton } from "./sign-out-button";
import { Button } from "./ui/button";
import { T, useLocale } from "./localization";
export function AdminMobileMenu({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false),
    dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    title = useId(),
    { t } = useLocale(),
    pathname = usePathname();
  const previousOverflow = useRef<string | undefined>(undefined);
  const restoreScroll = useCallback(() => {
    if (previousOverflow.current !== undefined) {
      document.body.style.overflow = previousOverflow.current;
      previousOverflow.current = undefined;
    }
  }, []);
  const close = useCallback(() => {
    restoreScroll();
    dialog.current?.close();
  }, [restoreScroll]);
  useEffect(() => {
    close();
  }, [pathname, close]);
  useEffect(() => {
    if (!open || !dialog.current) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current.showModal();
    dialog.current
      .querySelector<HTMLButtonElement>("[data-menu-close]")
      ?.focus();
    const media = window.matchMedia("(min-width: 1024px)");
    const resized = () => {
      if (media.matches) close();
    };
    media.addEventListener("change", resized);
    resized();
    return () => {
      restoreScroll();
      media.removeEventListener("change", resized);
    };
  }, [open, close, restoreScroll]);
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="size-11 shrink-0 p-0 lg:hidden"
        aria-label={t("Open admin menu")}
        data-testid="admin-menu-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={title + "-drawer"}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </Button>
      <dialog
        ref={dialog}
        id={title + "-drawer"}
        aria-labelledby={title}
        data-testid="admin-mobile-drawer"
        aria-modal="true"
        onCancel={restoreScroll}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[calc(100vw_-_3rem)] max-w-sm overflow-hidden border-0 border-r border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const b = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < b.left ||
              e.clientX > b.right ||
              e.clientY < b.top ||
              e.clientY > b.bottom
            )
              close();
          }
        }}
        onClose={() => {
          restoreScroll();
          setOpen(false);
          trigger.current?.focus();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const controls = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button,a[href],input,select,textarea,[tabindex]",
              ),
            ).filter(
              (el) =>
                el.tabIndex >= 0 &&
                !el.matches(":disabled") &&
                el.getClientRects().length > 0,
            ),
            first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        {open && (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
              <h2 id={title} className="flex items-center gap-2 font-bold">
                <Droplets className="size-6 text-primary" aria-hidden />
                <T k="Mount Kailash" />
              </h2>
              <Button
                data-menu-close
                type="button"
                variant="ghost"
                className="size-11 p-0"
                aria-label={t("Close admin menu")}
                onClick={close}
              >
                <X className="size-5" aria-hidden />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              <Navigation role="ADMIN" onNavigate={close} />
            </div>
            <div className="shrink-0 space-y-3 border-t border-border bg-muted/30 p-4">
              <Link
                href="/account/profile"
                onClick={close}
                className="flex min-h-11 items-center gap-2 rounded-lg"
              >
                <UserRound
                  className="size-5 shrink-0 text-primary"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p
                    className="break-words font-semibold"
                    data-testid="mobile-admin-name"
                  >
                    {profile.name || t("Warehouse Admin")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <T k="Warehouse Admin" />
                  </p>
                </div>
              </Link>
              <SignOutButton user={profile.id} />
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
