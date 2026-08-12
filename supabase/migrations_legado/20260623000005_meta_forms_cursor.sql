-- Cursor incremental do poller meta-forms-sync.
--
-- Substitui a janela fixa de 15 min por um cursor por clínica: o created_time do lead mais recente
-- já sincronizado do Formulário Nativo do Meta. A Edge Function lê leads com time_created a partir
-- do cursor (− uma pequena sobreposição) e só AVANÇA o cursor quando o ciclo da clínica termina
-- 100% ok (sem erro de Graph/RPC). Assim, se o meta_token expirar ou a captação cair por horas, ao
-- voltar a function rebusca tudo desde o cursor — nada de lead perdido (a dedup por
-- (channel, external_id) em lead_tracking absorve qualquer reprocessamento).

alter table public.clinics
  add column if not exists meta_forms_last_synced_at timestamptz;

comment on column public.clinics.meta_forms_last_synced_at is
  'Cursor do poller meta-forms-sync: created_time do lead mais recente já sincronizado do Formulário Nativo do Meta. Avança só em ciclo 100% ok. Ver migration 20260623000005.';
