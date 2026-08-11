-- Seed do catálogo (14 motivos + 2 de sistema) e o de-para dos 30 textos que existem hoje
-- em tickets.loss_reason e leads.loss_reason.
--
-- Regra aplicada: só entra categoria com LASTRO no dado medido em 10/08/2026. Nenhuma inventada.
-- As `descricao` são o texto que a IA lê para escolher — carregam a REGRA DE DESEMPATE, porque
-- 8 dos 44 encerramentos reais da IA são ambíguos entre dois motivos ("paciente de 10 anos E não
-- oferece urologia pediátrica" cabe em perfil e em serviço ao mesmo tempo).

insert into public.loss_reasons
  (slug, label, label_clinica, label_outro, descricao, position, ia_pode_escolher, categorias, is_system)
values
  -- ---------------- estruturais: a perda é definitiva
  ('servico_nao_oferecido',
   'Não fazemos o que ele procura', null, null,
   'O serviço, produto ou procedimento pedido não é oferecido pela empresa a NINGUÉM. Se a empresa oferece, mas não para essa pessoa, use perfil_nao_atendido. Se oferece em outro lugar, use atendido_em_outra_unidade.',
   10, true, array['clinica','outro','meta_tester'], false),

  ('atendido_em_outra_unidade',
   'Atendido em outra unidade ou por outro profissional', null, null,
   'A empresa OFERECE o que ele procura, mas em outra unidade, filial ou com um profissional que não atende aqui. Não é "não fazemos": o serviço existe e dá dinheiro.',
   20, true, array['clinica','outro','meta_tester'], false),

  ('perfil_nao_atendido',
   'Perfil não atendido (idade, condição)', null, null,
   'A empresa oferece o serviço, mas não para ESSA pessoa: idade fora da faixa atendida, condição clínica que a casa não trata, porte incompatível. Se o serviço não existe para ninguém, use servico_nao_oferecido.',
   30, true, array['clinica','outro','meta_tester'], false),

  ('convenio_pagamento_nao_aceito',
   'Só aceita pagamento que não trabalhamos',
   'Quer convênio que não atendemos',
   'Só compra faturado ou consignado',
   'Ele só fecha por uma FORMA de pagamento que a empresa não trabalha (convênio/plano não credenciado, faturamento, consignado). Diferente de achou caro: aqui o valor não está em discussão.',
   40, true, array['clinica','outro','meta_tester'], false),

  ('fora_area_atendimento',
   'Fora da área de atendimento', null, null,
   'Mora ou precisa de entrega fora do raio que a empresa atende. Só use quando a área atendida estiver escrita no cadastro; sem isso, não deduza.',
   50, true, array['clinica','outro','meta_tester'], false),

  ('contato_indevido',
   'Contato indevido (robô, engano, fornecedor)', null, null,
   'Não é um cliente em potencial: mensagem automática de operadora, robô de outra empresa, representante comercial oferecendo produto, ou pessoa que escreveu por engano. Apenas registre: quem tira da lista de contatos é a equipe, não você.',
   60, true, array['clinica','outro','meta_tester'], false),

  -- ---------------- negociáveis: o contato pode voltar pelo follow-up
  ('preco_sem_orcamento',
   'Achou caro / sem orçamento', null, null,
   'Desistiu pelo VALOR: achou caro, não tem o dinheiro agora, não tem limite no cartão. Se o problema é a forma de pagamento e não o preço, use convenio_pagamento_nao_aceito.',
   70, true, array['clinica','outro','meta_tester'], false),

  ('sem_interesse',
   'Desistiu / sem interesse', null, null,
   'Disse claramente que não quer seguir, sem apontar preço, concorrente ou impedimento. É desistência declarada, não silêncio.',
   80, true, array['clinica','outro','meta_tester'], false),

  ('concorrente',
   'Fechou com concorrente', null, null,
   'Escolheu outra empresa, já resolveu em outro lugar ou avisou que vai fechar com alguém.',
   90, true, array['clinica','outro','meta_tester'], false),

  ('prazo_disponibilidade',
   'Prazo ou data não atendeu', null, null,
   'Precisava para uma data ou prazo que a empresa não consegue cumprir. É o tempo que inviabilizou, não o preço.',
   100, true, array['clinica','outro','meta_tester'], false),

  ('nao_e_decisor',
   'Não é quem decide', null, null,
   'Quem falou não decide a compra e o decisor não entrou na conversa.',
   110, true, array['clinica','outro','meta_tester'], false),

  -- ---------------- automação e equipe
  ('sem_resposta',
   'Parou de responder', null, null,
   'Sumiu no meio do atendimento e não voltou depois das tentativas de contato. NUNCA escolha este motivo durante uma conversa ativa: por definição ele só existe quando o contato está calado.',
   120, true, array['clinica','outro','meta_tester'], false),

  ('faltou_nao_retomou',
   'Faltou/cancelou e não retomou', null, null,
   'Tinha compromisso ou pedido marcado, faltou ou cancelou, e não voltou a remarcar.',
   130, true, array['clinica'], false),
  -- ^ só MedDesk: nasce de agenda, e agenda é zero no WakeDesk (§0.3). Lastro medido: 7/7 clinica.

  ('outro',
   'Outro (descreva)', null, null,
   'Use SÓ quando nenhum outro motivo servir, e sempre com o detalhe preenchido explicando o caso.',
   900, true, array['clinica','outro','meta_tester'], false),

  -- ---------------- sistema: fora do menu humano e fora do enum da IA
  ('descartado_onboarding',
   'Descartado na auditoria de importação', null, null,
   'Registro descartado durante a importação inicial do histórico. Não é perda comercial.',
   1000, false, array['clinica','outro','meta_tester'], true),

  ('importado_sem_desfecho',
   'Importado sem desfecho registrado', null, null,
   'Veio da importação de histórico sem informação de desfecho. Não é perda comercial.',
   1010, false, array['clinica','outro','meta_tester'], true)
on conflict (slug) do nothing;


-- ------------------------------------------------------------------ de-para
-- Chave normalizada (normalize_stage_text: sem acento, minúsculo, espaço colapsado), então
-- 'Preço alto' e 'Preco alto' caem na MESMA linha. É isso que mata a divergência dos dois
-- dropdowns do front sem precisar corrigir os dados antigos.

insert into public.loss_reason_aliases (alias_norm, slug, origem, exemplo)
select public.normalize_stage_text(t.texto), t.slug, t.origem, t.texto
from (values
  -- CRM externo (Clint / Intubação) — 76% do volume
  ('Tentativas esgotadas',                          'sem_resposta',                 'crm'),
  ('Sem perfil',                                    'perfil_nao_atendido',          'crm'),
  ('Sem dinheiro',                                  'preco_sem_orcamento',          'crm'),
  ('Sem interesse',                                 'sem_interesse',                'crm'),
  ('Não respondeu',                                 'sem_resposta',                 'crm'),
  ('Não é o tomador de decisão',                    'nao_e_decisor',                'crm'),
  ('Comprou com outra empresa',                     'concorrente',                  'crm'),
  ('Prazo de entrega',                              'prazo_disponibilidade',        'crm'),
  ('Outros motivos',                                'outro',                        'crm'),
  ('Motivo Indefinido',                             'outro',                        'crm'),
  ('Preço',                                         'preco_sem_orcamento',          'crm'),
  ('Upgrade não aceito',                            'outro',                        'crm'),
  -- ^ GG Imports, 1 caso, sentido não determinável sem ler a conversa.
  ('Venda Cancelada',                               'outro',                        'crm'),
  -- ^ PENDÊNCIA CONHECIDA (decisão do dono, 10/08): é cancelamento de venda JÁ FECHADA, evento que
  --   o sistema não tem. Entra em 'outro' para não virar alerta permanente; o texto original fica
  --   preservado em tickets.loss_reason. Único caso medido, GG Imports.

  -- automação
  ('Encerrado por falta de resposta',               'sem_resposta',                 'automacao'),
  ('Sem resposta ao follow-up',                     'sem_resposta',                 'automacao'),
  ('Tentativas de follow-up esgotadas',             'sem_resposta',                 'automacao'),
  -- ^ escrito hardcoded pela trigger fn_check_followup_exhausted (só em leads, hoje)
  ('Onboarding',                                    'descartado_onboarding',        'automacao'),

  -- dropdowns do front + IA
  ('Fora do perfil',                                'perfil_nao_atendido',          'legado'),
  -- ^ no atacado. Os 44 encerramentos da IA são reclassificados um a um na Fase 3, pela anotação.
  ('Fora do perfil — não realizamos',               'servico_nao_oferecido',        'legado'),
  ('Fora do raio',                                  'fora_area_atendimento',        'legado'),
  ('Preço alto',                                    'preco_sem_orcamento',          'legado'),
  ('Sem limite no cartão',                          'preco_sem_orcamento',          'legado'),
  ('Escolheu concorrente',                          'concorrente',                  'legado'),
  ('Preferiu outra clínica',                        'concorrente',                  'legado'),
  ('Agendou e não compareceu',                      'faltou_nao_retomou',           'legado'),
  ('tela solda',                                    'outro',                        'legado'),
  -- ^ Metaltres: alguém usou o campo "Outro" como se fosse anotação. A Fase 6 dá o campo certo.

  -- correções manuais em lote
  ('Não realizamos (convênio/exame não ofertado)',  'servico_nao_oferecido',        'manual'),
  -- ^ decisão do dono (10/08): NÃO separar convênio de exame. Ler 38 conversas não paga o trabalho;
  --   o dado de convênio passa a existir daqui pra frente.
  ('Exame que não oferecemos',                      'servico_nao_oferecido',        'manual'),
  ('Fora da Data',                                  'prazo_disponibilidade',        'manual')
) as t(texto, slug, origem)
on conflict (alias_norm) do nothing;

