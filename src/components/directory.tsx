"use client";
import { T, Message } from "@/components/localization";

import { useState } from "react";
import Link from "next/link";
import { Input } from "./ui/input";
export function Directory({
  rows,
  href,
  label,
}: {
  rows: {
    id: string;
    name: string;
    detail: string;
    displayDetail?: React.ReactNode;
    active: boolean;
  }[];
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
        {" "}
        <T k="Search" /> <Message value={label} />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {filtered.length === 0 && (
        <p className="py-5 text-muted-foreground">
          <T
            k="No matching {0}."
            values={[<Message key="v0" value={label} />]}
          />
        </p>
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
              {r.displayDetail ?? r.detail}
            </p>
            <p className="mt-2 text-xs">
              <T
                k="{0} · View / edit"
                values={[
                  <Message key="v0" value={r.active ? "Active" : "Inactive"} />,
                ]}
              />
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
