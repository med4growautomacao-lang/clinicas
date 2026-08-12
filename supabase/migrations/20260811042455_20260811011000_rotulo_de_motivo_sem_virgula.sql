-- 20260811042455_20260811011000_rotulo_de_motivo_sem_virgula
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Rótulo de motivo NÃO pode ter vírgula, pelo mesmo motivo que o slug não pode.
--
-- O slug já era protegido por CHECK, com o comentário certo ("o filtro do Comercial faz
-- string_to_array(p_loss_reasons, ',')"), mas quem viaja no filtro é o RÓTULO: o painel devolve
-- `reason` = rótulo, o chip guarda esse texto e o front manda de volta com `join(",")`. Dois dos 14
-- rótulos do seed tinham vírgula, e o filtro se partia antes de chegar ao banco.
--
-- Medido: clicar o chip "Perfil não atendido (idade, condição)" (534 perdas na Intubação) devolvia
-- lost = 0 no painel E na lista de leads. O gestor lê isso como "não teve perda no período".
-- Atingia 581 tickets em 11 clínicas, no 2º motivo mais frequente do sistema.
--
-- É REGRESSÃO desta feature: nenhum texto cru de tickets.loss_reason tinha vírgula, então o filtro
-- antigo funcionava. Corrigir o rótulo resolve para todo mundo AGORA, sem depender de publicar o
-- site; o front mandando slug em vez de rótulo é melhoria complementar, não pré-requisito.

update public.loss_reasons
   set label = 'Perfil não atendido (idade ou condição)'
 where slug = 'perfil_nao_atendido';

update public.loss_reasons
   set label = 'Contato indevido (robô/engano/fornecedor)'
 where slug = 'contato_indevido';

-- A trava, para não voltar: mesma régua do slug, agora nas três colunas de rótulo.
alter table public.loss_reasons
  add constraint loss_reasons_label_sem_virgula
  check (
    label         not like '%,%'
    and coalesce(label_clinica, '') not like '%,%'
    and coalesce(label_outro,   '') not like '%,%'
  );

alter table public.clinic_loss_reasons
  add constraint clinic_loss_reasons_label_sem_virgula
  check (coalesce(label_custom, '') not like '%,%');

comment on constraint loss_reasons_label_sem_virgula on public.loss_reasons is
  'Vírgula no rótulo parte o filtro do Comercial (string_to_array por vírgula) e o painel devolve zero, que o usuário lê como ausência de perda.';

-- Os aliases reflexivos apontavam para os rótulos antigos; recria para os novos textos.
insert into public.loss_reason_aliases (alias_norm, slug, origem, exemplo)
select public.normalize_stage_text(v.texto), v.slug, 'manual', v.texto
from (
  select slug, label         as texto from public.loss_reasons where label is not null
  union
  select slug, label_clinica as texto from public.loss_reasons where label_clinica is not null
  union
  select slug, label_outro   as texto from public.loss_reasons where label_outro is not null
) v
on conflict (alias_norm) do nothing;
