import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { logSystemError, logFetchFailThrottled } from './useSupabase';
import { normalizeText } from '../lib/search';

/**
 * Respostas rápidas do chat humano (tabela `quick_replies`): atalho "/" na caixa de envio.
 * Uma lista por clínica; qualquer membro cria e edita (RLS `my_clinic_ids()`).
 *
 * A lista mora num store de MÓDULO, por clínica, compartilhado por todas as instâncias do hook:
 * o App mantém as abas visitadas montadas (display:none), então o composer das Conversas, a
 * gaveta do Kanban e o card das Configurações coexistem; sem store, o que uma instância salvava
 * não aparecia nas outras até recarregar a página. A busca em voo também é compartilhada, e como
 * o store é por clínica, resposta atrasada de uma clínica nunca cai na lista de outra.
 */
export interface QuickReply {
  id: string;
  shortcut: string;
  content: string;
  /** Atalho e texto já normalizados (sem acento/caixa), uma vez por carga, para o filtro por tecla. */
  atalhoNorm: string;
  textoNorm: string;
}

export const QUICK_REPLY_SHORTCUT_MAX = 40;
// = MAX_TEXT da edge chat-send: acima disso o envio é recusado (texto_muito_longo).
export const QUICK_REPLY_CONTENT_MAX = 4096;

export interface SalvarRespostaInput { id?: string; shortcut: string; content: string }
export interface Resultado { ok: boolean; error?: string }

// Erros do banco traduzidos para o operador. O resto cai no genérico.
const ERROS: Record<string, string> = {
  '23505': 'Já existe uma resposta rápida com este atalho.',
  // Cinto: o save valida as mesmas regras antes de gravar, então este caminho é raro.
  '23514': `Atalho ou texto fora do formato: o atalho é uma palavra só (até ${QUICK_REPLY_SHORTCUT_MAX} caracteres) e o texto vai até ${QUICK_REPLY_CONTENT_MAX.toLocaleString('pt-BR')} caracteres.`,
  '42501': 'Você não tem permissão para alterar as respostas rápidas desta clínica.',
};
// Erro do operador (atalho repetido, formato) não é defeito: não vai para a Central.
const ERROS_DO_OPERADOR = new Set(['23505', '23514']);

// ── Store por clínica ─────────────────────────────────────────────────────────

interface Store { items: QuickReply[]; loading: boolean; erro: string | null; carregado: boolean }
const VAZIO: Store = { items: [], loading: false, erro: null, carregado: false };
const stores = new Map<string, Store>();
const ouvintes = new Map<string, Set<() => void>>();
const emVoo = new Map<string, Promise<void>>();

const lerStore = (clinicId: string): Store => stores.get(clinicId) ?? VAZIO;
function gravarStore(clinicId: string, patch: Partial<Store>) {
  stores.set(clinicId, { ...lerStore(clinicId), ...patch });
  ouvintes.get(clinicId)?.forEach(fn => fn());
}
function assinar(clinicId: string, fn: () => void) {
  let set = ouvintes.get(clinicId);
  if (!set) { set = new Set(); ouvintes.set(clinicId, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

// Ordem ÚNICA (pt-BR, sem distinguir caixa/acento) em todo caminho: carga e salvamento. Ordenar pela
// collation do banco numa hora e por localeCompare noutra fazia o item trocar de lugar entre "/" e "/a".
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
type Linha = { id: string; shortcut: string; content: string };
function preparar(linhas: Linha[]): QuickReply[] {
  return linhas
    .map(r => ({
      id: r.id,
      shortcut: r.shortcut,
      content: r.content,
      atalhoNorm: normalizeText(r.shortcut),
      textoNorm: normalizeText(r.content),
    }))
    .sort((a, b) => collator.compare(a.shortcut, b.shortcut) || a.id.localeCompare(b.id));
}

/** Carrega (ou recarrega) a lista da clínica. Chamadas simultâneas compartilham a mesma ida ao banco. */
function carregar(clinicId: string): Promise<void> {
  const andamento = emVoo.get(clinicId);
  if (andamento) return andamento;
  // A promessa existe e está em `emVoo` ANTES de o corpo rodar, e a limpeza de `emVoo` acontece no
  // `finally`, de forma síncrona, antes de resolver: assim tanto quem faz `await carregar()` quanto um
  // re-render do React disparado pelo último `gravarStore` já enxergam a busca como concluída.
  let resolver!: () => void;
  const p = new Promise<void>(r => { resolver = r; });
  emVoo.set(clinicId, p);
  (async () => {
    gravarStore(clinicId, { loading: true });
    try {
      const { data, error } = await supabase
        .from('quick_replies')
        .select('id, shortcut, content')
        .eq('clinic_id', clinicId);
      if (error) throw error;
      gravarStore(clinicId, { loading: false, erro: null, carregado: true, items: preparar((data ?? []) as Linha[]) });
    } catch (e) {
      const err = e as { code?: string; message?: string } | null;
      // Aparece na tela (seletor e editor) E na Central: grant/RLS regredindo aqui seria invisível.
      // Throttle de leitura (6h por clínica), como o resto do front: cada "/" digitado com a leitura
      // quebrada não vira uma requisição de log.
      gravarStore(clinicId, { loading: false, erro: 'Não foi possível carregar as respostas rápidas.' });
      logFetchFailThrottled('quick_replies_carregar_falhou', 'Respostas rápidas: falha ao carregar a lista', clinicId, {
        code: err?.code, detail: err?.message ?? String(e),
      });
    } finally {
      if (emVoo.get(clinicId) === p) emVoo.delete(clinicId);
      resolver();
    }
  })();
  return p;
}

/**
 * Depois de gravar ou excluir: se havia um SELECT em voo (disparado antes da gravação), a resposta
 * dele chegaria DEPOIS e apagaria o merge local; refaz a busca quando ele terminar, para o estado final
 * ser o pós-gravação. E se a carga inicial tinha falhado, a gravação provou que a conexão voltou:
 * carrega a lista completa em vez de deixar só o item recém-salvo parecendo "a lista inteira".
 */
function reconciliar(clinicId: string) {
  const andamento = emVoo.get(clinicId);
  if (andamento) { void andamento.then(() => carregar(clinicId)); return; }
  if (!lerStore(clinicId).carregado) void carregar(clinicId);
}

/**
 * Filtra e ordena pelo que foi digitado depois da barra: atalho que COMEÇA com a busca vem primeiro,
 * depois atalho que contém, depois texto que contém. Sem acento e sem caixa, dos dois lados (o mesmo
 * `normalizeText` das buscas do app). A ordem alfabética já vem do store; o sort é estável e só
 * agrupa por peso.
 */
export function filtrarRespostas(items: QuickReply[], query: string): QuickReply[] {
  const q = normalizeText(query);
  if (!q) return items;
  const peso = (r: QuickReply) =>
    r.atalhoNorm.startsWith(q) ? 0 : r.atalhoNorm.includes(q) ? 1 : r.textoNorm.includes(q) ? 2 : -1;
  return items
    .map(r => ({ r, p: peso(r) }))
    .filter(x => x.p >= 0)
    .sort((a, b) => a.p - b.p)
    .map(x => x.r);
}

export function useQuickReplies(enabled = true) {
  const { activeClinicId } = useAuth();
  const clinicId = activeClinicId ?? '';

  const subscribe = useCallback((fn: () => void) => (clinicId ? assinar(clinicId, fn) : () => {}), [clinicId]);
  const getSnapshot = useCallback(() => lerStore(clinicId), [clinicId]);
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(() => (clinicId ? carregar(clinicId) : Promise.resolve()), [clinicId]);

  // Primeira carga da clínica ao montar (uma vez por clínica, não por instância: a gaveta do Kanban
  // monta o composer a cada abertura). Recargas ficam a cargo de quem usa, via `refresh`: o composer
  // ao abrir o seletor, o card das Configurações ao montar.
  useEffect(() => {
    if (!enabled || !clinicId) return;
    if (!lerStore(clinicId).carregado) carregar(clinicId);
  }, [enabled, clinicId]);

  const save = useCallback(async (input: SalvarRespostaInput): Promise<Resultado> => {
    if (!clinicId) return { ok: false, error: 'Nenhuma clínica selecionada.' };
    // O atalho é o que se digita DEPOIS da barra: entra sem ela e sem espaço.
    const shortcut = input.shortcut.trim().replace(/^\/+/, '');
    const content = input.content.trim();
    if (!shortcut) return { ok: false, error: 'Informe o atalho.' };
    if (/\s/.test(shortcut)) return { ok: false, error: 'O atalho é uma palavra só, sem espaços.' };
    if (shortcut.length > QUICK_REPLY_SHORTCUT_MAX) return { ok: false, error: `O atalho vai até ${QUICK_REPLY_SHORTCUT_MAX} caracteres.` };
    if (!content) return { ok: false, error: 'Escreva o texto da resposta.' };
    if (content.length > QUICK_REPLY_CONTENT_MAX) return { ok: false, error: `O texto vai até ${QUICK_REPLY_CONTENT_MAX.toLocaleString('pt-BR')} caracteres.` };

    // `.select()` devolve a linha gravada: é o que distingue "atualizou" de "não achou a linha"
    // (o PostgREST não erra em UPDATE de zero linhas).
    const { data, error } = input.id
      ? await supabase.from('quick_replies').update({ shortcut, content }).eq('id', input.id).eq('clinic_id', clinicId).select('id, shortcut, content')
      : await supabase.from('quick_replies').insert({ clinic_id: clinicId, shortcut, content }).select('id, shortcut, content');
    if (error) {
      if (!ERROS_DO_OPERADOR.has(error.code)) {
        logSystemError('quick_replies_salvar_falhou', 'Respostas rápidas: falha ao salvar', clinicId, {
          code: error.code, detail: error.message, editando: !!input.id,
        });
      }
      return { ok: false, error: ERROS[error.code] ?? 'Não foi possível salvar a resposta rápida.' };
    }
    const linha = (data as Linha[] | null)?.[0];
    if (!linha) {
      // Editou uma resposta que outra pessoa excluiu enquanto o formulário estava aberto.
      await carregar(clinicId);
      return { ok: false, error: 'Esta resposta não existe mais (foi excluída por outra pessoa). Se precisar, crie de novo.' };
    }
    const demais = lerStore(clinicId).items.filter(i => i.id !== linha.id);
    gravarStore(clinicId, { items: preparar([...demais, linha]), erro: null });
    reconciliar(clinicId);
    return { ok: true };
  }, [clinicId]);

  const remove = useCallback(async (id: string): Promise<Resultado> => {
    if (!clinicId) return { ok: false, error: 'Nenhuma clínica selecionada.' };
    const { error } = await supabase.from('quick_replies').delete().eq('id', id).eq('clinic_id', clinicId);
    if (error) {
      logSystemError('quick_replies_excluir_falhou', 'Respostas rápidas: falha ao excluir', clinicId, { code: error.code, detail: error.message });
      return { ok: false, error: ERROS[error.code] ?? 'Não foi possível excluir a resposta rápida.' };
    }
    // Zero linhas (já excluída por outra pessoa) dá no mesmo: a resposta não existe mais.
    gravarStore(clinicId, { items: lerStore(clinicId).items.filter(i => i.id !== id) });
    reconciliar(clinicId);
    return { ok: true };
  }, [clinicId]);

  return { items: store.items, loading: store.loading, erro: store.erro, refresh, save, remove };
}
