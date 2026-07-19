import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export type ChannelStatus = 'none' | 'inactive' | 'active';

// Hook leve p/ o banner global de contas de anúncio. Lê meta_status/google_status da clínica
// ATIVA e assina Realtime na linha dela (mesmo padrão do useWhatsappStatus). 'inactive' = token/
// permissão quebrada (marcado pelo agendador quando a API recusa), então o investimento não
// sincroniza até corrigir.
export function useAdAccountStatus(): { meta: ChannelStatus; google: ChannelStatus; loading: boolean } {
  const { activeClinicId } = useAuth();
  const [meta, setMeta] = useState<ChannelStatus>('none');
  const [google, setGoogle] = useState<ChannelStatus>('none');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!activeClinicId) {
      setMeta('none'); setGoogle('none'); setLoading(false);
      return;
    }
    setLoading(true);

    (async () => {
      const { data } = await supabase
        .from('clinics')
        .select('meta_status, google_status')
        .eq('id', activeClinicId)
        .maybeSingle();
      if (!mounted) return;
      setMeta((data?.meta_status as ChannelStatus) ?? 'none');
      setGoogle((data?.google_status as ChannelStatus) ?? 'none');
      setLoading(false);
    })();

    const channel = supabase
      .channel(`ad_status_banner_${activeClinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clinics', filter: `id=eq.${activeClinicId}` },
        (payload) => {
          const row = payload.new as any;
          if (!mounted || !row) return;
          if (row.meta_status !== undefined) setMeta(row.meta_status as ChannelStatus);
          if (row.google_status !== undefined) setGoogle(row.google_status as ChannelStatus);
        },
      )
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [activeClinicId]);

  return { meta, google, loading };
}
