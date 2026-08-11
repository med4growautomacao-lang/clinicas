import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, Pencil, ThumbsUp, Trash2, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../../lib/supabase";
import {
  Conversion, Orcamento, logSystemError, updateSale,
  useFinancial, useProducts, useProtocols, useSettings,
} from "../../hooks/useSupabase";
import { useToast } from "../ui/toast";
import { Button, Field, Modal, fmtBRL, fmtDate, fmtQty, inputCls } from "../production/shared";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// JANELA ÚNICA DE VENDA
//
// Até 11/08 existiam DUAS: a do Kanban (arrastar o card para Ganho, valor digitado à mão, sem
// saber que existiam propostas) e a da Central de Orçamentos (aprovar a proposta). Quem vendia
// pelo Kanban deixava a proposta parada em "Enviado", e quem aprovava a proposta num card que já
// tinha venda lançada à mão DOBRAVA o faturamento do cliente.
//
// 📌 A pergunta que justifica este arquivo: com uma proposta escolhida e o card JÁ com venda
// lançada, é a MESMA venda ou OUTRA? "Mesma" amarra a proposta na venda que existe (sem criar
// dinheiro); "outra" lança uma venda nova. Sem essa pergunta o faturamento dobra em silêncio.
//
// ⚠️ Arquivo próprio de propósito: o Kanban importa a Central (OrcamentoModal) e a Central importa
// o Kanban. Este componente não pode morar em nenhum dos dois sem fechar um ciclo de import.
//
// O bloco de proposta só aparece para quem TEM proposta viva no card. Em clínica (MedDesk) não
// existe orçamento, e na maioria dos cards da fábrica também não: nesses casos a janela é a de
// sempre, com o valor digitado.
// ═══════════════════════════════════════════════════════════════════════════════════════════

type RpcResult = { success: boolean; error_code?: string; [key: string]: any };

export type AprovarPropostaOpts = {
  paymentMethod: string;
  paymentStatus: "pago" | "pendente";
  paymentDate: string;
  category?: string;
  dataEntrega?: string | null;
  lineKeys?: string[] | null;
  total?: number | null;
  // Vínculo: quando preenchido, a proposta é amarrada a uma venda que JÁ existe e nada de dinheiro
  // é criado. `linkSyncValue` traz o valor da proposta para a venda e para o financeiro.
  linkConversionId?: string | null;
  linkSyncValue?: boolean;
};

// Venda já lançada neste card (recorte mínimo: é só o que a tela mostra e edita).
type VendaDoCard = {
  id: string;
  value: number;
  description: string | null;
  payment_method: string | null;
  converted_at: string;
};

const METODOS = [
  { id: "pix", label: "Pix" },
  { id: "cartao", label: "Cartão" },
  { id: "dinheiro", label: "Dinheiro" },
  { id: "plano", label: "Plano" },
];

// Dia de hoje no fuso do negócio (§0.1). O relógio da máquina não decide data de venda.
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
// ⚠️ `conversions.converted_at` é timestamptz, e o dia da venda é o de São Paulo. Cortar a string
// crua pegaria o dia em UTC: venda das 22h apareceria (e seria SALVA) no dia seguinte.
const diaSP = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dataBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

// Mensagem em português para CADA recusa do backend. Código sem tradução vira texto genérico, mas
// nunca some: recusa muda foi o defeito que trouxe este trabalho.
export function mensagemDeErroDeVenda(code?: string): string {
  return (
    {
      already_processed: "Esta proposta já foi processada (ganha ou recusada). Feche e abra a janela para ver o estado atual.",
      orcamento_vencido: "A validade desta proposta já venceu. Ajuste a validade no orçamento antes de fechar a venda.",
      no_lead_linked: "Esta proposta não está ligada a um cliente.",
      no_open_ticket: "Este cliente não tem card aberto no funil. Abra ou reabra o card antes de registrar a venda.",
      ticket_perdido: "O card deste cliente está marcado como Perdido. Reverta a perda antes de registrar a venda.",
      nenhum_item_selecionado: "Selecione ao menos um item da proposta.",
      venda_nao_encontrada: "A venda escolhida não existe mais. Feche e abra a janela de novo.",
      venda_de_outro_card: "A venda escolhida pertence a outro card, então esta proposta não pode ser amarrada nela.",
      venda_ja_vinculada: "Esta venda já está amarrada a outra proposta.",
      multiplas_vendas: "Este card tem mais de uma venda lançada. Escolha qual delas.",
      valor_invalido: "Informe um valor maior que zero.",
      forbidden: "Sem permissão para registrar venda nesta clínica.",
      orcamento_not_found: "Proposta não encontrada.",
    } as Record<string, string>
  )[code || ""] || "Não foi possível concluir. Nada foi lançado.";
}

// Campo de dinheiro no formato de caixa (os dígitos entram pela direita). Cópia deliberada do que o
// Kanban usa: importá-lo de lá fecharia o ciclo de import que este arquivo existe para evitar.
function CurrencyInput({ value, onChange, className, placeholder, autoFocus }: {
  value: string | number;
  onChange: (val: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (raw === "") { onChange(""); return; }
    onChange((parseInt(raw, 10) / 100).toFixed(2));
  };
  const display = value && !isNaN(Number(value))
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))
    : "";
  return (
    <div className={cn(
      "flex items-center w-full px-4 py-3 border border-slate-200 rounded-xl bg-white shadow-sm focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-all",
      className
    )}>
      <span className="text-slate-400 font-black text-sm mr-2 select-none shrink-0">R$</span>
      <input
        type="text"
        autoFocus={autoFocus}
        value={display}
        onChange={handleChange}
        placeholder={placeholder || "0,00"}
        className="w-full bg-transparent border-none outline-none text-sm font-bold p-0 placeholder:text-slate-300 focus:ring-0"
      />
    </div>
  );
}

// Uma linha do orçamento resolvida contra o catálogo. `key` é a MESMA chave que o provision usa
// (orcamento_line_key = 'L' + ordinal da linha no snapshot), por isso o ordinal conta TODAS as linhas
// cruas — inclusive as puladas — para não desalinhar a seleção do que vira pedido/OP.
export type OrcLine = { ord: number; key: string; name: string; qtyLine: string; value: number; productId: string; qty: number; altura: number };

// Vive aqui (e não na Central) porque a seleção de itens é da JANELA DE VENDA. A Central importa
// daqui para imprimir o recibo; o contrário fecharia ciclo de import.
export function resolveOrcamentoLines(snapshot: any, products: any[], protocols: any[]): OrcLine[] {
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

export function RegistrarVendaModal({
  lead,
  ticketId,
  isConversionStage = false,
  orcamentos = [],
  orcamentoInicialId = null,
  aprovarProposta,
  onCreate,
  createPatient,
  updateLead,
  stagesParaReabrir = [],
  cancelarVenda,
  onAtualizado,
  onClose,
  onCancel,
}: {
  lead: { id: string; name: string; phone?: string | null; patientId?: string | null; ctwaClid?: string | null; email?: string | null };
  /** Card da venda. A Central não conhece o card, só a proposta: passa null e a janela resolve o
   *  ticket ABERTO do cliente, que é exatamente o que a RPC vai usar. */
  ticketId: string | null;
  isConversionStage?: boolean;
  /** Propostas da clínica (o chamador já as carrega com useOrcamentos). A janela filtra as do card. */
  orcamentos?: Orcamento[];
  /** Proposta já escolhida na tela de origem (a linha de onde o usuário clicou, na Central). */
  orcamentoInicialId?: string | null;
  /** useOrcamentos().approve. Sem ele o bloco de proposta não aparece. */
  aprovarProposta?: (orcamentoId: string, opts: AprovarPropostaOpts) => Promise<RpcResult>;
  /** Venda avulsa (valor digitado): mesmo contrato de sempre do Kanban. Sem ele, a venda avulsa
   *  não é oferecida e a janela exige escolher uma proposta. */
  onCreate?: (data: Omit<Conversion, "id" | "clinic_id" | "created_at">) => Promise<boolean>;
  createPatient?: (p: { name: string; phone: string | null }) => Promise<{ id: string } | null>;
  updateLead?: (id: string, payload: { converted_patient_id?: string; email?: string }) => Promise<unknown>;
  /** Etapas ATIVAS para onde o card volta ao cancelar uma venda. Vazio = a tela não oferece cancelar. */
  stagesParaReabrir?: { id: string; name: string }[];
  /** useTickets().reopenTicket, já com a venda escolhida. */
  cancelarVenda?: (conversionId: string, stageId: string) => Promise<RpcResult>;
  /** Chamado após QUALQUER escrita bem-sucedida, para a tela de origem se atualizar. */
  onAtualizado?: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  const showToast = useToast();
  const { clinic } = useSettings();
  const { create: createTransaction, remove: removeTransaction } = useFinancial();
  const { data: products } = useProducts();
  const { data: protocols } = useProtocols();
  const isFactory = clinic?.category === "outro";

  // ── Card ────────────────────────────────────────────────────────────────────────────────
  // A Central abre pela proposta e não sabe o card. O card certo é o ticket ABERTO do cliente
  // (mesma regra da RPC): confiar em orcamentos.ticket_id apontaria para um card já fechado, e a
  // pergunta "mesma venda ou outra?" olharia para as vendas erradas.
  const [ticketDoCard, setTicketDoCard] = useState<string | null>(ticketId);
  // ⚠️ `cardResolvido` separa "ainda não sei qual é o card" de "já sei que não tem card". Sem essa
  // diferença, `ticketDoCard` nulo parece card sem venda nenhuma, e é assim que a janela liberaria
  // a confirmação antes de conferir o que já está lançado.
  const [cardResolvido, setCardResolvido] = useState(!!ticketId);
  useEffect(() => {
    if (ticketId) { setTicketDoCard(ticketId); setCardResolvido(true); return; }
    if (!lead.id) { setCardResolvido(true); return; }
    let cancelado = false;
    (async () => {
      const { data } = await supabase
        .from("tickets").select("id").eq("lead_id", lead.id).eq("status", "open").limit(1).maybeSingle();
      if (!cancelado) { setTicketDoCard((data as any)?.id ?? null); setCardResolvido(true); }
    })();
    return () => { cancelado = true; };
  }, [ticketId, lead.id]);

  // ── Vendas já lançadas neste card ───────────────────────────────────────────────────────
  const [vendas, setVendas] = useState<VendaDoCard[]>([]);
  const [vendasCarregando, setVendasCarregando] = useState(false);
  const [vendasFalharam, setVendasFalharam] = useState(false);
  // Só vira true depois que a leitura VOLTOU. É o que o botão espera antes de deixar confirmar uma
  // proposta: lista vazia por não ter chegado é indistinguível de card sem venda.
  const [vendasConferidas, setVendasConferidas] = useState(false);

  const carregarVendas = React.useCallback(async () => {
    if (!ticketDoCard) {
      // Card ainda não resolvido: não há o que conferir e a conferência CONTINUA pendente. Card
      // resolvido como inexistente não tem venda, então aí a conferência está feita.
      setVendas([]);
      setVendasConferidas(cardResolvido);
      return;
    }
    setVendasCarregando(true);
    const { data, error } = await supabase
      .from("conversions")
      .select("id, value, description, payment_method, converted_at")
      .eq("ticket_id", ticketDoCard)
      .order("converted_at", { ascending: false });
    setVendasCarregando(false);
    if (error) {
      // §0.5: esta lista é o que impede o faturamento de dobrar. Falhar em silêncio aqui deixaria
      // a tela dizer "card sem venda" para um card que tem, e a venda nova entraria por cima.
      setVendasFalharam(true);
      setVendasConferidas(false);
      logSystemError("VENDAS_DO_CARD_FETCH_FAIL", `Janela de venda: falha ao ler as vendas do card (${error.message})`,
        clinic?.id ?? null, { ticket_id: ticketDoCard, error: error.message }, "error");
      return;
    }
    setVendasFalharam(false);
    setVendas((data as VendaDoCard[]) || []);
    setVendasConferidas(true);
  }, [ticketDoCard, cardResolvido, clinic?.id]);

  useEffect(() => { carregarVendas(); }, [carregarVendas]);

  // ── Propostas vivas deste card ──────────────────────────────────────────────────────────
  // Viva = rascunho ou enviado. O segundo ramo do filtro (proposta sem card) não é enfeite: há
  // orçamentos com ticket_id nulo que sumiriam do seletor.
  const propostas = useMemo(() => {
    const vivas = orcamentos.filter(o =>
      (o.status === "rascunho" || o.status === "enviado") &&
      ((!!ticketDoCard && o.ticket_id === ticketDoCard) || (o.lead_id === lead.id && o.ticket_id == null))
    );
    // UMA LINHA POR PROJETO: propostas do mesmo projeto são versões da mesma negociação e só a mais
    // recente está de pé. Sem projeto (legado), cada uma vale por si.
    const porProjeto = new Map<string, Orcamento>();
    for (const o of vivas) {
      const proj = (o.projeto || "").trim().toLowerCase();
      const chave = proj ? `p:${proj}` : `o:${o.id}`;
      const atual = porProjeto.get(chave);
      if (!atual || o.number > atual.number) porProjeto.set(chave, o);
    }
    const lista = [...porProjeto.values()];
    // A proposta de onde o usuário clicou entra sempre, mesmo sendo versão anterior do projeto:
    // quem clicou em "Marcar Ganho" nela quer fechar ELA.
    if (orcamentoInicialId && !lista.some(o => o.id === orcamentoInicialId)) {
      const inicial = orcamentos.find(o => o.id === orcamentoInicialId);
      if (inicial) lista.push(inicial);
    }
    return lista.sort((a, b) => b.number - a.number);
  }, [orcamentos, ticketDoCard, lead.id, orcamentoInicialId]);

  const temBlocoProposta = !!aprovarProposta && propostas.length > 0;
  const podeVendaAvulsa = !!onCreate;

  const [tocouEscolha, setTocouEscolha] = useState(false);
  const [orcSelecionadoId, setOrcSelecionadoId] = useState<string | null>(orcamentoInicialId);
  useEffect(() => {
    if (tocouEscolha) return;
    if (orcamentoInicialId) { setOrcSelecionadoId(orcamentoInicialId); return; }
    // Pré-seleciona só com UMA proposta viva. Com projetos diferentes são negócios distintos, e
    // escolher por inércia erra dinheiro. Sem venda avulsa disponível, a escolha é obrigatória.
    setOrcSelecionadoId(propostas.length === 1 ? propostas[0].id : null);
  }, [propostas, orcamentoInicialId, tocouEscolha]);

  const orcSel = temBlocoProposta ? (propostas.find(o => o.id === orcSelecionadoId) ?? null) : null;

  // ── Itens da proposta ───────────────────────────────────────────────────────────────────
  const lines = useMemo(
    () => (orcSel ? resolveOrcamentoLines(orcSel.snapshot, products, protocols) : []),
    [orcSel, products, protocols],
  );
  const [selected, setSelected] = useState<Set<string> | null>(null);
  useEffect(() => { setSelected(null); }, [orcSelecionadoId]);
  const sel = selected ?? new Set(lines.map(l => l.key));
  const selectedLines = lines.filter(l => sel.has(l.key));
  const selectedTotal = selectedLines.reduce((s, l) => s + l.value, 0);
  const isPartial = lines.length > 1 && selectedLines.length < lines.length;
  const totalDaProposta = orcSel ? (isPartial ? selectedTotal : Number(orcSel.total || 0)) : 0;
  const selKey = selectedLines.map(l => l.key).join(",");
  const toggleLinha = (key: string) => {
    const next = new Set(sel);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
  };

  // ── Vínculo: é a MESMA venda ou OUTRA? ──────────────────────────────────────────────────
  // Venda que outra proposta já reivindicou não pode ser oferecida: a RPC recusaria com
  // 'venda_ja_vinculada', e mostrar a opção só levaria o usuário a um beco.
  const vendasTomadas = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const o of orcamentos) {
      const cid = (o as any).conversion_id as string | null | undefined;
      if (cid && o.id !== orcSelecionadoId) mapa.set(cid, o.number);
    }
    return mapa;
  }, [orcamentos, orcSelecionadoId]);
  const vendasLivres = vendas.filter(v => !vendasTomadas.has(v.id));
  const precisaDecidirVinculo = !!orcSel && vendasLivres.length > 0;

  const [respostaVinculo, setRespostaVinculo] = useState<"mesma" | "outra" | null>(null);
  const [vendaAlvoId, setVendaAlvoId] = useState<string | null>(null);
  const [sincronizarValor, setSincronizarValor] = useState(false);
  useEffect(() => {
    // Trocou de proposta: a decisão anterior não vale mais.
    setRespostaVinculo(null);
    setVendaAlvoId(null);
    setSincronizarValor(false);
  }, [orcSelecionadoId]);
  useEffect(() => {
    // Uma venda livre só: já fica escolhida (a pergunta que importa continua sendo mesma x outra).
    if (respostaVinculo === "mesma" && !vendaAlvoId && vendasLivres.length === 1) setVendaAlvoId(vendasLivres[0].id);
  }, [respostaVinculo, vendaAlvoId, vendasLivres]);

  const vendaAlvo = vendas.find(v => v.id === vendaAlvoId) ?? null;
  const vinculando = !!orcSel && respostaVinculo === "mesma";
  const valorDivergente = !!vendaAlvo && Math.abs(Number(vendaAlvo.value) - totalDaProposta) > 0.005;

  // ── Pagamento / datas ───────────────────────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [txStatus, setTxStatus] = useState<"pago" | "pendente">("pago");
  const [date, setDate] = useState(hojeSP);
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [protocolIds, setProtocolIds] = useState<string[]>([]);
  const [dataEntrega, setDataEntrega] = useState<string>("");
  useEffect(() => { setDataEntrega(orcSel?.data_entrega_prevista ?? ""); }, [orcSelecionadoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Atribuição Meta: o e-mail é o único dado de match que costuma faltar (clid/telefone já vêm do
  // lead). Só pedimos quando o lead veio de anúncio (tem ctwa_clid) e ainda não tem e-mail.
  const fromAd = !!lead.ctwaClid;
  const [emailInput, setEmailInput] = useState(lead.email ?? "");
  // DEBUG (TEMPORÁRIO, p/ aprovação Meta): resultado do envio de teste (payload + resposta crua).
  // Remover este estado + o painel abaixo depois da aprovação e restaurar o auto-close no handleSave.
  const [capiResult, setCapiResult] = useState<any>(null);
  const [capiOpen, setCapiOpen] = useState(true);

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // ── Disponibilidade / prazo (fábrica) ───────────────────────────────────────────────────
  const [eta, setEta] = useState<any>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  useEffect(() => {
    if (!isFactory || !orcSel) { setEta(null); setEtaLoading(false); return; }
    if (selectedLines.length === 0) { setEta(null); setEtaLoading(false); return; }
    const payload = selectedLines
      .filter(l => l.productId.startsWith("p:"))
      .map(l => ({ productId: l.productId, qty: String(l.qty), altura: l.altura ? String(l.altura) : "" }));
    if (payload.length === 0) { setEta(null); setEtaLoading(false); return; }
    let cancelado = false;
    setEtaLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("simulate_production_eta", { p_clinic_id: orcSel.clinic_id, p_lines: payload });
      if (cancelado) return;
      setEtaLoading(false);
      if (error || !(data as any)?.success) { setEta({ error: true }); return; }
      const res = data as any;
      setEta(res);
      setDataEntrega(prev => prev || res.resumo?.data_sugerida || "");
    })();
    return () => { cancelado = true; };
  }, [isFactory, orcSel?.id, orcSel?.clinic_id, selKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtDataBR = (iso?: string) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "");

  // ── Gravação ────────────────────────────────────────────────────────────────────────────

  // Venda avulsa: o caminho de sempre do Kanban (valor digitado). Cria a receita PRIMEIRO para
  // vincular a conversão a ela (financial_transaction_id). Esse vínculo deixa a limpeza automática
  // confiável: quando o ticket sai de 'ganho', o gatilho fn_purge_ticket_sale apaga a conversão E a
  // receita ligada (sem órfão no Financeiro).
  const salvarAvulsa = async () => {
    if (!onCreate) return;
    if (!value || Number(value) <= 0) return;
    setErro(null);
    setSaving(true);
    // Garante um paciente vinculado ao lead ANTES de fechar o ticket — senão o trigger
    // fn_auto_create_lead_on_patient abriria um ticket novo. Sem patient_id, a receita
    // nasce órfã e some do "Faturamento real" quando há filtro de coorte (Entrada).
    let patientId = lead.patientId ?? null;
    if (!patientId && createPatient) {
      const np = await createPatient({ name: lead.name, phone: lead.phone ?? null });
      if (np?.id) {
        patientId = np.id;
        // O trigger já liga por telefone; este update cobre o caso de lead sem telefone.
        await updateLead?.(lead.id, { converted_patient_id: np.id });
      }
    }
    // Atribuição Meta: grava o e-mail informado (coluna simples, sem risco de zerar JSONB) para
    // subir a nota da conversão que a edge meta-capi-conversions enviará ao Meta.
    const emailTrim = emailInput.trim();
    if (emailTrim && emailTrim !== (lead.email ?? "")) {
      await updateLead?.(lead.id, { email: emailTrim });
    }

    const tx = await createTransaction({
      type: "receita",
      category: "Consulta",
      amount: Number(value),
      description: description || "Venda registrada",
      payment_method: paymentMethod as any,
      status: txStatus,
      date,
      protocol_ids: protocolIds,
      patient_id: patientId ?? undefined,
    } as any);
    const ok = await onCreate({
      lead_id: lead.id,
      value: Number(value),
      description: description || null,
      payment_method: paymentMethod,
      protocol_ids: protocolIds,
      converted_at: new Date(date + "T12:00:00").toISOString(),
      financial_transaction_id: (tx as any)?.id ?? null,
    } as any);
    if (ok) {
      setDone(true);
      onAtualizado?.();
      // Só dispara CAPI quando 'ganho' É a etapa de conversão desta clínica. Se a conversão está em
      // outra etapa (ex.: 'agendado'), mover para ganho não gera evento — então fecha normal.
      if (isConversionStage) {
        // DEBUG (TEMPORÁRIO, p/ aprovação Meta): dispara a conversão na hora e mostra payload+resposta.
        setCapiResult("loading");
        try {
          const { data, error } = await supabase.functions.invoke("meta-capi-conversions", { body: { debug_ticket_id: ticketDoCard } });
          setCapiResult(error ? { ok: false, error: error.message } : data);
        } catch (e) {
          setCapiResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      } else {
        setTimeout(onClose, 1000);
      }
    } else {
      // ⚠️ A receita nasce ANTES da venda (é o vínculo que deixa o cancelamento limpo). Se a venda
      // não entrou, o lançamento fica órfão no Financeiro, e convidar a tentar de novo criaria um
      // SEGUNDO lançamento para a mesma venda: desfaz o que acabamos de criar antes de oferecer o
      // retry.
      const txId = (tx as any)?.id as string | undefined;
      const desfeito = txId ? await removeTransaction(txId) : true;
      if (!desfeito) {
        // §0.5: receita órfã no caixa não aparece em lugar nenhum se não acender aqui.
        logSystemError("VENDA_AVULSA_RECEITA_ORFA",
          "Venda avulsa falhou e o lançamento no Financeiro não pôde ser desfeito",
          clinic?.id ?? null, { lead_id: lead.id, ticket_id: ticketDoCard, financial_transaction_id: txId }, "error");
      }
      setErro(desfeito
        ? "Não foi possível registrar a venda. Nada foi lançado, pode tentar de novo."
        : "Não foi possível registrar a venda, e o lançamento no Financeiro não pôde ser desfeito. Confira o Financeiro antes de tentar de novo.");
    }
    setSaving(false);
  };

  // Proposta: uma só chamada, que decide lançar venda nova ou amarrar na que já existe.
  const salvarProposta = async () => {
    if (!orcSel || !aprovarProposta) return;
    setErro(null);
    setSaving(true);
    // Atribuição Meta: mesma gravação da venda avulsa (coluna simples, sem risco de zerar JSONB).
    // O fechamento é que enfileira o evento de conversão, e a edge meta-capi-conversions lê o
    // e-mail do lead depois: gravar antes garante que ele já esteja lá quando ela ler.
    const emailTrim = emailInput.trim();
    if (emailTrim && emailTrim !== (lead.email ?? "")) {
      await updateLead?.(lead.id, { email: emailTrim });
    }
    const res = await aprovarProposta(orcSel.id, {
      paymentMethod,
      paymentStatus: txStatus,
      paymentDate: date,
      dataEntrega: isFactory ? (dataEntrega || null) : null,
      // Só manda a seleção quando ela é parcial — sem seleção, o servidor mantém tudo/total cotado.
      lineKeys: isPartial ? selectedLines.map(l => l.key) : null,
      total: isPartial ? selectedTotal : null,
      linkConversionId: vinculando ? vendaAlvoId : null,
      linkSyncValue: vinculando ? sincronizarValor : false,
    });
    setSaving(false);
    if (!res?.success) {
      setErro(mensagemDeErroDeVenda(res?.error_code));
      return;
    }
    setDone(true);
    onAtualizado?.();
    showToast(
      res.vinculado
        ? `Proposta #${orcSel.number} marcada como ganha e amarrada à venda que já existia (nada de dinheiro novo foi lançado).`
        : `Venda registrada: proposta #${orcSel.number} marcada como ganha.`,
      "success",
    );
    onClose();
  };

  // ── Editar / cancelar venda já lançada ──────────────────────────────────────────────────
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edValor, setEdValor] = useState("");
  const [edData, setEdData] = useState("");
  const [edMetodo, setEdMetodo] = useState("pix");
  const [edDescricao, setEdDescricao] = useState("");
  const [edSalvando, setEdSalvando] = useState(false);

  const abrirEdicao = (v: VendaDoCard) => {
    setCancelandoId(null);
    setEditandoId(v.id);
    setEdValor(Number(v.value).toFixed(2));
    setEdData(diaSP(v.converted_at));
    // ⚠️ Vazio quando a venda não tem forma de pagamento, NUNCA 'pix' por inércia: o formulário
    // pré-preenchido carimbava na venda (e na receita) uma forma que ninguém escolheu.
    setEdMetodo(v.payment_method || "");
    setEdDescricao(v.description || "");
  };

  // ⚠️ `update_conversion_sale` grava `COALESCE(p_campo, campo)`: mandar null NÃO apaga, mantém o
  // que estava. Por isso a descrição só viaja quando MUDOU (vazia, viaja como texto vazio, que é o
  // que de fato apaga) e a forma de pagamento em branco viaja como null (não apaga, mas também não
  // inventa uma forma).
  const salvarEdicao = async (v: VendaDoCard) => {
    if (!edValor || Number(edValor) <= 0) { setErro(mensagemDeErroDeVenda("valor_invalido")); return; }
    setEdSalvando(true);
    const res = await updateSale(v.id, {
      value: Number(edValor),
      convertedAt: edData || null,
      paymentMethod: edMetodo || null,
      description: edDescricao !== (v.description ?? "") ? edDescricao : null,
    });
    setEdSalvando(false);
    if (!res.success) { setErro(mensagemDeErroDeVenda(res.error_code)); return; }
    setEditandoId(null);
    setErro(null);
    await carregarVendas();
    onAtualizado?.();
    showToast("Venda atualizada. A receita no Financeiro acompanhou.", "success");
  };

  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [stageDestino, setStageDestino] = useState<string>("");
  const [cancelando, setCancelando] = useState(false);
  const podeCancelar = !!cancelarVenda && stagesParaReabrir.length > 0;

  const confirmarCancelamento = async (id: string) => {
    if (!cancelarVenda || !stageDestino) return;
    setCancelando(true);
    const res = await cancelarVenda(id, stageDestino);
    setCancelando(false);
    if (!res?.success) { setErro(mensagemDeErroDeVenda(res?.error_code)); return; }
    onAtualizado?.();
    showToast("Venda cancelada: a receita e o lançamento no Financeiro foram removidos, e o card voltou para o funil.", "success");
    onClose();
  };

  // ── Botão principal ─────────────────────────────────────────────────────────────────────
  // Com VÁRIAS propostas vivas nada vem pré-escolhido, e aí a escolha é obrigatória: ou a venda é
  // de uma proposta, ou o usuário diz que é avulsa. Deixar passar em branco é como a proposta fica
  // parada em "Enviado" com o card já ganho. Card sem proposta nenhuma não vê nada disso.
  const faltaEscolherProposta = temBlocoProposta && !orcSel && (!podeVendaAvulsa || !tocouEscolha);
  // ⚠️ TRAVA CENTRAL DESTA JANELA. Enquanto a conferência do card não voltou (duas leituras em
  // série quando a Central abre pela proposta: primeiro o card, depois as vendas dele), `vendas` é
  // [] e a pergunta "mesma venda ou OUTRA?" nem existe na tela. Sem esta linha o botão nasce
  // clicável e um clique rápido lança venda NOVA por cima da que já estava lançada, que é
  // exatamente o que a RPC faz nesse caso (o CAMINHO B vale também para card já ganho, de
  // propósito). Vale só para o caminho da proposta: a venda avulsa não tem o que vincular.
  const conferindoVendas = !!orcSel && !vendasConferidas;
  const bloqueado =
    saving ||
    // Já registrou: a janela só fica de pé por causa do painel de conferência do Meta, e um
    // segundo clique aqui lançaria a MESMA venda de novo.
    done ||
    faltaEscolherProposta ||
    (orcSel
      ? conferindoVendas ||
        (lines.length > 0 && selectedLines.length === 0) ||
        (precisaDecidirVinculo && respostaVinculo === null) ||
        (vinculando && !vendaAlvoId)
      : !value || Number(value) <= 0);

  const rotuloBotao = done
    ? "Registrado!"
    : saving
      ? "Registrando…"
      : conferindoVendas
        ? "Conferindo o card…"
        : vinculando
          ? "Vincular à venda"
          : orcSel
            ? "Confirmar venda"
            : "Registrar Ganho";

  return (
    // A janela abre por cima do quadro e da conversa (drawer z-[70]): sem esta camada o primitivo
    // da casa (z-50) ficaria ATRÁS do drawer e o usuário veria só o escurecido.
    <div className="relative z-[90]">
      <Modal
        title="Registrar venda"
        subtitle={lead.name}
        onClose={onCancel}
        footer={<>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" onClick={() => (orcSel ? salvarProposta() : salvarAvulsa())} disabled={bloqueado}>
            {done ? <Check className="w-4 h-4 mr-1.5" /> : saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ThumbsUp className="w-4 h-4 mr-1.5" />}
            {rotuloBotao}
          </Button>
        </>}
      >
        <div className="space-y-4">
          {/* ── Proposta ─────────────────────────────────────────────────────────────── */}
          {temBlocoProposta && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                {propostas.length === 1 ? "Proposta deste cliente" : "De qual proposta é esta venda?"}
              </div>
              {propostas.map(o => {
                const escolhida = o.id === orcSelecionadoId;
                return (
                  <label key={o.id} className={cn(
                    "flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer select-none transition-colors",
                    escolhida ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 hover:border-slate-300"
                  )}>
                    <input
                      type="radio"
                      name="proposta-da-venda"
                      className="w-4 h-4 accent-emerald-600 shrink-0"
                      checked={escolhida}
                      onChange={() => { setTocouEscolha(true); setOrcSelecionadoId(o.id); }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        #{o.number}{o.projeto ? ` · ${o.projeto}` : ""}
                      </p>
                      <p className="text-[11px] text-slate-400">{fmtDate(o.created_at)}</p>
                    </div>
                    <span className="text-sm font-black text-slate-800 shrink-0">{fmtBRL(o.total)}</span>
                  </label>
                );
              })}
              {podeVendaAvulsa && (
                <button
                  type="button"
                  onClick={() => { setTocouEscolha(true); setOrcSelecionadoId(null); }}
                  className={cn(
                    "text-[11px] font-bold underline underline-offset-2 transition-colors",
                    orcSelecionadoId === null ? "text-slate-700" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {propostas.length === 1 ? "Não é esta proposta (venda avulsa)" : "Nenhuma destas (venda avulsa)"}
                </button>
              )}
              {faltaEscolherProposta && (
                <p className="text-[11px] font-semibold text-rose-500">
                  {podeVendaAvulsa
                    ? "Escolha de qual proposta é esta venda, ou marque venda avulsa."
                    : "Escolha de qual proposta é esta venda."}
                </p>
              )}
            </div>
          )}

          {/* ── Pergunta que impede o faturamento de dobrar ───────────────────────────── */}
          {vendasFalharam && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 flex items-center gap-2">
              <p className="text-[11px] font-semibold text-amber-700 flex-1">
                Não consegui conferir as vendas já lançadas neste card.{" "}
                {orcSel
                  ? "Enquanto isso a confirmação fica travada, para não lançar a mesma venda duas vezes."
                  : "Confira o card antes de registrar, para não lançar a mesma venda duas vezes."}
              </p>
              <Button variant="outline" size="sm" onClick={() => { void carregarVendas(); }}>Tentar de novo</Button>
            </div>
          )}
          {conferindoVendas && !vendasFalharam && (
            <p className="text-[11px] font-semibold text-slate-400">Conferindo as vendas já lançadas neste card…</p>
          )}
          {orcSel && vendas.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2.5">
              <p className="text-xs font-black text-amber-800 uppercase tracking-wide">Este card já tem venda lançada</p>
              {vendasLivres.length === 0 ? (
                <p className="text-[11px] font-semibold text-amber-700">
                  As vendas deste card já estão amarradas a outras propostas, então esta proposta lança uma venda nova de {fmtBRL(totalDaProposta)}.
                </p>
              ) : (<>
                <p className="text-[11px] text-amber-800 font-medium">
                  {vendasLivres.length === 1
                    ? `A proposta #${orcSel.number} (${fmtBRL(totalDaProposta)}) é a mesma venda de ${fmtBRL(vendasLivres[0].value)} lançada em ${dataBR(vendasLivres[0].converted_at)}, ou é outra venda?`
                    : `A proposta #${orcSel.number} (${fmtBRL(totalDaProposta)}) é uma das ${vendasLivres.length} vendas já lançadas neste card, ou é uma venda a mais?`}
                </p>
                <label className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer select-none",
                  respostaVinculo === "mesma" ? "border-emerald-300 bg-white" : "border-amber-200 bg-white/70"
                )}>
                  <input type="radio" name="vinculo-da-venda" className="w-4 h-4 mt-0.5 accent-emerald-600 shrink-0"
                    checked={respostaVinculo === "mesma"} onChange={() => setRespostaVinculo("mesma")} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">É a MESMA venda</p>
                    <p className="text-[11px] text-slate-500">A proposta vira Ganho e vai para a produção, sem lançar dinheiro novo.</p>
                  </div>
                </label>
                {respostaVinculo === "mesma" && (
                  <div className="pl-6 space-y-2">
                    {vendasLivres.length > 1 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Qual venda?</p>
                        {vendasLivres.map(v => (
                          <label key={v.id} className="flex items-center gap-2.5 cursor-pointer select-none">
                            <input type="radio" name="venda-alvo" className="w-4 h-4 accent-emerald-600 shrink-0"
                              checked={vendaAlvoId === v.id} onChange={() => setVendaAlvoId(v.id)} />
                            <span className="flex-1 min-w-0 text-xs text-slate-600 truncate">
                              {dataBR(v.converted_at)}{v.description ? ` · ${v.description}` : ""}
                            </span>
                            <span className="text-xs font-bold text-slate-700 shrink-0">{fmtBRL(v.value)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {valorDivergente && vendaAlvo && (
                      <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-1.5">
                        <p className="text-[11px] font-bold text-slate-600">
                          O valor da proposta é diferente do que está lançado. Qual vale?
                        </p>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="radio" name="valor-do-vinculo" className="w-4 h-4 accent-emerald-600 shrink-0"
                            checked={!sincronizarValor} onChange={() => setSincronizarValor(false)} />
                          <span className="text-xs text-slate-600">Manter o valor lançado ({fmtBRL(vendaAlvo.value)})</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="radio" name="valor-do-vinculo" className="w-4 h-4 accent-emerald-600 shrink-0"
                            checked={sincronizarValor} onChange={() => setSincronizarValor(true)} />
                          <span className="text-xs text-slate-600">Usar o valor da proposta ({fmtBRL(totalDaProposta)}), corrigindo a receita</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}
                <label className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer select-none",
                  respostaVinculo === "outra" ? "border-emerald-300 bg-white" : "border-amber-200 bg-white/70"
                )}>
                  <input type="radio" name="vinculo-da-venda" className="w-4 h-4 mt-0.5 accent-emerald-600 shrink-0"
                    checked={respostaVinculo === "outra"} onChange={() => setRespostaVinculo("outra")} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">É OUTRA venda</p>
                    <p className="text-[11px] text-slate-500">Lança {fmtBRL(totalDaProposta)} a mais neste card, com a data de pagamento abaixo.</p>
                  </div>
                </label>
              </>)}
            </div>
          )}

          {/* ── Valor ────────────────────────────────────────────────────────────────── */}
          {orcSel ? (
            <div className="bg-emerald-50 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-bold text-emerald-800">{vinculando ? "Valor da venda amarrada" : "Valor da venda"}</span>
              <div className="text-right">
                <span className="text-xl font-black text-emerald-700">
                  {fmtBRL(vinculando && vendaAlvo && !sincronizarValor ? vendaAlvo.value : totalDaProposta)}
                </span>
                {isPartial && <div className="text-[11px] text-emerald-700/70">cotado {fmtBRL(orcSel.total)}</div>}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Valor (R$)</label>
              <CurrencyInput autoFocus value={value} onChange={setValue} className="focus:ring-emerald-500/20 focus:border-emerald-500" />
            </div>
          )}

          {/* ── Itens da proposta ────────────────────────────────────────────────────── */}
          {orcSel && lines.length > 1 && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Itens que viram pedido</div>
              {lines.map(l => (
                <label key={l.key} className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={sel.has(l.key)} onChange={() => toggleLinha(l.key)} className="w-4 h-4 accent-teal-600 shrink-0" />
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

          {/* ── Disponibilidade e prazo (fábrica) ────────────────────────────────────── */}
          {isFactory && orcSel && (
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
                    <p className="text-[11px] text-amber-600">Alguma linha sem taxa de produção cadastrada, o prazo pode estar incompleto.</p>
                  )}
                </>
              ) : eta?.error ? (
                <p className="text-sm text-amber-600 py-1">Não foi possível verificar a disponibilidade agora.</p>
              ) : selectedLines.length === 0 ? (
                <p className="text-sm text-slate-400 py-1">Selecione ao menos um item para verificar.</p>
              ) : (
                <p className="text-sm text-slate-400 py-1">Nenhum item de produção nesta proposta.</p>
              )}
              <Field label="Prazo de entrega (confirme ou ajuste)">
                <input type="date" className={inputCls} value={dataEntrega} onChange={e => setDataEntrega(e.target.value)} />
              </Field>
            </div>
          )}

          {/* ── Pagamento. No vínculo não aparece: amarrar não cria receita nenhuma. ──── */}
          {!vinculando && (<>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status do pagamento</label>
              <div className="flex gap-2">
                {(["pago", "pendente"] as const).map(s => (
                  <button key={s} type="button" onClick={() => setTxStatus(s)}
                    className={cn("flex-1 py-2 rounded-xl text-xs font-bold border transition-all",
                      txStatus === s ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
                    )}>
                    {s === "pago" ? "Pago" : "Pendente"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Forma de pagamento</label>
              <div className="flex flex-wrap gap-1.5">
                {METODOS.map(m => (
                  <button key={m.id} type="button" onClick={() => setPaymentMethod(m.id)}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                      paymentMethod === m.id ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
                    )}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {!orcSel && protocols.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Protocolos</label>
                <div className="flex flex-wrap gap-1.5">
                  {protocols.filter(p => p.is_active).map(p => (
                    <button key={p.id} type="button"
                      onClick={() => setProtocolIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                      className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                        protocolIds.includes(p.id) ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                      )}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!orcSel && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Descrição (opcional)</label>
                <input
                  type="text" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Ex: Consulta inicial, Pacote mensal..."
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{orcSel ? "Data do pagamento" : "Data"}</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
          </>)}

          {/* ── Atribuição Meta Ads ──────────────────────────────────────────────────
              📌 Vale TAMBÉM com proposta escolhida: venda de proposta é conversão igual, e a
              maioria dos cards da fábrica tem proposta viva. Restringir à venda avulsa escondia o
              pedido de e-mail justamente nos cards vindos de anúncio, e o Meta recebia o evento com
              um dado de casamento a menos. No vínculo não aparece: ali nenhuma venda nova nasce. */}
          {!vinculando && isConversionStage && (fromAd || !lead.email) && (
            <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
              <div className="flex items-center gap-1.5">
                <ThumbsUp className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-black text-blue-700 uppercase tracking-wider">Atribuição Meta</span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                {fromAd
                  ? "Este lead veio de anúncio Click-to-WhatsApp. A venda será enviada ao Meta para otimizar suas campanhas."
                  : "A venda será enviada ao Meta como conversão offline, casando por telefone/e-mail. Informe o e-mail para melhorar a atribuição."}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold">
                {fromAd && <span className="inline-flex items-center gap-1 text-emerald-600"><Check className="w-3 h-3" /> Clique do anúncio</span>}
                <span className={cn("inline-flex items-center gap-1", lead.phone ? "text-emerald-600" : "text-slate-400")}>
                  {lead.phone ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} Telefone
                </span>
                <span className={cn("inline-flex items-center gap-1", emailInput.trim() ? "text-emerald-600" : "text-slate-400")}>
                  {emailInput.trim() ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} E-mail
                </span>
              </div>
              {!lead.email && (
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  placeholder="E-mail do lead (opcional, aumenta a atribuição)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              )}
            </div>
          )}

          {/* ── Vendas já lançadas neste card: editar e cancelar ─────────────────────── */}
          {(vendas.length > 0 || vendasCarregando) && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                Vendas já lançadas neste card
              </div>
              {vendasCarregando && vendas.length === 0 && <p className="text-xs text-slate-400">Carregando…</p>}
              {vendas.map(v => (
                <div key={v.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800">{fmtBRL(v.value)}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {dataBR(v.converted_at)}{v.description ? ` · ${v.description}` : ""}
                        {vendasTomadas.has(v.id) ? ` · proposta #${vendasTomadas.get(v.id)}` : ""}
                      </p>
                    </div>
                    <button title="Editar esta venda" onClick={() => abrirEdicao(v)}
                      className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {podeCancelar && (
                      <button title="Cancelar esta venda" onClick={() => { setEditandoId(null); setCancelandoId(v.id); setStageDestino(stagesParaReabrir[0]?.id ?? ""); }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {editandoId === v.id && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Valor">
                          <CurrencyInput value={edValor} onChange={setEdValor} />
                        </Field>
                        <Field label="Data da venda">
                          <input type="date" className={inputCls} value={edData} onChange={e => setEdData(e.target.value)} />
                        </Field>
                      </div>
                      <Field label="Forma de pagamento">
                        <select className={inputCls} value={edMetodo} onChange={e => setEdMetodo(e.target.value)}>
                          {/* "Não informada" só existe para a venda que já está sem forma: escolher
                              uma grava, deixar como está não inventa nada. Em venda que JÁ tem
                              forma a opção não aparece, porque a RPC não apaga forma de pagamento
                              e a tela diria que apagou sem ter apagado. */}
                          {!v.payment_method && <option value="">Não informada</option>}
                          {METODOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Descrição">
                        <input className={inputCls} value={edDescricao} onChange={e => setEdDescricao(e.target.value)} placeholder="opcional" />
                      </Field>
                      <p className="text-[11px] text-slate-400">
                        A receita no Financeiro acompanha valor, data, forma e descrição. O orçamento, o estoque e a produção não mudam.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditandoId(null)}>Cancelar</Button>
                        <Button size="sm" onClick={() => salvarEdicao(v)} disabled={edSalvando}>
                          {edSalvando ? "Salvando…" : "Salvar venda"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {cancelandoId === v.id && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2">
                      <p className="text-[11px] font-semibold text-rose-600">
                        Cancelar apaga esta venda e a receita dela no Financeiro. O card sai de Ganho e volta para a etapa escolhida.
                      </p>
                      {/* ⚠️ Consequência que a tela escondia: o cancelamento tira o GANHO do card
                          inteiro, não só da venda escolhida. As outras vendas continuam lançadas
                          (o dinheiro delas segue no faturamento), mas o card deixa de ser contado
                          como venda nos painéis até voltar para Ganho. */}
                      {vendas.length > 1 && (
                        <p className="text-[11px] font-semibold text-amber-700">
                          As outras vendas deste card continuam lançadas, com o dinheiro delas no faturamento. Mas o card inteiro sai de Ganho, então ele deixa de contar como venda nos painéis até você marcá-lo como Ganho de novo.
                        </p>
                      )}
                      <Field label="Para qual etapa o card volta">
                        <select className={inputCls} value={stageDestino} onChange={e => setStageDestino(e.target.value)}>
                          {stagesParaReabrir.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </Field>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setCancelandoId(null)}>Voltar</Button>
                        <Button size="sm" onClick={() => confirmarCancelamento(v.id)} disabled={cancelando || !stageDestino}>
                          {cancelando ? "Cancelando…" : "Cancelar esta venda"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {erro && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="text-xs font-semibold text-rose-700">{erro}</p>
            </div>
          )}

          {/* DEBUG (TEMPORÁRIO, p/ aprovação Meta): payload + resposta do envio da conversão, para print.
              Remover este bloco + o estado capiResult depois da aprovação. */}
          {capiResult && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setCapiOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-black text-slate-700">
                  Detalhes do envio
                  {capiResult === "loading"
                    ? <span className="text-[10px] font-bold text-slate-400">enviando…</span>
                    : <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded",
                        capiResult?.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                        {capiResult?.ok ? `OK · ${capiResult?.kind}` : `ERRO${capiResult?.status ? " " + capiResult.status : ""}`}
                      </span>}
                </span>
                {capiOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
              {capiOpen && capiResult !== "loading" && (
                <div className="p-3 space-y-3 bg-white">
                  {capiResult?.url && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Endpoint</p>
                      <p className="text-[11px] font-mono text-slate-600 break-all">{capiResult.url}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Payload enviado</p>
                    <pre className="text-[10px] leading-relaxed font-mono text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-2 overflow-auto max-h-56">{JSON.stringify(capiResult.request ?? capiResult, null, 2)}</pre>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Resposta da Meta</p>
                    <pre className="text-[10px] leading-relaxed font-mono text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-2 overflow-auto max-h-56">{JSON.stringify(capiResult.response ?? capiResult, null, 2)}</pre>
                  </div>
                  <button type="button" onClick={onClose} className="w-full py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">Fechar</button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// Escolher QUAL venda cancelar. Aparece quando o card tem mais de uma e a RPC recusa o cancelamento
// pedindo o alvo (error_code 'multiplas_vendas'), devolvendo a lista que esta janela mostra.
export function EscolherVendaCancelarModal({ vendas, onClose, onEscolher }: {
  vendas: { conversion_id: string; valor: number; data: string; descricao: string | null }[];
  onClose: () => void;
  onEscolher: (conversionId: string) => Promise<void>;
}) {
  const [alvo, setAlvo] = useState<string | null>(vendas.length === 1 ? vendas[0].conversion_id : null);
  const [salvando, setSalvando] = useState(false);
  return (
    <div className="relative z-[90]">
      <Modal
        title="Qual venda cancelar?"
        subtitle="Este card tem mais de uma venda lançada."
        onClose={onClose}
        footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Voltar</Button>
          <Button size="sm" disabled={!alvo || salvando} onClick={async () => {
            if (!alvo) return;
            setSalvando(true);
            await onEscolher(alvo);
            setSalvando(false);
          }}>
            {salvando ? "Cancelando…" : "Cancelar esta venda"}
          </Button>
        </>}
      >
        <p className="text-xs text-slate-500 mb-3">
          Cancelar apaga a venda escolhida e a receita dela no Financeiro. As outras continuam lançadas, com o dinheiro delas no faturamento.
        </p>
        {/* ⚠️ Mesma consequência do cancelamento pela janela de venda: quem sai de Ganho é o CARD,
            não só a venda escolhida. Dizer só "as outras continuam" fazia parecer que o card seguia
            contando como venda. */}
        <p className="text-xs font-semibold text-amber-700 mb-3">
          O card inteiro sai de Ganho e volta para o funil, então ele deixa de contar como venda nos painéis até ser marcado como Ganho de novo.
        </p>
        <div className="space-y-2">
          {vendas.map(v => (
            <label key={v.conversion_id} className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer select-none",
              alvo === v.conversion_id ? "border-rose-300 bg-rose-50/60" : "border-slate-200 hover:border-slate-300"
            )}>
              <input type="radio" name="venda-a-cancelar" className="w-4 h-4 accent-rose-600 shrink-0"
                checked={alvo === v.conversion_id} onChange={() => setAlvo(v.conversion_id)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800">{fmtBRL(v.valor)}</p>
                <p className="text-[11px] text-slate-400 truncate">
                  {dataBR(v.data)}{v.descricao ? ` · ${v.descricao}` : ""}
                </p>
              </div>
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}
