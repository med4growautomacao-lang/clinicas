-- Devolve etapas de sistema que sumiram de alguns funis, porém OCULTAS (is_hidden).
--
-- Contexto: auditoria de 21/07 achou 12 clínicas sem alguma etapa de sistema. A causa era o banco
-- nunca ter impedido DELETE de etapa is_system (corrigido em 20260721000021 com
-- tr_block_system_stage_delete). Na maioria a ausência é deliberada (clínicas category='outro',
-- café, joalheria, imports, não têm "Compareceu"/"Faltou/Cancelou" porque ali não existe consulta).
--
-- O dono escolheu restaurar só estes casos, e ocultas: o funil volta a ficar íntegro para o motor e
-- para os relatórios, sem poluir o quadro de quem não usa a etapa. Exibir é um clique no olho.
--
-- Reparo pontual de dados: as clínicas vão por ID, não por nome. Nome de clínica é texto livre que
-- o próprio cliente edita, e se um deles renomear antes desta migration rodar noutro ambiente o
-- filtro viraria no-op silencioso. Em base nova nenhum destes ids existe e tudo aqui é no-op, que é
-- o correto: lá o handle_new_clinic já semeia o funil completo.

begin;

-- 'Compareceu' entra logo ANTES de 'Ganho' (a ordem do seed é Agendado, Compareceu, Ganho).
-- Ancorado na posição do 'ganho' de cada clínica porque os funis divergem: Vaz tinha Ganho em 5,
-- Dente Forma em 6, MedDesk Demo em 4. Não há unique em (clinic_id, position), então o
-- deslocamento +1 é seguro em lote.
with alvo as (
  select c.id as clinic_id,
         (select fs.position from funnel_stages fs
           where fs.clinic_id = c.id and fs.slug = 'ganho' limit 1) as pos_ganho
  from clinics c
  where c.id in (
      '2c9c4e85-df66-41f6-b345-8b7ec94f0605',  -- Clínica Vaz
      '9d98d508-33c4-4b6c-ba9b-cc1ba54a610b',  -- Clínica MedDesk Demonstrativa
      '50b62ff3-e0d3-4449-8555-19fb019bc9a4',  -- Dente Forma
      'f99baa3e-7c9b-4040-af52-37e698f9db8e',  -- Gheller
      '550676fa-16d0-45db-adea-7617accaba13',  -- Marco Antonio
      'a04a78de-358b-4dcc-9d47-8f02d9a61ef2'   -- Tyago Venâncio
    )
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

-- Metaltres (metalúrgica, category='outro'): funil sem 'forms'. Mesma âncora dinâmica do bloco
-- acima, mirando a posição do 'whatsapp', porque no seed forms vem imediatamente antes dele.
-- Posição fixa aqui daria colisão se a clínica tivesse reordenado o funil.
with alvo as (
  select c.id as clinic_id,
         (select fs.position from funnel_stages fs
           where fs.clinic_id = c.id and fs.slug = 'whatsapp' limit 1) as pos_wpp
  from clinics c
  where c.id = '43575057-f20a-40a3-8805-200384d0b867'  -- Metaltres
    and not exists (select 1 from funnel_stages fs
                     where fs.clinic_id = c.id and fs.slug = 'forms')
),
abre_espaco as (
  update funnel_stages fs
     set position = fs.position + 1
    from alvo a
   where fs.clinic_id = a.clinic_id
     and a.pos_wpp is not null
     and fs.position >= a.pos_wpp
  returning 1
)
insert into funnel_stages (clinic_id, name, slug, position, color, is_system, is_hidden)
select a.clinic_id, 'Contato via Forms', 'forms', a.pos_wpp, 'bg-blue-500', true, true
from alvo a
where a.pos_wpp is not null;

commit;
