"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package } from "lucide-react";
import type { Role } from "@/domain/auth/roles";
import { cn } from "@/lib/utils";
export function Navigation({ role }: { role: Role }) {
  const pathname = usePathname();
  const href = role === "ADMIN" ? "/admin/dashboard" : "/driver/home";
  return (
    <nav
      aria-label={`${role === "ADMIN" ? "Admin" : "Driver"} navigation`}
      className={
        role === "ADMIN"
          ? "space-y-2"
          : "fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-1 border-t border-border bg-card p-2 lg:static lg:grid-cols-6 lg:border-0"
      }
    >
      <Link
        href={href}
        aria-current={pathname === href ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-semibold",
          pathname === href ? "bg-primary text-white" : "hover:bg-muted",
          role === "DRIVER" &&
            "min-h-16 flex-col justify-center gap-1 px-2 py-2 text-center text-xs",
        )}
      >
        <LayoutDashboard className="size-4" aria-hidden="true" />
        {role === "ADMIN" ? "Overview" : "My Stock"}
      </Link>
      {role === "DRIVER" &&
        (
          [
            ["New Delivery", "/driver/delivery"],
            ["Customers", "/driver/customers"],
            ["Pending Jars", "/driver/pending-jars"],
            ["Sales History", "/driver/sales"],
            ["Return to Warehouse", "/driver/return"],
          ] as const
        ).map(([label, target]) => (
          <Link
            key={target}
            href={target}
            aria-current={pathname === target ? "page" : undefined}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-semibold",
              pathname === target ? "bg-primary text-white" : "hover:bg-muted",
            )}
          >
            <Package className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      {role === "ADMIN" &&
        (
          [
            ["Products", "/admin/products"],
            ["Inventory", "/admin/inventory"],
            ["Refilling and damage", "/admin/refilling"],
            ["Trips", "/admin/trips"],
            ["Customers", "/admin/customers"],
            ["Vehicles", "/admin/vehicles"],
            ["Drivers", "/admin/drivers"],
            ["Payments", "/admin/payments"],
            ["Customer credit", "/admin/credit"],
            ["Billing settings", "/admin/billing"],
            ["Daily close", "/admin/daily-close"],
            ["Daily history", "/admin/reports"],
          ] as const
        ).map(([label, target]) => (
          <Link
            key={target}
            href={target}
            aria-current={pathname === target ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-semibold",
              pathname === target ? "bg-primary text-white" : "hover:bg-muted",
            )}
          >
            <Package className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
    </nav>
  );
}
