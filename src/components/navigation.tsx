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
      className="space-y-2"
    >
      <Link
        href={href}
        aria-current={pathname === href ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-semibold",
          pathname === href ? "bg-primary text-white" : "hover:bg-muted",
        )}
      >
        <LayoutDashboard className="size-4" aria-hidden="true" />
        {role === "ADMIN" ? "Overview" : "My day"}
      </Link>
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
