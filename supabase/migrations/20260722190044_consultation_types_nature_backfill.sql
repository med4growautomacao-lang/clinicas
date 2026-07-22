-- Backfill APENAS onde o nome/description e inequivoco. Chutar natureza para quem nomeia
-- so por modalidade seria inventar regra de negocio: Vaz, MedDesk Demonstrativa e Med4Grow
-- ficam NULL de proposito, ate a clinica classificar na tela.

-- Lorena Barros: unica que ja codificava a natureza no titulo.
update public.consultation_types
   set nature = 'primeira'
 where clinic_id = '7f030e9a-7209-47d4-8130-78c013f808ca'
   and name in ('Primeira Online', 'Primeira Presencial')
   and nature is null;

-- "Seguimento" na Lorena e consulta nova PAGA (nao e o retorno de cortesia de 15 dias, que ela
-- descreve no prompt mas nunca chegou a cadastrar como modelo).
update public.consultation_types
   set nature = 'seguimento'
 where clinic_id = '7f030e9a-7209-47d4-8130-78c013f808ca'
   and name in ('Seguimento Online', 'Seguimento Presencial')
   and nature is null;

-- Tyago Venancio: a janela estava escrita na description ("menos de um mes").
update public.consultation_types
   set nature = 'retorno',
       return_window_days = 30
 where clinic_id = (select id from public.clinics where name = 'Tyago Venâncio')
   and name = 'Consulta de Retorno'
   and nature is null;
