"use client";
import { useState } from "react";
import Link from "next/link";
import { Input } from "./ui/input";
export function Directory({
  rows,
  href,
  label,
}: {
  rows: { id: string; name: string; detail: string; active: boolean }[];
  href: string;
  label: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = rows.filter((r) =>
    `${r.name} ${r.detail}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <label className="grid gap-2 text-sm font-medium">
        Search {label}
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {filtered.length === 0 && (
        <p className="py-5 text-muted-foreground">No matching {label}.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((r) => (
          <Link
            key={r.id}
            href={`${href}/${r.id}`}
            className="rounded-xl border border-border bg-card p-5 hover:border-primary"
          >
            <p className="font-semibold">{r.name}</p>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {r.detail}
            </p>
            <p className="mt-2 text-xs">
              {r.active ? "Active" : "Inactive"} · View / edit
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
