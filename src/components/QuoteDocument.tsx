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

export type QuoteDocItem = { name: string; description: string | null; specs: string[]; qtyLine: string; value: number };

export function QuoteDocument({ docRef, clinicName, clinicPhone, clinicAddress, clinicCnpj, clientName, clientPhone, number, dateStr, items, total, pagamento, validade, accent }: {
  docRef?: React.RefObject<HTMLDivElement | null>;
  clinicName: string;
  clinicPhone: string | null;
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
  return (
    <div ref={docRef} style={{ width: 794, minHeight: 1040, background: "#ffffff", color: "#0f172a", fontFamily: "Arial, Helvetica, sans-serif", position: "relative", overflow: "hidden" }}>
      {/* marca d'água + formas geométricas */}
      <div style={{ position: "absolute", top: -70, left: 24, fontSize: 420, lineHeight: 1, fontWeight: 900, color: accent, opacity: 0.06 }}>{(clinicName || "&").charAt(0)}</div>
      <div style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderTop: `110px solid ${accent}`, borderLeft: "110px solid transparent" }} />
      <div style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderTop: "58px solid rgba(15,23,42,0.20)", borderLeft: "58px solid transparent" }} />
      <div style={{ position: "absolute", bottom: -44, left: -44, width: 170, height: 170, background: accent, opacity: 0.9, transform: "rotate(35deg)", borderRadius: 14 }} />
      <div style={{ position: "absolute", bottom: 26, left: 66, width: 92, height: 92, background: accent, opacity: 0.45, transform: "rotate(20deg)", borderRadius: 10 }} />

      <div style={{ position: "relative", padding: "46px 54px 130px" }}>
        {/* cabeçalho */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
          <div style={{ fontSize: 21, fontWeight: 800, color: accent, maxWidth: 380 }}>{clinicName || "Sua Empresa"}</div>
          <div style={{ textAlign: "right", fontSize: 11, color: "#475569", lineHeight: 1.7 }}>
            {clinicPhone ? <div>{clinicPhone}</div> : null}
            {clinicAddress ? <div style={{ maxWidth: 230 }}>{clinicAddress}</div> : null}
            {clinicCnpj ? <div>CNPJ: {clinicCnpj}</div> : null}
          </div>
        </div>

        {/* título */}
        <div style={{ marginTop: 36 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: accent }}>ORÇAMENTO #{number}</div>
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
            <tr style={{ borderBottom: `2px solid ${accent}` }}>
              <th style={{ textAlign: "left", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 8px" }}>SERVIÇO</th>
              <th style={{ textAlign: "left", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 8px" }}>DESCRIÇÃO</th>
              <th style={{ textAlign: "right", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 8px" }}>VALOR</th>
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
          <div style={{ background: accent, color: "#ffffff", fontWeight: 800, fontSize: 15, padding: "10px 22px", borderRadius: 4 }}>
            TOTAL: {formatBRL(total)}
          </div>
        </div>

        {/* pagamento + termos */}
        <div style={{ marginTop: 42, display: "flex", gap: 56 }}>
          {pagamento ? (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: accent, borderBottom: `2px solid ${accent}`, paddingBottom: 4, display: "inline-block" }}>FORMA DE PAGAMENTO</div>
              <div style={{ fontSize: 12, color: "#334155", marginTop: 8, lineHeight: 1.6 }}>{pagamento}</div>
            </div>
          ) : null}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: accent, borderBottom: `2px solid ${accent}`, paddingBottom: 4, display: "inline-block" }}>TERMOS E CONDIÇÕES</div>
            <div style={{ fontSize: 12, color: "#334155", marginTop: 8, lineHeight: 1.6 }}>
              {validade ? `Este orçamento é válido por ${validade}.` : "Orçamento sujeito a confirmação de disponibilidade."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
