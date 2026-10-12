import { it, expect } from "vitest";
import { receiptPdf } from "@/services/pdf";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
it("embeds Nepali glyphs, preserves money and renders measured lines without clipping", async () => {
  const pdf = await receiptPdf({
    title: "बिल मिति: २६ असोज २०८३",
    company: {
      name: "Mount Kailash",
      address: "काठमाडौं",
      phone: "",
      registration: "",
      tax_mode: "UNCONFIGURED",
      tax_label: "",
      tax_rate: "0.00",
      version: 1,
    },
    lines: [
      "ग्राहक: ABC Hotel 123",
      "जम्मा: NPR ५,२५८.७५",
      "फिर्ता आउन बाँकी जार: ५",
      "संकलित खाली जार: ३०",
      "लामो ग्राहक ठेगाना काठमाडौं नेपाल ".repeat(20),
    ],
  });
  const task = getDocument({ data: pdf, useSystemFonts: false });
  try {
    const document = await task.promise,
      page = await document.getPage(1),
      viewport = page.getViewport({ scale: 1.5 });
    const text = await page.getTextContent();
    expect(
      text.items.map((i) => ("str" in i ? i.str : "")).join(" "),
    ).toContain("५,२५८.७५");
    for (const item of text.items)
      if ("str" in item) {
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(551);
        expect(item.transform[5]).toBeGreaterThanOrEqual(54);
      }
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    await mkdir("test-results/localization", { recursive: true });
    await writeFile(
      "test-results/localization/nepali-pdf-preview.png",
      canvas.toBuffer("image/png"),
    );
  } finally {
    await task.destroy();
  }
}, 30000);
