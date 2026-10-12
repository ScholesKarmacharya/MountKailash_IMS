"use client";
import type { ReceiptDocument } from "@/domain/finance/documents";
import { useLocale } from "./localization";
export function LocalizedDocument({
  documents,
  heading = false,
}: {
  documents: Record<"en" | "ne", ReceiptDocument>;
  heading?: boolean;
}) {
  const { locale } = useLocale(),
    document = documents[locale];
  return heading ? (
    <h1 className="text-3xl font-bold">{document.title}</h1>
  ) : (
    <div className="mt-5 space-y-3">
      {document.lines.map((line, index) => (
        <p key={index} className="break-words text-sm">
          {line}
        </p>
      ))}
    </div>
  );
}
