import React from "react";
import { formatBRL } from "../QuoteDocument";

// Recibo de ENTREGA: impresso na hora de entregar o pedido já separado/produzido. Gerado a
// partir de um orçamento APROVADO (número = orcamentos.number). São DUAS VIAS empilhadas na
// MESMA folha A4 (Via Empresa / Via Cliente) separadas por um tracejado: o entregador colhe a
// ASSINATURA DO CLIENTE, rasga no tracejado, deixa a Via Cliente e traz a Via Empresa assinada
// de volta (comprovante de entrega). Vai junto com a Nota Fiscal.
// Não reusa o DocumentChrome ornamentado (marca d'água + cantos não cabem em meia página cada).
// Estilos INLINE em hex (nunca classe Tailwind): oklch quebra o html2canvas na captura.

export interface ReciboItem {
  name: string;
  qtyLine: string;
  value: number;
}

export interface ReciboDocumentProps {
  docRef?: React.RefObject<HTMLDivElement | null>;
  clinicName: string;
  clinicLegalName?: string | null;
  clinicCnpj?: string | null;
  logoDataUrl?: string | null;
  number: number | string;
  dateStr: string;
  clientName: string;
  clientDoc?: string | null;
  clientAddress?: string | null;
  items: ReciboItem[];
  subtotal: number;
  desconto: number;
  frete: number;
  total: number;
  vencimento?: string | null;
  pagamento?: string | null;
  accent: string;
}

function row(label: string, value: string) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 11.5 }}>
      <span style={{ fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>{label}:</span>
      <span style={{ color: "#0f172a" }}>{value || "—"}</span>
    </div>
  );
}

function ReciboVia({ via, ...p }: ReciboDocumentProps & { via: "Via Empresa" | "Via Cliente" }) {
  const empresa = (p.clinicLegalName || p.clinicName || "Sua Empresa").trim();
  return (
    <div style={{ padding: "20px 40px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {p.logoDataUrl ? <img src={p.logoDataUrl} alt={empresa} style={{ maxHeight: 30, maxWidth: 140, objectFit: "contain" }} /> : null}
        <div style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>
          Empresa: {empresa}{p.clinicCnpj ? <span style={{ fontWeight: 400 }}> · CNPJ: {p.clinicCnpj}</span> : null}
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: 12 }}>
        <div style={{ fontSize: 21, fontWeight: 800, color: p.accent, letterSpacing: 1 }}>RECIBO DE ENTREGA</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginTop: 2 }}>Pedido Nº {p.number} — {p.dateStr}</div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px" }}>
        {row("Cliente", p.clientName)}
        {row("Documento", p.clientDoc || "")}
        {row("Vencimento", p.vencimento || "—")}
        {row("Pagamento", p.pagamento || "—")}
      </div>
      {p.clientAddress ? <div style={{ marginTop: 6 }}>{row("Endereço", p.clientAddress)}</div> : null}

      {p.items.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${p.accent}` }}>
              <th style={{ textAlign: "left", fontSize: 11, fontWeight: 800, color: p.accent, padding: "0 8px 6px" }}>ITEM</th>
              <th style={{ textAlign: "right", fontSize: 11, fontWeight: 800, color: p.accent, padding: "0 8px 6px" }}>VALOR</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((it, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#f8fafc" : "#ffffff" }}>
                <td style={{ padding: "6px 8px", fontSize: 11.5, fontWeight: 600 }}>
                  {it.name}
                  {it.qtyLine ? <span style={{ color: "#64748b", fontWeight: 400 }}> — {it.qtyLine}</span> : null}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>{formatBRL(it.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
        <div style={{ width: 220 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "2px 0" }}><span>Subtotal</span><span>{formatBRL(p.subtotal)}</span></div>
          {p.desconto > 0 ? <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "2px 0", color: "#e11d48" }}><span>Desconto</span><span>-{formatBRL(p.desconto)}</span></div> : null}
          {p.frete > 0 ? <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "2px 0" }}><span>Frete</span><span>+{formatBRL(p.frete)}</span></div> : null}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800, color: p.accent, borderTop: `1.5px solid ${p.accent}`, marginTop: 4, padding: "5px 0 0" }}>
            <span>TOTAL</span><span>{formatBRL(p.total)}</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
        Declaro ter recebido os itens descritos acima, conferidos e em conformidade com o pedido.
      </div>

      {/* Assinatura do CLIENTE (quem recebe) + data da entrega, preenchidas à mão pelo entregador. */}
      <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #94a3b8", paddingTop: 4, fontSize: 10.5, fontWeight: 700 }}>Assinatura do cliente</div>
          <div style={{ fontSize: 9.5, color: "#64748b", marginTop: 1 }}>{p.clientName}</div>
        </div>
        <div style={{ width: 150, textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #94a3b8", paddingTop: 4, fontSize: 10.5, fontWeight: 700 }}>Data da entrega</div>
        </div>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{via}</div>
      </div>
    </div>
  );
}

export function ReciboDocument({ docRef, ...props }: ReciboDocumentProps) {
  return (
    <div
      ref={docRef}
      style={{ width: 794, background: "#ffffff", color: "#0f172a", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <ReciboVia {...props} via="Via Empresa" />
      <div style={{ borderTop: "1px dashed #94a3b8", margin: "0 40px" }} />
      <ReciboVia {...props} via="Via Cliente" />
    </div>
  );
}
