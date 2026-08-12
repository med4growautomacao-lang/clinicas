-- O lead nascido de um clique no site estava PERDENDO a identidade do visitante.
--
-- Sequência do que acontecia (achado no teste de ponta a ponta):
--   1. A pessoa clica no site. O script manda o `rast_id` do cookie (identidade real, TTL 2 anos,
--      a mesma que aparece nos toques anteriores dela em lead_touchpoints).
--   2. Ela manda a 1ª mensagem no WhatsApp. O lead é criado pelo TELEFONE — sem rast_id — e a
--      `fn_handle_lead_uniqueness` GERA um UUID novo, aleatório, porque todo lead precisa de um.
--   3. O `fn_apply_inbox_to_lead` aplica a atribuição com
--          rast_id = coalesce(nullif(l.rast_id,''), nullif(i.rast_id,''))
--      → o UUID inventado no passo 2 VENCE, e o do site é descartado.
--
-- Resultado: o lead fica com uma identidade que nasceu há 2 segundos e não aparece em lugar
-- nenhum. A jornada multi-toque (visitou o site em maio, preencheu form em junho, chamou no
-- WhatsApp em julho) NÃO se liga — que é exatamente o que o rast_id existe para fazer.
--
-- O COALESCE não está errado como regra geral ("quem já está na base manda"): ele protege a
-- identidade de um lead ANTIGO contra ser sobrescrita. O problema é o caso específico em que o
-- rast_id atual foi INVENTADO agora, junto com este mesmo lead — aí não há nada a proteger.
--
-- Fix: quando o lead nasceu junto com esta mensagem, ele ADOTA o rast_id do site.
--
-- Guardas:
--   · Só lead recém-criado (2 min). Lead antigo mantém a identidade dele — regra preservada.
--   · Só se ninguém mais na clínica já usa esse rast_id (respeita uq_leads_clinic_rast_id; sem
--     isto, um visitante que já tem lead pelo mesmo cookie derrubaria a constraint e a mensagem
--     inteira falharia).

begin;

create or replace function public.fn_close_site_protocol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proto text;
  i       public.attribution_inbox%rowtype;
begin
  if new.direction is distinct from 'inbound' or new.lead_id is null or new.clinic_id is null then
    return new;
  end if;

  -- 4+ dígitos e match exato. Com (\w+), "protocolo 2" casava com meio mundo (ver 20260714000012).
  v_proto := (regexp_match(coalesce(new.message->>'content', ''), '[Pp]rotocolo:?\s*([0-9]{4,})'))[1];
  if v_proto is null then
    return new;
  end if;

  select * into i
  from public.attribution_inbox ai
  where ai.clinic_id = new.clinic_id
    and ai.protocolo = v_proto
    and ai.consumed_at is null
    and ai.created_at > now() - interval '7 days'
  order by ai.created_at desc
  limit 1;

  if not found then
    return new;                      -- protocolo do fluxo antigo (n8n) ou já consumido
  end if;

  -- ── Adoção da identidade ────────────────────────────────────────────────────────────────
  -- Antes de aplicar a atribuição: se este lead acabou de nascer (e portanto seu rast_id foi
  -- inventado pela fn_handle_lead_uniqueness segundos atrás), ele adota o rast_id REAL do
  -- visitante. É o que liga a visita ao site com a conversa no WhatsApp.
  update public.leads l
  set rast_id = nullif(i.rast_id, '')
  where l.id = new.lead_id
    and nullif(i.rast_id, '') is not null
    and l.rast_id is distinct from i.rast_id
    and l.created_at > (now() at time zone 'America/Sao_Paulo') - interval '2 minutes'
    and not exists (
      select 1 from public.leads x
      where x.clinic_id = l.clinic_id
        and x.rast_id  = i.rast_id
        and x.id <> l.id
    );

  perform public.fn_apply_inbox_to_lead(new.lead_id, i.id);

  return new;
end;
$$;

commit;

-- ============================================================================
-- ROLLBACK: reaplicar a versão de 20260714000013 (sem o bloco de adoção).
-- ============================================================================
