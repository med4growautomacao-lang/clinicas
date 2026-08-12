-- 20260723205111_20260723193500_emissor_check_conteudo_so_pre_envio
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- A regra "tem corpo OU tem midia" so faz sentido ENQUANTO a mensagem esta para enviar. Depois de
-- entregue, o mark_outbound_sent solta o base64 (bounded storage), e a linha terminal fica sem
-- conteudo DE PROPOSITO. Sem esta correcao, zerar o base64 de um audio (sem media_url) violaria o
-- check. Exime os estados terminais.

alter table public.outbound_messages drop constraint if exists outbound_body_ou_midia;

alter table public.outbound_messages add constraint outbound_body_ou_midia check (
  status in ('sent','simulated','dropped','failed')          -- terminal: conteudo pode ter sido liberado
  or (kind = 'text'  and coalesce(btrim(body), '') <> '')
  or (kind <> 'text' and (media_url is not null or media_base64 is not null))
);
