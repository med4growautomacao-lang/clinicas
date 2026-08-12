-- 20260707172501_clinic_quote_show_total
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Chave por clínica: mostrar/enviar o valor da SOMA TOTAL no orçamento (documento + mensagem
-- WhatsApp + resumo do modal). Default true (comportamento atual). Off = some o total geral;
-- os valores por item continuam aparecendo.
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS quote_show_total boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN clinics.quote_show_total IS 'Mostra/envia o valor total da soma no orçamento (doc + msg + modal). Off = oculta o total geral; itens seguem com valor.';
