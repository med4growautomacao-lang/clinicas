import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export type WhatsappStatus = 'connected' | 'disconnected' | 'connecting' | 'unknown';

// Hook leve usado pelo banner global. Subscreve Realtime na linha da clinica ativa
// e mantem o status atual em memoria sem refetch de dados pesados.
export function useWhatsappStatus(): { status: WhatsappStatus; loading: boolean } {
  const { activeClinicId } = useAuth();
  const [status, setStatus] = useState<WhatsappStatus>('unknown');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!activeClinicId) {
      setStatus('unknown');
      setLoading(false);
      return;
    }
    setLoading(true);

    (async () => {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('status')
        .eq('clinic_id', activeClinicId)
        .maybeSingle();
      if (!mounted) return;
      setStatus(((data?.status as WhatsappStatus) ?? 'disconnected'));
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
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [activeClinicId]);

  return { status, loading };
}
