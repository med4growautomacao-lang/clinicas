-- session_id: chave de sessão da IA (n8n) associada ao lead, usada como chave de
-- memória da conversa. Texto (n8n usa session keys como string — pode ser phone,
-- uuid, etc.). Índice parcial porque a maioria dos leads não terá sessão.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS session_id text;

CREATE INDEX IF NOT EXISTS idx_leads_session_id
  ON public.leads (session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.leads.session_id IS
  'ID de sessão da IA (n8n) associado ao lead, usado como chave de memória da conversa.';
