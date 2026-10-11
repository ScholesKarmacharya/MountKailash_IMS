import "server-only";
import "regenerator-runtime/runtime";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReceiptDocument } from "@/domain/finance/documents";
export async function receiptPdf(document: ReceiptDocument) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "assets/fonts/NotoSansDevanagari.ttf"),
    ),
    { subset: true },
  );
  pdf.setTitle(document.title);
  pdf.setAuthor(document.company.name);
  pdf.setSubject("Mount Kailash financial receipt");
  let page = pdf.addPage([595, 842]),
    y = 795;
  const draw = (line: string, size = 11) => {
    const text = line.replace(/[\x00-\x1f]/g, " ");
    let current = "";
    // Wrap by measured glyph width; long unbroken names/references wrap instead of clipping.
    for (const { segment: char } of new Intl.Segmenter("ne", {
      granularity: "grapheme",
    }).segment(text)) {
      if (font.widthOfTextAtSize(current + char, size) > 505) {
        write(current, size);
        current = "";
      }
      current += char;
    }
    write(current, size);
  };
  const write = (line: string, size: number) => {
    if (y < 55) {
      page = pdf.addPage([595, 842]);
      y = 795;
    }
    page.drawText(line, { x: 45, y, size, font, color: rgb(0.06, 0.17, 0.23) });
    y -= size + 9;
  };
  draw(document.company.name, 20);
  for (const line of [
    document.company.address,
    document.company.phone,
    document.company.registration,
  ])
    if (line) draw(line);
  y -= 12;
  draw(document.title, 15);
  y -= 8;
  for (const line of document.lines) draw(line);
  return pdf.save();
}
