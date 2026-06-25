-- No máximo 1 passo de encerramento (is_closing) por clínica. A UI também é exclusiva (ligar
-- o encerramento num passo desliga dos outros), mas o índice garante no banco.
create unique index if not exists uq_followup_steps_one_closing
  on public.followup_steps (clinic_id)
  where is_closing;
