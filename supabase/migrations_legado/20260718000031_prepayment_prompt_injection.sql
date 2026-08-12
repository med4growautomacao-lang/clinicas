-- Pagamento antecipado — injeção no PROMPT (prompt-driven; a IA decide, guiada por instrução).
-- Quando payment_enabled, a view v_clinic_ai_prompt anexa um bloco "PAGAMENTO ANTECIPADO"
-- ao combined_prompt (que o Agente IA já lê). E list_consultation_types marca no description
-- quais tipos exigem pré-pagamento + o valor, pra IA saber o que cobrar.

alter table public.ai_config
  add column if not exists payment_ai_instructions text;
comment on column public.ai_config.payment_ai_instructions is
  'Instrução (prompt) injetada no prompt da clínica quando payment_enabled: regra de quando/como cobrar e conferir o comprovante.';

-- View do prompt combinado + bloco de pagamento (só quando ativo)
create or replace view public.v_clinic_ai_prompt
with (security_invoker = true) as
  select ac.clinic_id,
    ac.prompt_template_id as template_id,
    pt.name as template_name,
    pt.focus as template_focus,
    pt.content as template_content,
    ac.prompt as company_prompt,
    (
      trim(both E'\n' from (
        coalesce(nullif(pt.content, ''), '') ||
        case when nullif(pt.content, '') is not null and nullif(ac.prompt, '') is not null
             then E'\n\n---\n\n' else '' end ||
        coalesce(nullif(ac.prompt, ''), '')
      ))
      || case when ac.payment_enabled then
           E'\n\n---\n\n## PAGAMENTO ANTECIPADO\n'
           || coalesce(nullif(ac.payment_ai_instructions, ''),
                'Alguns tipos de consulta exigem pagamento antecipado. Nesses casos, envie os dados de pagamento abaixo e só marque a consulta (MARCAR_HORARIO) DEPOIS de receber o comprovante e conferir que o VALOR e os DADOS BANCÁRIOS batem. Se não bater, acione o atendimento humano (ACIONAR_HANDOFF).')
           || E'\n\nDados de pagamento para enviar ao paciente:'
           || coalesce(E'\n- Chave PIX: '   || nullif(ac.payment_pix_key, ''),  '')
           || coalesce(E'\n- Titular: '     || nullif(ac.payment_pix_name, ''), '')
           || coalesce(E'\n- Banco: '       || nullif(ac.payment_pix_bank, ''), '')
           || coalesce(E'\n- QR Code (imagem): ' || nullif(ac.payment_qr_url, ''), '')
           || coalesce(E'\n- Link de cartão: '   || nullif(ac.payment_card_link, ''), '')
           || E'\n\nOs valores por tipo de consulta aparecem em LISTAR_TIPOS_CONSULTA (tipos marcados como PRÉ-PAGAMENTO OBRIGATÓRIO).'
         else '' end
    ) as combined_prompt
   from ai_config ac
     left join prompt_templates pt on pt.id = ac.prompt_template_id;

-- LISTAR_TIPOS_CONSULTA: marca pré-pagamento + valor no description (a IA já recebe o description)
create or replace function public.list_consultation_types(p_clinic_id uuid, p_doctor_id uuid default null::uuid)
 returns table(id uuid, doctor_id uuid, doctor_name text, slug text, name text, modality text, description text, consultation_duration integer, is_active boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select ct.id, ct.doctor_id, d.name as doctor_name, ct.slug, ct.name,
         ct.modality,
         coalesce(nullif(ct.description, ''), '')
           || case when ct.requires_prepayment
                   then ' [PRÉ-PAGAMENTO OBRIGATÓRIO'
                        || coalesce(': R$ ' || trim(to_char(ct.prepayment_amount, 'FM999999990D00')), '')
                        || ' — só agende após comprovante válido]'
                   else '' end as description,
         ct.consultation_duration, ct.is_active
  from consultation_types ct
  join doctors d on d.id = ct.doctor_id
  where ct.clinic_id = p_clinic_id
    and (p_doctor_id is null or ct.doctor_id = p_doctor_id)
    and ct.is_active = true
  order by d.name, ct.name;
$function$;
