import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Zap, Pencil, Plus, Trash2, Search, Loader2, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Modal, ModalHeader, ModalBody } from "./ui/modal";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";
import { useAnchoredPosition } from "../hooks/useAnchoredPosition";
import {
  useQuickReplies,
  filtrarRespostas,
  type QuickReply,
  type SalvarRespostaInput,
  type Resultado,
  QUICK_REPLY_SHORTCUT_MAX,
  QUICK_REPLY_CONTENT_MAX,
} from "../hooks/useQuickReplies";

/**
 * Respostas rápidas do chat humano, no modelo do WhatsApp: o operador digita "/" na caixa de envio,
 * escolhe uma resposta pelo atalho e o texto entra na caixa para revisar antes de mandar.
 *
 * Três peças: o seletor (popover do "/"), o editor (lista + formulário) e as duas casas do editor:
 * o modal aberto pelo lápis do seletor e a aba "Respostas Rápidas" das Configurações.
 * O dado é por clínica (`quick_replies`, hook `useQuickReplies`) e vale para as duas marcas: texto
 * neutro, sem "paciente".
 */

// ── Seletor (popover do "/") ──────────────────────────────────────────────────

interface PickerProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Ref do painel do seletor: o composer usa para saber que um clique ali não é "fora". */
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

// Mantém o foco (e o cursor) na caixa de texto ao clicar nos botões do seletor. Só nos botões, no
// cabeçalho e no rodapé, NÃO na lista inteira: preventDefault sobre a barra de rolagem impede
// arrastá-la no Firefox.
const manterFoco = (e: React.MouseEvent) => e.preventDefault();

export function QuickRepliesPicker({
  anchorRef, containerRef, open, query, items, total, loading, erro, activeIndex, onHover, onPick, onManage,
}: PickerProps) {
  // Mesmo motor dos demais popups da casa (CustomDropdown, PatientSearchSelector): `fixed` em
  // coordenadas de viewport, vira para cima quando não há espaço embaixo, nunca sai da janela e
  // acompanha a âncora (scroll, resize e, via ResizeObserver, o próprio textarea crescendo).
  const pos = useAnchoredPosition(anchorRef, open, { maxHeight: 340, gap: 6 });
  const listRef = useRef<HTMLDivElement>(null);

  // Navegação por teclado: o item ativo acompanha a rolagem da lista.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  if (!open || !pos || typeof document === "undefined") return null;

  // Portal: a caixa de envio mora em Cards com overflow-hidden e em modais animados (transform), e
  // `fixed` dentro de ancestral com transform vira relativo a ele.
  return createPortal(
    // Faixa transparente do tamanho reservado (maxH): com o seletor virado para cima o painel se
    // alinha pela BASE dela, colado na caixa, em vez de flutuar com um vão quando a lista é curta.
    <div
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, height: pos.maxH }}
      className={cn("z-[150] flex flex-col pointer-events-none", pos.above ? "justify-end" : "justify-start")}
    >
      <div
        ref={containerRef}
        role="listbox"
        aria-label="Respostas rápidas"
        className="pointer-events-auto max-h-full min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
      >
        <div onMouseDown={manterFoco} className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-slate-100 shrink-0">
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

        {erro && (
          // Erro de recarga aparece JUNTO da lista anterior (se houver), nunca no lugar dela: o teclado
          // do composer navega por esta mesma lista, e escondê-la faria Enter escolher às cegas.
          <p onMouseDown={manterFoco} className="flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-semibold text-rose-600 bg-rose-50 border-b border-rose-100 shrink-0">
            <AlertTriangle className="w-3 h-3 shrink-0" /> {erro}
          </p>
        )}

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1">
          {loading && total === 0 && !erro ? (
            <div onMouseDown={manterFoco} className="flex items-center gap-2 px-3.5 py-3 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…
            </div>
          ) : total === 0 ? (
            !erro && (
              <div onMouseDown={manterFoco} className="px-3.5 py-4 text-center">
                <p className="text-xs font-semibold text-slate-600">Nenhuma resposta rápida cadastrada.</p>
                <button type="button" onClick={onManage} className="mt-2 text-xs font-bold text-teal-700 hover:underline">
                  Criar a primeira
                </button>
              </div>
            )
          ) : items.length === 0 ? (
            <p onMouseDown={manterFoco} className="px-3.5 py-3 text-xs text-slate-500">
              Nenhuma resposta para <span className="font-mono font-semibold text-slate-700">/{query}</span>.
            </p>
          ) : items.map((r, i) => (
            <button
              key={r.id}
              type="button"
              data-idx={i}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={manterFoco}
              // onMouseMove, não onMouseEnter: ao navegar por setas a lista rola sob o ponteiro parado e
              // o navegador reemite "enter", roubando o destaque do teclado. Só avisa quando muda.
              onMouseMove={() => { if (i !== activeIndex) onHover(i); }}
              onClick={() => onPick(r)}
              className={cn(
                "w-full text-left px-3.5 py-2 transition-colors",
                i === activeIndex ? "bg-teal-50" : "hover:bg-slate-50",
              )}
            >
              <p className="text-sm font-bold text-slate-800 truncate">/{r.shortcut}</p>
              <p className="text-xs text-slate-500 whitespace-pre-wrap break-words line-clamp-2">{r.content}</p>
            </button>
          ))}
        </div>

        <div onMouseDown={manterFoco} className="px-3.5 py-1.5 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
          ↑↓ navegar · Enter escolher · Esc fechar
        </div>
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
  onSave: (input: SalvarRespostaInput) => Promise<Resultado>;
  onRemove: (id: string) => Promise<Resultado>;
  /** Abre já no formulário de nova resposta se a lista estiver carregada e vazia (vindo do seletor). */
  comecarCriando?: boolean;
}

type Form = { id?: string; shortcut: string; content: string };

export function QuickRepliesEditor({ items, loading, erro, onSave, onRemove, comecarCriando }: EditorProps) {
  const showToast = useToast();
  // Só abre direto em "Nova" com a lista CARREGADA e vazia: com a carga em voo, abrir o formulário
  // em cima de uma lista que ainda vai aparecer induz a criar duplicata.
  const [form, setForm] = useState<Form | null>(() =>
    comecarCriando && items.length === 0 && !loading && !erro ? { shortcut: "", content: "" } : null,
  );
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  // Exclusão em dois passos num estado só: qual linha pede confirmação e se o delete já está em voo.
  const [excluindo, setExcluindo] = useState<{ id: string; emVoo: boolean } | null>(null);

  const visiveis = useMemo(() => filtrarRespostas(items, busca), [items, busca]);
  // O campo de busca fica enquanto houver o que buscar OU enquanto houver filtro digitado: sumir com
  // filtro ativo deixaria a lista "vazia" sem jeito de limpar.
  const mostrarBusca = items.length > 5 || busca !== "";

  const abrirNovo = () => { setForm({ shortcut: "", content: "" }); setErroForm(null); };
  const abrirEdicao = (r: QuickReply) => {
    setForm({ id: r.id, shortcut: r.shortcut, content: r.content });
    setErroForm(null);
    setExcluindo(null);
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
    setExcluindo({ id, emVoo: true });
    const res = await onRemove(id);
    setExcluindo(null);
    if (res.ok) {
      showToast("Resposta rápida excluída.", "success");
      // Forma funcional: o `form` do momento do clique pode já ser outro (abriu a edição de Y
      // enquanto X era excluída).
      setForm(f => (f?.id === id ? null : f));
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
        {mostrarBusca && (
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
        // `key` remonta o formulário ao trocar de item (editar→editar) e o autoFocus do atalho vale de novo.
        <div key={form.id ?? "novo"} className="rounded-2xl border border-teal-200 bg-teal-50/40 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-800">{form.id ? "Editar resposta rápida" : "Nova resposta rápida"}</p>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Atalho</label>
            <div className="flex items-center bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-teal-200 focus-within:border-teal-400 overflow-hidden">
              <span className="pl-3 pr-1 text-slate-400 font-mono text-sm select-none">/</span>
              <input
                autoFocus
                value={form.shortcut}
                maxLength={QUICK_REPLY_SHORTCUT_MAX}
                disabled={salvando}
                // Espaço não entra: o atalho acaba onde o operador bate espaço na caixa do chat.
                onChange={e => setForm({ ...form, shortcut: e.target.value.replace(/\s+/g, "") })}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (podeSalvar) salvar(); } }}
                placeholder="obrigado"
                className="flex-1 py-2 pr-3 text-sm bg-transparent focus:outline-none disabled:opacity-60"
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
              // Travado enquanto salva: o que fosse digitado durante o await ficaria de fora do que foi
              // gravado e sumiria quando o formulário fechasse.
              disabled={salvando}
              onChange={e => setForm({ ...form, content: e.target.value })}
              placeholder="Agradecemos o contato! Qualquer dúvida, é só chamar."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl resize-y focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 disabled:opacity-60"
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
                <p className="text-xs text-slate-500 whitespace-pre-wrap break-words mt-0.5 line-clamp-3">{r.content}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {excluindo?.id === r.id ? (
                  <>
                    <span className="text-[11px] font-semibold text-rose-600 mr-1">Excluir?</span>
                    <button
                      type="button"
                      onClick={() => excluir(r.id)}
                      disabled={excluindo.emVoo}
                      className="px-2 py-1 rounded-lg text-[11px] font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      {excluindo.emVoo ? "…" : "Sim"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExcluindo(null)}
                      disabled={excluindo.emVoo}
                      className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                    >
                      Não
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => abrirEdicao(r)} title="Editar" className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setExcluindo({ id: r.id, emVoo: false })} title="Excluir" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
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
  // Recarrega ao abrir a aba: a lista do store pode ter sido carregada há muito tempo pelo composer,
  // e aqui é onde se edita, então vale a ida ao banco.
  const { refresh } = qr;
  useEffect(() => { refresh(); }, [refresh]);
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
