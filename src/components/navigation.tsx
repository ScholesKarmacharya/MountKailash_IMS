"use client";
import { Message } from "@/components/localization";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  PlusCircle,
  Users,
  History,
  Truck,
  Droplets,
  Zap,
} from "lucide-react";
import type { Role } from "@/domain/auth/roles";
import { cn } from "@/lib/utils";
import { useLocale } from "./localization";
export function Navigation({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const href = role === "ADMIN" ? "/admin/dashboard" : "/driver/home";
  const active = (target: string) =>
    pathname === target ||
    (role === "ADMIN" && pathname.startsWith(target + "/"));
  return (
    <nav
      aria-label={t(
        role === "ADMIN" ? "Admin navigation" : "Driver navigation",
      )}
      className={
        role === "ADMIN"
          ? "space-y-2"
          : "fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 gap-1 border-t border-border bg-card p-2 lg:static lg:grid-cols-7 lg:border-0"
      }
    >
      <Link
        href={href}
        onClick={onNavigate}
        prefetch={role === "DRIVER" ? false : undefined}
        aria-current={active(href) ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-semibold",
          active(href) ? "bg-primary text-white" : "hover:bg-muted",
          role === "DRIVER" &&
            "min-h-16 flex-col justify-center gap-1 px-2 py-2 text-center text-xs",
        )}
      >
        <LayoutDashboard className="size-4" aria-hidden="true" />
        <Message value={role === "ADMIN" ? "Overview" : "My Stock"} />
      </Link>
      {role === "DRIVER" &&
        (
          [
            ["New Sale", "/driver/delivery", PlusCircle],
            ["Instant Delivery", "/driver/instant-delivery", Zap],
            ["Customers", "/driver/customers", Users],
            ["Unreturned Jars", "/driver/pending-jars", Droplets],
            ["Sales History", "/driver/sales", History],
            ["Return to Warehouse", "/driver/return", Truck],
          ] as const
        ).map(([label, target, Icon]) => (
          <Link
            key={target}
            href={target}
            onClick={onNavigate}
            prefetch={false}
            aria-current={active(target) ? "page" : undefined}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-semibold",
              active(target) ? "bg-primary text-white" : "hover:bg-muted",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <Message value={label} />
          </Link>
        ))}
      {role === "ADMIN" &&
        (
          [
            ["Products", "/admin/products"],
            ["Pricing & Free Supply", "/admin/pricing"],
            ["Inventory", "/admin/inventory"],
            ["Refilling and damage", "/admin/refilling"],
            ["Trips", "/admin/trips"],
            ["Instant Deliveries", "/admin/instant-deliveries"],
            ["Customers", "/admin/customers"],
            ["Unreturned Jars", "/admin/pending-jars"],
            ["Vehicles", "/admin/vehicles"],
            ["Drivers", "/admin/drivers"],
            ["Payments", "/admin/payments"],
            ["Customer credit", "/admin/credit"],
            ["Billing settings", "/admin/billing"],
            ["Daily close", "/admin/daily-close"],
            ["Driver sync", "/admin/sync"],
            ["Daily history", "/admin/reports"],
          ] as const
        ).map(([label, target]) => (
          <Link
            key={target}
            href={target}
            onClick={onNavigate}
            aria-current={active(target) ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-semibold",
              active(target) ? "bg-primary text-white" : "hover:bg-muted",
            )}
          >
            <Package className="size-4" aria-hidden="true" />
            <Message value={label} />
          </Link>
        ))}
    </nav>
  );
}
