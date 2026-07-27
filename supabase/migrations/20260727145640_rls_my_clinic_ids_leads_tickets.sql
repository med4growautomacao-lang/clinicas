-- RLS de leads e tickets: régua de tenancy resolvida UMA VEZ por query, não por linha.
-- PILOTO deliberado em 2 tabelas (as do Kanban). As outras ~27 policies seguem como estão.
--
-- SINTOMA (produção, 27/07): `TICKETS_FETCH_FAIL` na Central com
-- `canceling statement due to statement timeout`, 13 ocorrências, em Metaltres (3.561 tickets) e
-- Clínica São Lucas (2.465). O board voltava vazio/velho para o usuário.
--
-- MEDIDO na 1ª página do Kanban da Metaltres (equivalente ao `useTickets`, com o embed `leads(*)`):
--   com a RLS atual .................... 2.548 ms
--   mesma query sem RLS (piso) .........    77 ms   -> a RLS respondia por 2.471 ms (33x)
--   régua nova, executada 1x por query ..   3,5 ms
--
-- POR QUE ERA CARO: as policies chamavam `is_clinic_active(clinic_id)` / `is_clinic_admin(clinic_id)`
-- passando a COLUNA. Função com argumento dependente da linha não pode virar InitPlan, então rodava
-- uma vez POR LINHA. Em `leads` isso ainda era DOBRADO, porque havia duas policies PERMISSIVE OR'd
-- (`leads_all` + `leads_org_access`) repetindo o par de funções. `tickets` tinha só `tickets_all`,
-- então nele o ganho vem apenas de sair do por-linha, não da desduplicação.
--
-- AGRAVANTE que fez isso estourar em clínica média: o embed `lead:leads(*)` do PostgREST não propaga
-- o filtro de `clinic_id` para o lado de `leads`, então a RLS de leads era avaliada nas **32.151
-- linhas do banco inteiro** (`Rows Removed by Filter: 28595`), não nas 3,5k da clínica. O custo é
-- GLOBAL: cresce com o banco e atinge toda clínica, o que explica Metaltres estourar sendo menor
-- que a Intubação.
--
-- �s�️ Uma hipótese que MEDI E DESCARTEI, para ninguém repetir: passar `is_clinic_active` de plpgsql
-- para `language sql` rende 180 ms -> 168 ms (7%) em 8.236 chamadas. O custo não é a linguagem, é
-- tocar clinics/organizations uma vez por linha. Só resolve não chamando por linha.
--
-- EQUIVAL�SNCIA DE VISIBILIDADE (o que autoriza mexer aqui): a expressão da policy atual e a régua
-- nova foram comparadas em TODOS os 1.768 pares usuário x clínica (52 usuários x 34 clínicas):
--   visíveis hoje 219 | visíveis depois 219 | ganharia acesso indevido 0 | perderia acesso 0
--
-- Backend não é afetado: `service_role` e `postgres` têm rolbypassrls, então edge functions e
-- pg_cron nunca passam por policy nenhuma.
--
-- `assistant_ro_read` (role assistant_ro, por `app.clinic_id`) fica INTACTA. Como as policies são
-- PERMISSIVE (OR), o assistente segue lendo pelo caminho dele, igual a hoje.
--
-- ORDEM DAS OPERA�?�.ES: a policy nova é criada ANTES de derrubar as antigas. Sendo todas PERMISSIVE
-- e equivalentes, conviver por um instante é inócuo, e assim não existe janela em que a tabela fique
-- sem policy permissiva (o que trancaria authenticated para fora) caso isto rode fora de transação.
--
-- ROLLBACK (restaura o estado exato de antes):
--   drop policy leads_access on public.leads;
--   create policy leads_all on public.leads for all to public using (
--     ((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid())))
--       AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id));
--   create policy leads_org_access on public.leads for all to public using (
--     ((clinic_id IN (SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id)))
--       WHERE (ou.user_id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id));
--   drop policy tickets_access on public.tickets;
--   create policy tickets_all on public.tickets for all to public using (
--     ((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid())))
--       AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id));
--   drop function public.my_clinic_ids();   -- <- não esquecer: sem isto a função fica órfã,
--                                           --    concedida a anon/authenticated, apontando num
--                                           --    comentário para uma migration já revertida.

-- 1. A régua, SEM ARGUMENTO -----------------------------------------------------
-- Sem parâmetro dependente de linha, o planner materializa o conjunto uma vez (hashed SubPlan) e o
-- teste por linha vira lookup de hash. �? essa ausência de argumento que dá o ganho, não o conteúdo.
-- Semântica: cópia fiel do OR das duas policies que ela substitui.
--   * vínculo direto em clinic_users -> exige clínica ativa (e organização ativa, quando houver)
--   * membro da organização dona     -> não exige, igual ao `OR is_clinic_admin(clinic_id)` de antes
--   * super-admin                    -> tudo
create or replace function public.my_clinic_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id
  from public.clinics c
  left join public.organizations o on o.id = c.organization_id
  where (
      ( exists (select 1 from public.clinic_users cu
                 where cu.id = auth.uid() and cu.clinic_id = c.id)
        and c.is_active and (o.id is null or o.is_active) )
      or exists (select 1 from public.org_users ou
                  where ou.user_id = auth.uid() and ou.organization_id = c.organization_id)
      or exists (select 1 from public.clinic_users su
                  where su.id = auth.uid() and su.role = 'super-admin')
  );
$function$;

comment on function public.my_clinic_ids() is
  'Conjunto de clinic_ids visíveis ao usuário do JWT. SEM ARGUMENTO de propósito: é o que permite ao planner resolver uma vez por query em vez de por linha (ver migration 20260727145640). Usar em policy como: clinic_id in (select public.my_clinic_ids()).';

-- anon/authenticated precisam de EXECUTE: a policy é avaliada no papel deles, e sem grant a
-- avaliação erraria por permissão em vez de simplesmente não casar. Para anon, auth.uid() é null e
-- o retorno é vazio.
grant execute on function public.my_clinic_ids() to anon, authenticated, service_role;

-- 2. leads ----------------------------------------------------------------------
create policy leads_access on public.leads
  for all to public
  using (clinic_id in (select public.my_clinic_ids()));

drop policy leads_all on public.leads;
drop policy leads_org_access on public.leads;

-- 3. tickets --------------------------------------------------------------------
create policy tickets_access on public.tickets
  for all to public
  using (clinic_id in (select public.my_clinic_ids()));

drop policy tickets_all on public.tickets;
