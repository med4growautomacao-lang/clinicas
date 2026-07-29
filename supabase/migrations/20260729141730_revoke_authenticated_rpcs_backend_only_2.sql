-- Fecha para `authenticated` as RPCs SECURITY DEFINER sem guard de tenant que o FRONT NÃO chama.
--
-- Contexto: o vetor `anon` foi fechado em 20260727163000. Sobrou o cross-tenant COM conta: um
-- usuário logado de uma clínica passa o `p_clinic_id` de outra e a função obedece, porque é DEFINER
-- (ignora RLS) e não confere nada.
--
-- Para estas sete, `revoke` é melhor que guard: ninguém legítimo as chama pelo navegador (grep em
-- src/ não acha uma única chamada), só edge/cron com service_role. Guard aqui seria código a mais
-- protegendo um caminho que não deveria sequer existir.
--
--   register_conversion              lança receita/conversão em qualquer clínica
--   notify_ops                       dispara notificação em qualquer clínica
--   fn_resolve_patient_lead_ticket   resolve/cria paciente+lead+ticket
--   fn_onboarding_disable_followups  desliga follow-up de qualquer clínica
--   list_consultation_types          lista tipos de consulta (usada pela tool da IA)
--   match_stage_rule                 casa regra de etapa
--   site_ingest_click                ingestão de clique do site (edge site-tracking)
--
-- `site_ingest_click` já tinha o revoke de anon desde 20260714000013; entra aqui só pelo
-- `authenticated`, que havia sobrado.
--
-- NÃO estão aqui, de propósito:
--   * is_clinic_active / fn_emissor_ativo -> helpers lidos de dentro de policy e de trigger.
--     Sem EXECUTE, a avaliação erra com "permission denied" e derruba a leitura da tabela.
--   * book_appointment, convert_lead_to_appointment e os onboarding_* -> o front CHAMA. Nessas o
--     conserto é guard (assert_clinic_access), não revoke, e está anotado como pendência:
--     book_appointment é a função mais crítica do sistema (§1 do CLAUDE.md) e merece uma alteração
--     dedicada, com teste de agendamento real, não uma no fim de uma sessão longa.

revoke all on function public.register_conversion(uuid, uuid, numeric, text, text, text, uuid[], timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.register_conversion(uuid, uuid, numeric, text, text, text, uuid[], timestamptz, uuid) to service_role;

revoke all on function public.notify_ops(uuid, text, text, text, text, uuid, uuid, uuid, text, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.notify_ops(uuid, text, text, text, text, uuid, uuid, uuid, text, jsonb, boolean, text) to service_role;

revoke all on function public.fn_resolve_patient_lead_ticket(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_resolve_patient_lead_ticket(uuid, uuid, uuid, text, text) to service_role;

revoke all on function public.fn_onboarding_disable_followups(uuid) from public, anon, authenticated;
grant execute on function public.fn_onboarding_disable_followups(uuid) to service_role;

revoke all on function public.list_consultation_types(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_consultation_types(uuid, uuid) to service_role;

revoke all on function public.match_stage_rule(uuid, text) from public, anon, authenticated;
grant execute on function public.match_stage_rule(uuid, text) to service_role;

revoke all on function public.site_ingest_click(uuid, text, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.site_ingest_click(uuid, text, text, text, text, text, text, text, text, text, jsonb) to service_role;
