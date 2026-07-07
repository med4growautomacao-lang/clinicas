import React from "react";
import { DocumentChrome, SectionBlock, formatBRL, formatValidade } from "./QuoteDocument";

// Ordem de Produção (documento interno p/ a fábrica): foco em especificações + quantidade.
// Preços são opcionais (show_prices). Reaproveita o esqueleto do orçamento (DocumentChrome).

export type ProdItem = { name: string; specs: string[]; qty: string; value: number };

export function ProductionOrderDocument({ docRef, clinicName, clinicPhone, clinicEmail, clinicInstagram, clinicCnpj, clientName, clientPhone, number, dateStr, items, total, showPrices, prazo, responsavel, observacoes, accent }: {
  docRef?: React.RefObject<HTMLDivElement | null>;
  clinicName: string;
  clinicPhone: string | null;
  clinicEmail?: string | null;
  clinicInstagram?: string | null;
  clinicCnpj: string | null;
  clientName: string;
  clientPhone: string | null;
  number: string;
  dateStr: string;
  items: ProdItem[];
  total: number;
  showPrices: boolean;
  prazo: string;
  responsavel: string;
  observacoes: string;
  accent: string;
}) {
  const rowLight = "#e6ecf5";
  const rowAlt = "#f2f4f8";
  return (
    <DocumentChrome
      docRef={docRef}
      clinicName={clinicName}
      clinicPhone={clinicPhone}
      clinicEmail={clinicEmail}
      clinicInstagram={clinicInstagram}
      clinicCnpj={clinicCnpj}
      clientName={clientName}
      clientPhone={clientPhone}
      title="ORDEM DE PRODUÇÃO"
      number={number}
      dateStr={dateStr}
      accent={accent}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 30 }}>
        <thead>
          <tr style={{ borderBottom: `3px solid ${accent}` }}>
            <th style={{ textAlign: "left", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 9px" }}>PRODUTO</th>
            <th style={{ textAlign: "left", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 9px" }}>ESPECIFICAÇÕES</th>
            <th style={{ textAlign: "center", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 9px" }}>QTD</th>
            {showPrices ? <th style={{ textAlign: "right", color: accent, fontSize: 13, fontWeight: 800, padding: "0 14px 9px" }}>VALOR</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? rowLight : rowAlt }}>
              <td style={{ padding: "14px", fontWeight: 700, fontSize: 12.5, verticalAlign: "top", width: showPrices ? "24%" : "30%" }}>{it.name}</td>
              <td style={{ padding: "14px", fontSize: 12, color: "#334155", verticalAlign: "top" }}>
                {it.specs.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {it.specs.map((s, j) => <li key={j} style={{ marginBottom: 2 }}>{s}</li>)}
                  </ul>
                ) : <span style={{ color: "#94a3b8" }}>—</span>}
              </td>
              <td style={{ padding: "14px", textAlign: "center", fontWeight: 700, fontSize: 12.5, verticalAlign: "top", width: "16%", whiteSpace: "nowrap" }}>{it.qty || "—"}</td>
              {showPrices ? <td style={{ padding: "14px", textAlign: "right", fontWeight: 700, fontSize: 12.5, verticalAlign: "top", width: "18%", whiteSpace: "nowrap" }}>{formatBRL(it.value)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      {showPrices ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <div style={{ background: accent, color: "#ffffff", fontWeight: 800, fontSize: 16, padding: "11px 26px", borderRadius: 6 }}>
            TOTAL: {formatBRL(total)}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 44, marginLeft: "auto", width: "56%", display: "flex", flexDirection: "column", gap: 26 }}>
        {prazo.trim() ? <SectionBlock accent={accent} title="PRAZO DE ENTREGA">{formatValidade(prazo)}</SectionBlock> : null}
        {responsavel.trim() ? <SectionBlock accent={accent} title="RESPONSÁVEL">{responsavel}</SectionBlock> : null}
        {observacoes.trim() ? <SectionBlock accent={accent} title="OBSERVAÇÕES DE PRODUÇÃO">{observacoes}</SectionBlock> : null}
      </div>
    </DocumentChrome>
  );
}
