-- 20260721231825_restore_missing_system_stages_hidden
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

with alvo as (
  select c.id as clinic_id,
         (select fs.position from funnel_stages fs
           where fs.clinic_id = c.id and fs.slug = 'ganho' limit 1) as pos_ganho
  from clinics c
  where c.name in ('Clínica Vaz','Clínica MedDesk Demonstrativa','Dente Forma',
                   'Gheller','Marco Antonio','Tyago Venâncio')
    and not exists (select 1 from funnel_stages fs
                     where fs.clinic_id = c.id and fs.slug = 'compareceu')
),
abre_espaco as (
  update funnel_stages fs
     set position = fs.position + 1
    from alvo a
   where fs.clinic_id = a.clinic_id
     and a.pos_ganho is not null
     and fs.position >= a.pos_ganho
  returning 1
)
insert into funnel_stages (clinic_id, name, slug, position, color, is_system, is_hidden)
select a.clinic_id, 'Compareceu', 'compareceu', a.pos_ganho, 'bg-indigo-500', false, true
from alvo a
where a.pos_ganho is not null;

insert into funnel_stages (clinic_id, name, slug, position, color, is_system, is_hidden)
select c.id, 'Contato via Forms', 'forms', 1, 'bg-blue-500', true, true
from clinics c
where c.name = 'Metaltres'
  and not exists (select 1 from funnel_stages fs where fs.clinic_id = c.id and fs.slug = 'forms');

commit;
