// _shared/agent/long-memory.ts — MEMORIA LONGA do Agente IA.
//
// A janela de conversa (`memory.ts`, MEMORY_WINDOW linhas) e curta de proposito: ela existe para o
// agente saber do que se esta falando AGORA, nao para guardar o que o contato disse. Quem guardava
// isso era o sub-workflow n8n "Chat Memory Agente IA" (systemMessage "LEAD MEMORY ORGANIZER"),
// chamado pelo agente como tool e responsavel por manter `leads.ai_summary`. Ele nao foi
// substituido quando o agente virou nativo, e o buraco ficou aberto de 22/07 a 30/07/2026.
//
// O custo disso, medido: Lorena Barros, 30/07, lead Pedro. O contato respondeu "33" as 11h51; sete
// minutos depois, com a resposta 1 posicao fora da janela de 10, o agente escreveu "eu ainda nao
// anotei a sua idade" e depois "acabei me perdendo, perdoa a falha", com o paciente na frente.
//
// ── O QUE MUDA EM RELACAO AO n8n (cada item e uma correcao, nao gosto pessoal) ────────────────
//
// 1. CHAVE = `lead_id`. O n8n lia e gravava casando `session_id = Clinica_phone || lead_phone`,
//    string montada na mao. E a mesma concatenacao que partiu a memoria de conversa em 30/07 (ver
//    `fn_chat_session_id`): `normalize_br_phone` tira o 9o digito, quem monta a mao nao tira, e o
//    contato ganha duas pastas. Pior, o UPDATE do n8n casava por `session_id` numa coluna que NAO
//    e unica: chave repetida gravaria a memoria de um contato no cadastro de outro. Identidade e
//    `lead_id`; chave de memoria de conversa e `session_id`; sao coisas diferentes (CLAUDE.md §2).
//
// 2. COLUNA PROPRIA (`leads.ai_long_memory`), nao `ai_summary`. `ai_summary` ja tem dono: o
//    `conv-ai-analyst`, que reescreve a coluna inteira a cada rodada do cron. Compartilhar faria os
//    dois se sobrescreverem em silencio. E, principalmente, prende a memoria do agente a chave de
//    OUTRO produto: e por isso que a Lorena Barros estava com 100% dos leads sem memoria nenhuma
//    (o analista dela esta desligado). Memoria do agente nao pode depender do analista.
//
// 3. RODA DEPOIS DA RESPOSTA SAIR, nao como tool no meio do turno. No n8n o agente parava para
//    chamar a memoria e so entao respondia. Aqui o paciente ja recebeu; a memoria e a faxina.
//
// 4. NUNCA APAGA. O n8n fazia UPDATE cru com a saida do modelo: um turno ruim (resposta vazia,
//    recusa, timeout devolvendo texto curto) zerava a ficha inteira do contato, sem erro. Aqui,
//    saida vazia, erro de provedor ou encolhimento brusco PRESERVAM a memoria anterior.
//
// 5. ENTRA NO MONITOR (`llm_usage`) E NA CENTRAL DE ERROS. O no do n8n nao tinha nem um nem outro:
//    quando parava de rodar, ninguem ficava sabendo, e o sintoma chegava semanas depois como
//    "a IA esta esquecendo". CLAUDE.md §0.5 e §2.
//
// 6. TETO DE TAMANHO. A memoria vai no system prompt de TODO turno e a conta e dominada pela
//    ENTRADA (CLAUDE.md §2: 14.845 tokens de entrada contra 15 de saida numa unica mensagem). Sem
//    teto, contato antigo vira custo composto para sempre.
//
// ⚠️ Modelo PROPRIO, em `system_settings.long_memory_config` (Super Admin > Modelo do Agente).
// Antes ela usava o modelo do agente, e pagava preco de raciocinio para fazer extracao de fatos.
// Ao trocar o modelo ali, cadastre o preco em `system_settings.llm_prices` no mesmo ato: modelo
// sem preco entra com custo ZERO e o total do painel encolhe em silencio (CLAUDE.md §2).

import { runAgentTurn, type ModelConfig } from "../llm.ts";
import { FEATURE } from "../llm-usage.ts";
import { lerJanela, MEMORY_WINDOW, quando } from "./memory.ts";
import { stripCodeFences } from "./guard.ts";

/** Teto do texto guardado. Vai inteiro no prompt de todo turno, entao e teto de CUSTO, nao de disco. */
const MEMORIA_MAX_CHARS = 3000;

/** Abaixo disso nao vale a pena gastar um turno de modelo: nao ha fato novo em "ok"/"obrigado". */
const FALA_MIN_CHARS = 2;

/** Quantas linhas de conversa a memoria RELE a cada atualizacao. Importada de `memory.ts`, que e a
 *  dona da constante: a ficha guarda o que SAI da janela, entao ela precisa enxergar pelo menos o
 *  que a janela enxerga, e duas constantes soltas ligadas por comentario divergiriam em silencio.
 *
 *  Ate 30/07/2026 ela via so a ultima troca, e isso deixava tres buracos: (a) conversa que ja
 *  existia nascia com ficha vazia e so acumulava dali para frente (caso real: a ficha da Priscila
 *  ficou sem idade, medicacao e diagnostico, tudo dito antes de a memoria existir); (b) nada era
 *  anotado enquanto a SECRETARIA atendia, porque a memoria so roda no turno do agente; (c) uma
 *  atualizacao que falhasse perdia aquele fato para sempre. Relendo a janela, os tres se curam
 *  sozinhos na proxima rodada. */
const LINHAS_JANELA = MEMORY_WINDOW;

/** Teto de caracteres da janela relida. A janela e barata (~200 a 550 tokens medidos), mas conversa
 *  com texto longo (orcamento, endereco, lista de horarios) pode estourar sem isto. */
const JANELA_MAX_CHARS = 6000;

/** Usado quando `long_memory_config` nao existe ou esta corrompido. Modelo rapido e com preco ja
 *  cadastrado: fail-safe aqui e continuar gravando a memoria, nao parar de gravar. */
const CFG_PADRAO: ModelConfig = {
  provider: "gemini", model: "gemini-3.1-flash-lite", temperature: 0.2, fallback: null,
};

interface CfgMemoria { cfg: ModelConfig; ligada: boolean }

/** Le `system_settings.long_memory_config`. Nunca lanca: config ruim cai no padrao. */
async function carregarConfig(supabase: any): Promise<CfgMemoria> {
  try {
    const { data } = await supabase.from("system_settings").select("value")
      .eq("id", "long_memory_config").maybeSingle();
    if (!data?.value) return { cfg: CFG_PADRAO, ligada: true };
    const c = JSON.parse(String(data.value));
    return {
      // `enabled` ausente = ligada. Desligar exige dizer `false` explicitamente, senao uma config
      // gravada pela metade silenciaria a memoria de todo mundo sem ninguem perceber.
      ligada: c?.enabled !== false,
      cfg: {
        provider: (c?.provider ?? CFG_PADRAO.provider) as ModelConfig["provider"],
        model: String(c?.model || CFG_PADRAO.model),
        temperature: Number.isFinite(Number(c?.temperature)) ? Number(c.temperature) : CFG_PADRAO.temperature,
        // Sem fallback de proposito: se o principal falhou, a memoria anterior fica de pe e o
        // proximo turno tenta de novo. Pagar um segundo provedor pela faxina nao se justifica.
        fallback: null,
      },
    };
  } catch {
    return { cfg: CFG_PADRAO, ligada: true };
  }
}

// Vocabulario NEUTRO de proposito (CLAUDE.md §0.2): o mesmo agente atende clinica e nao-clinica.
// "Contato", nao "paciente". As linhas clinicas so aparecem quando houver informacao, pela regra 4.
const PROMPT_ORGANIZADOR = `Você organiza a MEMÓRIA LONGA de um contato em atendimento.

Recebe a memória atual e o que acabou de ser dito. Devolve a memória ATUALIZADA e consolidada.

Formato da resposta (markdown, começando exatamente por este cabeçalho):

## Memória do Contato

- Nome:
- Idade:
- Forma de atendimento (convênio/particular):
- Queixa ou necessidade:
- Diagnóstico ou situação já informada:
- Interesse:
- Acompanhamento atual:
- Medicação ou tratamento em uso:
- Principais objeções:
- Preferência de horário:
- Outras informações relevantes:

Você recebe a memória atual e um trecho da conversa. Cada linha do trecho começa com quem falou:
"CONTATO" é a pessoa; "CLÍNICA" somos nós (assistente, atendente ou mensagem automática).

REGRAS (obrigatórias):
1. Os dados da pessoa saem SÓ das linhas do CONTATO. Nunca invente, nunca deduza, nunca preencha
   por parecer provável, e nunca registre como informação dela algo que quem falou fomos nós
   (valor da consulta, endereço, horários oferecidos: isso é fala da CLÍNICA, não dela).
   Exceção: o que ficou COMBINADO (consulta marcada, dia e hora escolhidos, forma de atendimento)
   entra em "Outras informações relevantes", porque é fato do atendimento dela.
2. SOME o novo ao que já existia. Nunca apague informação que já estava na memória.
3. Não duplique. Se a informação foi corrigida pelo contato, mantenha a versão mais recente.
4. Linha sem informação: omita a linha inteira. Não escreva "não informado" nem deixe em branco.
5. O que não couber nas linhas acima vai como item próprio em "Outras informações relevantes".
6. Responda SÓ a memória. Sem saudação, sem comentário, sem explicação, sem bloco de código.
7. Máximo de 2000 caracteres. Ao se aproximar do limite, condense o que é antigo e menos útil, preservando sempre nome, idade, queixa e objeções.`;

/** Relê a janela recente da conversa como transcricao legivel.
 *
 *  ⚠️ Cada linha diz QUEM falou, e isso e load-bearing: com a janela a memoria passa a ver tambem
 *  as falas da CLINICA (agente, atendente humano, mensagem automatica). Sem a etiqueta, o modelo
 *  anotaria "valor da consulta R$ 650" como coisa que o CONTATO informou, e a ficha viraria um
 *  resumo do atendimento em vez de uma ficha da pessoa.
 *
 *  Nunca lanca: sem janela, o chamador cai na ultima troca, que e o comportamento antigo. */
async function carregarJanela(supabase: any, sessionId: string | null): Promise<string> {
  if (!sessionId) return "";
  const rows = await lerJanela(supabase, sessionId, LINHAS_JANELA);
  const linhas = rows.map((r: any) => {
    const txt = (r.message?.content ?? "").toString().trim();
    if (!txt) return "";
    const quem = r.direction === "inbound" ? "CONTATO"
      : r.sender === "system" ? "CLÍNICA (mensagem automática)"
      : r.sender === "human" ? "CLÍNICA (atendente)"
      : "CLÍNICA (assistente)";
    const q = quando(r.created_at);
    return `${q ? `[${q}] ` : ""}${quem}: ${txt}`;
  }).filter(Boolean);
  // Corta pelo COMECO: o fim da janela e o que acabou de acontecer, e e o que menos pode faltar.
  const texto = linhas.join("\n");
  return texto.length > JANELA_MAX_CHARS ? texto.slice(texto.length - JANELA_MAX_CHARS) : texto;
}

async function registrar(
  supabase: any, code: string, title: string, level: string, clinicId: string | null, ctx: unknown,
) {
  try {
    await supabase.rpc("log_system_error", {
      p_scope: "memoria-longa", p_code: code, p_title: title,
      p_level: level, p_clinic_id: clinicId, p_context: ctx,
    });
  } catch (e) {
    console.error("[memoria-longa] log falhou:", e);
  }
}

/** Corta no fim de linha para nao deixar a ficha terminando no meio de um fato. */
function aparar(texto: string): string {
  if (texto.length <= MEMORIA_MAX_CHARS) return texto;
  const cortado = texto.slice(0, MEMORIA_MAX_CHARS);
  const ultimaQuebra = cortado.lastIndexOf("\n");
  return (ultimaQuebra > MEMORIA_MAX_CHARS * 0.6 ? cortado.slice(0, ultimaQuebra) : cortado).trimEnd();
}

/** Vale trocar a memoria antiga por esta?
 *
 *  Encolhimento brusco e o sintoma barato de saida ruim (recusa do modelo, resposta truncada,
 *  "não consigo ajudar com isso"). O n8n gravava assim mesmo e perdia a ficha inteira. Aqui, na
 *  duvida, fica a anterior: memoria velha atrapalha menos que memoria apagada. */
export function vaiSubstituir(anterior: string, nova: string): boolean {
  const a = (anterior || "").trim();
  const n = (nova || "").trim();
  if (!n) return false;
  if (!n.includes("Memória do Contato")) return false;
  if (a.length >= 200 && n.length < a.length * 0.5) return false;
  return n !== a;
}

/**
 * Atualiza a memoria longa do lead com o que acabou de ser dito.
 *
 * NUNCA lanca: e chamada depois que o paciente ja recebeu a resposta, e derrubar o turno aqui
 * transformaria uma falha de faxina em "turno_quebrou" na Central, que e diagnostico errado.
 */
export async function atualizarMemoriaLonga(supabase: any, a: {
  clinicId: string | null;
  leadId: string | null;
  /** chave da conversa: e por ela que a janela e relida. Sem ela, cai na ultima troca. */
  sessionId: string | null;
  falaDoContato: string;
  respostaDoAgente: string;
}): Promise<void> {
  try {
    // Sem lead nao ha onde guardar. E o caso do sandbox (simulacao do Super Admin), que roda o
    // pipeline inteiro sem lead real: sair calado aqui e o certo, nao e falha.
    if (!a.leadId) return;

    const fala = (a.falaDoContato || "").trim();
    if (fala.length < FALA_MIN_CHARS) return;

    const { cfg, ligada } = await carregarConfig(supabase);
    if (!ligada) return; // desligada no Super Admin: o agente segue so com a janela de conversa

    // ⚠️ LER O `error`, nao so o `data`. O supabase-js NAO lanca quando o PostgREST falha (RLS,
    // statement timeout, 5xx): devolve `{ data: null, error }`. A primeira versao (30/07) pegava so
    // o `data`, entao falha de leitura virava `anterior = ""` em silencio — e com a ficha anterior
    // vazia a trava de `vaiSubstituir` (que so age quando ha ficha de 200+ chars) ficava DESARMADA,
    // deixando uma ficha magra sobrescrever a acumulada. Era exatamente o "NUNCA APAGA" do cabecalho
    // deste arquivo falhando no unico momento em que ele importa.
    //
    // Agora falha de leitura ABORTA a atualizacao: nao gravar e sempre melhor que apagar.
    let anterior = "";
    const falhaDeLeitura = async (erro: string) => {
      await registrar(supabase, "memoria_longa_leitura_falhou",
        "Não consegui ler a memória atual do contato, então não atualizei nada (a ficha anterior está preservada)",
        "warning", a.clinicId, { lead_id: a.leadId, erro: erro.slice(0, 300) });
    };
    try {
      const { data, error } = await supabase.from("leads").select("ai_long_memory").eq("id", a.leadId).maybeSingle();
      if (error) { await falhaDeLeitura(String(error.message ?? error)); return; }
      anterior = (data?.ai_long_memory ?? "").toString();
    } catch (e) {
      await falhaDeLeitura(String((e as Error)?.message ?? e));
      return;
    }

    // A janela ja termina no que acabou de acontecer: a mensagem do contato foi persistida pelo
    // ingest ANTES do agente rodar, e `saveAiResponse` grava a resposta ANTES desta funcao ser
    // chamada. Por isso a janela SUBSTITUI o par "fala/resposta" em vez de somar: mandar os dois
    // repetiria as ultimas linhas e o modelo passaria a achar que a pessoa insistiu.
    const janela = await carregarJanela(supabase, a.sessionId);
    const trecho = janela || [
      `CONTATO: ${fala}`,
      (a.respostaDoAgente || "").trim() ? `CLÍNICA (assistente): ${a.respostaDoAgente.trim()}` : "",
    ].filter(Boolean).join("\n");

    const entrada = [
      anterior.trim() ? `MEMÓRIA ATUAL:\n${anterior.trim()}` : "MEMÓRIA ATUAL: (vazia, este é o primeiro registro)",
      `TRECHO DA CONVERSA (mais antigo primeiro; as últimas linhas são o que acabou de acontecer):\n${trecho}`,
    ].join("\n\n");

    let saida = "";
    try {
      const out = await runAgentTurn(
        supabase, cfg, PROMPT_ORGANIZADOR, [{ role: "user", text: entrada }], [],
        { feature: FEATURE.memoriaLonga, scope: "memoria-longa", clinicId: a.clinicId, leadId: a.leadId },
      );
      // `stripCodeFences` e o mesmo helper que o worker usa na resposta ao paciente. A regra 6 do
      // prompt pede "sem bloco de código", mas modelo embrulha markdown em cerca por habito, e
      // `vaiSubstituir` deixaria passar (o corpo cercado ainda contem o cabecalho). A cerca ficaria
      // gravada e seria injetada no prompt de TODO turno seguinte.
      saida = stripCodeFences(out.text || "").trim();
    } catch (e) {
      await registrar(supabase, "memoria_longa_modelo_falhou",
        "A memória longa do contato não pôde ser atualizada (o agente segue respondendo, mas pode esquecer o que foi dito agora)",
        "error", a.clinicId, { lead_id: a.leadId, erro: (e as Error)?.message?.slice(0, 300) });
      return;
    }

    if (!vaiSubstituir(anterior, saida)) {
      // Saida vazia/curta demais/igual. Igual e o caso comum (turno sem fato novo) e nao merece
      // alerta; o resto merece, porque e memoria que deixou de ser gravada.
      if (saida && saida.trim() !== anterior.trim()) {
        await registrar(supabase, "memoria_longa_descartada",
          "A memória longa voltou vazia ou encurtou demais e foi descartada para não apagar o que já estava guardado",
          "warning", a.clinicId, {
            lead_id: a.leadId, tamanho_anterior: anterior.trim().length, tamanho_novo: saida.length,
            amostra_nova: saida.slice(0, 200),
          });
      }
      return;
    }

    const { error } = await supabase.from("leads")
      .update({ ai_long_memory: aparar(saida) })
      .eq("id", a.leadId);
    if (error) {
      await registrar(supabase, "memoria_longa_gravacao_falhou",
        "A memória longa do contato foi gerada mas não foi salva",
        "error", a.clinicId, { lead_id: a.leadId, erro: error.message });
    }
  } catch (e) {
    // Rede de seguranca final: nada daqui pode escapar para o loop do turno.
    await registrar(supabase, "memoria_longa_quebrou",
      "A rotina de memória longa quebrou (o atendimento não foi afetado)",
      "error", a.clinicId ?? null, { lead_id: a.leadId, erro: (e as Error)?.message?.slice(0, 300) });
  }
}
