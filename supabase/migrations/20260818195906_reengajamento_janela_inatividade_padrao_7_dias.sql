-- Janela de inatividade do reengajamento (`ai_config.followup_max_idle_days`) passa a ser editável
-- na tela, ao lado da janela de horário. É o filtro que mais corta público: medido na Metaltres,
-- 877 dos 1.298 contatos da coluna "Contato via WhatsApp" ficam de fora só por ele.
--
-- Padronização pedida pelo dono: 7 dias para todos. As 35 clínicas já estavam em 7 (conferido
-- antes de aplicar), então isto não muda o comportamento de ninguém — fixa o padrão para quem
-- vier depois e para qualquer linha que tenha ficado nula.
update public.ai_config
   set followup_max_idle_days = 7
 where followup_max_idle_days is null or followup_max_idle_days <> 7;

alter table public.ai_config alter column followup_max_idle_days set default 7;

comment on column public.ai_config.followup_max_idle_days is
  'Reengajamento: até quantos dias de silêncio o contato continua na régua. Passado esse prazo ele sai do público e não recebe mais nada. Padrão 7. Editável em Configurações IA › Follow-ups, ao lado da janela de horário. Aumentar traz backlog inteiro de uma vez: insistir com quem sumiu há meses é o que gera bloqueio e denúncia (incidente do WhatsApp da Clínica Vaz, 13/07/2026).';
