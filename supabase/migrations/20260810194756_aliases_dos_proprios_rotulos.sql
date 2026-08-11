-- O catálogo precisa reconhecer os PRÓPRIOS rótulos que ele manda gravar.
--
-- A partir da Fase 5, a IA passa a escrever em tickets.loss_reason o rótulo do motivo escolhido
-- ("Não fazemos o que ele procura") em vez do antigo literal "Fora do perfil". A ai-scheduler já
-- manda o slug explícito, então o dado nasce certo por ali. Mas qualquer OUTRO caminho que grave
-- esse mesmo texto sem slug (equipe digitando, reprocessamento, importação, CRM copiando o rótulo)
-- cairia em fn_resolve_loss_reason sem tradução e acenderia motivo_perda_sem_catalogo à toa.
--
-- Alias reflexivo: rótulo -> o próprio slug. Cobre as três variantes (neutro, MedDesk, WakeDesk),
-- e a chave normalizada resolve acento e caixa de graça.

insert into public.loss_reason_aliases (alias_norm, slug, origem, exemplo)
select public.normalize_stage_text(v.texto), v.slug, 'manual', v.texto
from (
  select slug, label          as texto from public.loss_reasons where label is not null
  union
  select slug, label_clinica  as texto from public.loss_reasons where label_clinica is not null
  union
  select slug, label_outro    as texto from public.loss_reasons where label_outro is not null
) v
on conflict (alias_norm) do nothing;

