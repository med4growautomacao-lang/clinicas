import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export type WhatsappStatus = 'connected' | 'disconnected' | 'connecting' | 'unknown';

// Hook leve usado pelo banner global. Subscreve Realtime na linha da clinica ativa
// e mantem o status atual em memoria sem refetch de dados pesados.
//
// hasWhatsapp = clinics.has_whatsapp: cliente que NAO contratou o canal nao pode ver
// faixa de reconexao nem tela de conexao. Assina a linha da clinica tambem, senao
// desmarcar na Gestao da Org so faria efeito no proximo F5 do cliente.
export function useWhatsappStatus(): { status: WhatsappStatus; hasWhatsapp: boolean; loading: boolean } {
  const { activeClinicId } = useAuth();
  const [status, setStatus] = useState<WhatsappStatus>('unknown');
  const [hasWhatsapp, setHasWhatsapp] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!activeClinicId) {
      setStatus('unknown');
      setHasWhatsapp(true);
      setLoading(false);
      return;
    }
    setLoading(true);

    (async () => {
      const [waRes, clinicRes] = await Promise.all([
        supabase.from('whatsapp_instances').select('status').eq('clinic_id', activeClinicId).maybeSingle(),
        supabase.from('clinics').select('has_whatsapp').eq('id', activeClinicId).maybeSingle(),
      ]);
      if (!mounted) return;
      setStatus(((waRes.data?.status as WhatsappStatus) ?? 'disconnected'));
      // Ausente/indefinido = tem (default do banco). Só o false explícito esconde.
      setHasWhatsapp((clinicRes.data as any)?.has_whatsapp !== false);
      setLoading(false);
    })();

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
          if (mounted && next) setStatus(next as WhatsappStatus);
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
          if (!mounted || !row) return;
          if (row.has_whatsapp !== undefined) setHasWhatsapp(row.has_whatsapp !== false);
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [activeClinicId]);

  return { status, hasWhatsapp, loading };
}
