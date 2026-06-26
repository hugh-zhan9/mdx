console.log([
  "Manual editor verification:",
  "1. Run npm run dev and open the app.",
  "2. Open a Markdown file with headings, bold text, table, task list, math, Mermaid, callout, and footnote.",
  "3. Confirm the hybrid editor surface is the only visible Markdown editor and no global Source/源码 mode toggle is visible.",
  "4. Edit each structure in WYSIWYG; confirm dirty state, save, and reopen without content loss.",
  "5. Select content and copy it; paste into a plain text target and a rich text target.",
  "6. Type Chinese text with IME into a paragraph, table cell, and callout.",
  "7. Export the document as PDF and confirm math, Mermaid, table, and fallback HTML still render in the export preview/output.",
  "8. Run node scripts/measure-tex-canvas-layout.mjs and confirm the mixed-layout smoke stays within the reported budget.",
].join("\n"));
