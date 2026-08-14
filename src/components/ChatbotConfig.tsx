import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { cn } from '@/src/lib/utils';
import { useToast } from './ui/toast';
import { logSystemError } from '../hooks/useSupabase';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Loader2, Save, Rocket, Play, RotateCcw,
  AlertTriangle, MessageSquare, List as ListIcon, Type, Image as ImageIcon, Check,
} from 'lucide-react';

// Configurações Chatbot: o "Roteiro de Atendimento" da clínica.
//
// ⚠️ SEM CANVAS, DE PROPÓSITO. O roteiro é uma LISTA ORDENADA de perguntas, e o condicional é
// marcado DENTRO da opção do passo anterior ("quem escolher Alambrado também responde Malha e
// Fio"). Como a marcação nasce sempre no passo PAI, é impossível apontar para frente, e isso
// substitui de graça a detecção de ciclo, nó órfão e passo inalcançável que um editor de nós e
// setas obriga a escrever. A palavra "condição" não aparece em lugar nenhum da tela.
//
// ⚠️ A PRÉVIA CHAMA O MOTOR DE VERDADE (fn_chatbot_render / fn_chatbot_passo_atual, por RPC).
// Uma implementação só, então a prévia não pode divergir do que o contato recebe. Não desenhe
// aqui uma maquete "parecida": ela envelheceria calada.

type Opcao = {
  id: string;
  rotulo: string;
  descricao?: string;
  sinonimos?: string[];
  desbloqueia?: string[];
};

type Passo = {
  slug: string;              // ⚠️ IMUTÁVEL: é a chave da resposta. O que se edita é o rotulo_ficha.
  rotulo_ficha?: string;
  tipo: 'opcoes' | 'texto';
  pergunta: string;
  midia_url?: string;
  botao_lista?: string;
  opcoes?: Opcao[];
};

type Definicao = { passos: Passo[]; fim?: { mensagem?: string }; humano?: { mensagem?: string } };

type Script = {
  id: string;
  clinic_id: string;
  nome: string;
  ativo: boolean;
  versao_publicada: number | null;
  definicao_rascunho: Definicao;
  etapa_destino_id: string | null;
  test_numbers: string[];
  modo_envio: 'menu' | 'texto';
  max_tentativas: number;
};

type Stage = { id: string; name: string; slug: string; position: number };

// Etapas que fecham o atendimento: escolher uma delas como destino faria a trigger de consistência
// gravar venda ou perda sozinha. O banco recusa na publicação; aqui elas nem aparecem na lista.
const ETAPAS_PROIBIDAS = ['ganho', 'perdido', 'entregue', 'faltou_cancelou', 'agendado'];

const norm = (s: string) =>
  (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const DEF_VAZIA: Definicao = { passos: [], fim: {}, humano: {} };

/** Mesma compilação do banco (fn_chatbot_publicar): o `desbloqueia` da opção do PAI vira `so_se`
 *  no passo filho. Existe aqui só para a prévia e o simulador enxergarem o rascunho como o motor
 *  enxergaria depois de publicado. */
function compilar(def: Definicao) {
  const passos = def.passos.map((p, i) => {
    const conds = def.passos.slice(0, i).flatMap((pai) => {
      const valores = (pai.opcoes || []).filter((o) => (o.desbloqueia || []).includes(p.slug)).map((o) => o.id);
      return valores.length ? [{ passo: pai.slug, valores }] : [];
    });
    return conds.length ? { ...p, so_se: conds } : { ...p };
  });
  return { ...def, passos };
}

/** A frase que o cartão fechado mostra: a consequência já calculada, em português. */
function resumoDoPasso(def: Definicao, p: Passo, i: number): string {
  const donos = def.passos.slice(0, i).flatMap((pai) =>
    (pai.opcoes || []).filter((o) => (o.desbloqueia || []).includes(p.slug)).map((o) => o.rotulo));
  const quem = donos.length ? `só para quem escolheu ${donos.join(' ou ')}` : 'feita para todos';
  const como = p.tipo === 'texto'
    ? 'o contato escreve'
    : `${(p.opcoes || []).length} opções, ${(p.opcoes || []).length <= 3 ? 'botões' : 'lista'}`;
  return `${como}, ${quem}`;
}

export function ChatbotConfig({ clinicId }: { clinicId: string }) {
  const showToast = useToast();
  const [script, setScript] = useState<Script | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [previewModo, setPreviewModo] = useState<'menu' | 'texto'>('menu');
  const [preview, setPreview] = useState<any>(null);
  const [erros, setErros] = useState<string[]>([]);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [simResp, setSimResp] = useState<Record<string, any> | null>(null);

  const def: Definicao = script?.definicao_rascunho || DEF_VAZIA;

  const carregar = useCallback(async () => {
    setLoading(true);
    const [sRes, stRes] = await Promise.all([
      supabase.from('chatbot_scripts').select('*').eq('clinic_id', clinicId).maybeSingle(),
      supabase.from('funnel_stages').select('id,name,slug,position').eq('clinic_id', clinicId).order('position'),
    ]);
    setStages((stRes.data || []) as Stage[]);
    setErroCarga(null);
    if (sRes.data) {
      const s = sRes.data as any;
      setScript({ ...s, definicao_rascunho: s.definicao_rascunho || DEF_VAZIA });
    } else {
      // Primeira vez nesta clínica: cria o rascunho vazio e DESLIGADO.
      const { data, error } = await supabase.from('chatbot_scripts')
        .insert({ clinic_id: clinicId, nome: 'Roteiro de Atendimento', definicao_rascunho: DEF_VAZIA })
        .select('*').maybeSingle();
      if (data) {
        setScript({ ...(data as any), definicao_rascunho: DEF_VAZIA });
      } else {
        // ⚠️ Falhar em VOZ ALTA. Antes daqui a tela ficava girando para sempre e nada acendia em
        // lugar nenhum: foi assim que a falta de GRANT para `authenticated` passou por "está
        // carregando". Se o select não trouxe e o insert também não, alguma coisa está errada e o
        // dono precisa ver, não adivinhar.
        const msg = error?.message || sRes.error?.message || 'sem detalhe do banco';
        setErroCarga(msg);
        logSystemError('chatbot_config_nao_abriu',
          'A tela de Configurações Chatbot não conseguiu carregar nem criar o roteiro da clínica',
          clinicId, { erro_insert: error?.message ?? null, erro_select: sRes.error?.message ?? null }, 'error');
      }
    }
    setDirty(false);
    setLoading(false);
  }, [clinicId]);

  useEffect(() => { carregar(); }, [carregar]);

  const patch = (p: Partial<Script>) => { setScript((s) => (s ? { ...s, ...p } : s)); setDirty(true); };
  const setDef = (d: Definicao) => patch({ definicao_rascunho: d });

  const setPasso = (i: number, p: Partial<Passo>) =>
    setDef({ ...def, passos: def.passos.map((x, k) => (k === i ? { ...x, ...p } : x)) });

  const addPasso = () => {
    const n = def.passos.length + 1;
    const slug = `passo_${Date.now().toString(36)}`;   // ⚠️ nunca muda depois de criado
    setDef({ ...def, passos: [...def.passos, { slug, rotulo_ficha: `Pergunta ${n}`, tipo: 'opcoes', pergunta: '', opcoes: [] }] });
    setAberto(slug);
  };

  const moverPasso = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= def.passos.length) return;
    const arr = [...def.passos];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setDef({ ...def, passos: arr });
  };

  const removerPasso = (i: number) => {
    const alvo = def.passos[i].slug;
    // Tira também a marcação nas opções que liberavam este passo, senão a publicação recusaria.
    const passos = def.passos.filter((_, k) => k !== i).map((p) => ({
      ...p,
      opcoes: (p.opcoes || []).map((o) => ({ ...o, desbloqueia: (o.desbloqueia || []).filter((s) => s !== alvo) })),
    }));
    setDef({ ...def, passos });
  };

  const addOpcao = (i: number) => {
    const p = def.passos[i];
    setPasso(i, { opcoes: [...(p.opcoes || []), { id: `op-${Date.now().toString(36)}`, rotulo: '' }] });
  };

  const setOpcao = (i: number, k: number, o: Partial<Opcao>) => {
    const p = def.passos[i];
    setPasso(i, { opcoes: (p.opcoes || []).map((x, n) => (n === k ? { ...x, ...o } : x)) });
  };

  const removerOpcao = (i: number, k: number) => {
    const p = def.passos[i];
    setPasso(i, { opcoes: (p.opcoes || []).filter((_, n) => n !== k) });
  };

  // ── Prévia: chama o motor de verdade ──────────────────────────────────────────────────────────
  const passoAberto = useMemo(() => def.passos.find((p) => p.slug === aberto) || def.passos[0], [def, aberto]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!passoAberto) { setPreview(null); return; }
      const { data } = await supabase.rpc('fn_chatbot_render', { p_passo: passoAberto, p_modo: previewModo });
      if (vivo) setPreview(data);
    })();
    return () => { vivo = false; };
  }, [passoAberto, previewModo]);

  // ── Simulador: percorre o roteiro clicando, como o contato ────────────────────────────────────
  const [simPasso, setSimPasso] = useState<any>(null);
  const simular = async (respostas: Record<string, any> | null) => {
    const { data } = await supabase.rpc('fn_chatbot_passo_atual', {
      p_definicao: compilar(def), p_respostas: respostas || {},
    });
    setSimResp(respostas || {});
    setSimPasso(data);
  };
  const simResponder = (op: Opcao | null, texto?: string) => {
    if (!simPasso) return;
    const r = { ...(simResp || {}), [simPasso.slug]: { valor: op ? op.id : (texto || 'resposta'), rotulo: op ? op.rotulo : (texto || 'resposta') } };
    simular(r);
  };

  const salvar = async () => {
    if (!script) return;
    setSaving(true);
    const { error } = await supabase.from('chatbot_scripts').update({
      nome: script.nome, ativo: script.ativo, modo_envio: script.modo_envio,
      etapa_destino_id: script.etapa_destino_id, test_numbers: script.test_numbers,
      definicao_rascunho: script.definicao_rascunho, updated_at: new Date().toISOString(),
    }).eq('id', script.id);
    setSaving(false);
    if (error) { showToast('Não consegui salvar o roteiro.', 'error'); return; }
    setDirty(false);
    showToast('Rascunho salvo.', 'success');
  };

  const publicar = async () => {
    if (!script) return;
    setPublishing(true);
    if (dirty) await salvar();
    const { data, error } = await supabase.rpc('fn_chatbot_publicar', { p_script_id: script.id });
    setPublishing(false);
    if (error) { showToast('Não consegui publicar.', 'error'); return; }
    if (!data?.ok) { setErros(data?.erros || []); return; }
    setErros([]);
    showToast(`Roteiro publicado (versão ${data.versao}).`, 'success');
    carregar();
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
  }

  if (!script) {
    return (
      <div className="max-w-lg mx-auto mt-10 bg-red-50 border border-red-200 rounded-xl p-5 space-y-2">
        <p className="text-sm font-bold text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Não consegui abrir o roteiro desta clínica
        </p>
        <p className="text-xs text-red-600 leading-relaxed">
          O erro já foi registrado na Central de Erros. Detalhe do banco: {erroCarga || 'sem detalhe'}
        </p>
        <button onClick={carregar} className="text-xs font-bold text-red-700 underline">Tentar de novo</button>
      </div>
    );
  }

  const somenteTeste = (script.test_numbers || []).length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 h-full min-h-0">
      {/* ── Coluna da esquerda: o roteiro ────────────────────────────────────────────────────── */}
      <div className="space-y-4 overflow-y-auto custom-scrollbar pr-1 min-h-0">

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <button
                onClick={() => patch({ ativo: !script.ativo })}
                className={cn('w-12 h-6 rounded-full relative transition-all', script.ativo ? (somenteTeste ? 'bg-amber-500' : 'bg-teal-600') : 'bg-slate-300')}
                title={script.ativo ? 'Roteiro ligado' : 'Roteiro desligado'}
              >
                <div className={cn('w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm', script.ativo ? 'left-7' : 'left-1')} />
              </button>
              <div>
                <p className="text-sm font-bold text-slate-800">{script.ativo ? 'Roteiro ligado' : 'Roteiro desligado'}</p>
                <p className="text-[11px] text-slate-500">
                  {script.versao_publicada ? `Versão publicada: ${script.versao_publicada}` : 'Nunca publicado'}
                </p>
              </div>
            </div>
            {script.ativo && (
              <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full border',
                somenteTeste ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200')}>
                {somenteTeste ? 'Só para os números de teste' : 'Atendendo TODOS os contatos'}
              </span>
            )}
          </div>

          {/* ⚠️ Enquanto houver número aqui, o roteiro atende SÓ estes contatos e todos os outros
              continuam com o atendimento normal da clínica. Lista vazia = vale para todo mundo. */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Testar só nestes números</label>
            <input
              value={(script.test_numbers || []).join(', ')}
              onChange={(e) => patch({ test_numbers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="5535999999999, 5535988888888 (vazio = vale para todos)"
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Quando terminar, o card vai para</label>
              <select
                value={script.etapa_destino_id || ''}
                onChange={(e) => patch({ etapa_destino_id: e.target.value || null })}
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-teal-100"
              >
                <option value="">Escolha a etapa...</option>
                {stages.filter((s) => !ETAPAS_PROIBIDAS.includes(s.slug)).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Como as opções são enviadas</label>
              <select
                value={script.modo_envio}
                onChange={(e) => patch({ modo_envio: e.target.value as any })}
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-teal-100"
              >
                <option value="menu">Botões e listas do WhatsApp</option>
                <option value="texto">Texto numerado (plano B)</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── Os cartões ─────────────────────────────────────────────────────────────────────── */}
        {def.passos.map((p, i) => {
          const isOpen = aberto === p.slug;
          const posteriores = def.passos.slice(i + 1);
          return (
            <div key={p.slug} className={cn('bg-white border rounded-xl transition-all', isOpen ? 'border-teal-300 shadow-sm' : 'border-slate-200')}>
              <div className="flex items-center gap-2 p-3">
                <button onClick={() => setAberto(isOpen ? null : p.slug)} className="flex-1 text-left min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">
                    {i + 1}. {p.rotulo_ficha || 'Sem nome'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{resumoDoPasso(def, p, i)}</p>
                </button>
                <button onClick={() => moverPasso(i, -1)} disabled={i === 0} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                <button onClick={() => moverPasso(i, 1)} disabled={i === def.passos.length - 1} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                <button onClick={() => removerPasso(i)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>

              {isOpen && (
                <div className="border-t border-slate-100 p-4 space-y-4">
                  <div>
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">O que perguntar</label>
                    <textarea
                      rows={5} value={p.pergunta}
                      onChange={(e) => setPasso(i, { pergunta: e.target.value })}
                      className="w-full mt-1 p-3 border border-slate-200 rounded-lg text-sm leading-relaxed outline-none focus:ring-2 focus:ring-teal-100 resize-none"
                      placeholder="O texto exato que sai no WhatsApp."
                    />
                    <p className="text-[10px] text-slate-400 mt-1">{p.pergunta.length} caracteres</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Guardar na ficha como</label>
                      <input
                        value={p.rotulo_ficha || ''} onChange={(e) => setPasso(i, { rotulo_ficha: e.target.value })}
                        className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100"
                        placeholder="Ex.: Altura"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">É o nome que o vendedor lê no card.</p>
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Foto (link)</label>
                      <input
                        value={p.midia_url || ''} onChange={(e) => setPasso(i, { midia_url: e.target.value })}
                        className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100"
                        placeholder="https://..."
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Como o contato responde</label>
                    <div className="flex gap-2 mt-1">
                      {([['opcoes', 'Escolhe uma opção', MessageSquare], ['texto', 'Ele escreve', Type]] as const).map(([v, label, Icon]) => (
                        <button key={v} onClick={() => setPasso(i, { tipo: v as any })}
                          className={cn('flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition-all',
                            p.tipo === v ? 'bg-teal-50 border-teal-300 text-teal-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}>
                          <Icon className="w-3.5 h-3.5" /> {label}
                        </button>
                      ))}
                    </div>
                    {p.tipo === 'opcoes' && (
                      <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
                        {(p.opcoes || []).length <= 3
                          ? <><MessageSquare className="w-3 h-3" /> Até 3 opções o WhatsApp mostra como botões, e a foto entra junto.</>
                          : <><ListIcon className="w-3 h-3" /> Acima de 3 vira lista com explicação em cada opção, e a foto vai em mensagem separada.</>}
                      </p>
                    )}
                  </div>

                  {p.tipo === 'opcoes' && (
                    <div className="space-y-3">
                      {(p.opcoes || []).map((o, k) => (
                        <div key={o.id} className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50/50">
                          <div className="flex items-center gap-2">
                            <input
                              value={o.rotulo} onChange={(e) => setOpcao(i, k, { rotulo: e.target.value })}
                              placeholder="O que o contato lê no botão"
                              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-teal-100"
                            />
                            <span className={cn('text-[10px] font-bold', o.rotulo.length > 20 ? 'text-amber-600' : 'text-slate-400')}>{o.rotulo.length}</span>
                            <button onClick={() => removerOpcao(i, k)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                          <input
                            value={o.descricao || ''} onChange={(e) => setOpcao(i, k, { descricao: e.target.value })}
                            placeholder="Explicação (só aparece quando é lista)"
                            className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-teal-100"
                          />
                          <input
                            value={(o.sinonimos || []).join(', ')}
                            onChange={(e) => setOpcao(i, k, { sinonimos: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                            placeholder="Também aceita se ele digitar: 3 pol, 3 polegadas"
                            className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-teal-100"
                          />
                          {posteriores.length > 0 && (
                            <div className="pt-1">
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Quem escolher isto também responde</p>
                              <div className="flex flex-wrap gap-1.5">
                                {posteriores.map((alvo) => {
                                  const on = (o.desbloqueia || []).includes(alvo.slug);
                                  return (
                                    <button key={alvo.slug}
                                      onClick={() => setOpcao(i, k, {
                                        desbloqueia: on ? (o.desbloqueia || []).filter((s) => s !== alvo.slug) : [...(o.desbloqueia || []), alvo.slug],
                                      })}
                                      className={cn('flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border transition-all',
                                        on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50')}>
                                      {on && <Check className="w-3 h-3" />} {alvo.rotulo_ficha || alvo.slug}
                                    </button>
                                  );
                                })}
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1">
                                Pergunta que ninguém marcar é feita para todo mundo.
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={() => addOpcao(i)} className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-700">
                        <Plus className="w-3.5 h-3.5" /> Nova opção
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <button onClick={addPasso}
          className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:border-teal-300 hover:text-teal-600 transition-all">
          <Plus className="w-4 h-4" /> Nova pergunta
        </button>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Mensagem final (depois de coletar tudo)</label>
            <textarea rows={2} value={def.fim?.mensagem || ''}
              onChange={(e) => setDef({ ...def, fim: { mensagem: e.target.value } })}
              className="w-full mt-1 p-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100 resize-none" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Quando o robô não entender duas vezes</label>
            <textarea rows={2} value={def.humano?.mensagem || ''}
              onChange={(e) => setDef({ ...def, humano: { mensagem: e.target.value } })}
              className="w-full mt-1 p-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100 resize-none"
              placeholder="Vou chamar uma pessoa da equipe para te atender." />
            <p className="text-[10px] text-slate-400 mt-1">A equipe é avisada no sino e o roteiro para de perguntar.</p>
          </div>
        </div>

        {erros.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1.5">
            <p className="text-sm font-bold text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Não dá para publicar ainda</p>
            {erros.map((e, k) => <p key={k} className="text-xs text-red-600 leading-relaxed">{e}</p>)}
          </div>
        )}

        <div className="flex gap-2 pb-2">
          <button onClick={salvar} disabled={saving || !dirty}
            className={cn('flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all',
              dirty ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-slate-100 text-slate-400')}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar rascunho
          </button>
          <button onClick={publicar} disabled={publishing}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-teal-600 text-white hover:bg-teal-700 transition-all">
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} Publicar
          </button>
        </div>
      </div>

      {/* ── Coluna da direita: prévia e simulador ────────────────────────────────────────────── */}
      <div className="space-y-4 overflow-y-auto custom-scrollbar min-h-0">
        <div className="bg-slate-900 rounded-2xl p-4 sticky top-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Como o contato recebe</p>
            <button onClick={() => setPreviewModo(previewModo === 'menu' ? 'texto' : 'menu')}
              className="text-[10px] font-bold text-teal-400 hover:text-teal-300">
              {previewModo === 'menu' ? 'ver como texto numerado' : 'ver como botão'}
            </button>
          </div>

          <div className="bg-[#0b141a] rounded-xl p-3 min-h-[180px] space-y-2">
            {passoAberto?.midia_url && !(preview?.menu?.type === 'button') && (
              <div className="bg-[#005c4b] rounded-lg overflow-hidden">
                <img src={passoAberto.midia_url} alt="" className="w-full max-h-40 object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              </div>
            )}
            <div className="bg-[#005c4b] text-white rounded-lg p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
              {preview?.menu?.imageButton && (
                <img src={preview.menu.imageButton} alt="" className="w-full max-h-32 object-cover rounded mb-2" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              )}
              {preview?.body || <span className="text-slate-400">Escreva a pergunta para ver aqui.</span>}
            </div>
            {preview?.menu?.type === 'button' && (
              <div className="space-y-1">
                {(preview.menu.choices || []).map((c: string, k: number) => (
                  <div key={k} className="bg-[#1f2c34] text-[#53bdeb] text-center rounded-lg py-2 text-[13px] font-medium">{String(c).split('|')[0]}</div>
                ))}
              </div>
            )}
            {preview?.menu?.type === 'list' && (
              <div className="bg-[#1f2c34] text-[#53bdeb] text-center rounded-lg py-2 text-[13px] font-medium">
                {preview.menu.listButton || 'Ver opções'} ({(preview.menu.choices || []).length})
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-2"><Play className="w-4 h-4 text-teal-600" /> Simular</p>
            <button onClick={() => simular(null)} className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
              <RotateCcw className="w-3 h-3" /> Começar
            </button>
          </div>
          {!simPasso && <p className="text-xs text-slate-400">Clique em Começar e responda como se fosse o contato.</p>}
          {simPasso && (
            <div className="space-y-2">
              <p className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-2 leading-relaxed">{simPasso.pergunta}</p>
              {simPasso.tipo === 'opcoes'
                ? (simPasso.opcoes || []).map((o: Opcao) => (
                    <button key={o.id} onClick={() => simResponder(o)}
                      className="w-full text-left px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium hover:bg-teal-50 hover:border-teal-300">
                      {o.rotulo}
                    </button>
                  ))
                : <button onClick={() => simResponder(null, 'resposta escrita')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium hover:bg-teal-50">
                    Responder por escrito
                  </button>}
            </div>
          )}
          {simResp && !simPasso && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-teal-700 mb-2">Fim do roteiro. A ficha do vendedor fica assim:</p>
              {Object.entries(simResp).map(([slug, v]: any) => {
                const p = def.passos.find((x) => x.slug === slug);
                return <p key={slug} className="text-xs text-slate-600"><b>{p?.rotulo_ficha || slug}:</b> {v.rotulo}</p>;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
