import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Check, X, Sparkles, TrendingUp, MessageSquare, ChevronDown, ChevronRight,
  ArrowRight, Quote, Brain, ShieldCheck, RefreshCw, History,
  Hand, ListChecks, Zap, MoveRight, Pencil, Cog,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";
import {
  useConvAiInsights, useConvAiClinicConfig, useFunnelStages, useTickets,
  useConversions, usePatients, ConvAiInsight, Lead,
} from "../hooks/useSupabase";
import { GanhoModal } from "./LeadKanban";
import { LeadChat } from "./LeadChat";

// Comercial › "Auditoria" (fila de sugestões de etapa/venda, de IA e do motor mecânico).
//
// Duas COLUNAS independentes, uma por eixo (etapa e venda). Cada coluna tem o
// seletor de 3 modos daquele eixo (Manual / Sugestão / Automático) e, embaixo, a
// fila que aquele modo alimenta. Só cai na fila o que estiver em "Sugestão".
//
// Confirmar uma venda abre o MESMO GanhoModal do Kanban (conversão + receita +
// fechamento do ticket + CAPI). Aprovar uma etapa passa pelo dono único do
// stage_id. Nenhum caminho de escrita é duplicado aqui.
//
// ⚠️ Na VENDA o modal vem ANTES da decisão: decide_conv_ai_insight já grava
// status='approved', e a fila só mostra 'pending'. Decidir primeiro fazia a
// sugestão sumir da tela ao fechar o modal no X, sem venda nenhuma lançada.
// Quem tira o card da fila é o desfecho: conversão criada (aprova) ou "Não foi
// venda" (recusa). Fechar o modal não decide nada.
//
// O manual da clínica é editável nesta tela: o bootstrap aprende do histórico, e
// o histórico rotula a conversa com o desfecho FINAL do ticket — foi assim que a
// IA confundiu "agendamento confirmado" (etapa Agendado) com venda na Vaz.

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

// UM seletor de motor para a clínica inteira (etapa E venda). A leitura da IA é
// uma só e é compartilhada pelos dois eixos, então escolher motor por eixo criava
// combinações incoerentes (ex.: Mecânico na etapa + IA na venda paga a leitura e
// não economiza). Um motor por clínica impede o incoerente.
//   Manual      = ninguém mexe (você move etapa e marca venda na mão)
//   Mecânico    = sem IA: padrões sugerem a etapa; venda na mão (plano sem IA, custo zero)
//   Sugestão    = a IA lê e sugere etapa e venda para você aprovar
//   Automático  = a IA move a etapa sozinha; venda vira sugestão (ou fecha sozinha, opt-in)
type Motor = "manual" | "mecanico" | "sugestao" | "automatico";
const MOTORES: Array<{ id: Motor; label: string; icon: typeof Hand; hint: string }> = [
  { id: "manual", label: "Manual", icon: Hand,
    hint: "Ninguém mexe: você move os cards e marca as vendas na mão." },
  { id: "mecanico", label: "Mecânico", icon: Cog,
    hint: "Sem IA e sem token: um motor de padrões de frase sugere a etapa. A venda você marca na mão." },
  { id: "sugestao", label: "Sugestão", icon: ListChecks,
    hint: "A IA lê a conversa e sugere etapa e venda para você aprovar na fila abaixo." },
  { id: "automatico", label: "Automático", icon: Zap,
    hint: "A IA move a etapa sozinha. A venda vira sugestão para você confirmar (ou fecha sozinha, se você ativar abaixo)." },
];

// UM seletor de motor para a clínica inteira. Antes eram dois painéis (um por eixo);
// como a leitura da IA é compartilhada, viraram uma escolha só. No Automático, uma
// sub-opção decide se a venda fecha sozinha (risco de faturamento/CAPI) ou só sugere.
function SeletorMotor({ motor, onMotor, mecanicoDisponivel, vendaAuto, onVendaAuto, disabled }: {
  motor: Motor;
  onMotor: (m: Motor) => void;
  mecanicoDisponivel?: boolean;
  vendaAuto: boolean;
  onVendaAuto: (v: boolean) => void;
  disabled?: boolean;
}) {
  const opcoes = mecanicoDisponivel ? MOTORES : MOTORES.filter(m => m.id !== "mecanico");
  const atual = opcoes.find(m => m.id === motor);
  return (
    <div className={cn(
      "bg-white rounded-2xl border border-slate-200 shadow-sm p-4",
      disabled && "opacity-50 pointer-events-none"
    )}>
      <div className="flex items-start gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
          <Cog className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-900 leading-tight">Motor de análise</p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            Quem cuida das conversas desta clínica, na etapa e na venda. Uma escolha só, porque a leitura é compartilhada.
          </p>
        </div>
      </div>

      <div className={cn("grid gap-1.5", opcoes.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        {opcoes.map(m => {
          const Icon = m.icon;
          const sel = motor === m.id;
          const mec = m.id === "mecanico";
          return (
            <button key={m.id} type="button" onClick={() => onMotor(m.id)}
              className={cn("rounded-xl border px-2 py-2 text-center transition-all",
                sel
                  ? mec
                    ? "border-sky-400 bg-sky-50 text-sky-800 ring-2 ring-sky-400/20"
                    : "border-violet-400 bg-violet-50 text-violet-800 ring-2 ring-violet-400/20"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>
              <span className="flex items-center justify-center gap-1.5 text-xs font-bold">
                <Icon className="w-3.5 h-3.5 shrink-0" /> {m.label}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 mt-2 leading-snug">{atual?.hint}</p>

      {motor === "automatico" && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-[11px] font-bold text-slate-600 mb-1.5">E a venda, quando a IA detectar?</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => onVendaAuto(false)}
              className={cn("rounded-xl border px-2 py-2 text-xs font-bold transition-all",
                !vendaAuto ? "border-emerald-400 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-400/20"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>
              Sugerir (você confirma)
            </button>
            <button type="button" onClick={() => onVendaAuto(true)}
              className={cn("rounded-xl border px-2 py-2 text-xs font-bold transition-all",
                vendaAuto ? "border-amber-400 bg-amber-50 text-amber-800 ring-2 ring-amber-400/20"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>
              Fechar sozinha
            </button>
          </div>
          {vendaAuto && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2 leading-snug">
              A IA lança a conversão e o faturamento sem passar por você, e o evento vai para a Meta (que não tem desfazer).
              Sem valor identificado na conversa, a venda cai na fila em vez de ser lançada.
            </p>
          )}
        </div>
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

// A fila de um eixo (etapa ou venda): só a lista para auditar. O motor virou um
// seletor único acima, então a coluna deixou de ter painel de modo próprio.
function FilaConfirmar({ eixo, itens, vazioTexto, busy, onAprovar, onRecusar, onVerConversa, stageName }: {
  eixo: "etapa" | "venda";
  itens: ConvAiInsight[];
  vazioTexto: string;
  busy: string | null;
  onAprovar: (i: ConvAiInsight) => void;
  onRecusar: (i: ConvAiInsight) => void;
  onVerConversa: (i: ConvAiInsight) => void;
  stageName: (id: string | null) => string;
}) {
  const venda = eixo === "venda";
  const Icone = venda ? TrendingUp : MoveRight;
  return (
    <div className="space-y-3 min-w-0">

      <h3 className={cn("text-xs font-black uppercase tracking-widest flex items-center gap-2 px-1 pt-1",
        venda ? "text-emerald-600" : "text-violet-600")}>
        <Icone className="w-3.5 h-3.5 shrink-0" />
        {venda ? "Vendas para confirmar" : "Etapas para confirmar"} ({itens.length})
      </h3>

      {itens.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 px-4 py-6 flex items-start gap-3">
          <MessageSquare className="w-5 h-5 text-slate-200 shrink-0" />
          <p className="text-slate-400 text-xs leading-snug">{vazioTexto}</p>
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
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-black text-slate-900">{ins.leads?.name ?? "Contato"}</span>
                <Confianca valor={ins.confidence} />
                {ins.origin === "mecanico" && (
                  <span
                    title="Sugestão por padrão de frases (sem IA). Confira a evidência antes de aprovar."
                    className="text-[10px] font-black text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5 tracking-wider"
                  >
                    MECÂNICA
                  </span>
                )}
                {ins.sale_value != null && (
                  <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                    R$ {Number(ins.sale_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                {stageName(ins.previous_stage_id)} <ArrowRight className="w-3 h-3 shrink-0" /> {stageName(ins.suggested_stage_id)}
              </p>
              {ins.rationale && <p className="text-xs text-slate-600 mt-2 leading-snug">{ins.rationale}</p>}
              <Evidencias itens={ins.evidence} />

              {/* Em coluna a largura é curta: as ações vão para o rodapé, não para a lateral. */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                <button
                  onClick={() => onVerConversa(ins)}
                  title="Abrir a conversa para conferir a evidência"
                  className="shrink-0 bg-white border border-slate-200 hover:border-teal-300 hover:text-teal-600 text-slate-500 px-2.5 py-2 rounded-xl transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onAprovar(ins)}
                  disabled={busy === ins.id}
                  className={cn("flex-1 disabled:opacity-50 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors",
                    venda ? "bg-emerald-600 hover:bg-emerald-700" : "bg-violet-600 hover:bg-violet-700")}
                >
                  {busy === ins.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {venda ? "Confirmar venda" : "Mover card"}
                </button>
                <button
                  onClick={() => onRecusar(ins)}
                  disabled={busy === ins.id}
                  className="flex-1 bg-white border border-slate-200 hover:bg-rose-50 hover:border-rose-200 text-slate-600 hover:text-rose-600 px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> {venda ? "Não foi venda" : "Manter etapa"}
                </button>
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
  const { config, current, versions, loading: cfgLoading, save, rollback, editar, setEnabled, analisarAgora } = useConvAiClinicConfig();
  const { data: stages } = useFunnelStages();
  const { moveTicket, closeTicket } = useTickets();
  const { create: createConversion } = useConversions();
  const { create: createPatient } = usePatients();

  const [busy, setBusy] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [conversa, setConversa] = useState<{ lead: Lead; ticketId: string } | null>(null);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvandoPrompt, setSalvandoPrompt] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [ativando, setAtivando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "espera" | "info"; texto: string } | null>(null);

  const flash = (tipo: "ok" | "espera" | "info", texto: string, ms = 6000) => {
    setAviso({ tipo, texto });
    setTimeout(() => setAviso(null), ms);
  };

  // O liga/desliga da IA agora mora no próprio seletor de motor (aplicarMotor):
  // Sugestão/Automático ligam a IA (e disparam o bootstrap do manual); Manual/Mecânico desligam.

  // Não espera o ciclo automático (5 min): enfileira e chama o worker na hora.
  const handleAnalisarAgora = async () => {
    setAnalisando(true);
    const res = await analisarAgora();
    if (!res.success) {
      setAnalisando(false);
      if (res.error_code === "cooldown") {
        flash("espera", `Acabei de rodar. Pode pedir de novo em ${res.aguarde_segundos ?? 0}s.`);
      } else {
        flash("info", "Ative a análise antes de pedir uma rodada.");
      }
      return;
    }
    flash("ok", `${res.enfileirados ?? 0} conversa(s) na fila. O resultado aparece aqui em alguns segundos.`);
    // A edge trabalha de forma assíncrona: recarrega em passos até aparecer algo.
    setTimeout(() => refetch(), 8000);
    setTimeout(() => { refetch(); setAnalisando(false); }, 20000);
  };
  const [ganho, setGanho] = useState<{
    insightId: string;
    id: string; name: string; phone: string | null; patientId: string | null;
    ticketId: string; ctwaClid: string | null; email: string | null; suggested: number | null;
  } | null>(null);

  const stageName = (id: string | null) => stages.find(s => s.id === id)?.name ?? "sem etapa";
  const ganhoStage = stages.find(s => s.slug === "ganho");
  const pendingVendas = pending.filter(i => i.kind === "sale");
  const pendingEtapas = pending.filter(i => i.kind === "stage");

  // Motor único da clínica, derivado da config (a leitura é compartilhada por etapa e venda).
  const motor: Motor = config?.mechanical_mode === "active" ? "mecanico"
    : config?.stage_mode === "auto" ? "automatico"
    : config?.stage_mode === "suggest" ? "sugestao" : "manual";
  const aplicarMotor = async (m: Motor) => {
    const usaIA = m === "sugestao" || m === "automatico";
    setAtivando(true);
    // Liga/desliga a IA conforme o motor. Ligar dispara o bootstrap (monta o manual).
    if (usaIA && !config?.enabled) {
      const res = await setEnabled(true);
      if (!res.success) {
        setAtivando(false);
        flash("info", res.error_code === "feature_off"
          ? "Esta clínica ainda não tem a IA liberada. Fale com o suporte."
          : "Não consegui ligar a IA agora. Tente de novo.");
        return;
      }
      if (res.montando_manual) {
        flash("ok", "IA ligada. Estou lendo as conversas para montar o manual desta clínica, leva um ou dois minutos.", 12000);
      }
    } else if (!usaIA && config?.enabled) {
      await setEnabled(false);
    }
    if (m === "manual") await save({ stage_mode: "off", sale_mode: "off", mechanical_mode: "off" });
    else if (m === "mecanico") await save({ stage_mode: "off", sale_mode: "off", mechanical_mode: "active" });
    else if (m === "sugestao") await save({ stage_mode: "suggest", sale_mode: "suggest", mechanical_mode: "off" });
    else await save({ stage_mode: "auto", sale_mode: config?.sale_mode === "auto" ? "auto" : "suggest", mechanical_mode: "off" });
    setAtivando(false);
  };

  const aprovar = async (ins: ConvAiInsight) => {
    // Venda: só abre o modal. A aprovação (que tira da fila) acontece no onCreate,
    // depois que a conversão existe de verdade — desistir no meio não perde o card.
    if (ins.kind === "sale") {
      setGanho({
        insightId: ins.id,
        id: ins.lead_id ?? "",
        name: ins.leads?.name ?? "Contato",
        phone: ins.leads?.phone ?? null,
        patientId: ins.leads?.converted_patient_id ?? null,
        ticketId: ins.ticket_id,
        ctwaClid: ins.leads?.ctwa_clid ?? null,
        email: ins.leads?.email ?? null,
        suggested: ins.sale_value,
      });
      return;
    }
    // Etapa: a própria RPC move o card, não há segundo passo.
    setBusy(ins.id);
    await decide(ins.id, "approve");
    setBusy(null);
  };

  const recusar = async (ins: ConvAiInsight) => {
    setBusy(ins.id);
    await decide(ins.id, "reject");
    setBusy(null);
  };

  // Auditar a evidência na fonte: abre a MESMA conversa do Kanban. O card só
  // traz o lead resumido (o embed do insight), então busca o lead inteiro aqui.
  const verConversa = async (ins: ConvAiInsight) => {
    if (!ins.lead_id) return;
    setBusy(ins.id);
    const { data } = await supabase.from("leads").select("*").eq("id", ins.lead_id).maybeSingle();
    setBusy(null);
    if (data) setConversa({ lead: data, ticketId: ins.ticket_id });
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
              Análise por IA {desligada ? "desligada" : "ligada"}
            </p>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
              Escolha o motor abaixo. Manual e Mecânico não usam IA (o Mecânico sugere de graça).
              Sugestão e Automático ligam a IA, que lê as conversas e afina o manual desta clínica.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!desligada && (
            <button onClick={handleAnalisarAgora} disabled={analisando}
              title="Enfileira as conversas recentes e analisa na hora, sem esperar o ciclo automático"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:text-teal-600 hover:border-teal-200 disabled:opacity-60 transition-colors">
              <RefreshCw className={cn("w-3.5 h-3.5", analisando && "animate-spin")} />
              {analisando ? "Analisando…" : "Analisar agora"}
            </button>
          )}
        </div>
      </div>

      {aviso && (
        <div className={cn("flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border",
          aviso.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : aviso.tipo === "espera" ? "bg-amber-50 border-amber-200 text-amber-700"
            : "bg-slate-50 border-slate-200 text-slate-600")}>
          <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {aviso.texto}
        </div>
      )}

      {/* Um seletor de motor para a clínica inteira. */}
      <SeletorMotor
        motor={motor}
        onMotor={aplicarMotor}
        mecanicoDisponivel={config?.mechanical_available === true}
        vendaAuto={config?.sale_mode === "auto"}
        onVendaAuto={(v) => save({ sale_mode: v ? "auto" : "suggest" })}
        disabled={ativando}
      />

      {/* As duas filas para auditar, embaixo do seletor. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <FilaConfirmar
          eixo="etapa"
          itens={pendingEtapas}
          vazioTexto={motor === "mecanico"
            ? "O motor mecânico não encontrou nenhuma etapa para sugerir por enquanto."
            : desligada
              ? "Ative a análise para a IA começar a ler as conversas."
              : motor === "sugestao"
                ? "Nenhuma mudança de etapa aguardando."
                : motor === "automatico"
                  ? "Está em Automático: a IA move os cards sozinha, e o histórico fica no final da página."
                  : "Está em Manual: ninguém sugere etapa nesta clínica."}
          busy={busy}
          onAprovar={aprovar}
          onRecusar={recusar}
          onVerConversa={verConversa}
          stageName={stageName}
        />
        <FilaConfirmar
          eixo="venda"
          itens={pendingVendas}
          vazioTexto={(motor === "mecanico" || motor === "manual")
            ? "Neste motor a venda é marcada na mão (pelo Ganho, no Kanban)."
            : desligada
              ? "Ative a análise para a IA começar a ler as conversas."
              : "Nenhuma venda aguardando. Assim que a IA encontrar uma, ela aparece aqui."}
          busy={busy}
          onAprovar={aprovar}
          onRecusar={recusar}
          onVerConversa={verConversa}
          stageName={stageName}
        />
      </div>

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
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-slate-500 flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                Escrito pela própria IA a partir das conversas desta clínica e reescrito conforme suas decisões.
                É isto que ela usa para decidir. Se estiver errado, corrija aqui: vale a partir da próxima análise.
                {config?.decisions_since_learn ? ` ${config.decisions_since_learn} decisão(ões) desde a última versão.` : ""}
              </p>
              {current && !editando && (
                <button
                  onClick={() => { setRascunho(current.content); setEditando(true); }}
                  className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-teal-600 border border-slate-200 hover:border-teal-200 rounded-lg px-2 py-1 transition-colors"
                >
                  <Pencil className="w-3 h-3" /> Corrigir
                </button>
              )}
            </div>

            {editando ? (
              <div className="space-y-2">
                <textarea
                  value={rascunho}
                  onChange={e => setRascunho(e.target.value)}
                  className="w-full h-72 p-3 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 resize-y"
                />
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setSalvandoPrompt(true);
                      const ok = await editar(rascunho);
                      setSalvandoPrompt(false);
                      if (ok) setEditando(false);
                    }}
                    disabled={salvandoPrompt || !rascunho.trim()}
                    className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    {salvandoPrompt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Salvar como nova versão
                  </button>
                  <button
                    onClick={() => setEditando(false)}
                    className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-xl text-xs font-bold"
                  >
                    Cancelar
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  A versão atual não é apagada: fica no histórico abaixo e você pode voltar para ela quando quiser.
                </p>
              </div>
            ) : current ? (
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

      {/* Auditoria manual: a mesma conversa que o Kanban abre */}
      <AnimatePresence>
        {conversa && (
          <LeadChat
            lead={conversa.lead}
            ticketId={conversa.ticketId}
            onClose={() => setConversa(null)}
          />
        )}
      </AnimatePresence>

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
              // Venda lançada: agora sim a sugestão está decidida (e vira aprendizado).
              const dec = await decide(ganho.insightId, "approve");
              if (!dec.success) {
                flash("info", "Venda registrada, mas não consegui baixar a sugestão da fila. Ela pode reaparecer aqui — use \"Não foi venda\" para tirá-la, sem lançar de novo.", 12000);
              }
            }
            return ok;
          }}
        />
      )}
    </div>
  );
}
