import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Loader2, Check, X, Sparkles, TrendingUp, MessageSquare, ChevronDown, ChevronRight,
  ArrowRight, Quote, Brain, ShieldCheck, RefreshCw, History, Power,
  Hand, ListChecks, Zap, MoveRight,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";
import {
  useConvAiInsights, useConvAiClinicConfig, useFunnelStages, useTickets,
  useConversions, usePatients, ConvAiInsight, ConvAiMode,
} from "../hooks/useSupabase";
import { GanhoModal } from "./LeadKanban";

// Comercial › "Sugestões IA" — a fila que a IA NÃO aplica sozinha.
//
// Só VENDA entra em fila: a etapa comum a IA move direto (decisão do dono), e o
// movimento fica listado abaixo apenas para auditoria. Corrigir uma etapa continua
// sendo arrastar o card no CRM, e esse arrasto vira contra-exemplo do aprendizado.
//
// Confirmar uma venda abre o MESMO GanhoModal do Kanban: a venda é registrada pelo
// caminho de sempre (conversão + receita + fechamento do ticket + CAPI).

function Confianca({ valor }: { valor: number | null }) {
  const pct = Math.round((valor ?? 0) * 100);
  const cls = pct >= 85 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : pct >= 70 ? "text-teal-700 bg-teal-50 border-teal-200"
    : "text-amber-700 bg-amber-50 border-amber-200";
  return (
    <span className={cn("text-[10px] font-black px-1.5 py-0.5 rounded border tracking-wider", cls)}>
      {pct}% DE CONFIANÇA
    </span>
  );
}

// Seletor de 3 estados, o mesmo espírito do kill-switch do Super Admin, só que
// por clínica e por eixo (etapa e venda).
const MODOS: Array<{ id: ConvAiMode; label: string; icon: typeof Hand; hint: (eixo: "etapa" | "venda") => string }> = [
  { id: "off", label: "Manual", icon: Hand,
    hint: (e) => e === "etapa" ? "A IA não move card nenhum." : "A IA não procura vendas." },
  { id: "suggest", label: "Sugestão", icon: ListChecks,
    hint: (e) => e === "etapa" ? "Toda mudança de etapa vai para a fila abaixo." : "As vendas vão para a fila abaixo." },
  { id: "auto", label: "Automático", icon: Zap,
    hint: (e) => e === "etapa" ? "A IA move o card sozinha." : "A IA fecha a venda sozinha e lança o faturamento." },
];

// Cada eixo é um PAINEL próprio: são decisões independentes (uma mexe no card,
// a outra em faturamento), e misturá-las num bloco só confunde quem configura.
function PainelModo({ eixo, valor, onChange, disabled }: {
  eixo: "etapa" | "venda";
  valor: ConvAiMode;
  onChange: (m: ConvAiMode) => void;
  disabled?: boolean;
}) {
  const etapa = eixo === "etapa";
  const Icone = etapa ? MoveRight : TrendingUp;
  return (
    <div className={cn(
      "bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col",
      disabled && "opacity-50 pointer-events-none"
    )}>
      <div className="flex items-start gap-2.5 mb-3">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
          etapa ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600")}>
          <Icone className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-900 leading-tight">
            {etapa ? "Mudança de etapa" : "Detecção de venda"}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            {etapa
              ? "O que a IA faz quando a conversa indica que o card deveria estar em outra etapa."
              : "O que a IA faz quando a conversa indica que o negócio foi fechado."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {MODOS.map(m => {
          const Icon = m.icon;
          const sel = valor === m.id;
          const perigo = !etapa && m.id === "auto";
          return (
            <button key={m.id} type="button" onClick={() => onChange(m.id)}
              className={cn("rounded-xl border px-2 py-2 text-center transition-all",
                sel
                  ? perigo
                    ? "border-amber-400 bg-amber-50 text-amber-800 ring-2 ring-amber-400/20"
                    : etapa
                      ? "border-violet-400 bg-violet-50 text-violet-800 ring-2 ring-violet-400/20"
                      : "border-emerald-400 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-400/20"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>
              <span className="flex items-center justify-center gap-1.5 text-xs font-bold">
                <Icon className="w-3.5 h-3.5 shrink-0" /> {m.label}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 mt-2 leading-snug">{MODOS.find(m => m.id === valor)?.hint(eixo)}</p>

      {!etapa && valor === "auto" && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2 leading-snug">
          A IA lança a conversão e o faturamento sem passar por você, e a conversão vai para a Meta.
          Cancelar a venda no CRM desfaz o lançamento, mas o evento já enviado à Meta não tem desfazer.
          Sem valor identificado na conversa, a venda cai na fila em vez de ser lançada.
        </p>
      )}
    </div>
  );
}

function Evidencias({ itens }: { itens: string[] | null }) {
  const lista = Array.isArray(itens) ? itens.filter(Boolean) : [];
  if (lista.length === 0) return null;
  return (
    <div className="space-y-1.5 mt-2.5">
      {lista.slice(0, 3).map((t, i) => (
        <div key={i} className="flex gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5">
          <Quote className="w-3 h-3 text-slate-300 shrink-0 mt-0.5" />
          <span className="italic">{String(t).slice(0, 300)}</span>
        </div>
      ))}
    </div>
  );
}

// Uma fila por eixo, cada uma com o vocabulário do seu tipo de decisão.
function FilaSecao({ eixo, itens, vazioTexto, onRefetch, busy, onAprovar, onRecusar, stageName }: {
  eixo: "etapa" | "venda";
  itens: ConvAiInsight[];
  vazioTexto: string;
  onRefetch: () => void;
  busy: string | null;
  onAprovar: (i: ConvAiInsight) => void;
  onRecusar: (i: ConvAiInsight) => void;
  stageName: (id: string | null) => string;
}) {
  const venda = eixo === "venda";
  const Icone = venda ? TrendingUp : MoveRight;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className={cn("text-xs font-black uppercase tracking-widest flex items-center gap-2",
          venda ? "text-emerald-600" : "text-violet-600")}>
          <Icone className="w-3.5 h-3.5" />
          {venda ? "Vendas para confirmar" : "Mudanças de etapa para confirmar"} ({itens.length})
        </h3>
        <button onClick={onRefetch} className="text-slate-400 hover:text-teal-600 transition-colors" title="Atualizar">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {itens.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 px-4 py-6 flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-slate-200 shrink-0" />
          <p className="text-slate-400 text-xs">{vazioTexto}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {itens.map(ins => (
            <motion.div
              key={ins.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-900">{ins.leads?.name ?? "Contato"}</span>
                    <Confianca valor={ins.confidence} />
                    {ins.sale_value != null && (
                      <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                        R$ {Number(ins.sale_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                    {stageName(ins.previous_stage_id)} <ArrowRight className="w-3 h-3" /> {stageName(ins.suggested_stage_id)}
                  </p>
                  {ins.rationale && <p className="text-xs text-slate-600 mt-2">{ins.rationale}</p>}
                  <Evidencias itens={ins.evidence} />
                </div>
                <div className="flex sm:flex-col gap-2 shrink-0">
                  <button
                    onClick={() => onAprovar(ins)}
                    disabled={busy === ins.id}
                    className={cn("flex-1 sm:flex-none disabled:opacity-50 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors",
                      venda ? "bg-emerald-600 hover:bg-emerald-700" : "bg-violet-600 hover:bg-violet-700")}
                  >
                    {busy === ins.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {venda ? "Confirmar venda" : "Mover card"}
                  </button>
                  <button
                    onClick={() => onRecusar(ins)}
                    disabled={busy === ins.id}
                    className="flex-1 sm:flex-none bg-white border border-slate-200 hover:bg-rose-50 hover:border-rose-200 text-slate-600 hover:text-rose-600 px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> {venda ? "Não foi venda" : "Manter etapa"}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConvAIReview() {
  const { pending, recentStages, loading, decide, refetch } = useConvAiInsights();
  const { config, current, versions, loading: cfgLoading, save, rollback } = useConvAiClinicConfig();
  const { data: stages } = useFunnelStages();
  const { moveTicket, closeTicket } = useTickets();
  const { create: createConversion } = useConversions();
  const { create: createPatient } = usePatients();

  const [busy, setBusy] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [ganho, setGanho] = useState<{
    id: string; name: string; phone: string | null; patientId: string | null;
    ticketId: string; ctwaClid: string | null; email: string | null; suggested: number | null;
  } | null>(null);

  const stageName = (id: string | null) => stages.find(s => s.id === id)?.name ?? "sem etapa";
  const ganhoStage = stages.find(s => s.slug === "ganho");
  const pendingVendas = pending.filter(i => i.kind === "sale");
  const pendingEtapas = pending.filter(i => i.kind === "stage");

  const aprovar = async (ins: ConvAiInsight) => {
    setBusy(ins.id);
    const res = await decide(ins.id, "approve");
    setBusy(null);
    if (!res.success) return;
    if (res.needs_ganho_modal) {
      setGanho({
        id: ins.lead_id ?? "",
        name: ins.leads?.name ?? "Contato",
        phone: ins.leads?.phone ?? null,
        patientId: ins.leads?.converted_patient_id ?? null,
        ticketId: ins.ticket_id,
        ctwaClid: ins.leads?.ctwa_clid ?? null,
        email: ins.leads?.email ?? null,
        suggested: ins.sale_value,
      });
    }
  };

  const recusar = async (ins: ConvAiInsight) => {
    setBusy(ins.id);
    await decide(ins.id, "reject");
    setBusy(null);
  };

  if (loading || cfgLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-slate-400 gap-3">
        <Loader2 className="w-6 h-6 animate-spin" /> <span className="text-sm font-medium">Carregando sugestões…</span>
      </div>
    );
  }

  const desligada = !config?.enabled;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar pr-1 space-y-5 pb-10">
      {/* Estado do analista nesta clínica */}
      <div className={cn(
        "rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3",
        desligada ? "bg-slate-50 border-slate-200" : "bg-teal-50/40 border-teal-200"
      )}>
        <div className="flex items-start gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
            desligada ? "bg-slate-200 text-slate-500" : "bg-teal-100 text-teal-700")}>
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-black text-slate-900">
              Análise de conversas {desligada ? "desligada" : "ativa"}
            </p>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
              A IA lê as conversas desta clínica e decide duas coisas, configuradas separadamente
              abaixo. Cada decisão sua afina o manual desta clínica.
            </p>
          </div>
        </div>
        <button
          onClick={() => save({ enabled: !config?.enabled })}
          className={cn("flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-colors shrink-0",
            desligada ? "bg-teal-600 hover:bg-teal-700 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50")}
        >
          <Power className="w-3.5 h-3.5" /> {desligada ? "Ativar análise" : "Desativar"}
        </button>
      </div>

      {/* Dois painéis independentes, lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PainelModo
          eixo="etapa"
          valor={config?.stage_mode ?? "auto"}
          disabled={desligada}
          onChange={m => save({ stage_mode: m })}
        />
        <PainelModo
          eixo="venda"
          valor={config?.sale_mode ?? "suggest"}
          disabled={desligada}
          onChange={m => save({ sale_mode: m })}
        />
      </div>

      {/* Uma fila por eixo. Venda e etapa são revisões diferentes, com pessoas e
          urgências diferentes: misturar as duas fazia a venda se perder no meio. */}
      <FilaSecao
        eixo="venda"
        itens={pendingVendas}
        vazioTexto={desligada
          ? "Ative a análise para a IA começar a ler as conversas."
          : (config?.sale_mode ?? "suggest") === "suggest"
            ? "Nenhuma venda aguardando. Assim que a IA encontrar uma, ela aparece aqui."
            : (config?.sale_mode === "auto"
              ? "Detecção de venda está em Automático: a IA fecha sozinha e nada cai aqui."
              : "Detecção de venda está em Manual: a IA não procura vendas nesta clínica.")}
        onRefetch={refetch}
        busy={busy}
        onAprovar={aprovar}
        onRecusar={recusar}
        stageName={stageName}
      />

      <FilaSecao
        eixo="etapa"
        itens={pendingEtapas}
        vazioTexto={desligada
          ? "Ative a análise para a IA começar a ler as conversas."
          : (config?.stage_mode ?? "auto") === "suggest"
            ? "Nenhuma mudança de etapa aguardando."
            : (config?.stage_mode === "auto"
              ? "Mudança de etapa está em Automático: a IA move os cards sozinha (veja o histórico abaixo)."
              : "Mudança de etapa está em Manual: a IA não mexe nos cards desta clínica.")}
        onRefetch={refetch}
        busy={busy}
        onAprovar={aprovar}
        onRecusar={recusar}
        stageName={stageName}
      />

      {/* Auditoria: o que a IA moveu sozinha */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <button onClick={() => setShowAudit(v => !v)} className="w-full flex items-center justify-between p-4">
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            {showAudit ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Etapas movidas pela IA nas últimas 24h ({recentStages.length})
          </span>
        </button>
        {showAudit && (
          <div className="px-4 pb-4 space-y-2">
            {recentStages.length === 0 && (
              <p className="text-xs text-slate-400">Nenhuma etapa movida pela IA neste período.</p>
            )}
            {recentStages.map(ins => (
              <div key={ins.id} className="flex items-start justify-between gap-3 border border-slate-100 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700">{ins.leads?.name ?? "Contato"}</p>
                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                    {stageName(ins.previous_stage_id)} <ArrowRight className="w-3 h-3" /> {stageName(ins.suggested_stage_id)}
                    {ins.status === "shadow" && (
                      <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 tracking-wider">
                        SÓ OBSERVAÇÃO
                      </span>
                    )}
                  </p>
                  {ins.rationale && <p className="text-[11px] text-slate-400 mt-1">{ins.rationale}</p>}
                </div>
                <Confianca valor={ins.confidence} />
              </div>
            ))}
            <p className="text-[11px] text-slate-400 pt-1">
              Errou? Arraste o card no CRM. A correção vira exemplo e a IA aprende com ela.
            </p>
          </div>
        )}
      </div>

      {/* Manual aprendido */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <button onClick={() => setShowPrompt(v => !v)} className="w-full flex items-center justify-between p-4">
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            {showPrompt ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Brain className="w-3.5 h-3.5" /> Manual aprendido desta clínica
            {current && <span className="text-teal-600">v{current.version}</span>}
          </span>
        </button>
        {showPrompt && (
          <div className="px-4 pb-4 space-y-3">
            <p className="text-xs text-slate-500 flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
              Escrito pela própria IA a partir das conversas desta clínica e reescrito conforme suas decisões.
              {config?.decisions_since_learn ? ` ${config.decisions_since_learn} decisão(ões) desde a última versão.` : ""}
            </p>
            {current ? (
              <pre className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-3 whitespace-pre-wrap max-h-72 overflow-y-auto custom-scrollbar">
                {current.content}
              </pre>
            ) : (
              <p className="text-xs text-slate-400">
                Ainda sem manual. A primeira versão é escrita automaticamente a partir do histórico de conversas
                assim que a análise for ativada.
              </p>
            )}
            {versions.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <History className="w-3 h-3" /> Versões
                </p>
                {versions.map(v => (
                  <div key={v.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-2.5 py-1.5">
                    <span className="text-slate-600">
                      <b>v{v.version}</b> · {v.source === "bootstrap" ? "histórico" : v.source === "learn" ? "aprendizado" : "manual"}
                      {" · "}{new Date(v.created_at).toLocaleDateString("pt-BR")}
                    </span>
                    {v.is_current
                      ? <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">EM USO</span>
                      : <button onClick={() => rollback(v.version)} className="text-[11px] font-bold text-slate-500 hover:text-teal-600">
                          voltar para esta
                        </button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmar venda = mesmo fluxo do Kanban */}
      {ganho && (
        <GanhoModal
          lead={{ id: ganho.id, name: ganho.name, phone: ganho.phone, patientId: ganho.patientId, ctwaClid: ganho.ctwaClid, email: ganho.email }}
          ticketId={ganho.ticketId}
          isConversionStage={ganhoStage?.is_conversion === true}
          createPatient={createPatient as any}
          updateLead={async (id, payload) => { await supabase.from("leads").update(payload).eq("id", id); }}
          onClose={() => { setGanho(null); refetch(); }}
          onCancel={() => { setGanho(null); refetch(); }}
          onCreate={async (data) => {
            const ok = await createConversion({ ...data, ticket_id: ganho.ticketId } as any);
            if (ok) {
              if (ganhoStage) await moveTicket(ganho.ticketId, ganhoStage.id);
              await closeTicket(ganho.ticketId, "ganho");
            }
            return ok;
          }}
        />
      )}
    </div>
  );
}
