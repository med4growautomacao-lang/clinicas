import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { FileText, Send, CheckCircle2, XCircle, Search, ExternalLink, Printer, Download, Receipt, Truck, Archive, ChevronDown, ChevronRight, Eye, Pencil, RotateCcw } from "lucide-react";
// Mesmo construtor do Kanban, de propósito: catálogo, alturas, cálculo, documento e envio já vivem
// nele. Uma segunda tela de orçamento aqui divergiria da primeira na primeira mudança.
import { OrcamentoModal } from "../LeadKanban";
import { cn } from "@/src/lib/utils";
import { useOrcamentos, useSettings, useProducts, useProtocols, Orcamento, OrcamentoStatus } from "../../hooks/useSupabase";
import { useToast } from "../ui/toast";
import { Button, Modal, Field, StatCard, StatusBadge, EmptyState, inputCls, fmtDate } from "../production/shared";
import { useImageDataUrl } from "../QuoteDocument";
import { ReciboDocument, ReciboItem } from "./ReciboDocument";
// Janela ÚNICA de venda: a mesma do Kanban. Marcar Ganho aqui e arrastar o card lá são o MESMO
// evento, e enquanto foram duas telas o card ganho pelo Kanban deixava a proposta viva, e a
// proposta aprovada aqui lançava dinheiro em cima de uma venda que já existia.
import { RegistrarVendaModal, resolveOrcamentoLines } from "../vendas/RegistrarVendaModal";

function fmtBRL(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n ?? 0));
}

const STATUS_META: Record<OrcamentoStatus, { label: string; tone: "slate" | "amber" | "emerald" | "rose" | "sky" }> = {
  rascunho: { label: "Rascunho", tone: "slate" },
  enviado: { label: "Enviado", tone: "sky" },
  // ⚠️ O valor GRAVADO continua 'aprovado' (é o que dezenas de RPCs, views e triggers leem); o que
  // muda aqui é só o que o vendedor lê. "Ganho" é a mesma palavra do Kanban de propósito: aprovar a
  // proposta e ganhar o card são o mesmo evento, e chamar de "Aprovado" fazia parecer um passo antes
  // da venda.
  aprovado: { label: "Ganho", tone: "emerald" },
  recusado: { label: "Recusado", tone: "rose" },
  expirado: { label: "Expirado", tone: "amber" },
  substituido: { label: "Substituído", tone: "slate" },
};

// 📌 APROVADO é o fim da linha da proposta, e é o MESMO evento de passar o card para Ganho: aprovar
// lança a venda, a receita e a produção. Não existe status "pago" aqui de propósito: quem responde
// se o cliente pagou é o lançamento financeiro, que o próprio modal de aprovação preenche.

const FILTERS: { id: OrcamentoStatus | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "rascunho", label: "Rascunho" },
  { id: "enviado", label: "Enviado" },
  { id: "aprovado", label: "Ganho" },
  { id: "recusado", label: "Recusado" },
  { id: "substituido", label: "Substituído" },
];

// A construção/edição do orçamento continua no Kanban comercial (OrcamentoModal já é um
// componente grande e testado ali); a Central foca em visibilidade + status + aprovação.
function goToLeadKanban() {
  localStorage.setItem("aiSecretaryTab", "leads");
  window.dispatchEvent(new CustomEvent("app-navigate", { detail: { tab: "ai-secretary" } }));
}

// As mensagens de recusa do fechamento de venda moram na janela de venda (mensagemDeErroDeVenda),
// junto com as duas telas que a abrem: duas listas de erro divergiam na primeira mudança da RPC.

export function OrcamentosCentral() {
  const showToast = useToast();
  const { data: orcamentos, loading, approve, updateStatus, markDelivered, fixStatus, save: saveOrcamento } = useOrcamentos();
  const [filter, setFilter] = useState<OrcamentoStatus | "todos">("todos");
  const [search, setSearch] = useState("");
  const [approveTarget, setApproveTarget] = useState<Orcamento | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Orcamento | null>(null);
  const [printTarget, setPrintTarget] = useState<Orcamento | null>(null);
  const [deliverTarget, setDeliverTarget] = useState<Orcamento | null>(null);
  const [viewTarget, setViewTarget] = useState<Orcamento | null>(null);
  const [editTarget, setEditTarget] = useState<Orcamento | null>(null);
  const [statusTarget, setStatusTarget] = useState<Orcamento | null>(null);
  // Pilha de orçamentos do mesmo cliente: fechada por padrão, abre pela setinha.
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});

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

  // Agrupa por CLIENTE. Com o mesmo card aceitando vários orçamentos, a lista corrida por número
  // deixou de ser legível: um cliente só chegou a ter 9 linhas soltas, e não dava para saber qual
  // proposta estava de pé. A chave é o lead (a pessoa), com o nome digitado como reserva para os
  // orçamentos antigos sem vínculo. A ordem dos grupos segue a ordem em que o cliente aparece na
  // lista filtrada, então nada muda de lugar para quem tem um orçamento só.
  const grupos = useMemo(() => {
    const mapa = new Map<string, { key: string; cliente: string; itens: Orcamento[] }>();
    for (const o of filtered) {
      // Sem lead E sem nome, cada um fica sozinho: agrupar "sem nome" com "sem nome" juntaria
      // clientes diferentes na mesma pilha, que é pior que não agrupar.
      const nome = (o.client_name || "").trim().toLowerCase();
      const key = o.lead_id || (nome ? `nome:${nome}` : `id:${o.id}`);
      const g = mapa.get(key);
      if (g) g.itens.push(o);
      else mapa.set(key, { key, cliente: o.client_name || o.lead?.name || "Sem nome", itens: [o] });
    }
    // Dentro do cliente, do mais novo para o mais antigo: o número é sequencial por clínica.
    // E um nível a mais: PROJETO. Propostas do mesmo projeto são versões da mesma negociação;
    // projetos diferentes são negócios distintos. Sem essa separação, 5 linhas soltas do mesmo
    // cliente não dizem se são cinco obras ou cinco versões da mesma.
    return [...mapa.values()].map(g => {
      const itens = [...g.itens].sort((a, b) => b.number - a.number);
      const porProjeto = new Map<string, { nome: string | null; itens: Orcamento[] }>();
      for (const o of itens) {
        const nome = (o.projeto || "").trim();
        // Sem projeto, cada proposta fica sozinha: é o legado, e agrupá-las inventaria um vínculo
        // que o dado não tem.
        const chave = nome ? `p:${nome.toLowerCase()}` : `o:${o.id}`;
        const sub = porProjeto.get(chave);
        if (sub) sub.itens.push(o);
        else porProjeto.set(chave, { nome: nome || null, itens: [o] });
      }
      return { ...g, itens, projetos: [...porProjeto.values()] };
    });
  }, [filtered]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Central de Orçamentos</h1>
        <p className="text-sm text-slate-500 mt-0.5">Todos os orçamentos da fábrica: status, ganhos e histórico.</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <StatCard label="Em aberto" value={String(abertos.length)} icon={<FileText className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Valor em aberto" value={fmtBRL(totalAberto)} tone="teal" />
        <StatCard label="Ganhos" value={String(aprovados.length)} tone="emerald" icon={<CheckCircle2 className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Faturado (ganhos)" value={fmtBRL(totalAprovado)} tone="emerald" />
        <StatCard label="Taxa de ganho" value={`${approvalRate}%`} tone={approvalRate >= 50 ? "emerald" : "amber"} />
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
        <div className="space-y-4">
          {grupos.map(g => {
            // Cliente com vários orçamentos NÃO é mostrado como se fosse um orçamento: fechado,
            // aparece só a linha do CLIENTE, com o que interessa para decidir se vale abrir
            // (quantos, em que pé estão e quanto). Mostrar a proposta mais recente aqui fazia a
            // linha parecer um orçamento comum e escondia que existiam outros oito.
            const empilhado = g.itens.length > 1;
            const aberto = !!expandidos[g.key];
            const ultimo = g.itens[0];
            const aprovados = g.itens.filter(o => o.status === "aprovado");
            const emAberto = g.itens.filter(o => o.status === "rascunho" || o.status === "enviado");
            // Valor em destaque: o que já virou venda, se houver; senão a proposta que está de pé.
            const valorDestaque = aprovados.length > 0
              ? aprovados.reduce((s, o) => s + Number(o.total || 0), 0)
              : Number(ultimo.total || 0);
            const rotuloValor = aprovados.length > 0 ? "Ganho" : "Última proposta";
            // Só os status que existem no grupo, na ordem em que importam.
            const resumo = (["aprovado", "enviado", "rascunho", "recusado", "substituido", "expirado"] as OrcamentoStatus[])
              .map(st => ({ st, n: g.itens.filter(o => o.status === st).length }))
              .filter(x => x.n > 0);
            return (
            <div key={g.key} className="space-y-2.5">
              {empilhado && (
                <button
                  type="button"
                  onClick={() => setExpandidos(p => ({ ...p, [g.key]: !p[g.key] }))}
                  className={cn(
                    "w-full bg-white border rounded-xl p-4 shadow-sm flex items-center justify-between gap-4 flex-wrap text-left transition-colors",
                    aberto ? "border-slate-300" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    {aberto
                      ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 text-sm truncate">{g.cliente}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {g.projetos.filter(p => p.nome).length > 0 && `${g.projetos.length} projetos · `}
                        {g.itens.length} orçamentos · último #{ultimo.number} em {fmtDate(ultimo.created_at)}
                        {emAberto.length > 0 && ` · ${emAberto.length} aguardando resposta`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {resumo.map(x => (
                      <StatusBadge key={x.st} label={`${x.n} ${STATUS_META[x.st].label}`} tone={STATUS_META[x.st].tone} />
                    ))}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-black text-slate-900">{fmtBRL(valorDestaque)}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{rotuloValor}</p>
                  </div>
                </button>
              )}
              {(!empilhado || aberto) && (
                // Aberto, os orçamentos entram recuados e com um fio à esquerda: sem isso eles
                // ficam no mesmo nível da linha do cliente e a pilha some visualmente.
                <div className={cn("space-y-3", empilhado && "ml-2 pl-4 border-l-2 border-slate-100")}>
                  {g.projetos.map((proj, pi) => (
                    <div key={proj.nome ?? proj.itens[0].id} className="space-y-2.5">
                      {/* Cabeçalho do projeto só quando ele tem nome: propostas sem projeto são o
                          legado e cada uma vale por si, então rotulá-las inventaria um vínculo. */}
                      {proj.nome && (
                        <div className="flex items-baseline justify-between gap-3 px-1 pt-0.5">
                          <p className="text-[11px] font-black text-teal-700 uppercase tracking-wider truncate">{proj.nome}</p>
                          <p className="text-[10px] font-bold text-slate-400 shrink-0">
                            {proj.itens.length > 1
                              ? `${proj.itens.length} versões · vale a #${proj.itens[0].number}`
                              : "1 proposta"}
                          </p>
                        </div>
                      )}
                      {proj.itens.map((o, i) => (
                        <OrcamentoRow
                          key={o.id}
                          o={o}
                          // Dentro de um projeto, só a mais recente está de pé; as outras são
                          // versões anteriores e aparecem apagadas para não competirem pela atenção.
                          versaoAntiga={!!proj.nome && i > 0 && (o.status === "rascunho" || o.status === "enviado")}
                          onApprove={() => setApproveTarget(o)}
                          onReject={() => setRejectTarget(o)}
                          onPrint={() => setPrintTarget(o)}
                          onDeliver={() => setDeliverTarget(o)}
                          onView={() => setViewTarget(o)}
                          onEdit={() => setEditTarget(o)}
                          onFixStatus={() => setStatusTarget(o)}
                          onSubstitute={async () => {
                            const res = await updateStatus(o.id, "substituido");
                            showToast(
                              res.success ? `Orçamento #${o.number} marcado como substituído.` : "Erro ao atualizar.",
                              res.success ? "success" : "error"
                            );
                          }}
                          onMarkSent={async () => {
                            const res = await updateStatus(o.id, "enviado");
                            showToast(res.success ? "Marcado como enviado." : "Erro ao atualizar.", res.success ? "success" : "error");
                          }}
                        />
                      ))}
                      {pi < g.projetos.length - 1 && proj.nome && <div className="h-px bg-slate-100 mx-1" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {approveTarget && (
          // ⚠️ `ticketId` vai NULO de propósito: a Central conhece a proposta, não o card. Quem
          // resolve é a própria janela, pelo ticket ABERTO do cliente, que é o mesmo que a RPC vai
          // usar. `orcamentos.ticket_id` pode apontar para um card já fechado, e aí a pergunta
          // "mesma venda ou outra?" olharia para as vendas do card errado.
          //
          // Sem `onCreate`: aqui a venda nasce SEMPRE de uma proposta (foi dela que o usuário
          // clicou). Venda avulsa, editar e cancelar venda continuam no Kanban.
          <RegistrarVendaModal
            lead={{
              id: approveTarget.lead_id ?? "",
              name: approveTarget.client_name || approveTarget.lead?.name || "",
              phone: approveTarget.lead?.phone ?? null,
            }}
            ticketId={null}
            orcamentos={orcamentos}
            orcamentoInicialId={approveTarget.id}
            aprovarProposta={approve}
            onClose={() => setApproveTarget(null)}
            onCancel={() => setApproveTarget(null)}
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
        {viewTarget && (
          <VerOrcamentoModal orcamento={viewTarget} onClose={() => setViewTarget(null)} />
        )}
        {statusTarget && (
          <StatusModal
            orcamento={statusTarget}
            onClose={() => setStatusTarget(null)}
            onConfirm={async status => {
              const res = await fixStatus(statusTarget.id, status);
              showToast(
                res.success
                  ? `Status do #${statusTarget.number} alterado para ${STATUS_META[status].label}.`
                  : res.error_code === "tem_venda_lancada"
                    ? "Esta proposta tem venda lançada. Cancele a venda no Kanban antes de voltar o status."
                    : res.error_code === "use_aprovar"
                      ? "Para fechar a venda use o botão Marcar Ganho: ele lança a receita e a produção junto."
                      : "Não foi possível alterar o status.",
                res.success ? "success" : "error"
              );
              if (res.success) setStatusTarget(null);
            }}
          />
        )}
        {editTarget && editTarget.lead_id && (
          <OrcamentoModal
            // Sem `key` por seq: aqui o modal edita UMA proposta, não empilha propostas novas.
            lead={{ id: editTarget.lead_id, name: editTarget.client_name || editTarget.lead?.name || "", phone: editTarget.lead?.phone ?? null }}
            // O snapshot é o orçamento inteiro (linhas, projeto, mensagens, formato): é o que faz o
            // construtor reabrir exatamente como foi salvo.
            initialQuote={editTarget.snapshot}
            projetosDoCliente={[...new Set(orcamentos.filter(x => x.lead_id === editTarget.lead_id && x.projeto).map(x => x.projeto as string))]}
            onClose={() => setEditTarget(null)}
            onCancel={() => setEditTarget(null)}
            onConfirm={async (value, description, quoteData, status) => {
              // ⚠️ `id` PREENCHIDO: aqui é edição, tem que ATUALIZAR. Sem ele a RPC inseriria uma
              // proposta nova e a Central ganharia uma linha duplicada a cada salvamento.
              const res = await saveOrcamento({
                id: editTarget.id,
                leadId: editTarget.lead_id!,
                ticketId: editTarget.ticket_id,
                status,
                clientName: editTarget.client_name,
                total: value,
                notes: description || null,
                snapshot: quoteData ?? null,
                projeto: (quoteData as any)?.projeto ?? null,
                // Dados do recibo: a RPC usa COALESCE neles, então em branco não apaga o que já
                // estava gravado (o Recibo também os edita, e um não pode zerar o outro).
                clientDoc: (quoteData as any)?.clientDoc ?? null,
                clientAddress: (quoteData as any)?.clientAddress ?? null,
                vencimento: (quoteData as any)?.vencimento ?? null,
              });
              if (!res.success) return { ok: false, errorCode: res.error_code };
              return { ok: true, number: editTarget.number, id: editTarget.id };
            }}
          />
        )}
        {printTarget && (
          <GerarReciboModal orcamento={printTarget} onClose={() => setPrintTarget(null)} />
        )}
        {deliverTarget && (
          <EntregaModal
            orcamento={deliverTarget}
            onClose={() => setDeliverTarget(null)}
            onConfirm={async data => {
              const res = await markDelivered(deliverTarget.id, data);
              showToast(
                res.success
                  ? `Entrega do #${deliverTarget.number} registrada, estoque baixado.`
                  : "Não foi possível registrar a entrega.",
                res.success ? "success" : "error"
              );
              setDeliverTarget(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function OrcamentoRow({ o, versaoAntiga = false, onApprove, onReject, onPrint, onDeliver, onView, onEdit, onFixStatus, onSubstitute, onMarkSent }: {
  o: Orcamento;
  // Versão anterior dentro do mesmo projeto: continua clicável (dá para aprovar, se o cliente
  // voltar atrás), mas aparece apagada, porque quem está de pé é a mais recente.
  versaoAntiga?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onPrint: () => void;
  onDeliver: () => void;
  onView: () => void;
  onEdit: () => void;
  onFixStatus: () => void;
  onSubstitute: () => void;
  onMarkSent: () => void;
}) {
  const clientName = o.client_name || o.lead?.name || "—";
  const pending = o.status === "rascunho" || o.status === "enviado";
  return (
    <div className={cn(
      "bg-white border rounded-xl p-4 shadow-sm flex items-center justify-between gap-4 flex-wrap",
      versaoAntiga ? "border-slate-200 opacity-60 hover:opacity-100 transition-opacity" : "border-slate-200"
    )}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-black text-slate-400">#{o.number}</span>
          <StatusBadge label={STATUS_META[o.status].label} tone={STATUS_META[o.status].tone} />
          {versaoAntiga && (
            <span className="text-[10px] font-bold text-slate-400">versão anterior</span>
          )}
          {o.status === "aprovado" && !o.approved_ticket_id && (
            <span className="text-[10px] font-bold text-amber-600">venda desfeita</span>
          )}
        </div>
        <p className="font-bold text-slate-800 text-sm truncate">{clientName}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {fmtDate(o.created_at)}{o.projeto ? ` · ${o.projeto}` : ""}
        </p>
      </div>
      <div className="text-right">
        <p className="text-lg font-black text-slate-900">{fmtBRL(o.total)}</p>
      </div>
      <div className="flex items-center gap-1.5">
        {/* Ver a proposta sem sair da Central: com a pilha do mesmo cliente, o número sozinho não
            diz o que tem dentro. É só leitura; editar continua no Kanban. */}
        <button title="Ver orçamento" onClick={onView} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Eye className="w-4 h-4" /></button>
        {/* Editar abre o MESMO construtor do Kanban (itens, valores, projeto, validade, pagamento,
            observações e dados do documento), gravando por cima desta proposta.
            📌 Vale também depois de GANHO: a RPC arrasta junto o que a proposta gerou (venda,
            receita e, quando produto/quantidade/altura mudam, a reserva de estoque e a ordem de
            produção). Mexer só em preço ou texto NÃO reprograma a fábrica.
            ⚠️ Ela recusa a mudança de itens quando já foi entregue, quando a produção começou ou
            quando a venda foi parcial; nesses casos o caminho é cancelar a venda no Kanban. */}
        {(pending || o.status === "aprovado") && (
          <button title="Editar orçamento" onClick={onEdit} className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><Pencil className="w-4 h-4" /></button>
        )}
        {o.status === "rascunho" && (
          <Button size="sm" variant="outline" onClick={onMarkSent}><Send className="w-3.5 h-3.5 mr-1" /> Marcar enviado</Button>
        )}
        {pending && (
          <>
            <Button size="sm" onClick={onApprove}><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Marcar Ganho</Button>
            <button title="Recusar (o cliente disse não)" onClick={onReject} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"><XCircle className="w-4 h-4" /></button>
            {/* Substituído ≠ recusado: aqui foi VOCÊ que trocou a proposta. Sai do "em aberto" e
                fica fora da taxa de ganho, porque não é resposta do cliente. É manual porque o
                sistema não sabe se o orçamento novo troca este ou é outro negócio do mesmo cliente. */}
            <button title="Marcar como substituído (você trocou a proposta por outra)" onClick={onSubstitute} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Archive className="w-4 h-4" /></button>
          </>
        )}
        {o.status === "aprovado" && (
          <Button size="sm" variant="outline" onClick={onPrint}><Receipt className="w-3.5 h-3.5 mr-1" /> Recibo</Button>
        )}
        {/* A entrega é o que baixa o estoque, por PEDIDO. Antes a baixa só acontecia quando o card
            era arquivado, e no modelo novo o card fica aberto de propósito para receber a próxima
            venda: a mercadoria saía da fábrica e o estoque nunca baixava.
            📌 Entregar e receber são coisas SEPARADAS: quem responde se o cliente pagou é o
            lançamento no Financeiro, preenchido na aprovação. Aqui é só a mercadoria. */}
        {o.status === "aprovado" && !o.entregue_at && (
          <Button size="sm" variant="outline" onClick={onDeliver}><Truck className="w-3.5 h-3.5 mr-1" /> Marcar entregue</Button>
        )}
        {o.entregue_at && (
          <span className="text-[10px] font-bold text-emerald-600 px-1.5">Entregue em {fmtDate(o.entregue_at)}</span>
        )}
        {/* Corrigir status: clique errado acontece, e refazer a proposta inteira por causa disso é
            pior. A trava de verdade está na RPC, não aqui. */}
        <button title="Corrigir status" onClick={onFixStatus} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><RotateCcw className="w-4 h-4" /></button>
        <button title="Ver no Kanban" onClick={goToLeadKanban} className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><ExternalLink className="w-4 h-4" /></button>
      </div>
    </div>
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

// Correção manual do status: clique errado acontece, e refazer a proposta por causa disso é pior.
// ⚠️ A trava de verdade está na RPC, em dois sentidos: sair de aprovado com venda lançada é
// RECUSADO (desfazer venda exige apagar conversão e lançamento financeiro juntos, que é o "Cancelar
// venda" do Kanban), e ENTRAR em aprovado por aqui também é recusado, porque aprovar de verdade é o
// botão Aprovar, que lança venda, receita e produção. Aqui só se corrige o rótulo.
function StatusModal({ orcamento, onClose, onConfirm }: {
  orcamento: Orcamento;
  onClose: () => void;
  onConfirm: (status: OrcamentoStatus) => Promise<void>;
}) {
  const [status, setStatus] = useState<OrcamentoStatus>(orcamento.status);
  const [saving, setSaving] = useState(false);
  const aprovado = orcamento.status === "aprovado";
  // Aprovado só volta atrás se a venda já tiver sido cancelada (é o caso "venda desfeita"); com a
  // venda de pé a RPC recusa e a tela explica.
  const opcoes: OrcamentoStatus[] = aprovado
    ? ["aprovado", "enviado", "rascunho"]
    : ["rascunho", "enviado", "recusado", "substituido", "expirado"];
  return (
    <Modal
      title={`Corrigir status do #${orcamento.number}`}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={async () => { setSaving(true); await onConfirm(status); setSaving(false); }} disabled={saving}>
          {saving ? "Salvando…" : "Salvar status"}
        </Button>
      </>}
    >
      <Field label="Status">
        <select className={inputCls} value={status} onChange={e => setStatus(e.target.value as OrcamentoStatus)}>
          {opcoes.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </Field>
      <p className="mt-3 text-[11px] text-slate-400">
        {aprovado
          ? "Esta proposta virou venda. Para desfazer, cancele a venda no Kanban: é o caminho que apaga a receita junto."
          : "Correção livre: esta proposta ainda não gerou venda."}
      </p>
    </Modal>
  );
}

// Registrar a entrega é o que dá baixa no estoque, e a baixa é gravada na DATA da entrega, não na
// do clique: a fábrica costuma registrar no dia seguinte, e o razão de estoque tem que refletir o
// dia em que a mercadoria saiu. Por isso a data é editável em vez de assumir "hoje" em silêncio.
function EntregaModal({ orcamento, onClose, onConfirm }: {
  orcamento: Orcamento;
  onClose: () => void;
  onConfirm: (data: string) => Promise<void>;
}) {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [data, setData] = useState(hoje);
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      title={`Registrar entrega do pedido #${orcamento.number}`}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={async () => { setSaving(true); await onConfirm(data); setSaving(false); }} disabled={saving || !data}>
          {saving ? "Registrando…" : "Confirmar entrega"}
        </Button>
      </>}
    >
      <p className="text-xs text-slate-500 mb-3">
        A baixa do estoque é lançada nesta data, só para os itens deste pedido.
      </p>
      <Field label="Data da entrega">
        <input type="date" className={inputCls} value={data} onChange={e => setData(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

// Itens do documento (recibo). Se o orçamento foi aprovado só com alguns itens (o cliente escolheu
// uma das opções cotadas), imprime apenas os aprovados.
function resolveOrcamentoItems(snapshot: any, products: any[], protocols: any[], approvedKeys?: string[] | null): ReciboItem[] {
  const has = Array.isArray(approvedKeys) && approvedKeys.length > 0;
  return resolveOrcamentoLines(snapshot, products, protocols)
    .filter(l => !has || approvedKeys!.includes(l.key))
    .map(l => ({ name: l.name, qtyLine: l.qtyLine, value: l.value }));
}

// Ver o orçamento sem sair da Central e sem risco de alterar nada. A edição continua no Kanban
// (o OrcamentoModal é o construtor, com catálogo, alturas e cálculo); aqui é só leitura, porque o
// caso de uso é "qual é a proposta desta linha?", em especial com vários orçamentos empilhados do
// mesmo cliente, onde só o número não diz nada.
function VerOrcamentoModal({ orcamento, onClose }: { orcamento: Orcamento; onClose: () => void }) {
  const { data: products } = useProducts();
  const { data: protocols } = useProtocols();
  // Sem `approved_line_keys`: mostra a proposta INTEIRA, não só o que foi aprovado. Quem quer o
  // recorte aprovado tem o Recibo.
  const items = useMemo(
    () => resolveOrcamentoItems(orcamento.snapshot, products, protocols),
    [orcamento.snapshot, products, protocols],
  );
  const subtotal = Number(orcamento.subtotal ?? orcamento.total ?? 0);
  const desconto = Number(orcamento.desconto ?? 0);
  const frete = Number(orcamento.frete ?? 0);
  return (
    <Modal
      title={`Orçamento #${orcamento.number}`}
      onClose={onClose}
      footer={<Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-bold text-slate-800 text-sm truncate">{orcamento.client_name || orcamento.lead?.name || "—"}</p>
          {orcamento.projeto && <p className="text-[11px] font-bold text-teal-700 truncate">{orcamento.projeto}</p>}
        </div>
        <StatusBadge label={STATUS_META[orcamento.status].label} tone={STATUS_META[orcamento.status].tone} />
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">Este orçamento não tem itens detalhados (valor lançado direto).</p>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {items.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-700 truncate">{it.name}</p>
                {it.qtyLine && <p className="text-[11px] text-slate-400">{it.qtyLine}</p>}
              </div>
              <p className="text-sm font-bold text-slate-800 shrink-0">{fmtBRL(it.value)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1 text-sm">
        {(desconto > 0 || frete > 0) && (
          <>
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtBRL(subtotal)}</span></div>
            {desconto > 0 && <div className="flex justify-between text-slate-500"><span>Desconto</span><span>- {fmtBRL(desconto)}</span></div>}
            {frete > 0 && <div className="flex justify-between text-slate-500"><span>Frete</span><span>{fmtBRL(frete)}</span></div>}
          </>
        )}
        <div className="flex justify-between font-black text-slate-900 text-base pt-1 border-t border-slate-100">
          <span>Total</span><span>{fmtBRL(orcamento.total)}</span>
        </div>
      </div>

      <div className="mt-3 space-y-0.5 text-[11px] text-slate-400">
        <p>Criado em {fmtDate(orcamento.created_at)}{orcamento.validade ? ` · validade ${fmtDate(orcamento.validade)}` : ""}</p>
        {orcamento.pagamento && <p>Pagamento: {orcamento.pagamento}</p>}
        {orcamento.entregue_at && <p className="text-emerald-600 font-bold">Entregue em {fmtDate(orcamento.entregue_at)}</p>}
        {orcamento.notes && <p className="text-slate-500 whitespace-pre-wrap pt-1">{orcamento.notes}</p>}
      </div>
    </Modal>
  );
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
