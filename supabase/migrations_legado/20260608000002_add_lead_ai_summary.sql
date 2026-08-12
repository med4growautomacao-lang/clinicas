-- Resumo persistente (perfil) do lead, gerado/atualizado pela IA.
-- Texto livre, injetado como contexto da IA. Vive no lead (persiste entre tickets),
-- separado de tickets.summary (resumo por jornada) e de notes (não usado).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ai_summary text;

COMMENT ON COLUMN public.leads.ai_summary IS
  'Resumo persistente (perfil) do lead, gerado/atualizado pela IA. Texto livre injetado no contexto da IA.';
