import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { logSystemError } from './useSupabase';

export type WhatsappStatus = 'connected' | 'disconnected' | 'connecting' | 'unknown';

// Hook leve usado pelo banner global. Subscreve Realtime na linha da clinica ativa
// e mantem o status atual em memoria sem refetch de dados pesados.
//
// hasWhatsapp = clinics.has_whatsapp: cliente que NAO contratou o canal nao pode ver
// faixa de reconexao nem tela de conexao. Assina a linha da clinica tambem, senao
// desmarcar na Gestao da Org so faria efeito no proximo F5 do cliente.
//
// ⚠️ Duas armadilhas ja provadas em cliente (Metaltres, 18/08/2026), as duas dando
// o MESMO sintoma: a faixa "WhatsApp desconectado" no ar com o WhatsApp conectado
// e mandando mensagem.
//   1. Leitura que FALHA nao e desconexao. O `?? 'disconnected'` transformava
//      qualquer "Failed to fetch" (rede do cliente piscando, sessao expirando) num
//      anuncio de queda. Agora falha mantem o estado anterior e vai para a Central.
//   2. Realtime perde o que aconteceu enquanto a aba estava dormindo. Quem deixa a
//      aba aberta a noite nao recebe o UPDATE da reconexao e fica com a faixa
//      congelada ate dar F5. Por isso relemos ao voltar a aba, ao voltar a rede e a
//      cada (re)inscricao do canal.
export function useWhatsappStatus(): { status: WhatsappStatus; hasWhatsapp: boolean; loading: boolean } {
  const { activeClinicId } = useAuth();
  const [status, setStatus] = useState<WhatsappStatus>('unknown');
  const [hasWhatsapp, setHasWhatsapp] = useState(true);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const ler = useCallback(async (clinicId: string) => {
    const [waRes, clinicRes] = await Promise.all([
      supabase.from('whatsapp_instances').select('status').eq('clinic_id', clinicId).maybeSingle(),
      supabase.from('clinics').select('has_whatsapp').eq('id', clinicId).maybeSingle(),
    ]);
    if (!mountedRef.current) return;

    if (waRes.error) {
      // Nao mexe no status: na duvida, nao acusar queda. Central porque uma leitura
      // que falha sempre e o unico rastro de "a faixa apareceu do nada".
      logSystemError(
        'WA_STATUS_FETCH_FAIL',
        'useWhatsappStatus: falha ao ler o status do WhatsApp — faixa manteve o estado anterior',
        clinicId,
        { error: (waRes.error as any)?.message ?? String(waRes.error) },
        'error',
      );
    } else {
      // Sem linha de instancia = clinica que nunca conectou: 'disconnected' e o fato.
      setStatus((waRes.data?.status as WhatsappStatus) ?? 'disconnected');
    }

    if (!clinicRes.error) {
      // Ausente/indefinido = tem (default do banco). Só o false explícito esconde.
      setHasWhatsapp((clinicRes.data as any)?.has_whatsapp !== false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!activeClinicId) {
      setStatus('unknown');
      setHasWhatsapp(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    void ler(activeClinicId);

    const releitura = () => {
      if (document.visibilityState === 'visible') void ler(activeClinicId);
    };
    document.addEventListener('visibilitychange', releitura);
    window.addEventListener('online', releitura);

    const channel = supabase
      .channel(`wa_status_banner_${activeClinicId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_instances',
          filter: `clinic_id=eq.${activeClinicId}`,
        },
        (payload) => {
          const next = (payload.new as any)?.status;
          if (mountedRef.current && next) setStatus(next as WhatsappStatus);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'clinics',
          filter: `id=eq.${activeClinicId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (!mountedRef.current || !row) return;
          if (row.has_whatsapp !== undefined) setHasWhatsapp(row.has_whatsapp !== false);
        },
      )
      // Toda (re)inscricao releva: o canal so rejunta o futuro, o que passou enquanto
      // o socket esteve caido nunca chega.
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED' && mountedRef.current) void ler(activeClinicId);
      });

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', releitura);
      window.removeEventListener('online', releitura);
      supabase.removeChannel(channel);
    };
  }, [activeClinicId, ler]);

  return { status, hasWhatsapp, loading };
}
