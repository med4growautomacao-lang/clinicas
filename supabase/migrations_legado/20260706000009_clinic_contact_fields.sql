-- Contatos da clínica exibidos no cabeçalho do orçamento (telefone já existe).
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS email     text,
  ADD COLUMN IF NOT EXISTS instagram text;
