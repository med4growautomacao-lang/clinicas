import React, { useState, useEffect } from "react";

// Converte uma imagem (URL) em data URI base64, p/ o html2canvas capturar sem problema de CORS.
export function useImageDataUrl(url: string | null | undefined) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!url) { setDataUrl(null); return; }
    (async () => {
      try {
        const res = await fetch(url, { mode: "cors" });
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => { if (!cancelled) setDataUrl(reader.result as string); };
        reader.readAsDataURL(blob);
      } catch {
        if (!cancelled) setDataUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);
  return dataUrl;
}

// Documentos formais A4 (orçamento e ordem de produção). Estilos INLINE com cores hex
// (não usar classe Tailwind: o oklch quebra o html2canvas na captura p/ imagem/PDF).
// DocumentChrome = esqueleto compartilhado (formas, cabeçalho com contatos, título, A/C).

export const formatBRL = (val: number | string) => {
  const n = typeof val === "string" ? Number(val) : val;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
};

// Validade/prazo p/ exibição: se for só número, vira "N dias"; senão mantém (ex.: "7 dias", "1 mês").
export const formatValidade = (v: string | null | undefined) => {
  const s = String(v ?? "").trim();
  return s && /^\d+$/.test(s) ? `${s} dias` : s;
};

export type QuoteDocItem = { name: string; description: string | null; specs: string[]; qtyLine: string; value: number };

// Bloco de seção com traço curto na cor da clínica + título + conteúdo (pagamento, termos, obs...).
export function SectionBlock({ accent, title, children, align = "left" }: { accent: string; title: string; children: React.ReactNode; align?: "left" | "center" }) {
  const centered = align === "center";
  return (
    <div style={centered ? { textAlign: "center" } : undefined}>
      <div style={{ width: 42, height: 3, background: accent, borderRadius: 2, marginBottom: 9, ...(centered ? { marginLeft: "auto", marginRight: "auto" } : {}) }} />
      <div style={{ fontSize: 16, fontWeight: 800, color: accent }}>{title}</div>
      <div style={{ fontSize: 13.5, color: "#334155", marginTop: 9, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

// Esqueleto A4: formas decorativas, cabeçalho (nome + contatos c/ ícones), título e A/C; o
// corpo (tabela, total, seções) vem como children.
export function DocumentChrome({ docRef, clinicName, clinicLegalName, clinicPhone, clinicEmail, clinicInstagram, clinicAddress, clinicCnpj, logoDataUrl, clientName, clientPhone, title, number, dateStr, accent, hideClient, children }: {
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
  title: string;
  number: string;
  dateStr: string;
  accent: string;
  hideClient?: boolean;
  children: React.ReactNode;
}) {
  const P_PHONE = <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />;
  const P_MAIL = <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>;
  const P_IG = <><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" x2="17.51" y1="6.5" y2="6.5" /></>;
  const P_CNPJ = <><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4" /><path d="M10 10h4" /><path d="M10 14h4" /></>;
  const P_ADDR = <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>;
  const contactRow = (key: string, text: string, glyph: React.ReactNode, maxWidth?: number) => (
    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, marginBottom: 5 }}>
      <span style={maxWidth ? { maxWidth, textAlign: "right", lineHeight: 1.4 } : undefined}>{text}</span>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{glyph}</svg>
      </span>
    </div>
  );
  const igText = clinicInstagram ? (clinicInstagram.trim().startsWith("@") || clinicInstagram.includes("/") ? clinicInstagram.trim() : `@${clinicInstagram.trim()}`) : "";
  const addrText = clinicAddress ? clinicAddress.replace(/\s*\n+\s*/g, ", ").trim() : "";
  const companyName = (clinicLegalName || clinicName || "").trim();

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
          <div style={{ maxWidth: 340 }}>
            {logoDataUrl
              ? <img src={logoDataUrl} alt={companyName} style={{ maxHeight: 58, maxWidth: 300, objectFit: "contain", display: "block", marginBottom: 8 }} />
              : null}
            {companyName
              ? <div style={{ fontSize: logoDataUrl ? 15 : 21, fontWeight: 800, color: accent, lineHeight: 1.25 }}>{companyName}</div>
              : (!logoDataUrl ? <div style={{ fontSize: 21, fontWeight: 800, color: accent }}>Sua Empresa</div> : null)}
          </div>
          <div style={{ fontSize: 11, color: "#475569" }}>
            {clinicPhone ? contactRow("ph", clinicPhone, P_PHONE) : null}
            {clinicEmail ? contactRow("em", clinicEmail, P_MAIL) : null}
            {clinicInstagram ? contactRow("ig", igText, P_IG) : null}
            {addrText ? contactRow("ad", addrText, P_ADDR, 230) : null}
            {clinicCnpj ? contactRow("cn", `CNPJ: ${clinicCnpj}`, P_CNPJ) : null}
          </div>
        </div>

        {/* título */}
        <div style={{ marginTop: 36 }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: accent }}>{title} #{number}</div>
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3 }}>Data: {dateStr}</div>
        </div>

        {/* A/C */}
        {!hideClient ? (
          <div style={{ marginTop: 26 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: accent }}>A/C:</div>
            <div style={{ fontSize: 13, marginTop: 5, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600 }}>{clientName || "—"}</div>
              {clientPhone ? <div>{clientPhone}</div> : null}
            </div>
          </div>
        ) : null}

        {children}
      </div>
    </div>
  );
}

export function QuoteDocument({ docRef, clinicName, clinicLegalName, clinicPhone, clinicEmail, clinicInstagram, clinicAddress, clinicCnpj, logoDataUrl, clientName, clientPhone, number, dateStr, items, total, pagamento, validade, accent }: {
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
  number: string;
  dateStr: string;
  items: QuoteDocItem[];
  total: number;
  pagamento: string;
  validade: string;
  accent: string;
}) {
  const rowLight = "#e6ecf5";
  const rowAlt = "#f2f4f8";
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
      title="ORÇAMENTO"
      number={number}
      dateStr={dateStr}
      accent={accent}
    >
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
            <tr key={i} style={{ background: i % 2 === 0 ? rowLight : rowAlt }}>
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

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <div style={{ background: accent, color: "#ffffff", fontWeight: 800, fontSize: 16, padding: "11px 26px", borderRadius: 6 }}>
          TOTAL: {formatBRL(total)}
        </div>
      </div>

      <div style={{ margin: "44px auto 0", width: "72%", display: "flex", flexDirection: "column", gap: 26 }}>
        {pagamento ? <SectionBlock accent={accent} title="FORMA DE PAGAMENTO" align="center">{pagamento}</SectionBlock> : null}
        <SectionBlock accent={accent} title="TERMOS E CONDIÇÕES" align="center">
          {validade ? `Este orçamento é válido por ${formatValidade(validade)}.` : "Orçamento sujeito a confirmação de disponibilidade."}
        </SectionBlock>
      </div>
    </DocumentChrome>
  );
}
