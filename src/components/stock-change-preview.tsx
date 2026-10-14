import { T, Message, Value } from "./localization";
export function StockChangePreview({
  rows,
  valid = true,
}: {
  rows: { label: string; before: number; after: number }[];
  valid?: boolean;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-muted/40 p-3"
      data-testid="stock-change-preview"
    >
      <p className="mb-2 text-sm font-semibold">
        <T k="Expected Stock After Posting" />
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="pb-2">
              <T k="Stock state" />
            </th>
            <th scope="col" className="pb-2 text-right">
              <T k="Before" />
            </th>
            <th scope="col" className="pb-2 text-right">
              <T k="After" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="py-1 pr-3 font-medium">
                <Message value={row.label} />
              </th>
              <td className="py-1 text-right tabular-nums">
                <Value value={row.before} />
              </td>
              <td className="py-1 text-right font-semibold tabular-nums">
                {valid ? <Value value={row.after} /> : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
