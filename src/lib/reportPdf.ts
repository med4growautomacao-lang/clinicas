import { jsPDF } from "jspdf";

// Converte o texto do relatório (formato WhatsApp: *negrito*, emojis, • bullets)
// num PDF A4 limpo. As fontes padrão do jsPDF NÃO têm glifos de emoji (virariam
// tofu ▯), então os emojis são removidos e a hierarquia é dada por tipografia:
// título 16pt teal, seções 11pt bold, bullets 10pt, rodapé itálico cinza.

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu;

function clean(line: string): string {
  return line.replace(EMOJI_RE, "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

export function downloadReportPdf(reportText: string, filename: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const rawLines = reportText.split("\n");
  let isFirst = true;

  for (const raw of rawLines) {
    const trimmed = raw.trim();

    // linha em branco → espaçamento
    if (trimmed === "") { y += 2.5; continue; }

    const isSection = /^\*.+\*$/.test(trimmed);                  // *💰 FINANCEIRO*
    const isFooter = /^_.+_$/.test(trimmed);                     // _legenda/_gerado em
    const text = clean(trimmed.replace(/^_|_$/g, ""));
    if (!text) continue;

    if (isFirst) {
      // Título (1ª linha: RELATÓRIO COMERCIAL)
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(13, 148, 136); // teal-600
      ensureSpace(10);
      doc.text(text, margin, y);
      y += 8;
      isFirst = false;
      continue;
    }

    if (isSection) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59); // slate-800
      ensureSpace(9);
      y += 3;
      doc.text(text, margin, y);
      y += 1.5;
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.line(margin, y, margin + maxW, y);
      y += 4.5;
      continue;
    }

    if (isFooter) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184); // slate-400
      const wrapped = doc.splitTextToSize(text, maxW);
      ensureSpace(wrapped.length * 4 + 2);
      y += 1.5;
      doc.text(wrapped, margin, y);
      y += wrapped.length * 4;
      continue;
    }

    // linha normal (cabeçalho/bullets)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85); // slate-700
    const wrapped = doc.splitTextToSize(text, maxW - (text.startsWith("•") ? 2 : 0));
    ensureSpace(wrapped.length * 5);
    doc.text(wrapped, margin + (text.startsWith("•") ? 2 : 0), y);
    y += wrapped.length * 5;
  }

  doc.save(filename);
}
