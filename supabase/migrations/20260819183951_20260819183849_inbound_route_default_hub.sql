-- Clínica nova nascia com inbound_route='n8n' e o orquestrador ainda decide o webhook
-- de 'messages' por essa coluna a cada conexão: instância nova era apontada para o
-- endpoint morto do n8n e as mensagens dos pacientes se perdiam em silêncio
-- (caso Ana Flávia, conectada 13/08 e muda até 19/08/2026).
-- 'hub' = rota nativa (wa-inbound), a mesma das 19 instâncias em operação.
alter table public.whatsapp_instances alter column inbound_route set default 'hub';
