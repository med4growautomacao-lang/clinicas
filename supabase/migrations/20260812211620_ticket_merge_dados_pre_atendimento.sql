-- Merge CAMPO A CAMPO dos dados coletados no pré-atendimento, numa instrução só.
--
-- ⚠️ Existe para tirar da edge um ler-modificar-gravar. Lá o valor era lido num ponto, gravado
-- vários passos depois, e no meio havia outras chamadas ao banco. Isso quebrava de duas formas,
-- as duas mudas:
--
--   1. A lista de campos era trocada INTEIRA. O cliente voltava, o agente recoletava só o que
--      mudou (a altura, digamos) e malha e comprimento sumiam do atendimento — a mesma classe de
--      "salvar apaga campo" que a regra da casa proíbe, agora dentro do próprio array.
--   2. Duas transferências ao mesmo tempo liam o mesmo valor e a segunda apagava a primeira. O
--      worker executa as tool calls do turno em paralelo, então não é hipótese.
--
-- Aqui as duas somem: o UPDATE lê e grava sob a trava da linha, e a referência a
-- t.dados_pre_atendimento dentro do SET é o valor ANTIGO, o que dá o merge sem ida e volta.
--
-- Regra do merge: campo novo GANHA do antigo (mesmo nome, comparado sem caixa nem espaço); campo
-- que a coleta nova não mencionou FICA, no fim da lista. Coleta vazia não apaga nada: o modelo
-- omitir um campo não é o cliente ter voltado atrás.
create or replace function public.ticket_merge_dados_pre_atendimento(
  p_ticket_id uuid,
  p_resumo    text,
  p_itens     jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_novo   jsonb;
  v_itens  jsonb := coalesce(p_itens, '[]'::jsonb);
  v_resumo text  := nullif(btrim(coalesce(p_resumo, '')), '');
begin
  if p_ticket_id is null then
    return null;
  end if;

  update public.tickets t
     set dados_pre_atendimento =
           coalesce(t.dados_pre_atendimento, '{}'::jsonb)
           || jsonb_build_object(
                -- Resumo vazio preserva o que já havia, pelo mesmo motivo dos campos.
                'resumo', coalesce(v_resumo, t.dados_pre_atendimento->>'resumo'),
                -- Fuso de São Paulo, sem sufixo, igual ao resto do sistema.
                'em', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
                'itens', (
                  select coalesce(jsonb_agg(y.item order by y.ord), '[]'::jsonb)
                    from (
                      select x.item, x.ord
                        from (
                          -- Os novos primeiro, na ordem em que o agente coletou.
                          select n.item, n.ord
                            from jsonb_array_elements(v_itens) with ordinality as n(item, ord)
                          union all
                          -- Os antigos que a coleta nova não citou, logo atrás.
                          select a.item, 1000 + a.ord
                            from jsonb_array_elements(
                                   coalesce(t.dados_pre_atendimento->'itens', '[]'::jsonb)
                                 ) with ordinality as a(item, ord)
                           where lower(btrim(coalesce(a.item->>'campo',''))) not in (
                                 select lower(btrim(coalesce(m.item->>'campo','')))
                                   from jsonb_array_elements(v_itens) as m(item))
                        ) x
                       order by x.ord
                       -- Mesmo teto do servidor (MAX_CAMPOS_PRE_ATENDIMENTO): a ficha existe para
                       -- ser conferida de relance, e lista maior que isso ninguém confere.
                       limit 15
                    ) y
                )
              )
   where t.id = p_ticket_id
  returning t.dados_pre_atendimento into v_novo;

  return v_novo;
end;
$$;

comment on function public.ticket_merge_dados_pre_atendimento(uuid, text, jsonb) is
  'Mescla os dados do pré-atendimento no ticket, campo a campo e numa instrução só. Campo novo ganha, campo não citado fica. Chamada pela edge ai-scheduler ao transferir para o especialista.';

-- ⚠️ O grant vem por DOIS caminhos: o PUBLIC que todo create function concede, e o nominal.
-- Revogar só de um não fecha nada. Esta função é interna (só a edge chama, com service_role).
revoke all on function public.ticket_merge_dados_pre_atendimento(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ticket_merge_dados_pre_atendimento(uuid, text, jsonb)
  to service_role;
