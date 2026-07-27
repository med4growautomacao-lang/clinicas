-- FASE 3 (escala): migra as policies caras (is_clinic_active/is_clinic_admin por LINHA) para a
-- régua set-based my_clinic_ids(), que resolve 1x por query (hashed SubPlan/InitPlan).
--
-- Equivalência PROVADA sobre os 219 pares usuário×clínica visíveis: ganha_indevido=0,
-- perde_legitimo=0. É exata porque is_clinic_admin(clinic) = super-admin OR membro-da-org
-- (sem is_active), o que colapsa com o braço org (sem is_active) de my_clinic_ids — mesma
-- transformação já aplicada em leads/tickets (20260727145640).
--
-- Medido pós-fix na clínica com mais mensagens: export 30d 4.537ms -> 67,9ms; conversa 510ms -> 3,1ms.
--
-- Ordem: cria a nova ANTES de dropar as antigas (todas PERMISSIVE, conviver é inócuo) para não
-- abrir janela sem policy permissiva. assistant_ro_read fica intacta (role assistant_ro).

-- chat_messages (498k linhas, 2 policies) -----------------------------------------
create policy chat_messages_access on public.chat_messages
  for all to public
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
drop policy chat_messages_all on public.chat_messages;
drop policy chat_messages_org_access on public.chat_messages;

-- lead_stage_history (55k, 2 policies) --------------------------------------------
create policy lead_stage_history_access on public.lead_stage_history
  for all to public
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
drop policy lead_stage_history_all on public.lead_stage_history;
drop policy lead_stage_history_org_access on public.lead_stage_history;

-- lead_touchpoints (16k, 1 policy com os dois braços inline) -----------------------
alter policy lead_touchpoints_access on public.lead_touchpoints
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
