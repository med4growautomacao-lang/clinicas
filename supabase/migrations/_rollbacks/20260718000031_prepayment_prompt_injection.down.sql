-- Rollback de 20260718000031_prepayment_prompt_injection.sql
create or replace view public.v_clinic_ai_prompt
with (security_invoker = true) as
  select ac.clinic_id,
    ac.prompt_template_id as template_id,
    pt.name as template_name,
    pt.focus as template_focus,
    pt.content as template_content,
    ac.prompt as company_prompt,
    trim(both E'\n' from (
      coalesce(nullif(pt.content, ''), '') ||
      case when nullif(pt.content, '') is not null and nullif(ac.prompt, '') is not null
           then E'\n\n---\n\n' else '' end ||
      coalesce(nullif(ac.prompt, ''), '')
    )) as combined_prompt
   from ai_config ac
     left join prompt_templates pt on pt.id = ac.prompt_template_id;

create or replace function public.list_consultation_types(p_clinic_id uuid, p_doctor_id uuid default null::uuid)
 returns table(id uuid, doctor_id uuid, doctor_name text, slug text, name text, modality text, description text, consultation_duration integer, is_active boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  select ct.id, ct.doctor_id, d.name as doctor_name, ct.slug, ct.name,
         ct.modality, ct.description, ct.consultation_duration, ct.is_active
  from consultation_types ct
  join doctors d on d.id = ct.doctor_id
  where ct.clinic_id = p_clinic_id
    and (p_doctor_id is null or ct.doctor_id = p_doctor_id)
    and ct.is_active = true
  order by d.name, ct.name;
$function$;

alter table public.ai_config drop column if exists payment_ai_instructions;
