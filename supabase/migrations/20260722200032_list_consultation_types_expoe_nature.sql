-- Expoe nature/return_window_days para o agente.
--
-- Sem isso a flag criada na migration anterior fica so na tela: o agente continua escolhendo o
-- modelo por semelhanca de texto na description, que e exatamente o mecanismo que errou 3 dos 10
-- agendamentos da Lorena (maio/2026, todos paciente novo marcado como "Seguimento").
--
-- RETURNS TABLE e fixo, entao exige DROP + CREATE. So a edge ai-scheduler consome esta RPC
-- (conferido no repo), nao ha chamada no frontend.
drop function if exists public.list_consultation_types(uuid, uuid);

create function public.list_consultation_types(p_clinic_id uuid, p_doctor_id uuid default null::uuid)
returns table(
  id uuid, doctor_id uuid, doctor_name text, slug text, name text, modality text,
  description text, consultation_duration integer, is_active boolean,
  nature text, return_window_days integer
)
language sql
stable
security definer
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
         ct.consultation_duration, ct.is_active,
         ct.nature, ct.return_window_days
  from consultation_types ct
  join doctors d on d.id = ct.doctor_id
  where ct.clinic_id = p_clinic_id
    and (p_doctor_id is null or ct.doctor_id = p_doctor_id)
    and ct.is_active = true
  order by d.name, ct.name;
$function$;
