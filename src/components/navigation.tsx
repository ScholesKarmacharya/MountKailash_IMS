"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, Wallet, ClipboardCheck } from "lucide-react";
import type { Role } from "@/domain/auth/roles";
import { cn } from "@/lib/utils";
const futureAdmin = [
  ["Payments", Wallet],
  ["Daily close", ClipboardCheck],
] as const;
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
            ["Trips", "/admin/trips"],
            ["Customers", "/admin/customers"],
            ["Vehicles", "/admin/vehicles"],
            ["Drivers", "/admin/drivers"],
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
      {role === "ADMIN" && (
        <>
          <p className="px-4 pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Coming in later sprints
          </p>
          {futureAdmin.map(([label, Icon]) => (
            <span
              key={label}
              className="flex min-h-11 items-center gap-3 px-4 text-sm text-muted-foreground"
              aria-disabled="true"
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
              <span className="ml-auto text-xs">Not live</span>
            </span>
          ))}
        </>
      )}
    </nav>
  );
}
