# Bundled receipt font

Noto Sans Devanagari (Latin and Devanagari), from the official [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/notosansdevanagari), retrieved 2026-10-11. The font is bundled so private PDFs do not fetch assets externally. License: [SIL Open Font License 1.1](OFL.txt).

PDF generation uses [pdf-lib](https://pdf-lib.js.org/) and its fontkit adapter. The regenerator runtime is required by that adapter's Devanagari shaping implementation. The font is explicitly included in Next route traces for deployments.
