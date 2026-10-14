"use client";
import { T, Message, useLocale } from "@/components/localization";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { StatusBadge } from "./ui/status-badge";

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
    type?: string;
  }[];
  href: string;
  label: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const { t } = useLocale();
  const types = [
    ...new Set(rows.map((r) => r.type).filter((v): v is string => !!v)),
  ];
  const filtered = rows.filter(
    (r) =>
      `${r.name} ${r.detail}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (!status || String(r.active) === status) &&
      (!type || r.type === type),
  );
  return (
    <div className="space-y-4">
      <Card className="grid items-end gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-2 text-sm font-medium">
          {" "}
          <T k="Search" /> <Message value={label} />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {types.length > 0 && (
          <label className="grid gap-2 text-sm font-medium">
            <T k="Customer Type" />
            <select
              aria-label={t("Customer Type")}
              className="min-h-12 w-full rounded-lg border border-input bg-background px-3"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">{t("All customer types")}</option>
              {types.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-2 text-sm font-medium">
          <T k="Status" />
          <select
            aria-label={t("Status")}
            className="min-h-12 w-full rounded-lg border border-input bg-background px-3"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("All statuses")}</option>
            <option value="true">{t("Active")}</option>
            <option value="false">{t("Inactive")}</option>
          </select>
        </label>
        {(search || status || type) && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSearch("");
              setStatus("");
              setType("");
            }}
          >
            <T k="Reset filters" />
          </Button>
        )}
      </Card>
      <p role="status" className="text-sm text-muted-foreground">
        <T k="{0} records shown" values={[filtered.length]} />
      </p>
      {filtered.length === 0 && (
        <p className="py-5 text-muted-foreground">
          <T
            k="No matching {0}."
            values={[<Message key="v0" value={label} />]}
          />
        </p>
      )}
      <div className="grid items-start gap-3 xl:grid-cols-2">
        {filtered.map((r) => (
          <Card
            key={r.id}
            className="min-w-0 space-y-3 p-4 sm:p-5"
            data-testid={`directory-card-${r.id}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="min-w-0 break-words font-semibold">{r.name}</h2>
              <StatusBadge
                label={r.active ? "Active" : "Inactive"}
                tone={r.active ? "positive" : "neutral"}
              />
            </div>
            {r.type && <StatusBadge label={r.type} />}
            <div className="break-words text-sm text-muted-foreground">
              {r.displayDetail ?? r.detail}
            </div>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={`${href}/${r.id}`}>
                <T k="View / edit" />
              </Link>
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
