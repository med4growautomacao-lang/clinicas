-- 20260713231305_rename_tracking_tables_step1
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

alter table public.lead_tracking_inbox rename to attribution_inbox;
alter table public.lead_tracking       rename to meta_form_submissions;

comment on table public.attribution_inbox is
  'Fila de reconciliação de atribuição: eventos de clique pago (CTWA hoje, Google em breve) que precisam ser casados a um lead por telefone normalizado ou rast_id. Existe porque o clique e o lead chegam por webhooks independentes, sem ordem garantida.';

comment on table public.meta_form_submissions is
  'Ledger de idempotência do poller do Formulário do Meta (Lead Ads). O unique (channel, external_id) é o que impede a mesma submissão de ser reprocessada a cada minuto pela edge meta-forms-sync.';

-- Compatibilidade: o n8n "Tracking Meta" ainda insere no nome antigo (29 inserts nas últimas 24h).
-- security_invoker = true é obrigatório: sem isso a view rodaria com as permissões do dono e daria
-- bypass de RLS cross-tenant.
create view public.lead_tracking_inbox
  with (security_invoker = true)
  as select * from public.attribution_inbox;

comment on view public.lead_tracking_inbox is
  'TEMPORÁRIO: nome antigo mantido vivo só para o workflow n8n "Tracking Meta", que insere aqui pelo nome. Remover quando todas as instâncias uazapi apontarem para a edge ctwa-tracking.';

grant select, insert, update, delete on public.lead_tracking_inbox to anon, authenticated, service_role;
grant select on public.lead_tracking_inbox to assistant_ro;

-- O n8n não preenche external_id, então as linhas dele ficariam fora do índice único e um retry
-- duplicaria o clique. Preencher aqui fecha o buraco para os dois caminhos de escrita.
create or replace function public.fn_attribution_inbox_external_id()
returns trigger
language plpgsql
as $$
begin
  if new.external_id is null then
    new.external_id := new.ctwa_clid;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attribution_inbox_external_id on public.attribution_inbox;
create trigger trg_attribution_inbox_external_id
  before insert on public.attribution_inbox
  for each row execute function public.fn_attribution_inbox_external_id();

commit;
