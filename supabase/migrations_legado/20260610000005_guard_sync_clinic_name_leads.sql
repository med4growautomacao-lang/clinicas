-- Guard em sync_clinic_name_to_leads: só propaga o nome para os leads quando ele
-- realmente mudou. Mesmo padrão de sync_clinic_name_to_instance / _chat_messages.
-- Importante aqui porque `leads` é grande (15k+) — evita UPDATE em massa quando a
-- clínica é salva sem trocar o nome.

CREATE OR REPLACE FUNCTION public.sync_clinic_name_to_leads()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE leads SET clinic_name = NEW.name WHERE clinic_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
