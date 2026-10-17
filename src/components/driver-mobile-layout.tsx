"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  Boxes,
  CirclePlus,
  Users,
  History,
  Menu,
  Droplets,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { T, LanguageSwitcher, useLocale } from "./localization";
import { cn } from "@/lib/utils";

// Covers every driver form, including nested customer editors and native selects.
// The document remains the scroll container; an overlay keyboard contributes only
// its measured occlusion, while resize-content keyboards need no extra space.
export function DriverPageContainer({
  children,
  onClickCapture,
}: {
  children: ReactNode;
  onClickCapture?: React.MouseEventHandler<HTMLDivElement>;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const viewport = window.visualViewport;
    let frame = 0,
      correction = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const activeField = () => {
      const el = document.activeElement;
      return el instanceof HTMLElement &&
        node.contains(el) &&
        !el.closest("[hidden]") &&
        el.matches(
          'textarea:not(:disabled):not([readonly]), select:not(:disabled), input:not(:disabled):not([readonly]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]',
        )
        ? el
        : null;
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = activeField();
        const mobile = window.matchMedia("(max-width: 1023px)").matches;
        const inset =
          mobile && field && viewport
            ? Math.max(
                0,
                window.innerHeight - viewport.height - viewport.offsetTop,
              )
            : 0;
        node.dataset.keyboardOpen = String(mobile && !!field);
        node.style.setProperty("--driver-keyboard-inset", `${inset}px`);
        if (!mobile || !field) return;
        const top = (viewport?.offsetTop ?? 0) + 16;
        const bottom =
          (viewport
            ? viewport.offsetTop + viewport.height
            : window.innerHeight) - 16;
        const rect = field.getBoundingClientRect();
        if (rect.top >= top && rect.bottom <= bottom) return;
        field.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "auto",
        });
        cancelAnimationFrame(correction);
        correction = requestAnimationFrame(() => {
          if (document.activeElement !== field) return;
          const box = field.getBoundingClientRect();
          if (box.bottom > bottom || box.top < top)
            window.scrollBy({
              top:
                box.top - (top + Math.max(0, (bottom - top - box.height) / 2)),
              behavior: "auto",
            });
        });
      });
    };
    const focus = () => {
      update();
      // Android IME animates after focus; also handle browsers without a
      // VisualViewport resize event during that animation.
      for (const delay of [120, 320]) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          update();
        }, delay);
        timers.add(timer);
      }
    };
    node.addEventListener("focusin", focus);
    node.addEventListener("focusout", update);
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    update();
    return () => {
      node.removeEventListener("focusin", focus);
      node.removeEventListener("focusout", update);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(correction);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return (
    <div
      ref={root}
      className="driver-shell min-h-dvh"
      data-testid="driver-shell"
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}

export function DriverMobileHeader({
  name,
  online,
  notifications,
}: {
  name?: string;
  online: boolean;
  notifications: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <header
      className="border-b border-border bg-card px-4 py-3 sm:px-6"
      data-testid="driver-header"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
        <Link href="/driver/home" className="min-w-0">
          <span className="flex items-center gap-1 text-sm font-bold sm:text-base">
            <Droplets className="size-5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">
              <T k="Mount Kailash" />
            </span>
          </span>
          <span
            className="flex min-w-0 max-w-64 items-center gap-1 text-xs text-muted-foreground"
            data-testid="profile-name"
          >
            {online ? (
              <Wifi
                className="size-3 shrink-0 text-primary"
                aria-label={t("Online")}
              />
            ) : (
              <WifiOff className="size-3 shrink-0" aria-label={t("Offline")} />
            )}
            <span className="truncate">
              {name ?? <T k="Delivery Driver" />}
            </span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-0.5">
          <LanguageSwitcher compact />
          {notifications}
          <Link
            href="/driver/more"
            aria-label={t("Driver menu")}
            className="flex size-11 items-center justify-center rounded-lg text-primary hover:bg-muted"
          >
            <UserRound className="size-5" aria-hidden />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function DriverBottomNav({ path }: { path: string }) {
  const { t } = useLocale();
  const tabs = [
    ["My Stock", "/driver/home", Boxes],
    ["New Sale", "/driver/delivery", CirclePlus],
    ["Customers", "/driver/customers", Users],
    ["Sales History", "/driver/sales", History],
    ["More", "/driver/more", Menu],
  ] as const;
  return (
    <nav
      aria-label={t("Driver navigation")}
      className="driver-bottom-nav"
      data-driver-bottom-nav
      data-testid="driver-bottom-nav"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-5 gap-1">
        {tabs.map(([label, href, Icon]) => {
          const active =
            path === href ||
            (href === "/driver/more" &&
              !tabs.slice(0, 4).some(([, target]) => target === path));
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              aria-label={t(label)}
              className={cn(
                "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1 py-2 text-center text-[11px] font-semibold sm:text-xs",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-5" aria-hidden />
              <T k={label === "Sales History" ? "History" : label} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
