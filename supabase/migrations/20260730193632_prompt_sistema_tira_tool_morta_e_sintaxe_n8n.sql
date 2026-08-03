-- Limpa o Prompt Fixo "Agendamento V3" (id 072aada5), usado por 4 clinicas.
--
-- ⚠️ TEMPLATE COMPARTILHADO: esta migration muda o comportamento das 4 de uma vez (CLAUDE.md §1).
-- Backup do texto anterior em system_settings id='backup_prompt_template_072aada5_20260730',
-- para reverter com um UPDATE se der errado.
--
-- Tres problemas, todos residuo da migracao do n8n (22/07), medidos em 30/07/2026:
--
-- 1. A ferramenta MEMORIA_LONGA e listada como a PRIMEIRA ferramenta e o agente e mandado usa-la
--    para "armazenar informacoes importantes". Essa ferramenta era um sub-workflow do n8n e NAO
--    EXISTE no agente nativo. O agente chegou a vazar o nome dela no texto que o paciente le 9
--    vezes (todas em junho, na era n8n; zero depois). Hoje a memoria e automatica.
--
-- 2. Sete linhas mandam passar o telefone como `{{ $('Start').item.json.lead_phone }}`, expressao
--    do n8n que NINGUEM substitui no caminho nativo: chega ao modelo como texto literal. Nao e
--    bug ativo (o servidor injeta o telefone verdadeiro em toda tool e ignora o que o modelo
--    escreve, ver _shared/agent/tools.ts), mas e instrucao mentirosa ocupando espaco no prompt.
--
-- 3. Nao havia UMA linha dizendo ao agente o que fazer com o bloco de memoria que ele recebe.
--    Ele usava por conta propria, porque a ficha se explica sozinha. Agora esta escrito.
insert into public.system_settings (id, value, description, updated_at)
select 'backup_prompt_template_072aada5_20260730', content,
       'Backup do Prompt Fixo "Agendamento V3" ANTES da limpeza de 30/07/2026 (tool MEMORIA_LONGA morta + sintaxe n8n). Reverter: update prompt_templates set content = (select value from system_settings where id = este) where id = ''072aada5-8721-4f00-bbd8-f8f8a890b2a2'';',
       now()
from public.prompt_templates where id = '072aada5-8721-4f00-bbd8-f8f8a890b2a2'
on conflict (id) do nothing;

update public.prompt_templates
set content = replace(
  replace(
    replace(
      replace(content,
        -- (1) tira a ferramenta que nao existe mais
        E'  MEMORIA_LONGA:\n    uso: |\n      Esteja atento para usar a MEMORIA_LONGA para armazenar informações importantes\n      do lead durante toda a conversa.\n\n',
        ''),
      -- (1b) e o "passo continuo" que manda chamar a mesma ferramenta morta
      E'  - passo: "contínuo"\n    acao: "MEMORIA_LONGA: armazene informações importantes do lead ao longo de toda a conversa."\n',
      ''),
    -- (3) o bloco `variaveis` so existia para carregar a expressao do n8n; vira a instrucao de
    -- como USAR a memoria, que e o que faltava.
    E'variaveis:\n  telefone_lead: "{{ $(''Start'').item.json.lead_phone }}"\n\nferramentas:',
    E'memoria_do_contato: |\n  Antes desta conversa você pode receber um bloco "## Memória do Contato" e/ou\n  "## Resumo do Contato" com o que esta pessoa JÁ informou antes: nome, idade, forma de\n  atendimento, queixa, diagnóstico, medicação, objeções e preferência de horário.\n  O sistema mantém esses blocos sozinho. Você NÃO salva nada, NÃO existe ferramenta de\n  memória, e você NUNCA menciona esses blocos ao paciente.\n  Como usar:\n  - O que está lá já foi dito pela pessoa: NÃO repergunte.\n  - Bloco ausente ou vazio = primeiro contato: colete normalmente.\n  - Se o paciente disser algo DIFERENTE do que está no bloco, vale o que ele diz AGORA.\n  - Falta um dado? Pergunte só o que falta, uma coisa de cada vez.\n\nferramentas:'),
  -- (2) as 6 expressoes restantes do n8n
  E'"{{ $(''Start'').item.json.lead_phone }}"',
  '"(preenchido pelo sistema — não escreva nada aqui)"')
where id = '072aada5-8721-4f00-bbd8-f8f8a890b2a2';
