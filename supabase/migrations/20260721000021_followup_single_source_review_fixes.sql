-- Janela de envio do pós-atendimento: colunas de configuração (default 8h-20h, horário de SP).
--
-- ⚠️ ESTE ARQUIVO SÓ CRIA AS COLUNAS. As funções que ele continha (fn_clinic_can_send,
-- fn_followup_candidates_*, preview) foram integralmente substituídas pela migration
-- 20260721000022_followup_single_source_v2, que é a definição canônica. As colunas ficam aqui
-- porque a 022 as LÊ e precisa que já existam.
--
-- Antes destas colunas a janela do pós era hardcoded 8-20 em dois lugares (motor e preview), sem
-- nenhum controle na tela, ao contrário das outras três janelas.

alter table public.ai_config
  add column if not exists pos_followup_window_start int not null default 8,
  add column if not exists pos_followup_window_end   int not null default 20;
