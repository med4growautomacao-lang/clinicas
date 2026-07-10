import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { FileText, Send, CheckCircle2, XCircle, Search, ExternalLink, Printer, Download, Receipt } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useOrcamentos, useSettings, useProducts, useProtocols, Orcamento, OrcamentoStatus } from "../../hooks/useSupabase";
import { supabase } from "../../lib/supabase";
import { useToast } from "../ui/toast";
import { Button, Modal, Field, StatCard, StatusBadge, EmptyState, inputCls, fmtDate, fmtQty } from "../production/shared";
import { useImageDataUrl } from "../QuoteDocument";
import { ReciboDocument, ReciboItem } from "./ReciboDocument";

function fmtBRL(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n ?? 0));
}

const STATUS_META: Record<OrcamentoStatus, { label: string; tone: "slate" | "amber" | "emerald" | "rose" | "sky" | "violet" }> = {
  rascunho: { label: "Rascunho", tone: "slate" },
  enviado: { label: "Enviado", tone: "sky" },
  aprovado: { label: "Aprovado", tone: "emerald" },
  recusado: { label: "Recusado", tone: "rose" },
  expirado: { label: "Expirado", tone: "amber" },
};

const FILTERS: { id: OrcamentoStatus | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "rascunho", label: "Rascunho" },
  { id: "enviado", label: "Enviado" },
  { id: "aprovado", label: "Aprovado" },
  { id: "recusado", label: "Recusado" },
];

// A construção/edição do orçamento continua no Kanban comercial (OrcamentoModal já é um
// componente grande e testado ali); a Central foca em visibilidade + status + aprovação.
function goToLeadKanban() {
  localStorage.setItem("aiSecretaryTab", "leads");
  window.dispatchEvent(new CustomEvent("app-navigate", { detail: { tab: "ai-secretary" } }));
}

function mapApproveError(code?: string) {
  return (
    {
      no_open_ticket: "Este lead não tem um card ativo no funil — abra/reabra o card no Kanban antes de aprovar.",
      ticket_perdido: "O card deste lead está marcado como Perdido — reverta a perda no Kanban antes de aprovar.",
      no_lead_linked: "Este orçamento não está vinculado a um lead.",
      already_processed: "Este orçamento já foi processado (aprovado/recusado).",
      forbidden: "Sem permissão para aprovar este orçamento.",
      orcamento_not_found: "Orçamento não encontrado.",
    } as Record<string, string>
  )[code || ""] || "Não foi possível aprovar o orçamento.";
}

export function OrcamentosCentral() {
  const showToast = useToast();
  const { data: orcamentos, loading, approve, updateStatus } = useOrcamentos();
  const [filter, setFilter] = useState<OrcamentoStatus | "todos">("todos");
  const [search, setSearch] = useState("");
  const [approveTarget, setApproveTarget] = useState<Orcamento | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Orcamento | null>(null);
  const [printTarget, setPrintTarget] = useState<Orcamento | null>(null);

  const abertos = orcamentos.filter(o => o.status === "rascunho" || o.status === "enviado");
  const aprovados = orcamentos.filter(o => o.status === "aprovado");
  const totalAberto = abertos.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalAprovado = aprovados.reduce((s, o) => s + Number(o.total || 0), 0);
  const processedCount = orcamentos.filter(o => o.status === "aprovado" || o.status === "recusado").length;
  const approvalRate = processedCount > 0 ? Math.round((aprovados.length / processedCount) * 100) : 0;

  const filtered = useMemo(() => {
    let list = filter === "todos" ? orcamentos : orcamentos.filter(o => o.status === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(o => (o.client_name || o.lead?.name || "").toLowerCase().includes(q) || String(o.number).includes(q));
    return list;
  }, [orcamentos, filter, search]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Central de Orçamentos</h1>
        <p className="text-sm text-slate-500 mt-0.5">Todos os orçamentos da fábrica — status, aprovação e histórico.</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <StatCard label="Em aberto" value={String(abertos.length)} icon={<FileText className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Valor em aberto" value={fmtBRL(totalAberto)} tone="teal" />
        <StatCard label="Aprovados" value={String(aprovados.length)} tone="emerald" icon={<CheckCircle2 className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Faturado (aprovados)" value={fmtBRL(totalAprovado)} tone="emerald" />
        <StatCard label="Taxa de aprovação" value={`${approvalRate}%`} tone={approvalRate >= 50 ? "emerald" : "amber"} />
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", filter === f.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className={cn(inputCls, "pl-9 w-56")}
            placeholder="Buscar cliente ou nº…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-10 text-center">Carregando…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-7 h-7" />}
          title="Nenhum orçamento aqui"
          hint="Orçamentos são criados a partir do Kanban comercial (Comercial → Leads), ao mover um lead para a etapa Orçamento."
          action={<Button size="sm" variant="outline" onClick={goToLeadKanban}><ExternalLink className="w-4 h-4 mr-1.5" /> Ir para o Kanban</Button>}
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map(o => (
            <OrcamentoRow
              key={o.id}
              o={o}
              onApprove={() => setApproveTarget(o)}
              onReject={() => setRejectTarget(o)}
              onPrint={() => setPrintTarget(o)}
              onMarkSent={async () => {
                const res = await updateStatus(o.id, "enviado");
                showToast(res.success ? "Marcado como enviado." : "Erro ao atualizar.", res.success ? "success" : "error");
              }}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {approveTarget && (
          <ApproveModal
            orcamento={approveTarget}
            onClose={() => setApproveTarget(null)}
            onConfirm={async opts => {
              const res = await approve(approveTarget.id, opts);
              if (res.success) {
                showToast(
                  (res as any).already_sold
                    ? `Orçamento #${approveTarget.number} aprovado (venda já existente, sem duplicar receita).`
                    : `Orçamento #${approveTarget.number} aprovado — venda registrada.`,
                  "success"
                );
              } else {
                showToast(mapApproveError(res.error_code), "error");
              }
              setApproveTarget(null);
            }}
          />
        )}
        {rejectTarget && (
          <RejectModal
            orcamento={rejectTarget}
            onClose={() => setRejectTarget(null)}
            onConfirm={async reason => {
              const res = await updateStatus(rejectTarget.id, "recusado", reason);
              showToast(res.success ? `Orçamento #${rejectTarget.number} recusado.` : "Erro ao recusar.", res.success ? "success" : "error");
              setRejectTarget(null);
            }}
          />
        )}
        {printTarget && (
          <GerarReciboModal orcamento={printTarget} onClose={() => setPrintTarget(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function OrcamentoRow({ o, onApprove, onReject, onPrint, onMarkSent }: {
  o: Orcamento;
  onApprove: () => void;
  onReject: () => void;
  onPrint: () => void;
  onMarkSent: () => void;
}) {
  const clientName = o.client_name || o.lead?.name || "—";
  const pending = o.status === "rascunho" || o.status === "enviado";
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-black text-slate-400">#{o.number}</span>
          <StatusBadge label={STATUS_META[o.status].label} tone={STATUS_META[o.status].tone} />
          {o.status === "aprovado" && !o.approved_ticket_id && (
            <span className="text-[10px] font-bold text-amber-600">venda desfeita</span>
          )}
        </div>
        <p className="font-bold text-slate-800 text-sm truncate">{clientName}</p>
        <p className="text-xs text-slate-400 mt-0.5">{fmtDate(o.created_at)}</p>
      </div>
      <div className="text-right">
        <p className="text-lg font-black text-slate-900">{fmtBRL(o.total)}</p>
      </div>
      <div className="flex items-center gap-1.5">
        {o.status === "rascunho" && (
          <Button size="sm" variant="outline" onClick={onMarkSent}><Send className="w-3.5 h-3.5 mr-1" /> Marcar enviado</Button>
        )}
        {pending && (
          <>
            <Button size="sm" onClick={onApprove}><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Aprovar</Button>
            <button title="Recusar" onClick={onReject} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"><XCircle className="w-4 h-4" /></button>
          </>
        )}
        {o.status === "aprovado" && (
          <Button size="sm" variant="outline" onClick={onPrint}><Receipt className="w-3.5 h-3.5 mr-1" /> Recibo</Button>
        )}
        <button title="Ver no Kanban" onClick={goToLeadKanban} className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><ExternalLink className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

// Mini-confirmação de pagamento — "Aprovar" fecha a venda (Ganho + receita), decisão do usuário.
function ApproveModal({ orcamento, onClose, onConfirm }: {
  orcamento: Orcamento;
  onClose: () => void;
  onConfirm: (opts: { paymentMethod: string; paymentStatus: "pago" | "pendente"; paymentDate: string; dataEntrega?: string | null; lineKeys?: string[] | null; total?: number | null }) => Promise<void>;
}) {
  const { clinic } = useSettings();
  const { data: products } = useProducts();
  const { data: protocols } = useProtocols();
  const isFactory = clinic?.category === "outro";
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [paymentStatus, setPaymentStatus] = useState<"pago" | "pendente">("pago");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [eta, setEta] = useState<any>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [dataEntrega, setDataEntrega] = useState<string>(orcamento.data_entrega_prevista ?? "");

  // Itens cotados. O vendedor marca quais viram pedido/OP (a fábrica costuma cotar 2 opções — ex.:
  // fio grosso e fio fino — e o cliente escolhe uma). Todos marcados por padrão.
  const lines = useMemo(() => resolveOrcamentoLines(orcamento.snapshot, products, protocols), [orcamento.snapshot, products, protocols]);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const sel = selected ?? new Set(lines.map(l => l.key));
  const toggle = (key: string) => {
    const next = new Set(sel);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
  };
  const selectedLines = lines.filter(l => sel.has(l.key));
  const selectedTotal = selectedLines.reduce((s, l) => s + l.value, 0);
  const isPartial = lines.length > 1 && selectedLines.length < lines.length;
  // Chave estável p/ re-rodar a simulação quando a seleção muda.
  const selKey = selectedLines.map(l => l.key).join(",");

  // Simula disponibilidade/prazo dos itens SELECIONADOS. Depende de isFactory porque `clinic` chega
  // async (na 1ª renderização é null) — sem isso o efeito rodava cedo demais e nunca chamava a RPC.
  useEffect(() => {
    if (!isFactory) return;
    if (selectedLines.length === 0) { setEta(null); setEtaLoading(false); return; }
    const payload = selectedLines
      .filter(l => l.productId.startsWith("p:"))
      .map(l => ({ productId: l.productId, qty: String(l.qty), altura: l.altura ? String(l.altura) : "" }));
    if (payload.length === 0) { setEta(null); setEtaLoading(false); return; }
    let cancelled = false;
    setEtaLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("simulate_production_eta", { p_clinic_id: orcamento.clinic_id, p_lines: payload });
      if (cancelled) return;
      setEtaLoading(false);
      if (error || !(data as any)?.success) { setEta({ error: true }); return; }
      const res = data as any;
      setEta(res);
      setDataEntrega(prev => prev || res.resumo?.data_sugerida || "");
    })();
    return () => { cancelled = true; };
  }, [isFactory, selKey, orcamento.clinic_id]);

  const fmtDataBR = (iso?: string) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "";

  const METHODS = [
    { id: "pix", label: "Pix" },
    { id: "cartao", label: "Cartão" },
    { id: "dinheiro", label: "Dinheiro" },
    { id: "plano", label: "Plano" },
  ];

  return (
    <Modal
      title={`Aprovar orçamento #${orcamento.number}`}
      subtitle="Isso fecha a venda: marca o card como Ganho, lança a receita e programa a produção."
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={async () => {
          setSaving(true);
          await onConfirm({
            paymentMethod, paymentStatus, paymentDate,
            dataEntrega: isFactory ? (dataEntrega || null) : null,
            // Só manda a seleção quando ela é parcial — sem seleção, o servidor mantém tudo/total cotado.
            lineKeys: isPartial ? selectedLines.map(l => l.key) : null,
            total: isPartial ? selectedTotal : null,
          });
          setSaving(false);
        }} disabled={saving || selectedLines.length === 0}>
          {saving ? "Aprovando…" : "Confirmar venda"}
        </Button>
      </>}
    >
      <div className="space-y-4">
        <div className="bg-emerald-50 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-bold text-emerald-800">Valor da venda</span>
          <div className="text-right">
            <span className="text-xl font-black text-emerald-700">{fmtBRL(isPartial ? selectedTotal : orcamento.total)}</span>
            {isPartial && <div className="text-[11px] text-emerald-700/70">cotado {fmtBRL(orcamento.total)}</div>}
          </div>
        </div>

        {lines.length > 1 && (
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Itens que viram pedido</div>
            {lines.map(l => (
              <label key={l.key} className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={sel.has(l.key)} onChange={() => toggle(l.key)} className="w-4 h-4 accent-teal-600 shrink-0" />
                <span className={cn("flex-1 min-w-0 text-sm truncate", sel.has(l.key) ? "text-slate-700 font-semibold" : "text-slate-400 line-through")}>
                  {l.name}
                </span>
                <span className="text-xs text-slate-400 shrink-0">{l.qtyLine}</span>
                <span className={cn("text-sm font-bold tabular-nums shrink-0 w-24 text-right", sel.has(l.key) ? "text-slate-700" : "text-slate-300")}>{fmtBRL(l.value)}</span>
              </label>
            ))}
            {selectedLines.length === 0 && <p className="text-[11px] text-rose-500 font-semibold">Selecione ao menos um item.</p>}
            <p className="text-[11px] text-slate-400">Só os marcados geram receita, pedido e ordem de produção. Os demais ficam registrados na cotação.</p>
          </div>
        )}

        {isFactory && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Disponibilidade e prazo</div>
            {etaLoading ? (
              <p className="text-sm text-slate-400 py-1">Verificando estoque e produção…</p>
            ) : eta && !eta.error ? (
              <>
                <div className="space-y-1">
                  {eta.linhas.map((ln: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-slate-600 truncate">{ln.label}</span>
                      {ln.sem_estimativa ? (
                        <span className="text-amber-600 font-semibold shrink-0">sem estimativa</span>
                      ) : ln.em_estoque ? (
                        <span className="text-emerald-600 font-semibold shrink-0">✓ em estoque</span>
                      ) : (
                        <span className="text-blue-600 font-semibold shrink-0">⏳ produzir {fmtQty(Number(ln.falta))} m</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">
                    {eta.resumo.tudo_em_estoque
                      ? "Tudo em estoque"
                      : `Produção ~${eta.resumo.dias_producao} dia(s)${eta.resumo.dias_expedicao ? ` + ${eta.resumo.dias_expedicao} expedição` : ""}`}
                  </span>
                  <span className="text-sm font-black text-slate-800 shrink-0">Sugerido: {fmtDataBR(eta.resumo.data_sugerida)}</span>
                </div>
                {eta.resumo.sem_estimativa && (
                  <p className="text-[11px] text-amber-600">Alguma linha sem taxa de produção cadastrada — o prazo pode estar incompleto.</p>
                )}
              </>
            ) : eta?.error ? (
              <p className="text-sm text-amber-600 py-1">Não foi possível verificar a disponibilidade agora.</p>
            ) : selectedLines.length === 0 ? (
              <p className="text-sm text-slate-400 py-1">Selecione ao menos um item para verificar.</p>
            ) : (
              <p className="text-sm text-slate-400 py-1">Nenhum item de produção neste orçamento.</p>
            )}
            <Field label="Prazo de entrega (confirme ou ajuste)">
              <input type="date" className={inputCls} value={dataEntrega} onChange={e => setDataEntrega(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Forma de pagamento">
            <select className={inputCls} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              {METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={paymentStatus} onChange={e => setPaymentStatus(e.target.value as "pago" | "pendente")}>
              <option value="pago">Pago</option>
              <option value="pendente">Pendente</option>
            </select>
          </Field>
        </div>
        <Field label="Data do pagamento">
          <input type="date" className={inputCls} value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function RejectModal({ orcamento, onClose, onConfirm }: {
  orcamento: Orcamento;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      title={`Recusar orçamento #${orcamento.number}`}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={async () => { setSaving(true); await onConfirm(reason.trim()); setSaving(false); }} disabled={saving}>
          {saving ? "Recusando…" : "Confirmar recusa"}
        </Button>
      </>}
    >
      <Field label="Motivo (opcional)">
        <textarea className={cn(inputCls, "min-h-[72px] resize-y")} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: preço alto, escolheu concorrente…" autoFocus />
      </Field>
    </Modal>
  );
}

// Uma linha do orçamento resolvida contra o catálogo. `key` é a MESMA chave que o provision usa
// (orcamento_line_key = 'L' + ordinal da linha no snapshot), por isso o ordinal conta TODAS as linhas
// cruas — inclusive as puladas — para não desalinhar a seleção do que vira pedido/OP.
type OrcLine = { ord: number; key: string; name: string; qtyLine: string; value: number; productId: string; qty: number; altura: number };

function resolveOrcamentoLines(snapshot: any, products: any[], protocols: any[]): OrcLine[] {
  const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  const num = (v: any) => Number(String(v ?? "").replace(",", ".")) || 0;
  const out: OrcLine[] = [];
  lines.forEach((l: any, i: number) => {
    const ord = i + 1;
    const key = String(l.productId || "");
    const id = key.slice(2);
    const prod = key.startsWith("p:") ? products.find(p => p.id === id) : null;
    const prot = key.startsWith("t:") ? protocols.find((t: any) => t.id === id) : null;
    if (!prod && !prot) return;
    const q = num(l.qty);
    if (q <= 0) return;
    const name = prod?.name ?? prot?.name ?? "—";
    const unit = prod?.unit ?? "serviço";
    const isArea = !!prod?.charge_by_area;
    const unitPrice = l.price !== "" && l.price != null && !isNaN(num(l.price)) ? num(l.price) : Number(prod?.unit_price ?? prot?.price ?? 0);
    const altura = isArea ? (num(l.altura) || 1) : 1;
    const base = q * altura * unitPrice;
    const pct = Math.min(100, Math.max(0, num(l.discount)));
    const fee = num(l.fee);
    const value = Math.max(0, base - base * (pct / 100)) + fee;
    const qtyLine = isArea ? `${q}m × ${altura}m` : `${q} ${unit}`;
    out.push({ ord, key: `L${ord}`, name, qtyLine, value, productId: key, qty: q, altura: isArea ? altura : 0 });
  });
  return out;
}

// Itens do documento (recibo). Se o orçamento foi aprovado só com alguns itens (o cliente escolheu
// uma das opções cotadas), imprime apenas os aprovados.
function resolveOrcamentoItems(snapshot: any, products: any[], protocols: any[], approvedKeys?: string[] | null): ReciboItem[] {
  const has = Array.isArray(approvedKeys) && approvedKeys.length > 0;
  return resolveOrcamentoLines(snapshot, products, protocols)
    .filter(l => !has || approvedKeys!.includes(l.key))
    .map(l => ({ name: l.name, qtyLine: l.qtyLine, value: l.value }));
}

// Gera o Recibo de Entrega imprimível (Via Empresa/Via Cliente, com assinatura do cliente) a
// partir de um orçamento APROVADO — usa orcamentos.number (sem numeração própria). Impresso na
// hora da entrega, depois do pedido separado. Doc/endereço/vencimento são coletados aqui e
// persistidos via set_orcamento_print_info (não trava por status — são campos do documento).
function GerarReciboModal({ orcamento, onClose }: { orcamento: Orcamento; onClose: () => void }) {
  const showToast = useToast();
  const { clinic } = useSettings();
  const { data: products } = useProducts();
  const { data: protocols } = useProtocols();
  const { setPrintInfo } = useOrcamentos();
  const logoDataUrl = useImageDataUrl(clinic?.logo_url);

  const [clientDoc, setClientDoc] = useState(orcamento.client_doc ?? "");
  const [clientAddress, setClientAddress] = useState(orcamento.client_address ?? "");
  const [vencimento, setVencimento] = useState(orcamento.vencimento ?? "");
  const [busy, setBusy] = useState(false);

  const docRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);
  const [ph, setPh] = useState(520);

  const items = useMemo(
    () => resolveOrcamentoItems(orcamento.snapshot, products, protocols, orcamento.approved_line_keys),
    [orcamento.snapshot, products, protocols, orcamento.approved_line_keys],
  );

  const docProps = {
    clinicName: clinic?.name ?? "",
    clinicLegalName: clinic?.legal_name ?? null,
    clinicCnpj: clinic?.cnpj ?? null,
    number: orcamento.number,
    dateStr: new Date().toLocaleDateString("pt-BR"),
    clientName: orcamento.client_name || orcamento.lead?.name || "—",
    clientDoc,
    clientAddress,
    items,
    subtotal: Number(orcamento.subtotal ?? orcamento.total),
    desconto: Number(orcamento.desconto ?? 0),
    frete: Number(orcamento.frete ?? 0),
    total: Number(orcamento.total),
    vencimento: vencimento ? new Date(`${vencimento}T00:00:00`).toLocaleDateString("pt-BR") : null,
    pagamento: orcamento.pagamento ?? null,
    accent: clinic?.primary_color || "#1d4ed8",
    logoDataUrl,
  };

  useEffect(() => {
    const el = docRef.current, wrap = previewWrapRef.current;
    if (!el || !wrap) return;
    const s = wrap.clientWidth / 794;
    setScale(s);
    setPh(Math.round(el.offsetHeight * s));
  }, [items, clientDoc, clientAddress, vencimento]);

  const persistPrintInfoIfChanged = async () => {
    const changed = clientDoc !== (orcamento.client_doc ?? "") || clientAddress !== (orcamento.client_address ?? "") || vencimento !== (orcamento.vencimento ?? "");
    if (!changed) return;
    await setPrintInfo(orcamento.id, { clientDoc: clientDoc || null, clientAddress: clientAddress || null, vencimento: vencimento || null });
  };

  const captureCanvas = async () => {
    const node = docRef.current;
    if (!node) return null;
    const html2canvas = (await import("html2canvas-pro")).default;
    return html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
  };

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await persistPrintInfoIfChanged();
      const canvas = await captureCanvas();
      if (!canvas) return;
      const { jsPDF } = await import("jspdf");
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
      pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
      pdf.save(`Recibo-${orcamento.number}.pdf`);
    } catch (_e) {
      showToast("Não foi possível gerar o PDF.", "error");
    }
    setBusy(false);
  };

  const handlePrint = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await persistPrintInfoIfChanged();
      const canvas = await captureCanvas();
      if (!canvas) return;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(`<html><head><title>Recibo de Entrega ${orcamento.number}</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{width:100%;display:block}</style></head><body><img src="${dataUrl}" onload="window.focus();window.print();" /></body></html>`);
        w.document.close();
      }
    } catch (_e) {
      showToast("Não foi possível abrir a impressão.", "error");
    }
    setBusy(false);
  };

  return (
    <Modal
      title={`Recibo de Entrega — Pedido #${orcamento.number}`}
      subtitle={docProps.clientName}
      onClose={onClose}
      wide
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>
        <Button variant="outline" size="sm" onClick={handlePrint} disabled={busy}><Printer className="w-4 h-4 mr-1.5" /> Imprimir</Button>
        <Button size="sm" onClick={handleDownload} disabled={busy}><Download className="w-4 h-4 mr-1.5" /> Baixar PDF</Button>
      </>}
    >
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Field label="Documento do cliente (CPF/CNPJ)">
          <input className={inputCls} value={clientDoc} onChange={e => setClientDoc(e.target.value)} placeholder="opcional" />
        </Field>
        <Field label="Endereço / Imóvel">
          <input className={inputCls} value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="opcional" />
        </Field>
        <Field label="Vencimento">
          <input type="date" className={inputCls} value={vencimento} onChange={e => setVencimento(e.target.value)} />
        </Field>
      </div>

      {/* Cópia offscreen (tamanho real, sem transform) capturada pelo html2canvas */}
      <div style={{ position: "fixed", left: -99999, top: 0, width: 794, pointerEvents: "none" }} aria-hidden>
        <ReciboDocument docRef={docRef} {...docProps} />
      </div>
      <div ref={previewWrapRef} style={{ height: ph }} className="relative w-full overflow-hidden border border-slate-200 rounded-xl bg-slate-100">
        <div style={{ position: "absolute", top: 0, left: 0, width: 794, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <ReciboDocument {...docProps} />
        </div>
      </div>
    </Modal>
  );
}
