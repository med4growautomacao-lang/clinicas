import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * Respostas rápidas do chat humano (tabela `quick_replies`): atalho "/" na caixa de envio.
 * Uma lista por clínica; qualquer membro cria e edita (RLS `my_clinic_ids()`).
 */
export interface QuickReply {
  id: string;
  clinic_id: string;
  shortcut: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export const QUICK_REPLY_SHORTCUT_MAX = 40;
// = MAX_TEXT da edge chat-send: acima disso o envio é recusado (texto_muito_longo).
export const QUICK_REPLY_CONTENT_MAX = 4096;

// Erros do banco traduzidos para o operador. O resto cai no genérico.
const ERROS: Record<string, string> = {
  '23505': 'Já existe uma resposta rápida com este atalho.',
  '23514': 'Atalho ou texto fora do formato: o atalho é uma palavra só (até 40 caracteres) e o texto vai até 4.096 caracteres.',
  '42501': 'Você não tem permissão para alterar as respostas rápidas desta clínica.',
};

export interface SalvarRespostaInput { id?: string; shortcut: string; content: string }

export function useQuickReplies(enabled = true) {
  const { activeClinicId } = useAuth();
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeClinicId) { setItems([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('quick_replies')
      .select('id, clinic_id, shortcut, content, created_at, updated_at')
      .eq('clinic_id', activeClinicId)
      .order('shortcut', { ascending: true });
    if (error) {
      // Falha de leitura aparece na tela (seletor e editor), não some em silêncio.
      setErro('Não foi possível carregar as respostas rápidas.');
    } else {
      setErro(null);
      setItems((data ?? []) as QuickReply[]);
    }
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  const save = useCallback(async (input: SalvarRespostaInput): Promise<{ ok: boolean; error?: string }> => {
    if (!activeClinicId) return { ok: false, error: 'Nenhuma clínica selecionada.' };
    // O atalho é o que se digita DEPOIS da barra: entra sem ela e sem espaço.
    const shortcut = input.shortcut.trim().replace(/^\/+/, '');
    const content = input.content.trim();
    if (!shortcut) return { ok: false, error: 'Informe o atalho.' };
    if (/\s/.test(shortcut)) return { ok: false, error: 'O atalho é uma palavra só, sem espaços.' };
    if (shortcut.length > QUICK_REPLY_SHORTCUT_MAX) return { ok: false, error: `O atalho vai até ${QUICK_REPLY_SHORTCUT_MAX} caracteres.` };
    if (!content) return { ok: false, error: 'Escreva o texto da resposta.' };
    if (content.length > QUICK_REPLY_CONTENT_MAX) return { ok: false, error: `O texto vai até ${QUICK_REPLY_CONTENT_MAX.toLocaleString('pt-BR')} caracteres.` };

    const { error } = input.id
      ? await supabase.from('quick_replies').update({ shortcut, content }).eq('id', input.id).eq('clinic_id', activeClinicId)
      : await supabase.from('quick_replies').insert({ clinic_id: activeClinicId, shortcut, content });
    if (error) return { ok: false, error: ERROS[error.code] ?? 'Não foi possível salvar a resposta rápida.' };
    await refresh();
    return { ok: true };
  }, [activeClinicId, refresh]);

  const remove = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    if (!activeClinicId) return { ok: false, error: 'Nenhuma clínica selecionada.' };
    const { error } = await supabase.from('quick_replies').delete().eq('id', id).eq('clinic_id', activeClinicId);
    if (error) return { ok: false, error: ERROS[error.code] ?? 'Não foi possível excluir a resposta rápida.' };
    setItems(prev => prev.filter(i => i.id !== id));
    return { ok: true };
  }, [activeClinicId]);

  return { items, loading, erro, refresh, save, remove };
}
