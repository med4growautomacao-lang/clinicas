import React from "react";
import { DocumentChrome, SectionBlock, formatBRL, formatValidade } from "./QuoteDocument";

// Ordem de Produção (documento interno p/ a fábrica). Segue o formulário de fábrica de telas:
// Nº da OP + datas (no cabeçalho/título), DADOS DO CLIENTE, e por item TIPO DE PRODUTO +
// ESPECIFICAÇÕES (bitola/comprimento/altura/malha) com caixas marcadas a partir do orçamento.

export type ProdItem = { name: string; attrs: { label: string; value: string }[]; comprimento?: string; altura?: string; qty: string; value: number };

const attrVal = (attrs: { label: string; value: string }[], keys: string[]) => {
  const a = attrs.find(x => keys.some(k => (x.label || "").toLowerCase().includes(k)));
  return a ? (a.value || "") : "";
};
const digits = (s: string) => (s || "").replace(",", ".").replace(/[^\d.]/g, "");

export function ProductionOrderDocument({ docRef, clinicName, clinicLegalName, clinicPhone, clinicEmail, clinicInstagram, clinicAddress, clinicCnpj, logoDataUrl, clientName, clientPhone, cidade, vendedor, number, dateStr, prazo, items, total, showPrices, observacoes, accent }: {
  docRef?: React.RefObject<HTMLDivElement | null>;
  clinicName: string;
  clinicLegalName?: string | null;
  clinicPhone: string | null;
  clinicEmail?: string | null;
  clinicInstagram?: string | null;
  clinicAddress?: string | null;
  clinicCnpj: string | null;
  logoDataUrl?: string | null;
  clientName: string;
  clientPhone: string | null;
  cidade: string;
  vendedor: string;
  number: string;
  dateStr: string;
  prazo: string;
  items: ProdItem[];
  total: number;
  showPrices: boolean;
  observacoes: string;
  accent: string;
}) {
  const heading = (text: string) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ width: 42, height: 3, background: accent, borderRadius: 2, marginBottom: 7 }} />
      <div style={{ fontSize: 15, fontWeight: 800, color: accent }}>{text}</div>
    </div>
  );
  const field = (label: string, value: string) => (
    <div style={{ fontSize: 13, marginBottom: 7, display: "flex", gap: 6 }}>
      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{label}:</span>
      <span style={{ borderBottom: "1px solid #cbd5e1", flex: 1, minWidth: 0, paddingBottom: 1 }}>{value || " "}</span>
    </div>
  );
  const cbox = (on: boolean, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginRight: 18, fontSize: 12.5, fontWeight: on ? 700 : 400 }}>
      <span style={{ width: 15, height: 15, border: `1.6px solid ${on ? accent : "#94a3b8"}`, borderRadius: 3, background: on ? accent : "#ffffff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {on ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : null}
      </span>
      {label}
    </span>
  );

  return (
    <DocumentChrome
      docRef={docRef}
      clinicName={clinicName}
      clinicLegalName={clinicLegalName}
      clinicPhone={clinicPhone}
      clinicEmail={clinicEmail}
      clinicInstagram={clinicInstagram}
      clinicAddress={clinicAddress}
      clinicCnpj={clinicCnpj}
      logoDataUrl={logoDataUrl}
      clientName={clientName}
      clientPhone={clientPhone}
      title="ORDEM DE PRODUÇÃO"
      number={number}
      dateStr={dateStr}
      accent={accent}
      hideClient
    >
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>Data prevista para entrega: {prazo ? formatValidade(prazo) : "____________"}</div>

      {/* DADOS DO CLIENTE */}
      <div style={{ marginTop: 24 }}>
        {heading("DADOS DO CLIENTE")}
        {field("Cliente", clientName)}
        {field("Cidade", cidade)}
        {field("Telefone", clientPhone || "")}
        {field("Vendedor", vendedor)}
      </div>

      {/* Itens */}
      {items.map((it, idx) => {
        const bit = digits(attrVal(it.attrs, ["fio", "bitola", "arame"]));
        const malha = digits(attrVal(it.attrs, ["malha"]));
        return (
          <div key={idx} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{it.name}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>Qtd: {it.qty || "—"}{showPrices ? ` · ${formatBRL(it.value)}` : ""}</div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: accent, marginBottom: 6 }}>ESPECIFICAÇÕES DO PEDIDO</div>
              <div style={{ fontSize: 12.5, marginBottom: 7, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, marginRight: 10 }}>Bitola do Arame:</span>
                {["12", "14", "16", "18"].map(o => <React.Fragment key={o}>{cbox(bit === o, o)}</React.Fragment>)}
              </div>
              {field("Comprimento (m)", it.comprimento || "")}
              {field("Altura (m)", it.altura || "")}
              <div style={{ fontSize: 12.5, marginTop: 3, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, marginRight: 10 }}>Malha:</span>
                {cbox(malha === "3", '3"')}{cbox(malha === "2.5", '2.5"')}{cbox(malha === "2", '2"')}
              </div>
            </div>
          </div>
        );
      })}

      {showPrices ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <div style={{ background: accent, color: "#ffffff", fontWeight: 800, fontSize: 16, padding: "11px 26px", borderRadius: 6 }}>
            TOTAL: {formatBRL(total)}
          </div>
        </div>
      ) : null}

      {observacoes.trim() ? (
        <div style={{ marginTop: 30 }}>
          <SectionBlock accent={accent} title="OBSERVAÇÕES DE PRODUÇÃO">{observacoes}</SectionBlock>
        </div>
      ) : null}
    </DocumentChrome>
  );
}
