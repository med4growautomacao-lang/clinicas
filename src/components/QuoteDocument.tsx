import React from "react";

// Documento formal do orçamento (layout A4). Estilos INLINE com cores hex (não usar classe
// Tailwind: o oklch quebra o html2canvas na captura para imagem/PDF). Reutilizado no modal
// de Orçamento do Kanban (LeadKanban) e na prévia do modelo (Settings).

const formatBRL = (val: number | string) => {
  const n = typeof val === "string" ? Number(val) : val;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
};

// Validade para exibição: se for só número, vira "N dias"; senão mantém o texto (ex.: "7 dias", "1 mês").
export const formatValidade = (v: string | null | undefined) => {
  const s = String(v ?? "").trim();
  return s && /^\d+$/.test(s) ? `${s} dias` : s;
};

export type QuoteDocItem = { name: string; description: string | null; specs: string[]; qtyLine: string; value: number };

export function QuoteDocument({ docRef, clinicName, clinicPhone, clinicEmail, clinicInstagram, clinicAddress, clinicCnpj, clientName, clientPhone, number, dateStr, items, total, pagamento, validade, accent }: {
  docRef?: React.RefObject<HTMLDivElement | null>;
  clinicName: string;
  clinicPhone: string | null;
  clinicEmail?: string | null;
  clinicInstagram?: string | null;
  clinicAddress: string | null;
  clinicCnpj: string | null;
  clientName: string;
  clientPhone: string | null;
  number: string;
  dateStr: string;
  items: QuoteDocItem[];
  total: number;
  pagamento: string;
  validade: string;
  accent: string;
}) {
  const rowLight = "#eef2f7";

  // Ícones (SVG inline, estilo Lucide) em um círculo na cor da clínica, à direita do texto.
  const P_PHONE = <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />;
  const P_MAIL = <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>;
  const P_IG = <><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" x2="17.51" y1="6.5" y2="6.5" /></>;
  const contactRow = (key: string, text: string, glyph: React.ReactNode) => (
    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, marginBottom: 5 }}>
      <span>{text}</span>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{glyph}</svg>
      </span>
    </div>
  );
  const igText = clinicInstagram ? (clinicInstagram.trim().startsWith("@") || clinicInstagram.includes("/") ? clinicInstagram.trim() : `@${clinicInstagram.trim()}`) : "";

  return (
    <div ref={docRef} style={{ width: 794, minHeight: 1040, background: "#ffffff", color: "#0f172a", fontFamily: "Arial, Helvetica, sans-serif", position: "relative", overflow: "hidden" }}>
      {/* marca d'água (inicial da clínica, bem clara) */}
      <div style={{ position: "absolute", top: -80, left: 10, fontSize: 470, lineHeight: 1, fontWeight: 900, color: accent, opacity: 0.05 }}>{(clinicName || "&").charAt(0)}</div>

      {/* canto superior direito: cluster angular */}
      <div style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderTop: `132px solid ${accent}`, borderLeft: "132px solid transparent" }} />
      <div style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderTop: "80px solid rgba(15,23,42,0.30)", borderLeft: "80px solid transparent" }} />
      <div style={{ position: "absolute", top: 24, right: -34, width: 140, height: 12, background: accent, opacity: 0.5, transform: "rotate(-45deg)" }} />

      {/* canto inferior esquerdo: barras angulares empilhadas */}
      <div style={{ position: "absolute", bottom: -50, left: -50, width: 172, height: 172, background: accent, transform: "rotate(45deg)", borderRadius: 12 }} />
      <div style={{ position: "absolute", bottom: -18, left: -60, width: 120, height: 120, background: "rgba(15,23,42,0.22)", transform: "rotate(45deg)", borderRadius: 10 }} />
      <div style={{ position: "absolute", bottom: 78, left: -16, width: 132, height: 14, background: accent, opacity: 0.5, transform: "rotate(45deg)" }} />
      <div style={{ position: "absolute", bottom: 44, left: 10, width: 96, height: 12, background: accent, opacity: 0.35, transform: "rotate(45deg)" }} />

      <div style={{ position: "relative", padding: "46px 54px 130px" }}>
        {/* cabeçalho */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, paddingRight: 50 }}>
          <div style={{ fontSize: 21, fontWeight: 800, color: accent, maxWidth: 340 }}>{clinicName || "Sua Empresa"}</div>
          <div style={{ fontSize: 11, color: "#475569" }}>
            {clinicPhone ? contactRow("ph", clinicPhone, P_PHONE) : null}
            {clinicEmail ? contactRow("em", clinicEmail, P_MAIL) : null}
            {clinicInstagram ? contactRow("ig", igText, P_IG) : null}
            {clinicCnpj ? <div style={{ textAlign: "right", marginTop: 2 }}>CNPJ: {clinicCnpj}</div> : null}
          </div>
        </div>

        {/* título */}
        <div style={{ marginTop: 36 }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: accent }}>ORÇAMENTO #{number}</div>
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3 }}>Data: {dateStr}</div>
        </div>

        {/* A/C */}
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: accent }}>A/C:</div>
          <div style={{ fontSize: 13, marginTop: 5, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600 }}>{clientName || "—"}</div>
            {clientPhone ? <div>{clientPhone}</div> : null}
          </div>
        </div>

        {/* tabela */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 30 }}>
          <thead>
            <tr style={{ borderBottom: `3px solid ${accent}` }}>
              <th style={{ textAlign: "left", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 9px" }}>SERVIÇO</th>
              <th style={{ textAlign: "center", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 9px" }}>DESCRIÇÃO</th>
              <th style={{ textAlign: "right", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 9px" }}>VALOR</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? rowLight : "#ffffff" }}>
                <td style={{ padding: "14px", fontWeight: 700, fontSize: 12.5, verticalAlign: "top", width: "26%" }}>{it.name}</td>
                <td style={{ padding: "14px", fontSize: 12, color: "#334155", verticalAlign: "top" }}>
                  {it.description ? <div style={{ marginBottom: 4 }}>{it.description}</div> : null}
                  {it.specs.length > 0 ? (
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      {it.specs.map((s, j) => <li key={j} style={{ marginBottom: 2 }}>{s}</li>)}
                    </ol>
                  ) : null}
                  {it.qtyLine ? <div style={{ marginTop: 6, fontSize: 11.5, color: "#64748b" }}>{it.qtyLine}</div> : null}
                </td>
                <td style={{ padding: "14px", textAlign: "right", fontWeight: 700, fontSize: 12.5, verticalAlign: "top", width: "20%", whiteSpace: "nowrap" }}>{formatBRL(it.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* total */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <div style={{ background: accent, color: "#ffffff", fontWeight: 800, fontSize: 16, padding: "11px 26px", borderRadius: 6 }}>
            TOTAL: {formatBRL(total)}
          </div>
        </div>

        {/* pagamento + termos */}
        <div style={{ marginTop: 44, display: "flex", flexDirection: "column", gap: 24 }}>
          {pagamento ? (
            <div>
              <div style={{ width: 36, height: 3, background: accent, borderRadius: 2, marginBottom: 7 }} />
              <div style={{ fontSize: 13, fontWeight: 800, color: accent }}>FORMA DE PAGAMENTO</div>
              <div style={{ fontSize: 12, color: "#334155", marginTop: 8, lineHeight: 1.6 }}>{pagamento}</div>
            </div>
          ) : null}
          <div>
            <div style={{ width: 36, height: 3, background: accent, borderRadius: 2, marginBottom: 7 }} />
            <div style={{ fontSize: 13, fontWeight: 800, color: accent }}>TERMOS E CONDIÇÕES</div>
            <div style={{ fontSize: 12, color: "#334155", marginTop: 8, lineHeight: 1.6 }}>
              {validade ? `Este orçamento é válido por ${formatValidade(validade)}.` : "Orçamento sujeito a confirmação de disponibilidade."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
