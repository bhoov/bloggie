// The number of pages in a PDF that Chromium printed (scripts/export/pdf.js): it writes each page object as plain
// text, "/Type /Page", so they can be counted without a PDF library.
export const pdfPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
