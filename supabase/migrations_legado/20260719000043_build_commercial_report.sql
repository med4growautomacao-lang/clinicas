-- Motor ÚNICO do relatório comercial (texto p/ WhatsApp).
-- Fonte única: o botão da tela E o envio agendado chamam ESTA função — a
-- montagem client-side do ComercialDashboard.tsx foi substituída por ela.
-- Números vêm de get_commercial_dashboard (mesmos da tela, sempre batem) +
-- blocos novos: Marketing (v_kpi_investment), Perdas (loss_reason/no-show) e
-- comparativo ▲▼ vs. período anterior equivalente (cada janela deslocada pelo
-- próprio tamanho). Nome canônico: "Vendas lançadas" (não "Faturamento").
-- (Aplicada em produção via MCP: build_commercial_report + _fix_appends + _blank_line.)

-- Auxiliar: moeda BRL sem centavos (R$ 14.400)
create or replace function public._report_brl(v numeric)
returns text language sql immutable as $f$
  select 'R$ ' || reverse(regexp_replace(reverse(coalesce(round(v),0)::bigint::text), '(\d{3})(?=\d)', '\1.', 'g'));
$f$;

-- Auxiliar: delta percentual "(▲ 12%)" / "(▼ 8%)"; null sem base de comparação
create or replace function public._report_delta(cur numeric, prev numeric)
returns text language sql immutable as $f$
  select case
    when prev is null or prev <= 0 or cur is null then null
    when round(((cur - prev) / prev) * 100) > 0 then '(▲ ' || round(((cur - prev) / prev) * 100)::text || '%)'
    when round(((cur - prev) / prev) * 100) < 0 then '(▼ ' || abs(round(((cur - prev) / prev) * 100))::text || '%)'
    else '(estável)'
  end;
$f$;

create or replace function public.build_commercial_report(
  p_clinic_id uuid,
  p_kind text default 'completo',            -- completo | geral | ia | humano
  p_entry_from date default null, p_entry_to date default null,
  p_conv_from date default null,  p_conv_to date default null,   -- janela "Agenda" (mesmo mapeamento da tela)
  p_appt_from date default null,  p_appt_to date default null,   -- janela "Conversão" (realização)
  p_compare boolean default true
) returns text
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_clinic_name text;
  v_geral jsonb; v_ia jsonb; v_hum jsonb; v_prev jsonb;
  v_header text; v_blocks text[] := '{}';
  g_interessados int; g_previstas int; g_realizadas int; g_won int; g_lost int;
  g_noshow int; g_cancel int; g_valid int; g_pct int;
  g_ticket numeric; g_fat_prev numeric; g_vendas_lancadas numeric; g_invest numeric;
  c_interessados numeric; c_previstas numeric; c_won numeric; c_vendas numeric; c_invest numeric;
  d_int text; d_prev text; d_won text; d_vendas text; d_inv text;
  m_meta numeric; m_google numeric; m_cpl numeric; m_cac numeric;
  p_top text; p_noshow_base int;
  a jsonb; a_is_ia boolean; a_touched int; a_prev_ap int; a_real int; a_pct int; a_valid int; a_fatprev numeric;
  lines text[];
  v_ia_acted boolean := false;
begin
  -- Acesso: service role/cron (sem JWT) passa; usuário logado precisa de vínculo
  if auth.uid() is not null then
    if not (
      is_super_admin()
      or is_clinic_admin(p_clinic_id)
      or exists (select 1 from clinic_users cu where cu.id = auth.uid() and cu.clinic_id = p_clinic_id)
      or exists (select 1 from clinics c join org_users ou on ou.organization_id = c.organization_id
                 where c.id = p_clinic_id and ou.user_id = auth.uid())
    ) then
      raise exception 'acesso negado ao relatório desta clínica';
    end if;
  end if;

  select name into v_clinic_name from clinics where id = p_clinic_id;

  v_geral := get_commercial_dashboard(p_clinic_id, p_entry_from, p_entry_to, p_conv_from, p_conv_to,
                                      'todos', 'todos', 'todos', p_appt_from, p_appt_to);

  g_interessados := coalesce((v_geral->>'newLeads')::int, 0);
  g_previstas    := coalesce((v_geral->'appointments'->>'total')::int, 0);
  g_realizadas   := coalesce((v_geral->'appointments'->'byStatus'->>'realizado')::int, 0)
                  + coalesce((v_geral->'appointments'->'byStatus'->>'compareceu')::int, 0);
  g_noshow       := coalesce((v_geral->'appointments'->'byStatus'->>'faltou')::int, 0);
  g_cancel       := coalesce((v_geral->'appointments'->'byStatus'->>'cancelado')::int, 0);
  g_won          := coalesce((v_geral->'outcomes'->>'won')::int, 0);
  g_lost         := coalesce((v_geral->'outcomes'->>'lost')::int, 0);
  g_ticket       := nullif(coalesce((v_geral->'finance'->>'defaultTicket')::numeric, 0), 0);
  g_valid        := greatest(g_previstas - (g_noshow + g_cancel), 0);
  g_fat_prev     := case when g_ticket is not null then g_valid * g_ticket end;
  g_vendas_lancadas := coalesce((v_geral->'finance'->>'revenueScoped')::numeric,
                                (v_geral->'finance'->>'revenue')::numeric, 0);
  g_invest       := coalesce((v_geral->'finance'->>'investment')::numeric, 0);
  g_pct          := case when g_interessados > 0 then round(g_previstas::numeric / g_interessados * 100) end;

  v_ia_acted := coalesce((v_geral->'agents'->'ia'->>'messagesOut')::int,0) > 0
             or coalesce((v_geral->'agents'->'ia'->>'leadsTouched')::int,0) > 0
             or coalesce((v_geral->'agents'->'ia'->>'appointments')::int,0) > 0;

  if p_compare and (p_entry_from is not null or p_conv_from is not null) then
    v_prev := get_commercial_dashboard(p_clinic_id,
      case when p_entry_from is not null then p_entry_from - (p_entry_to - p_entry_from + 1) end,
      case when p_entry_to   is not null then p_entry_from - 1 end,
      case when p_conv_from  is not null then p_conv_from - (p_conv_to - p_conv_from + 1) end,
      case when p_conv_to    is not null then p_conv_from - 1 end,
      'todos', 'todos', 'todos',
      case when p_appt_from  is not null then p_appt_from - (p_appt_to - p_appt_from + 1) end,
      case when p_appt_to    is not null then p_appt_from - 1 end);
    c_interessados := (v_prev->>'newLeads')::numeric;
    c_previstas    := (v_prev->'appointments'->>'total')::numeric;
    c_won          := (v_prev->'outcomes'->>'won')::numeric;
    c_vendas       := coalesce((v_prev->'finance'->>'revenueScoped')::numeric, (v_prev->'finance'->>'revenue')::numeric);
    c_invest       := (v_prev->'finance'->>'investment')::numeric;
    d_int    := _report_delta(g_interessados, c_interessados);
    d_prev   := _report_delta(g_previstas, c_previstas);
    d_won    := _report_delta(g_won, c_won);
    d_vendas := _report_delta(g_vendas_lancadas, c_vendas);
    d_inv    := _report_delta(g_invest, c_invest);
  end if;

  v_header := '📊 *RELATÓRIO COMERCIAL*'
    || case when v_clinic_name is not null then E'\n🏥 ' || v_clinic_name else '' end
    || E'\n📥 Entrada do lead: ' || case when p_entry_from is not null
         then to_char(p_entry_from,'DD/MM/YYYY') || ' a ' || to_char(p_entry_to,'DD/MM/YYYY') else 'Todos os leads' end
    || E'\n🎯 Conversão: ' || case when p_appt_from is not null
         then to_char(p_appt_from,'DD/MM/YYYY') || ' a ' || to_char(p_appt_to,'DD/MM/YYYY') else 'Todas as datas' end
    || case when v_prev is not null then E'\n📈 Variações vs. período anterior equivalente' else '' end;

  -- ===== Bloco GERAL =====
  if p_kind in ('completo','geral') then
    lines := array[
      '*👥 ATENDIMENTO*',
      '• Interessados: *' || g_interessados || '*' || coalesce(' ' || d_int, ''),
      '• Consultas marcadas: *' || g_previstas || '*'
        || case when g_pct is not null then ' (' || g_pct || '%)' else '' end
        || coalesce(' ' || d_prev, ''),
      '• Consultas realizadas: *' || g_realizadas || '*',
      '• Viraram clientes: *' || g_won || '*' || coalesce(' ' || d_won, '')
    ];
    lines := array_append(lines, '');
    lines := array_append(lines, '*💰 FINANCEIRO*');
    lines := array_append(lines, '• Vendas lançadas: *' ||
      case when g_vendas_lancadas > 0 then _report_brl(g_vendas_lancadas) else '—' end || '*'
      || coalesce(' ' || d_vendas, ''));
    lines := array_append(lines, '• Previsto (agendados × ticket): *' ||
      case when g_fat_prev is not null and g_fat_prev > 0 then _report_brl(g_fat_prev) else '—' end || '*');
    if g_invest > 0 then
      lines := array_append(lines, '• Investido em anúncios: *' || _report_brl(g_invest) || '*' || coalesce(' ' || d_inv, ''));
      if g_vendas_lancadas > 0 then
        lines := array_append(lines, '• Retorno realizado: *R$ ' ||
          case when g_vendas_lancadas / g_invest < 10
               then replace(round(g_vendas_lancadas / g_invest, 1)::text, '.', ',')
               else round(g_vendas_lancadas / g_invest)::text end || ' p/ cada R$ 1*');
      end if;
      if g_fat_prev is not null and g_fat_prev > 0 then
        lines := array_append(lines, '• Retorno previsto: *R$ ' ||
          case when g_fat_prev / g_invest < 10
               then replace(round(g_fat_prev / g_invest, 1)::text, '.', ',')
               else round(g_fat_prev / g_invest)::text end || ' p/ cada R$ 1*');
      end if;
    end if;
    v_blocks := array_append(v_blocks, array_to_string(lines, E'\n'));

    -- ===== Bloco MARKETING =====
    if g_invest > 0 then
      select coalesce(sum(investment) filter (where platform = 'meta_ads'), 0),
             coalesce(sum(investment) filter (where platform = 'google_ads'), 0)
        into m_meta, m_google
      from v_kpi_investment
      where clinic_id = p_clinic_id
        and (p_conv_from is null or day >= p_conv_from)
        and (p_conv_to   is null or day <= p_conv_to);
      m_cpl := case when g_interessados > 0 then g_invest / g_interessados end;
      m_cac := case when g_won > 0 then g_invest / g_won end;
      lines := array['*📣 MARKETING*'];
      if m_meta > 0 or m_google > 0 then
        lines := array_append(lines, '• Investimento: Meta *' || _report_brl(m_meta) || '* · Google *' || _report_brl(m_google) || '*');
      end if;
      if m_cpl is not null then
        lines := array_append(lines, '• Custo por interessado (CPL): *' || _report_brl(m_cpl) || '*');
      end if;
      if m_cac is not null then
        lines := array_append(lines, '• Custo por cliente (CAC): *' || _report_brl(m_cac) || '*');
      end if;
      v_blocks := array_append(v_blocks, array_to_string(lines, E'\n'));
    end if;

    -- ===== Bloco PERDAS =====
    if g_lost > 0 or g_noshow > 0 then
      select string_agg(r.motivo || ' (' || r.qtd || ')', ' · ')
        into p_top
      from (
        select coalesce(nullif(btrim(t.loss_reason), ''), 'Sem motivo') as motivo, count(*) as qtd
        from tickets t
        join leads l on l.id = t.lead_id
        where t.clinic_id = p_clinic_id and t.outcome = 'perdido'
          and coalesce(l.is_not_lead, false) = false
          and (p_entry_from is null or l.created_at::date >= p_entry_from)
          and (p_entry_to   is null or l.created_at::date <= p_entry_to)
          and (p_conv_from  is null or (coalesce(t.outcome_at, t.closed_at) at time zone 'America/Sao_Paulo')::date >= p_conv_from)
          and (p_conv_to    is null or (coalesce(t.outcome_at, t.closed_at) at time zone 'America/Sao_Paulo')::date <= p_conv_to)
        group by 1 order by 2 desc limit 3
      ) r;
      p_noshow_base := g_realizadas + g_noshow;
      lines := array['*🚫 PERDAS*', '• Oportunidades perdidas: *' || g_lost || '*'];
      if p_top is not null then
        lines := array_append(lines, '• Principais motivos: ' || p_top);
      end if;
      if p_noshow_base > 0 then
        lines := array_append(lines, '• Faltas (no-show): *' || g_noshow || ' de ' || p_noshow_base || '* ('
          || round(g_noshow::numeric / p_noshow_base * 100) || '%)');
      end if;
      v_blocks := array_append(v_blocks, array_to_string(lines, E'\n'));
    end if;
  end if;

  -- ===== Blocos por AGENTE (mesmos números da tela, scoped) =====
  if p_kind in ('completo','ia') and (p_kind = 'ia' or v_ia_acted) then
    v_ia := get_commercial_dashboard(p_clinic_id, p_entry_from, p_entry_to, p_conv_from, p_conv_to,
                                     'ia', 'todos', 'todos', p_appt_from, p_appt_to);
  end if;
  if p_kind in ('completo','humano') then
    v_hum := get_commercial_dashboard(p_clinic_id, p_entry_from, p_entry_to, p_conv_from, p_conv_to,
                                      'humano', 'todos', 'todos', p_appt_from, p_appt_to);
  end if;

  foreach a_is_ia in array (case
      when p_kind = 'ia' then array[true]
      when p_kind = 'humano' then array[false]
      when v_ia is not null then array[true, false]
      else array[false] end) loop
    a := case when a_is_ia then v_ia else v_hum end;
    continue when a is null;
    a_touched := coalesce((a->'agents'->case when a_is_ia then 'ia' else 'humano' end->>'leadsTouched')::int, 0);
    a_prev_ap := coalesce((a->'appointments'->>'total')::int, 0);
    a_real    := coalesce((a->'appointments'->'byStatus'->>'realizado')::int, 0)
               + coalesce((a->'appointments'->'byStatus'->>'compareceu')::int, 0);
    a_pct     := case when a_touched > 0 then round(a_prev_ap::numeric / a_touched * 100) end;
    a_valid   := greatest(a_prev_ap - (coalesce((a->'appointments'->'byStatus'->>'faltou')::int,0)
               + coalesce((a->'appointments'->'byStatus'->>'cancelado')::int,0)), 0);
    a_fatprev := case when g_ticket is not null then a_valid * g_ticket end;
    lines := array[
      case when a_is_ia then '*🤖 INTELIGÊNCIA ARTIFICIAL*' else '*🧑‍💼 EQUIPE (ATENDIMENTO HUMANO)*' end,
      '• Atendeu: *' || a_touched || '* interessados',
      '• Consultas marcadas: *' || a_prev_ap || '*' || case when a_pct is not null then ' (' || a_pct || '%)' else '' end,
      '• Consultas realizadas: *' || a_real || '*'
    ];
    if a_is_ia then
      lines := array_append(lines, '• Resolveu sozinha (sem humano): *' || coalesce((a->'agents'->'ia'->>'autonomous')::int, 0) || '*');
      lines := array_append(lines, '• Passou p/ humano: *' || coalesce((a->'agents'->'ia'->>'handoffs')::int, 0) || '*');
    else
      lines := array_append(lines, '• Assumiu da IA: *' || coalesce((a->'agents'->'humano'->>'handoffsReceived')::int, 0) || '* conversas');
    end if;
    if a_fatprev is not null and a_fatprev > 0 then
      lines := array_append(lines, '• Previsto (agendados × ticket): *' || _report_brl(a_fatprev) || '*');
    end if;
    v_blocks := array_append(v_blocks, array_to_string(lines, E'\n'));
  end loop;

  return v_header || E'\n\n' || array_to_string(v_blocks, E'\n\n')
    || E'\n\n_Realizado = já aconteceu · Previsto = projeção do que já está agendado_'
    || E'\n_Gerado em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || '_';
end;
$function$;

revoke execute on function public.build_commercial_report(uuid, text, date, date, date, date, date, date, boolean) from anon;
revoke execute on function public._report_brl(numeric) from anon;
revoke execute on function public._report_delta(numeric, numeric) from anon;
