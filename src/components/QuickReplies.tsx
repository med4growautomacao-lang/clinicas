import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Zap, Pencil, Plus, Trash2, Search, Loader2, Check } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Modal, ModalHeader, ModalBody } from "./ui/modal";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";
import {
  useQuickReplies,
  type QuickReply,
  type SalvarRespostaInput,
  QUICK_REPLY_SHORTCUT_MAX,
  QUICK_REPLY_CONTENT_MAX,
} from "../hooks/useQuickReplies";

/**
 * Respostas rápidas do chat humano, no modelo do WhatsApp: o operador digita "/" na caixa de envio,
 * escolhe uma resposta pelo atalho e o texto entra na caixa para revisar antes de mandar.
 *
 * Três peças: o seletor (popover do "/"), o editor (lista + formulário) e as duas casas do editor:
 * o modal aberto pelo lápis do seletor e a aba "Respostas Rápidas" das Configurações.
 * O dado é por clínica (`quick_replies`) e vale para as duas marcas: texto neutro, sem "paciente".
 */

// ── Filtro ─────────────────────────────────────────────────────────────────────

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Filtra e ordena pelo que foi digitado depois da barra: atalho que COMEÇA com a busca vem primeiro,
 * depois atalho que contém, depois texto que contém. Sem acento e sem caixa, dos dois lados.
 */
export function filtrarRespostas(items: QuickReply[], query: string): QuickReply[] {
  const q = semAcento(query.trim());
  if (!q) return items;
  const peso = (r: QuickReply) => {
    const atalho = semAcento(r.shortcut);
    if (atalho.startsWith(q)) return 0;
    if (atalho.includes(q)) return 1;
    if (semAcento(r.content).includes(q)) return 2;
    return -1;
  };
  return items
    .map(r => ({ r, p: peso(r) }))
    .filter(x => x.p >= 0)
    .sort((a, b) => a.p - b.p || a.r.shortcut.localeCompare(b.r.shortcut, "pt-BR"))
    .map(x => x.r);
}

// Prévia de texto cortada em N linhas (inline: não depende de utilitário do Tailwind).
const clamp = (linhas: number): React.CSSProperties => ({
  display: "-webkit-box",
  WebkitLineClamp: linhas,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});

// ── Seletor (popover do "/") ──────────────────────────────────────────────────

interface Posicao { left: number; width: number; bottom: number; maxH: number }

/**
 * Posição do seletor, em coordenadas de viewport, ACIMA da âncora e preso pela base: assim ele cresce
 * para cima conforme a lista, sempre colado na caixa de texto. O `useAnchoredPosition` da casa prende
 * pelo topo (é para menus que abrem para baixo); virado para cima, uma lista curta ficaria flutuando
 * com um vão até a caixa. `fixed` + portal: o Card das Conversas tem overflow-hidden e a caixa mora
 * dentro de modais animados, então `absolute` seria cortado.
 */
function usePosicaoAcima(anchorRef: React.RefObject<HTMLElement | null>, open: boolean, deps: unknown[]) {
  const [pos, setPos] = useState<Posicao | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      const width = Math.max(r.width, Math.min(320, window.innerWidth - 16));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({
        left,
        width,
        bottom: window.innerHeight - r.top + gap,
        maxH: Math.min(340, Math.max(120, r.top - gap - 12)),
      });
    };
    place();
    // Agrupa a rajada de scroll/resize num recálculo por frame (getBoundingClientRect força reflow).
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; place(); });
    };
    // capture=true enxerga o scroll de containers internos, que não borbulha.
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchorRef, ...deps]);
  return open ? pos : null;
}

interface PickerProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Ref do contêiner do seletor: o composer usa para saber que um clique ali não é "fora". */
  containerRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  /** O que foi digitado depois da barra. */
  query: string;
  /** Já filtradas e ordenadas (quem filtra é o composer, que também cuida do teclado). */
  items: QuickReply[];
  /** Total cadastrado, para distinguir "nada cadastrado" de "nada bate com a busca". */
  total: number;
  loading: boolean;
  erro: string | null;
  activeIndex: number;
  onHover: (i: number) => void;
  onPick: (item: QuickReply) => void;
  onManage: () => void;
}

export function QuickRepliesPicker({
  anchorRef, containerRef, open, query, items, total, loading, erro, activeIndex, onHover, onPick, onManage,
}: PickerProps) {
  // `query` entra nas deps: consulta longa quebra linha no textarea e a âncora sobe.
  const pos = usePosicaoAcima(anchorRef, open, [items.length, total, loading, !!erro, query]);
  const listRef = useRef<HTMLDivElement>(null);

  // Navegação por teclado: o item ativo acompanha a rolagem da lista.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Respostas rápidas"
      // preventDefault no mousedown: o foco (e o cursor) continuam na caixa de texto ao clicar aqui.
      onMouseDown={e => e.preventDefault()}
      style={{ position: "fixed", left: pos.left, width: pos.width, bottom: pos.bottom, maxHeight: pos.maxH }}
      className="z-[150] flex flex-col bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-slate-100 shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-teal-600" /> Respostas rápidas
        </span>
        <button
          type="button"
          onClick={onManage}
          title="Gerenciar respostas rápidas"
          className="p-1 rounded-lg text-slate-400 hover:text-teal-700 hover:bg-teal-50 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1">
        {loading && total === 0 ? (
          <div className="flex items-center gap-2 px-3.5 py-3 text-xs text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…
          </div>
        ) : erro ? (
          <p className="px-3.5 py-3 text-xs font-semibold text-rose-600">{erro}</p>
        ) : total === 0 ? (
          <div className="px-3.5 py-4 text-center">
            <p className="text-xs font-semibold text-slate-600">Nenhuma resposta rápida cadastrada.</p>
            <button type="button" onClick={onManage} className="mt-2 text-xs font-bold text-teal-700 hover:underline">
              Criar a primeira
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-3.5 py-3 text-xs text-slate-500">
            Nenhuma resposta para <span className="font-mono font-semibold text-slate-700">/{query}</span>.
          </p>
        ) : items.map((r, i) => (
          <button
            key={r.id}
            type="button"
            data-idx={i}
            role="option"
            aria-selected={i === activeIndex}
            // onMouseMove, não onMouseEnter: ao navegar por setas a lista rola sob o ponteiro parado
            // e o navegador reemite "enter", roubando o destaque do teclado.
            onMouseMove={() => onHover(i)}
            onClick={() => onPick(r)}
            className={cn(
              "w-full text-left px-3.5 py-2 transition-colors",
              i === activeIndex ? "bg-teal-50" : "hover:bg-slate-50",
            )}
          >
            <p className="text-sm font-bold text-slate-800 truncate">/{r.shortcut}</p>
            <p className="text-xs text-slate-500 whitespace-pre-wrap break-words" style={clamp(2)}>{r.content}</p>
          </button>
        ))}
      </div>

      <div className="px-3.5 py-1.5 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
        ↑↓ navegar · Enter escolher · Esc fechar
      </div>
    </div>,
    document.body,
  );
}

// ── Editor (lista + formulário) ────────────────────────────────────────────────

interface EditorProps {
  items: QuickReply[];
  loading: boolean;
  erro: string | null;
  onSave: (input: SalvarRespostaInput) => Promise<{ ok: boolean; error?: string }>;
  onRemove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Abre já no formulário de nova resposta (lista vazia vinda do seletor). */
  comecarCriando?: boolean;
}

type Form = { id?: string; shortcut: string; content: string };

export function QuickRepliesEditor({ items, loading, erro, onSave, onRemove, comecarCriando }: EditorProps) {
  const showToast = useToast();
  const [form, setForm] = useState<Form | null>(comecarCriando ? { shortcut: "", content: "" } : null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const atalhoRef = useRef<HTMLInputElement>(null);

  const visiveis = useMemo(() => filtrarRespostas(items, busca), [items, busca]);

  const focarAtalho = () => setTimeout(() => atalhoRef.current?.focus(), 0);
  const abrirNovo = () => { setForm({ shortcut: "", content: "" }); setErroForm(null); focarAtalho(); };
  const abrirEdicao = (r: QuickReply) => {
    setForm({ id: r.id, shortcut: r.shortcut, content: r.content });
    setErroForm(null);
    setConfirmandoId(null);
    focarAtalho();
  };
  const fechar = () => { setForm(null); setErroForm(null); };

  const salvar = async () => {
    if (!form || salvando) return;
    setSalvando(true);
    setErroForm(null);
    const res = await onSave(form);
    setSalvando(false);
    if (res.ok) {
      showToast(form.id ? "Resposta rápida atualizada." : "Resposta rápida criada.", "success");
      setForm(null);
    } else {
      setErroForm(res.error ?? "Não foi possível salvar.");
    }
  };

  const excluir = async (id: string) => {
    setExcluindoId(id);
    const res = await onRemove(id);
    setExcluindoId(null);
    setConfirmandoId(null);
    if (res.ok) {
      showToast("Resposta rápida excluída.", "success");
      if (form?.id === id) fechar();
    } else {
      showToast(res.error ?? "Não foi possível excluir.", "error");
    }
  };

  const podeSalvar = !!form && !!form.shortcut.trim() && !!form.content.trim() && !salvando;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 leading-relaxed">
        Na caixa de mensagem do chat, digite <span className="font-mono font-bold text-slate-700">/</span> e escolha
        a resposta pelo atalho. O texto entra na caixa para você revisar antes de enviar. Pode usar{" "}
        <span className="font-semibold">*negrito*</span> e <span className="italic">_itálico_</span> do WhatsApp.
      </p>

      <div className="flex items-center gap-2">
        {items.length > 5 && (
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por atalho ou texto…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
            />
          </div>
        )}
        {!form && (
          <Button onClick={abrirNovo} size="sm" className="gap-1.5 ml-auto">
            <Plus className="w-4 h-4" /> Nova resposta
          </Button>
        )}
      </div>

      {form && (
        <div className="rounded-2xl border border-teal-200 bg-teal-50/40 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-800">{form.id ? "Editar resposta rápida" : "Nova resposta rápida"}</p>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Atalho</label>
            <div className="flex items-center bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-teal-200 focus-within:border-teal-400 overflow-hidden">
              <span className="pl-3 pr-1 text-slate-400 font-mono text-sm select-none">/</span>
              <input
                ref={atalhoRef}
                value={form.shortcut}
                maxLength={QUICK_REPLY_SHORTCUT_MAX}
                // Espaço não entra: o atalho acaba onde o operador bate espaço na caixa do chat.
                onChange={e => setForm({ ...form, shortcut: e.target.value.replace(/\s+/g, "") })}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (podeSalvar) salvar(); } }}
                placeholder="obrigado"
                className="flex-1 py-2 pr-3 text-sm bg-transparent focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Uma palavra só, sem espaços. É o que você digita depois da barra.</p>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Texto da resposta</label>
            <textarea
              value={form.content}
              maxLength={QUICK_REPLY_CONTENT_MAX}
              rows={4}
              onChange={e => setForm({ ...form, content: e.target.value })}
              placeholder="Agradecemos o contato! Qualquer dúvida, é só chamar."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl resize-y focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
            />
            <p className="text-[11px] text-slate-400 mt-1 text-right tabular-nums">
              {form.content.length.toLocaleString("pt-BR")}/{QUICK_REPLY_CONTENT_MAX.toLocaleString("pt-BR")}
            </p>
          </div>
          {erroForm && <p className="text-xs font-semibold text-rose-600">{erroForm}</p>}
          <div className="flex items-center gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={fechar} disabled={salvando}>Cancelar</Button>
            <Button size="sm" onClick={salvar} disabled={!podeSalvar} className="gap-1.5">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
            </Button>
          </div>
        </div>
      )}

      {erro && <p className="text-xs font-semibold text-rose-600">{erro}</p>}

      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 py-6 justify-center text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : items.length === 0 ? (
        !form && !erro && (
          <div className="text-center py-10 text-slate-400">
            <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhuma resposta rápida</p>
            <p className="text-sm">Crie a primeira: ela fica disponível no chat digitando /</p>
          </div>
        )
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">Nenhuma resposta para "{busca}".</p>
      ) : (
        <div className="space-y-2">
          {visiveis.map(r => (
            <div
              key={r.id}
              className={cn(
                "flex items-start justify-between gap-3 p-3 rounded-xl border bg-white transition-all",
                form?.id === r.id ? "border-teal-300" : "border-slate-100 hover:border-slate-200",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 truncate">/{r.shortcut}</p>
                <p className="text-xs text-slate-500 whitespace-pre-wrap break-words mt-0.5" style={clamp(3)}>{r.content}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {confirmandoId === r.id ? (
                  <>
                    <span className="text-[11px] font-semibold text-rose-600 mr-1">Excluir?</span>
                    <button
                      type="button"
                      onClick={() => excluir(r.id)}
                      disabled={excluindoId === r.id}
                      className="px-2 py-1 rounded-lg text-[11px] font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      {excluindoId === r.id ? "…" : "Sim"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmandoId(null)}
                      className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-100"
                    >
                      Não
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => abrirEdicao(r)} title="Editar" className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setConfirmandoId(r.id)} title="Excluir" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modal (aberto pelo lápis do seletor, dentro do chat) ──────────────────────

interface ManagerModalProps extends EditorProps {
  open: boolean;
  onClose: () => void;
  /** Acima de qualquer modal que hospede a caixa de envio (Kanban/orçamento ficam em z-[100]). */
  zIndexClass?: string;
}

export function QuickRepliesManagerModal({ open, onClose, zIndexClass = "z-[160]", ...editor }: ManagerModalProps) {
  if (typeof document === "undefined") return null;
  // Portal: a caixa de envio mora dentro de Cards com overflow-hidden e de modais animados.
  return createPortal(
    <Modal open={open} onClose={onClose} size="2xl" zIndexClass={zIndexClass}>
      <ModalHeader
        title="Respostas rápidas"
        subtitle="Textos prontos para o chat: digite / na caixa de mensagem para usar."
        onClose={onClose}
        icon={(
          <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-teal-600" />
          </div>
        )}
      />
      <ModalBody>
        <QuickRepliesEditor {...editor} />
      </ModalBody>
    </Modal>,
    document.body,
  );
}

// ── Aba das Configurações ─────────────────────────────────────────────────────

export function QuickRepliesSettingsCard() {
  const qr = useQuickReplies(true);
  return (
    <Card className="border border-slate-200 shadow-sm max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Zap className="w-5 h-5 text-teal-600" />
          Respostas Rápidas
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Textos prontos da equipe para o chat, no modelo do WhatsApp. Valem para todos que atendem nesta clínica.
        </p>
      </CardHeader>
      <CardContent>
        <QuickRepliesEditor items={qr.items} loading={qr.loading} erro={qr.erro} onSave={qr.save} onRemove={qr.remove} />
      </CardContent>
    </Card>
  );
}
