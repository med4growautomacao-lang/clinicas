-- Natureza do modelo de consulta: PRIMEIRA x RETORNO (cortesia) x SEGUIMENTO (nova consulta paga).
--
-- Ate agora essa distincao vivia em dois lugares que nao sao chave:
--   1. no `name` (Lorena: "Primeira Online" / "Seguimento Online") -- mas 3 das 6 clinicas nomeiam
--      os tipos so por MODALIDADE ("Presencial" x3, um por medico, ja que doctor_id e NOT NULL),
--      e nelas a natureza era simplesmente indeterminavel;
--   2. na `description` em prosa (Tyago: "so pode ofertar para quem consultou em menos de um mes").
-- Nome e description sao texto livre digitado pela clinica. Mesmo problema do slug: nao servem
-- como chave do motor.
--
-- RETORNO nao e sinonimo de SEGUIMENTO (decisao do dono, 22/07):
--   retorno    = cortesia, gratuita, vinculada a uma consulta anterior e com prazo;
--   seguimento = consulta NOVA paga, de paciente que ja se consultou antes.
-- Sao slots comerciais diferentes, por isso valores diferentes.
--
-- NULL = "serve para qualquer natureza". E o default DE PROPOSITO: preserva o comportamento atual
-- de quem nunca classificou (Vaz, MedDesk Demonstrativa, Med4Grow). Marcar todo mundo como
-- 'primeira' quebraria essas clinicas no dia do deploy.
alter table public.consultation_types add column if not exists nature text;

alter table public.consultation_types drop constraint if exists consultation_types_nature_check;
alter table public.consultation_types add constraint consultation_types_nature_check
  check (nature is null or nature in ('primeira', 'retorno', 'seguimento'));

comment on column public.consultation_types.nature is
  'Natureza do modelo: primeira | retorno (cortesia gratuita, ver return_window_days) | seguimento (nova consulta paga). NULL = serve para qualquer natureza (nao classificado).';

-- Janela do retorno de cortesia, em dias, contada a partir da consulta anterior.
-- Hoje esse numero existe so em texto: Lorena = 15 dias (no ai_config.prompt, secao
-- politica_de_retorno_sem_custo) e Tyago = 30 dias (na description do tipo).
alter table public.consultation_types add column if not exists return_window_days integer;

alter table public.consultation_types drop constraint if exists consultation_types_return_window_check;
alter table public.consultation_types add constraint consultation_types_return_window_check
  check (return_window_days is null or (return_window_days > 0 and return_window_days <= 365));

comment on column public.consultation_types.return_window_days is
  'Prazo do retorno de cortesia em dias, contado da consulta anterior. So se aplica quando nature = retorno.';

-- Janela so faz sentido em retorno: evita que uma clinica preencha o prazo num tipo 'primeira'
-- e depois se pergunte por que ele nao surte efeito.
alter table public.consultation_types drop constraint if exists consultation_types_return_window_so_em_retorno;
alter table public.consultation_types add constraint consultation_types_return_window_so_em_retorno
  check (return_window_days is null or nature = 'retorno');

create index if not exists idx_consultation_types_clinic_nature
  on public.consultation_types (clinic_id, nature) where nature is not null;
