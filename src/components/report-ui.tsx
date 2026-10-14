import type { ReactNode } from "react";
import { Card } from "./ui/card";
import { T, Message, Value } from "./localization";

export function ReportPanel({
  title,
  description,
  children,
  collapsed = false,
  className = "",
  testId,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  collapsed?: boolean;
  className?: string;
  testId?: string;
}) {
  const content = (
    <div className="mt-4 space-y-4">
      {description && (
        <p className="text-sm text-muted-foreground">
          <T k={description} />
        </p>
      )}
      {children}
    </div>
  );
  return (
    <Card className={`min-w-0 p-4 sm:p-5 ${className}`} data-testid={testId}>
      {collapsed ? (
        <details>
          <summary className="min-h-12 cursor-pointer text-lg font-semibold">
            <h2 className="inline text-lg font-semibold">
              <T k={title} />
            </h2>
          </summary>
          {content}
        </details>
      ) : (
        <>
          <h2 className="text-lg font-semibold">
            <T k={title} />
          </h2>
          {content}
        </>
      )}
    </Card>
  );
}
export function MetricGrid({
  items,
  compact = false,
}: {
  items: { label: string; value: ReactNode; hint?: string }[];
  compact?: boolean;
}) {
  return (
    <dl
      className={`grid gap-3 sm:grid-cols-2 ${compact ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={`min-w-0 rounded-lg border border-border ${compact ? "bg-muted/40 p-3" : "bg-card p-4"}`}
        >
          <dt className="text-sm text-muted-foreground">
            <Message value={item.label} />
          </dt>
          <dd
            className={`mt-2 break-words font-semibold tabular-nums ${compact ? "text-lg" : "text-2xl"}`}
          >
            <Value value={item.value} />
          </dd>
          {item.hint && (
            <p className="mt-1 text-xs text-muted-foreground">
              <T k={item.hint} />
            </p>
          )}
        </div>
      ))}
    </dl>
  );
}
export function ReportTable({
  columns,
  rows,
  empty,
  testId,
}: {
  columns: string[];
  rows: { id: string; cells: ReactNode[] }[];
  empty: string;
  testId?: string;
}) {
  if (!rows.length)
    return (
      <p
        role="status"
        className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground"
      >
        <T k={empty} />
      </p>
    );
  return (
    <div data-testid={testId}>
      <div className="hidden overflow-x-auto rounded-lg border border-border xl:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/70 text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  scope="col"
                  key={c}
                  className="whitespace-nowrap px-3 py-3 font-medium"
                >
                  <Message value={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="align-top hover:bg-muted/30">
                {row.cells.map((cell, i) => (
                  <td key={columns[i]} className="px-3 py-3 tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:hidden">
        {rows.map((row) => (
          <dl
            key={row.id}
            className="min-w-0 space-y-3 rounded-lg border border-border p-4"
          >
            {row.cells.map((cell, i) => (
              <div
                key={columns[i]}
                className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"
              >
                <dt className="text-sm text-muted-foreground">
                  <Message value={columns[i]} />
                </dt>
                <dd className="min-w-0 max-w-full break-words text-sm font-medium tabular-nums">
                  {cell}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  );
}
