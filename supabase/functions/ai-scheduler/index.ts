import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
// Gate do modo SDR: a MESMA função que o worker usa para decidir se a tool de transferência
// aparece para o modelo. Importada em vez de recopiada — regra duplicada é regra que diverge.
import { clinicaEmModoSdr, etapaProibida, normalizarTexto } from "../_shared/agent/tools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente", confirmado: "Confirmado", compareceu: "Compareceu",
  realizado: "Realizado", cancelado: "Cancelado", faltou: "Faltou",
};

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";

// ─── Central de Erros ─────────────────────────────────────────────────────────
// Esta é a função mais crítica do produto (agenda, remarca, cancela consulta) e era a MENOS
// observável de todas: 3 `console.error` em 839 linhas. Quando ela falha, a IA responde ao paciente
// com naturalidade ("vou acionar o atendimento humano"), a conversa segue — e o paciente
// simplesmente não é agendado. Ninguém fica sabendo.
//
// ⚠️ SÓ REGISTRAMOS FALHA DE VERDADE. Os `success:false` de NEGÓCIO (horário ocupado, paciente já
// tem consulta, tipo inválido) são o funcionamento NORMAL: a IA sabe lidar com cada um deles e
// oferece alternativa. Registrá-los inundaria a Central e faria todo mundo parar de olhar — que é
// como um monitoramento morre.
async function registrarErro(
  code: string,
  title: string,
  level: string,
  clinicId: string | null,
  ctx: unknown,
): Promise<void> {
  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await supa.rpc("log_system_error", {
      p_scope: "ai-scheduler", p_code: code, p_title: title,
      p_level: level, p_clinic_id: clinicId, p_context: ctx,
    });
  } catch (e) {
    console.error("[ai-scheduler] log falhou:", e);
  }
}

// Data "hoje" no fuso da clínica (America/Sao_Paulo). O runtime do edge é UTC, então
// new Date().toISOString() vira o dia seguinte entre 21h-00h de SP — o que fazia consultas
// de hoje à noite serem classificadas como "passadas".
function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// Resolve o(s) tipo(s) de consulta de um médico a partir de um id OU de uma string que
// pode ser um slug ("primeira-online") OU uma modalidade ("online"/"presencial").
// Corrige o trap em que a modalidade era usada como slug: get_available_slots casa
// slug = p_modality, e "presencial" não é slug de nenhum tipo da Lorena -> caía em vazio
// silencioso (falso "sem horários"). Aqui casamos primeiro por slug e, se não achar, pela
// coluna modality real.
async function findDoctorTypes(
  supabaseClient: any, doctorId: string, ctId: string | undefined, modalityOrSlug: string,
): Promise<any[]> {
  if (ctId) {
    const { data } = await supabaseClient.from("consultation_types")
      .select("id, slug, modality, is_active, consultation_duration").eq("id", ctId).eq("doctor_id", doctorId).maybeSingle();
    if (data) return data.is_active === false ? [] : [data];
    // ctId não pertence a este médico -> tenta resolver por modalidade/slug abaixo
  }
  const key = (modalityOrSlug || "").trim().toLowerCase();
  const { data: types } = await supabaseClient.from("consultation_types")
    .select("id, slug, modality, is_active, consultation_duration").eq("doctor_id", doctorId).eq("is_active", true);
  const list = types || [];
  // "online"/"presencial" são MODALIDADES, não slugs — mesmo que exista um tipo cujo slug
  // seja "online" (Seguimento Online). Tratá-las como modalidade faz uma clínica com
  // primeira+seguimento na mesma modalidade cair em ambiguidade (2 matches), o que força
  // o agendamento a exigir o consultation_type_id em vez de marcar seguimento por engano.
  // Uma string que é um slug real (ex.: "primeira-online") continua casando por slug.
  const isBareModality = key === "online" || key === "presencial";
  let m = isBareModality ? [] : list.filter((t: any) => (t.slug || "").toLowerCase() === key);
  if (m.length === 0) m = list.filter((t: any) => (t.modality || "").toLowerCase() === key);
  return m;
}

// Quando mais de um tipo casa com a mesma modalidade, prefere "primeira" (primeira consulta)
// como default seguro — evita mostrar/assumir seguimento para um paciente novo.
function preferType(matches: any[]): any {
  return matches.find((t: any) => (t.slug || "").toLowerCase().includes("primeira")) || matches[0];
}

const DIAS_SEMANA = [
  "Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado",
];

// "2026-07-27" + "09:00:00" -> "Segunda-feira, 27/07 às 09h"
// Monta a partir dos componentes, sem Date/Intl com fuso: a data já É de São Paulo e
// converter aqui deslocaria o dia (o runtime do edge é UTC).
function formatarQuando(date: string, time: string): string {
  const [y, m, d] = String(date || "").split("-").map(Number);
  const [hh, mi] = String(time || "").slice(0, 5).split(":");
  if (!y || !m || !d) return `${date} às ${String(time || "").slice(0, 5)}`;
  const diaSemana = DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const dm = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  const hora = mi && mi !== "00" ? `${hh}h${mi}` : `${hh}h`;
  return `${diaSemana}, ${dm} às ${hora}`;
}

// ─── Política de oferta: AGRUPAR, não espalhar ────────────────────────────────
// get_available_slots devolve TODOS os livres em ordem cronológica. Oferecer os
// primeiros da lista (que era o que o modelo fazia, por falta de qualquer critério)
// esburaca a agenda: com uma consulta às 17:30, o próximo paciente caía às 15:00 e o
// médico ficava 2h15 ocioso na clínica para atender 15 minutos. Aqui o motor decide
// QUAIS oferecer; a lista completa continua no retorno para o paciente que pede outro
// período. Regra: encostar no que já existe; dia vazio começa cedo.
const SUGGESTED_COUNT = 2;

type Busy = { start: number; end: number };

function hhmmToMin(t: string): number {
  const [h, m] = (t || "").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}

function pickSuggestedSlots(slots: string[], busy: Busy[], durationMinutes: number): string[] {
  if (slots.length <= SUGGESTED_COUNT) return [...slots];
  // Dia sem nada marcado: o começo do expediente JÁ é o agrupamento ideal (o médico
  // entra, atende e vai embora). É também o que a recepção pede: "prioridade mais cedo".
  if (busy.length === 0) return slots.slice(0, SUGGESTED_COUNT);
  // Default alinhado ao do banco (appointments.duration_minutes / consultation_duration
  // são NOT NULL DEFAULT 60). Um default menor aqui encurtaria o `end` e faria um slot
  // sobreposto parecer livre.
  const dur = durationMinutes > 0 ? durationMinutes : 60;
  const scored: { s: string; start: number; gap: number }[] = [];
  for (const s of slots) {
    const start = hhmmToMin(s);
    const end = start + dur;
    let gap = Number.MAX_SAFE_INTEGER;
    let overlaps = false;
    for (const b of busy) {
      // Sobreposição não é "gap zero": é slot inválido. Tratá-la como 0 a
      // empataria com o slot que encosta perfeitamente e a colocaria no topo.
      if (start < b.end && end > b.start) { overlaps = true; break; }
      const d = start >= b.end ? start - b.end : b.start - end;
      if (d < gap) gap = d;
    }
    if (overlaps) continue;
    scored.push({ s, start, gap });
  }
  // get_available_slots já filtra ocupados; se ainda assim tudo colidir (durações
  // divergentes), volta ao comportamento antigo em vez de não oferecer nada.
  if (scored.length === 0) return slots.slice(0, SUGGESTED_COUNT);
  // Menor janela ociosa primeiro; empate desempata pelo mais cedo.
  scored.sort((a, b) => (a.gap - b.gap) || (a.start - b.start));
  return scored.slice(0, SUGGESTED_COUNT).map((x) => x.s);
}

/** Frase com os horários livres que não estão entre os sugeridos, limitada e com contador. */
function otherSlotsPhrase(all: string[], suggested: string[], maxOthers = Infinity): string {
  const others = all.filter((s) => !suggested.includes(s));
  if (others.length === 0) return "";
  const shown = others.length > maxOthers ? others.slice(0, maxOthers) : others;
  const restante = others.length - shown.length;
  return restante > 0
    ? `${shown.join(", ")} (+${restante}, peça VER_HORARIOS nesse dia para a lista completa)`
    : shown.join(", ");
}

// O readable_summary é o que o modelo de fato lê. Ele precisa dizer três coisas ao mesmo
// tempo: o que oferecer AGORA, que existem outros horários, e que ele PODE usar os outros
// quando o paciente pedir. Esconder o resto da lista prenderia a IA no primeiro palpite.
const REGRA_DE_OFERTA =
  'REGRA DE OFERTA: ofereça primeiro os horários marcados como "OFEREÇA ESTES". ' +
  "Se o paciente recusar, pedir outro período (mais cedo, mais tarde, manhã, tarde) ou outro dia, " +
  'ofereça à vontade os "outros livres" desta lista ou chame VER_HORARIOS em outra data. ' +
  "Nunca ofereça horário que não esteja nessas listas.";

// `maxOthers` omitido = lista todos os outros horários.
function doctorAvailabilityLine(a: any, dateLabel: string, maxOthers = Infinity): string {
  if (!a.available_slots || a.available_slots.length === 0) {
    return `${a.doctor_name}: sem horários disponíveis em ${dateLabel}.`;
  }
  const sug: string[] = a.suggested_slots || [];
  const motivo = a.grouped
    ? " (encaixam junto às consultas já marcadas, sem deixar o médico ocioso)"
    : "";
  let linha = `${a.doctor_name} em ${dateLabel}: OFEREÇA ESTES: ${sug.join(", ")}${motivo}.`;
  const outros = otherSlotsPhrase(a.available_slots, sug, maxOthers);
  if (outros) linha += ` Outros livres nesse dia: ${outros}.`;
  return linha;
}

// Consultas já marcadas, para saber onde encostar. Mesmo critério de ocupação de
// get_available_slots (`status NOT IN ('cancelado','faltou')`) — se divergir, a IA passa
// a sugerir horário colado numa consulta que não existe mais.
async function fetchBusyMap(
  supabaseClient: any, clinicId: string | null, doctorIds: string[], dateFrom: string, dateTo: string,
): Promise<Map<string, Busy[]>> {
  const map = new Map<string, Busy[]>();
  if (doctorIds.length === 0) return map;
  const { data, error } = await supabaseClient
    .from("appointments")
    .select("doctor_id, date, time, duration_minutes")
    .in("doctor_id", doctorIds)
    .gte("date", dateFrom).lte("date", dateTo)
    .not("status", "in", "(cancelado,faltou)");
  if (error) {
    // Não é fatal: sem isso a oferta volta a ser "os primeiros da lista", que é o
    // comportamento antigo. Mas é silencioso, então precisa aparecer na Central.
    await registrarErro(
      "agenda_ocupada_nao_carregou",
      "Não deu para ler as consultas já marcadas — a IA vai oferecer horários sem agrupar (agenda esburacada)",
      "warning", clinicId, { erro: error.message, medicos: doctorIds.length, de: dateFrom, ate: dateTo },
    );
    return map;
  }
  const rows = data || [];
  // O PostgREST clampa a resposta em max_rows e não avisa. Se bater o teto, parte das
  // consultas não entrou na conta e a sugestão degrada em silêncio.
  if (rows.length >= 1000) {
    await registrarErro(
      "agenda_ocupada_truncada",
      "A leitura das consultas marcadas bateu o teto do PostgREST — o agrupamento de horários pode estar incompleto",
      "warning", clinicId, { linhas: rows.length, de: dateFrom, ate: dateTo },
    );
  }
  for (const r of rows) {
    const key = `${r.doctor_id}|${r.date}`;
    const start = hhmmToMin(String(r.time || ""));
    const end = start + (Number(r.duration_minutes) > 0 ? Number(r.duration_minutes) : 15);
    const list = map.get(key);
    if (list) list.push({ start, end });
    else map.set(key, [{ start, end }]);
  }
  return map;
}

async function fetchSlotsForDoctorDate(
  supabaseClient: any,
  clinicId: string | null,
  doctorId: string,
  date: string,
  modality: string = "presencial",
  consultationTypeId?: string,
): Promise<string[]> {
  return (await fetchSlotsDetailed(supabaseClient, clinicId, doctorId, date, modality, consultationTypeId)).slots;
}

async function fetchSlotsDetailed(
  supabaseClient: any,
  clinicId: string | null,
  doctorId: string,
  date: string,
  modality: string = "presencial",
  consultationTypeId?: string,
): Promise<{ slots: string[]; durationMinutes: number }> {
  const matches = await findDoctorTypes(supabaseClient, doctorId, consultationTypeId, modality);
  if (matches.length === 0) return { slots: [], durationMinutes: 0 };
  const chosen = preferType(matches);
  const typeId = chosen.id;
  const durationMinutes = Number(chosen.consultation_duration) || 0;
  const { data, error } = await supabaseClient.rpc("get_available_slots", {
    p_doctor_id: doctorId, p_date: date, p_consultation_type_id: typeId,
  });
  if (error) {
    console.error("get_available_slots error", { doctorId, date, typeId, msg: error.message });
    // Devolver [] aqui faz a IA dizer ao paciente "não há horários" — quando na verdade HÁ, e a
    // consulta é que quebrou. É uma falha cara e completamente muda: o paciente desiste achando
    // que a agenda está cheia.
    await registrarErro(
      "consulta_de_horarios_falhou",
      "A busca de horários quebrou — a IA vai dizer ao paciente que não há vagas mesmo que existam",
      "critical", clinicId,
      { erro: error.message, doctor_id: doctorId, data: date, tipo_consulta: typeId },
    );
    return { slots: [], durationMinutes };
  }
  return {
    slots: (data || []).map((s: any) => (s.slot_time || "").toString().substring(0, 5)),
    durationMinutes,
  };
}

// Busca alternativas de horario para a IA oferecer: tenta a data pedida e os 14 dias seguintes.
async function findAlternativeSlots(
  supabaseClient: any,
  clinicId: string | null,
  doctorId: string,
  fromDate: string,
  modality: string,
  consultationTypeId?: string,
): Promise<{ date: string; slots: string[]; suggested: string[] } | null> {
  for (let i = 0; i <= 14; i++) {
    const d = addDays(fromDate, i);
    const { slots, durationMinutes } = await fetchSlotsDetailed(supabaseClient, clinicId, doctorId, d, modality, consultationTypeId);
    if (slots.length > 0) {
      const busyMap = await fetchBusyMap(supabaseClient, clinicId, [doctorId], d, d);
      const suggested = pickSuggestedSlots(slots, busyMap.get(`${doctorId}|${d}`) || [], durationMinutes);
      // Lista completa: truncar aqui já escondeu do modelo a faixa do meio do dia
      // (os sugeridos podem ser do fim do expediente), e a IA passava a dizer ao
      // paciente que não havia horário à tarde. Quem monta o texto é que limita.
      return { date: d, slots, suggested };
    }
  }
  return null;
}

async function sendWhatsAppText(
  token: string, number: string, text: string, clinicId: string | null, oQue: string,
): Promise<boolean> {
  if (!token || !number || !text) return false;
  try {
    const resp = await fetch(`${UAZAPI_BASE}/send/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "token": token,
      },
      body: JSON.stringify({ number, text, delay: 0 }),
    });
    if (!resp.ok) {
      const corpo = (await resp.text()).slice(0, 200);
      console.error("uazapi send falhou", resp.status, corpo);
      await registrarErro(
        "envio_falhou_" + oQue,
        "A IA achou que avisou (" + oQue + "), mas a mensagem não saiu",
        "error", clinicId, { status: resp.status, resposta: corpo, o_que: oQue },
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("uazapi send error", e);
    await registrarErro(
      "envio_falhou_" + oQue,
      "A IA achou que avisou (" + oQue + "), mas a mensagem não saiu",
      "error", clinicId, { erro: String(e), o_que: oQue },
    );
    return false;
  }
}

// ---- Emissor (opt-in por clinica). O handoff do agente (despedida ao lead + aviso ao grupo) passa
// a enfileirar quando a chave esta ligada: ganha gate/retry e roteia lead de SIMULACAO p/ o sandbox
// (sem isto, a despedida de um teste iria para um WhatsApp real). Chave desligada = envio inline. ----
async function emissorAtivo(supabase: any, clinicId: string | null, leadId: string | null = null): Promise<boolean> {
  if (!clinicId) return false;
  try {
    // Com leadId, um lead de simulacao (sandbox) sempre roteia pela fila (mesmo com a chave off).
    const { data } = await supabase.rpc("fn_emissor_ativo", { p_clinic_id: clinicId, p_lead_id: leadId });
    return data === true;
  } catch { return false; }
}

function kickEmissor(supabase: any, clinicId: string | null): void {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/emissor-worker`;
    const kick = fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "kick", clinic_id: clinicId }) }).catch(() => {});
    (globalThis as any).EdgeRuntime?.waitUntil?.(kick);
  } catch { /* cron backstop cobre */ }
}

// Enfileira via Emissor; se a fila falhar, cai para o envio inline (sendWhatsAppText). Devolve true
// se enfileirou/enviou. toKind='group' nao normaliza nem entra na conversa do paciente.
async function enviarOuEnfileirar(
  supabase: any, token: string, number: string, text: string, clinicId: string | null,
  oQue: string, viaEmissor: boolean, toKind: "lead" | "group", leadId: string | null,
  isSim = false,
): Promise<boolean> {
  if (viaEmissor && clinicId) {
    // supabase.rpc NAO lanca em erro de RPC (devolve {error}); checar o campo, senao um emit falho
    // retornaria "enviado" sem enfileirar nem cair no inline.
    let emitErr: unknown = null;
    try {
      const { error } = await supabase.rpc("emit_message", {
        p_clinic_id: clinicId, p_to_addr: number, p_producer: "ai_scheduler_" + oQue,
        p_body: text, p_to_kind: toKind, p_lead_id: leadId,
      });
      emitErr = error;
    } catch (e) { emitErr = e; }
    if (!emitErr) {
      kickEmissor(supabase, clinicId);
      return true;
    }
    // Lead de SIMULACAO: NAO cai no inline (mandaria ao numero ficticio pela uazapi real, quebrando
    // o isolamento). Falha silenciosa e aceitavel num teste.
    if (isSim) return false;
    // falhou o enfileiramento: tenta o inline como fallback
  }
  return await sendWhatsAppText(token, number, text, clinicId, oQue);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Declarados FORA do try para que o `catch` saiba QUAL ferramenta quebrou e em QUAL clínica.
  // Sem isso o erro chega na Central como "algo explodiu" — o que não é acionável.
  let acaoAtual: string | null = null;
  let clinicAtual: string | null = null;

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const payload = await req.json();
    const { action, clinic_id } = payload;
    acaoAtual = action ?? null;
    clinicAtual = clinic_id ?? null;

    if (!clinic_id) {
      return new Response(JSON.stringify({ success: false, error: "clinic_id is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (action === "list_consultation_types") {
      const { doctor_id } = payload;
      const { data: types, error: ctError } = await supabaseClient.rpc("list_consultation_types", {
        p_clinic_id: clinic_id, p_doctor_id: doctor_id || null,
      });
      if (ctError) throw ctError;
      const list = (types || []).map((t: any) => ({
        id: t.id, doctor_id: t.doctor_id, doctor_name: t.doctor_name,
        slug: t.slug, name: t.name, modality: t.modality,
        description: t.description, duration: t.consultation_duration,
        nature: t.nature ?? null, return_window_days: t.return_window_days ?? null,
      }));
      // A natureza entra no texto, nao so no JSON: e o readable_summary que o modelo de fato le.
      // Antes disso a unica pista era a description em prosa, e foi assim que 3 dos 10 agendamentos
      // da IA na Lorena sairam como "Seguimento" para paciente que nunca tinha consultado.
      const natureLabel = (t: any): string => {
        if (t.nature === "primeira") return "PRIMEIRA CONSULTA: so para quem NUNCA se consultou aqui";
        if (t.nature === "seguimento") return "SEGUIMENTO: consulta nova paga, para quem JA se consultou";
        if (t.nature === "retorno") {
          return "RETORNO DE CORTESIA (gratuito)" +
            (t.return_window_days ? `, valido ate ${t.return_window_days} dias apos a consulta anterior` : "");
        }
        return "";
      };
      const lines = list.map((t: any) => {
        const nat = natureLabel(t);
        return `- [${t.id}] ${t.name} (${t.modality}, ${t.duration}min) com ${t.doctor_name}` +
          (nat ? ` [${nat}]` : "") +
          (t.description ? `: ${t.description}` : "");
      });
      const temNatureza = list.some((t: any) => t.nature);
      const readable_summary = list.length === 0
        ? "Nenhum tipo de consulta cadastrado para esta clinica."
        : `Tipos disponiveis (use o ID em VER_HORARIOS e MARCAR_HORARIO):\n${lines.join("\n")}` +
          (temNatureza
            ? "\n\nA natureza entre colchetes MANDA na escolha: cruze com VER_HISTORICO_PACIENTE " +
              "(is_first_consultation) e use o tipo compativel. A description so desempata entre tipos " +
              "de MESMA natureza. Tipo sem natureza serve para qualquer caso."
            : "");
      return new Response(JSON.stringify({ success: true, types: list, readable_summary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    } else if (action === "get_availability") {
      const { date, date_to, days, doctor_id, consultation_type_id, modality: modalityRaw } = payload;
      const modality = (typeof modalityRaw === "string" && modalityRaw.trim()) ? modalityRaw.trim() : "presencial";
      const ctId = (typeof consultation_type_id === "string" && consultation_type_id.trim()) ? consultation_type_id.trim() : undefined;
      if (!date) {
        return new Response(JSON.stringify({ success: false, error: "date is required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
        });
      }

      let dateList: string[] = [date];
      if (date_to) {
        const start = new Date(date + "T00:00:00");
        const endD = new Date(date_to + "T00:00:00");
        if (endD >= start) {
          dateList = [];
          const cur = new Date(start);
          let count = 0;
          while (cur <= endD && count < 60) {
            dateList.push(cur.toISOString().split("T")[0]);
            cur.setDate(cur.getDate() + 1);
            count++;
          }
        }
      } else if (days && Number(days) > 0) {
        const total = Math.min(Number(days), 60);
        dateList = Array.from({ length: total }, (_, i) => addDays(date, i));
      }

      let doctorsQuery = supabaseClient
        .from("doctors").select("id, name, clinic_users(full_name)")
        .eq("clinic_id", clinic_id).eq("is_active", true);
      if (doctor_id) doctorsQuery = doctorsQuery.eq("id", doctor_id);
      const { data: doctors, error: doctorsError } = await doctorsQuery;
      if (doctorsError) throw doctorsError;

      // Uma leitura só das consultas marcadas em toda a janela: é o que permite oferecer
      // horário colado no que já existe em vez de sempre o começo do expediente.
      const busyMap = await fetchBusyMap(
        supabaseClient, clinic_id, (doctors || []).map((d: any) => d.id),
        dateList[0], dateList[dateList.length - 1],
      );

      const days_availability: any[] = [];
      for (const d of dateList) {
        const perDoctor = await Promise.all(
          (doctors || []).map(async (doc: any) => {
            const { slots, durationMinutes } = await fetchSlotsDetailed(supabaseClient, clinic_id, doc.id, d, modality, ctId);
            const busy = busyMap.get(`${doc.id}|${d}`) || [];
            return {
              doctor_id: doc.id,
              doctor_name: doc.name || doc.clinic_users?.full_name || "Médico sem nome",
              available_slots: slots,
              suggested_slots: pickSuggestedSlots(slots, busy, durationMinutes),
              grouped: busy.length > 0,
            };
          })
        );
        days_availability.push({ date: d, availability: perDoctor });
      }

      if (dateList.length === 1) {
        const single = days_availability[0];
        const totalSlots = single.availability.reduce((s: number, a: any) => s + a.available_slots.length, 0);

        let next_available: { date: string; availability: any[] } | null = null;
        if (totalSlots === 0) {
          // Uma leitura só para os 14 dias: dentro do laço isso era uma consulta por
          // dia, dobrando a latência no caminho mais lento (agenda cheia), com a IA
          // esperando de forma síncrona no meio da conversa.
          const probeBusy = await fetchBusyMap(
            supabaseClient, clinic_id, (doctors || []).map((d: any) => d.id),
            addDays(date, 1), addDays(date, 14),
          );
          for (let i = 1; i <= 14; i++) {
            const tryDate = addDays(date, i);
            const probe = await Promise.all(
              (doctors || []).map(async (doc: any) => {
                const { slots, durationMinutes } = await fetchSlotsDetailed(supabaseClient, clinic_id, doc.id, tryDate, modality, ctId);
                const busy = probeBusy.get(`${doc.id}|${tryDate}`) || [];
                return {
                  doctor_id: doc.id,
                  doctor_name: doc.name || doc.clinic_users?.full_name || "Médico sem nome",
                  available_slots: slots,
                  suggested_slots: pickSuggestedSlots(slots, busy, durationMinutes),
                  grouped: busy.length > 0,
                };
              })
            );
            const probeTotal = probe.reduce((s, a) => s + a.available_slots.length, 0);
            if (probeTotal > 0) {
              next_available = { date: tryDate, availability: probe };
              break;
            }
          }
        }

        let readable_summary = single.availability
          .map((a: any) => doctorAvailabilityLine(a, single.date))
          .join("\n");

        if (totalSlots === 0 && next_available) {
          const lines = next_available.availability
            .filter((a: any) => a.available_slots.length > 0)
            .map((a: any) => `  ${doctorAvailabilityLine(a, next_available!.date)}`);
          readable_summary += `\n\nPróxima data disponível: ${next_available.date}\n${lines.join("\n")}`;
        } else if (totalSlots === 0 && !next_available) {
          readable_summary += `\n\nSem disponibilidade nos próximos 14 dias.`;
        }

        if (totalSlots > 0 || next_available) readable_summary += `\n\n${REGRA_DE_OFERTA}`;

        return new Response(
          JSON.stringify({
            success: true,
            date: single.date,
            availability: single.availability,
            next_available,
            readable_summary,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      const summaryLines: string[] = [];
      for (const day of days_availability) {
        const dayLines = day.availability
          .filter((a: any) => a.available_slots.length > 0)
          // Janela larga: a lista completa de todo dia de todo médico estoura o contexto.
          // Os sugeridos vêm sempre; os outros ficam limitados, com o total sinalizado.
          .map((a: any) => `  ${doctorAvailabilityLine(a, day.date, 10)}`);
        if (dayLines.length > 0) {
          summaryLines.push(`${day.date}:`);
          summaryLines.push(...dayLines);
        }
      }
      const readable_summary = summaryLines.length > 0
        ? `${summaryLines.join("\n")}\n\n${REGRA_DE_OFERTA}`
        : `Sem horários disponíveis no período solicitado (${dateList[0]} a ${dateList[dateList.length-1]}).`;
      return new Response(
        JSON.stringify({
          success: true,
          date_from: dateList[0], date_to: dateList[dateList.length - 1],
          days: days_availability, readable_summary,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "book_appointment") {
      const { doctor_id, date, time, patient_name, patient_phone, request_id, modality, notes, consultation_type_id } = payload;
      if (!doctor_id || !date || !time || !patient_name || !patient_phone) {
        return new Response(
          JSON.stringify({ success: false, error_code: "missing_fields", error: "Campos obrigatórios faltando: doctor_id, date, time, patient_name, patient_phone." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const ctId = (typeof consultation_type_id === "string" && consultation_type_id.trim()) ? consultation_type_id.trim() : undefined;
      const finalModality = (typeof modality === "string" && modality.trim())
        ? modality.trim().toLowerCase() : "presencial";

      // Resolve o tipo de consulta ANTES de gravar. Nunca trata "modality" como slug:
      // casa por id, depois por slug, depois pela coluna modality. Para AGENDAR exigimos
      // UM tipo inequívoco — se a modalidade casar com vários (ex.: primeira + seguimento),
      // devolve erro pedindo o consultation_type_id, evitando marcar o tipo errado.
      const typeMatches = await findDoctorTypes(supabaseClient, doctor_id, ctId, finalModality);
      if (typeMatches.length === 0) {
        return new Response(
          JSON.stringify({
            success: false, error_code: "consultation_type_not_found",
            error: ctId
              ? `Tipo de consulta com id "${ctId}" não está disponível para este médico.`
              : `Não há tipo de consulta "${finalModality}" configurado para este médico.`,
            next_step: "Chame LISTAR_TIPOS_CONSULTA, escolha um consultation_type_id válido deste médico e chame MARCAR_HORARIO com esse id.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      if (typeMatches.length > 1) {
        return new Response(
          JSON.stringify({
            success: false, error_code: "consultation_type_ambiguous",
            error: `Há mais de um tipo de consulta "${finalModality}" para este médico (ex.: primeira consulta e seguimento).`,
            next_step: "Chame LISTAR_TIPOS_CONSULTA e passe o consultation_type_id EXATO escolhido pelo paciente em MARCAR_HORARIO (não use apenas a modalidade).",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const resolvedTypeId = typeMatches[0].id;

      const derived = await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(`${clinic_id}|${doctor_id}|${date}|${time}|${patient_phone}`));
      const hash = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const computed_request_id = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
      const final_request_id = request_id || computed_request_id;
      const rpcParams: Record<string, unknown> = {
        p_clinic_id: clinic_id, p_doctor_id: doctor_id, p_date: date, p_time: time,
        p_patient_name: patient_name, p_patient_phone: patient_phone, p_source: "ia",
        p_notes: notes || null, p_request_id: final_request_id,
        p_consultation_type_id: resolvedTypeId,
      };
      const { data, error } = await supabaseClient.rpc("book_appointment", rpcParams);
      if (error) throw error;
      const result = data as any;
      if (!result.success) {
        // Erros com CONTEXTO RICO: alem da mensagem, devolve next_step instruindo o LLM
        // sobre a melhor proxima acao (e alternativas de horario quando fizer sentido).
        const code: string = result.error_code || "unknown";
        let errorMsg = "Erro ao agendar.";
        let next_step = "Peça desculpas ao paciente pelo imprevisto e acione o atendimento humano (ACIONAR_HANDOFF) se o problema persistir.";
        const extra: Record<string, unknown> = {};

        if (code === "slot_conflict" || code === "slot_unavailable") {
          errorMsg = code === "slot_conflict"
            ? `O horário ${time} de ${date} acabou de ser reservado por outra pessoa.`
            : `O horário ${time} de ${date} está fora da agenda do médico (expediente, bloqueio ou antecedência mínima).`;
          const alt = await findAlternativeSlots(supabaseClient, clinic_id, doctor_id, date, finalModality, resolvedTypeId);
          if (alt) {
            extra.alternatives = alt;
            next_step = `NÃO repita o mesmo horário. Ofereça ao paciente estes horários em ${alt.date}: ${alt.suggested.join(", ")}. Se ele pedir outro período, os demais livres desse dia são: ${otherSlotsPhrase(alt.slots, alt.suggested, 10)}. Quando ele escolher, chame MARCAR_HORARIO novamente com o horário escolhido.`;
          } else {
            next_step = "Sem horários disponíveis nos próximos 14 dias para este médico. Consulte VER_HORARIOS em datas mais distantes ou ofereça outro profissional (LISTAR_TIPOS_CONSULTA).";
          }
        } else if (code === "ticket_has_active_appointment") {
          const ex = result.existing_appointment || null;
          const when = ex ? `${ex.date} às ${ex.time} com ${ex.doctor_name}` : "em data já registrada";
          extra.existing_appointment = ex;
          extra.reason = result.reason;
          if (result.reason === "upcoming_appointment") {
            errorMsg = `Este paciente JÁ TEM uma consulta marcada: ${when} (status: ${ex?.status || "?"}).`;
            next_step = `NÃO marque uma nova consulta. Informe ao paciente a consulta existente (${when}). Se ele quiser MUDAR data/horário, use REAGENDAR_HORARIO com appointment_id="${ex?.appointment_id || ""}". Se quiser DESMARCAR, confirme com ele e use CANCELAR_HORARIO com o mesmo appointment_id. Se ele só quer confirmar a consulta, repita os dados acima.`;
          } else {
            // awaiting_finalization = consulta pendente/confirmada cuja DATA JA PASSOU sem
            // desfecho (compareceu/realizado auto-resolvem antes de chegar aqui).
            errorMsg = `O paciente tem uma consulta antiga (${when}, status: ${ex?.status || "?"}) que já passou da data e não foi atualizada pela recepção.`;
            next_step = `Pergunte ao paciente se ele chegou a COMPARECER a essa consulta de ${ex?.date || "data passada"}. Se NÃO compareceu e quer remarcar: use REAGENDAR_HORARIO com appointment_id="${ex?.appointment_id || ""}" para mover essa mesma consulta para a nova data/horário (NÃO use MARCAR_HORARIO de novo). Se ele COMPARECEU: acione o atendimento humano (ACIONAR_HANDOFF) para a recepção finalizar o atendimento anterior.`;
          }
        } else if (code === "invalid_phone") {
          errorMsg = "Telefone do paciente inválido para vincular o agendamento.";
          next_step = "Use SEMPRE o número de WhatsApp da própria conversa (lead_phone da sessão) no campo patient_phone — nunca um número ditado pelo paciente.";
        } else if (code === "consultation_type_not_found" || code === "consultation_type_inactive") {
          errorMsg = `Tipo de consulta com id "${resolvedTypeId}" não está disponível para este médico.`;
          next_step = "Chame LISTAR_TIPOS_CONSULTA, escolha um consultation_type_id válido deste médico e tente novamente.";
        } else if (code === "doctor_not_found" || code === "doctor_inactive" || code === "doctor_clinic_mismatch") {
          errorMsg = "Médico inválido ou indisponível nesta clínica.";
          next_step = "Chame LISTAR_TIPOS_CONSULTA para obter os médicos válidos e use o doctor_id correto.";
        } else {
          // Todos os casos acima são NEGÓCIO: a IA sabe o que fazer e oferece alternativa ao
          // paciente. Cair aqui é diferente — é um erro que não sabemos explicar, e a IA vai
          // apenas pedir desculpas e acionar o humano. O paciente fica sem agendamento e o motivo
          // se perde. Este é o único ramo que merece a Central.
          await registrarErro(
            "agendamento_falhou_sem_motivo_conhecido",
            'A RPC de agendamento recusou com um motivo desconhecido ("' + code + '") — o paciente não foi agendado',
            "critical", clinic_id,
            { error_code: code, resultado: result, doctor_id, data: date, horario: time },
          );
        }

        return new Response(
          JSON.stringify({ success: false, error_code: code, error: errorMsg, next_step, ...extra }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      // O caminho de SUCESSO era o único sem texto pronto nem next_step: devolvia a linha crua
      // e deixava o modelo redigir a confirmação de memória. Foi assim que um paciente escolheu
      // segunda 09h, o banco gravou segunda 09h e a mensagem enviada disse "sexta, 15h" (o
      // primeiro horário que a IA tinha oferecido). O agendamento certo não adianta nada se o
      // paciente aparece noutro dia. Agora o texto sai daqui, já formatado.
      const { data: aptRow } = await supabaseClient.from("appointments")
        .select("*, doctors(name)").eq("id", result.appointment_id).maybeSingle();
      const { doctors: aptDoctor, ...aptFlat } = (aptRow || {}) as any;
      const dataFinal = aptRow?.date ?? date;
      const horaFinal = String(aptRow?.time ?? time).slice(0, 5);
      const medicoFinal = aptDoctor?.name || "";
      const quando = formatarQuando(dataFinal, horaFinal);
      const jaExistia = result.idempotent || false;
      const readable_summary =
        `${jaExistia ? "Este agendamento JÁ estava gravado (chamada repetida) e continua valendo" : "Agendamento GRAVADO na agenda"}: ` +
        `${quando}${medicoFinal ? `, com ${medicoFinal}` : ""} (data ${dataFinal}, horário ${horaFinal}).`;
      const next_step =
        "Confirme ao paciente EXATAMENTE a data, o horário e o médico que estão em readable_summary. " +
        "NÃO use nenhum horário que você tenha oferecido antes nesta conversa: o que vale é o desta " +
        "resposta, porque é o que ficou na agenda da clínica. Se divergir do que você tinha em mente, " +
        "o certo é o desta resposta.";
      return new Response(
        JSON.stringify({
          success: true,
          idempotent: jaExistia,
          appointment: { ...aptFlat, doctor_name: medicoFinal || null },
          readable_summary,
          next_step,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "reschedule_appointment") {
      // Reagenda uma consulta DO PROPRIO paciente da conversa (titularidade validada na RPC
      // via p_requester_phone). appointment_id vem de VER_AGENDAMENTOS_PACIENTE ou do erro
      // ticket_has_active_appointment de MARCAR_HORARIO.
      const { appointment_id, patient_phone, doctor_id, date, time, consultation_type_id } = payload;
      if (!appointment_id || !patient_phone || !date || !time) {
        return new Response(
          JSON.stringify({ success: false, error_code: "missing_fields", error: "Campos obrigatórios: appointment_id, patient_phone, date, time.", next_step: "Obtenha o appointment_id em VER_AGENDAMENTOS_PACIENTE e tente novamente." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const { data: curApt } = await supabaseClient.from("appointments")
        .select("doctor_id, consultation_type_id, consultation_type_slug, modality").eq("id", appointment_id).maybeSingle();
      if (!curApt) {
        return new Response(
          JSON.stringify({ success: false, error_code: "appointment_not_found", error: "Agendamento não encontrado.", next_step: "Use VER_AGENDAMENTOS_PACIENTE para obter um appointment_id válido deste paciente." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const targetDoctor = doctor_id || curApt.doctor_id;
      const rctId = (typeof consultation_type_id === "string" && consultation_type_id.trim())
        ? consultation_type_id.trim() : (curApt.consultation_type_id || undefined);
      const { data: rres, error: rerr } = await supabaseClient.rpc("reschedule_appointment", {
        p_appointment_id: appointment_id,
        p_doctor_id: targetDoctor,
        p_date: date,
        p_time: time,
        p_consultation_type_id: rctId || null,
        p_force: false,
        p_requester_phone: patient_phone,
      });
      if (rerr) throw rerr;
      const rr = rres as any;
      if (!rr.success) {
        const code: string = rr.error_code || "unknown";
        let errorMsg = "Não foi possível reagendar.";
        let next_step = "Acione o atendimento humano (ACIONAR_HANDOFF) para resolver com a recepção.";
        const extra: Record<string, unknown> = {};
        if (code === "not_your_appointment") {
          errorMsg = "Este agendamento não pertence ao paciente desta conversa.";
          next_step = "Use VER_AGENDAMENTOS_PACIENTE com o telefone da sessão e escolha um appointment_id que pertença a este paciente.";
        } else if (code === "appointment_not_reschedulable") {
          errorMsg = "Esta consulta não pode mais ser alterada (já aconteceu ou foi cancelada).";
          next_step = "Se o paciente quer uma NOVA consulta, use MARCAR_HORARIO normalmente.";
        } else if (code === "slot_unavailable" || code === "slot_conflict") {
          errorMsg = `O horário ${time} de ${date} não está disponível para reagendamento.`;
          // Alternativas pelo tipo real do agendamento (consultation_type_slug), não pela
          // coluna modality (que não é slug e devolvia lista vazia p/ agendamentos legados).
          const altModality = curApt.consultation_type_slug || curApt.modality || "presencial";
          const alt = await findAlternativeSlots(supabaseClient, clinic_id, targetDoctor, date, altModality, rctId);
          if (alt) {
            extra.alternatives = alt;
            next_step = `Ofereça ao paciente estes horários em ${alt.date}: ${alt.suggested.join(", ")} (se ele pedir outro período, os demais livres são: ${otherSlotsPhrase(alt.slots, alt.suggested, 10)}) e chame REAGENDAR_HORARIO novamente com o escolhido.`;
          } else {
            next_step = "Sem horários próximos disponíveis. Consulte VER_HORARIOS em outras datas ou outro médico.";
          }
        }
        return new Response(
          JSON.stringify({ success: false, error_code: code, error: errorMsg, next_step, ...extra }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true, appointment_id, date: rr.date, time: rr.time, doctor_name: rr.doctor_name,
          readable_summary: `Consulta REAGENDADA na agenda para ${formatarQuando(rr.date, String(rr.time || ""))}` +
            `${rr.doctor_name ? `, com ${rr.doctor_name}` : ""} (data ${rr.date}, horário ${String(rr.time || "").slice(0, 5)}).`,
          next_step:
            "Confirme ao paciente EXATAMENTE a data, o horário e o médico que estão em readable_summary. " +
            "NÃO repita o horário antigo nem um horário oferecido antes nesta conversa: o que vale é o " +
            "desta resposta, porque é o que ficou na agenda da clínica.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "cancel_appointment") {
      // Cancela uma consulta DO PROPRIO paciente (titularidade na RPC). So consultas
      // futuras/pendentes podem ser canceladas pelo WhatsApp.
      const { appointment_id, patient_phone, reason } = payload;
      if (!appointment_id || !patient_phone) {
        return new Response(
          JSON.stringify({ success: false, error_code: "missing_fields", error: "Campos obrigatórios: appointment_id, patient_phone.", next_step: "Obtenha o appointment_id em VER_AGENDAMENTOS_PACIENTE e confirme o cancelamento com o paciente antes de chamar esta tool." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const { data: cres, error: cerr } = await supabaseClient.rpc("cancel_appointment", {
        p_appointment_id: appointment_id,
        p_reason: reason || "Cancelado pelo paciente via WhatsApp",
        p_revert_transaction: true,
        p_requester_phone: patient_phone,
      });
      if (cerr) throw cerr;
      const cr = cres as any;
      if (!cr.success) {
        const code: string = cr.error_code || "unknown";
        let errorMsg = "Não foi possível cancelar.";
        let next_step = "Acione o atendimento humano (ACIONAR_HANDOFF) para resolver com a recepção.";
        if (code === "not_your_appointment") {
          errorMsg = "Este agendamento não pertence ao paciente desta conversa.";
          next_step = "Use VER_AGENDAMENTOS_PACIENTE com o telefone da sessão e escolha um appointment_id que pertença a este paciente.";
        } else if (code === "appointment_not_cancellable") {
          errorMsg = "Esta consulta não pode ser cancelada pelo WhatsApp (já foi realizada ou finalizada).";
          next_step = "Explique ao paciente e, se necessário, acione o atendimento humano (ACIONAR_HANDOFF).";
        } else if (code === "appointment_not_found") {
          errorMsg = "Agendamento não encontrado.";
          next_step = "Use VER_AGENDAMENTOS_PACIENTE para obter um appointment_id válido.";
        }
        return new Response(
          JSON.stringify({ success: false, error_code: code, error: errorMsg, next_step }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ success: true, idempotent: cr.idempotent || false, readable_summary: "Consulta cancelada com sucesso. Confirme o cancelamento ao paciente e pergunte se deseja marcar um novo horário." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "get_patient_appointments") {
      const { patient_phone, include_past, include_future, limit } = payload;
      if (!patient_phone) {
        return new Response(JSON.stringify({ success: false, error: "patient_phone is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      const includePast = include_past !== false;
      const includeFuture = include_future !== false;
      const lim = Math.min(Number(limit) || 10, 50);
      const today = todaySP();
      // Lookup por telefone NORMALIZADO (o n8n manda o numero da sessao com 9o digito;
      // o paciente esta gravado na forma canonica sem o 9)
      const { data: aptLookup } = await supabaseClient.rpc("find_patient_by_phone", { p_clinic_id: clinic_id, p_phone: patient_phone });
      const patient = (aptLookup as any)?.patient || null;
      if (!patient) {
        return new Response(
          JSON.stringify({ success: true, patient_found: false, appointments: [], readable_summary: "Paciente não encontrado nesta clínica (primeiro contato)." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      let query = supabaseClient.from("appointments")
        .select("id, date, time, status, modality, source, notes, doctor:doctors(id, name)")
        .eq("clinic_id", clinic_id).eq("patient_id", patient.id);
      if (!includePast && includeFuture) query = query.gte("date", today);
      if (includePast && !includeFuture) query = query.lt("date", today);
      const { data: appts, error: apptsError } = await query.order("date", { ascending: false }).order("time", { ascending: false }).limit(lim);
      if (apptsError) throw apptsError;
      const formatted = (appts || []).map((a: any) => ({
        id: a.id, date: a.date, time: (a.time || "").toString().substring(0, 5),
        doctor_id: a.doctor?.id || null, doctor_name: a.doctor?.name || "—",
        status: a.status, status_label: STATUS_LABEL[a.status] || a.status,
        modality: a.modality, source: a.source, notes: a.notes, is_future: a.date >= today,
      }));
      const past = formatted.filter((a) => !a.is_future);
      const future = formatted.filter((a) => a.is_future);
      const summarize = (arr: any[]) => arr.map((a) => `${a.date} ${a.time} — ${a.doctor_name} (${a.status_label}, ${a.modality}) [id: ${a.id}]`).join("; ");
      const readable_summary = `Paciente ${patient.name} encontrado. ` +
        (future.length ? `${future.length} agendamento(s) futuro(s): ${summarize(future)}. ` : "Sem agendamentos futuros. ") +
        (past.length ? `${past.length} agendamento(s) passado(s): ${summarize(past.slice(0, 5))}.` : "Sem histórico passado.") +
        " Use o id do agendamento como appointment_id em REAGENDAR_HORARIO/CANCELAR_HORARIO.";
      return new Response(
        JSON.stringify({ success: true, patient_found: true, patient: { id: patient.id, name: patient.name, cpf: patient.cpf }, appointments: formatted, counts: { total: formatted.length, past: past.length, future: future.length }, readable_summary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "get_patient_history") {
      const { patient_phone, limit } = payload;
      if (!patient_phone) {
        return new Response(JSON.stringify({ success: false, error: "patient_phone is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      const lim = Math.min(Number(limit) || 5, 20);

      // Lookup por telefone NORMALIZADO (paciente e leads estao na forma canonica)
      const { data: histLookup } = await supabaseClient.rpc("find_patient_by_phone", { p_clinic_id: clinic_id, p_phone: patient_phone });
      const patient = (histLookup as any)?.patient || null;
      const canonicalPhone = (histLookup as any)?.canonical_phone || patient_phone;

      const { data: oldLeads } = await supabaseClient.from("leads")
        .select("id, created_at").eq("clinic_id", clinic_id).eq("phone", canonicalPhone).order("created_at", { ascending: false });
      const oldLeadIds = (oldLeads || []).map((l: any) => l.id);

      let ticketIds: string[] = [];
      if (patient) {
        const { data: apptsWithTicket } = await supabaseClient.from("appointments")
          .select("ticket_id").eq("patient_id", patient.id).not("ticket_id", "is", null);
        ticketIds = (apptsWithTicket || []).map((a: any) => a.ticket_id);
      }
      let tickets: any[] = [];
      if (ticketIds.length > 0 || oldLeadIds.length > 0) {
        let q = supabaseClient.from("tickets")
          .select("id, lead_id, status, outcome, opened_at, closed_at, outcome_at, summary, notes")
          .eq("clinic_id", clinic_id);
        const orParts: string[] = [];
        if (ticketIds.length > 0) orParts.push(`id.in.(${ticketIds.join(",")})`);
        if (oldLeadIds.length > 0) orParts.push(`lead_id.in.(${oldLeadIds.join(",")})`);
        q = q.or(orParts.join(","));
        q = q.order("closed_at", { ascending: false, nullsFirst: false }).limit(lim);
        const { data: tk } = await q;
        tickets = tk || [];
      }

      if (!patient && oldLeadIds.length === 0) {
        return new Response(
          JSON.stringify({
            success: true, patient_found: false, had_previous_journey: false,
            is_first_consultation: true, has_upcoming_appointment: false, upcoming: null,
            tickets: [], readable_summary: "Primeiro contato — sem histórico anterior.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      const hojeSP = todaySP();
      let stats: any = { appointments_realized: 0, appointments_total: 0, total_paid: 0 };
      // is_first_consultation e has_upcoming_appointment sao FATOS, calculados aqui. Antes o agente
      // tinha de deduzi-los de patient_found/had_previous_journey, e os dois respondiam outra
      // pergunta: patient_found vira true no instante em que book_appointment cria o paciente (nos
      // 10 agendamentos da IA na Lorena, patients.created_at == appointments.created_at em 100%),
      // ou seja, quem marcou e faltou ja aparecia como "paciente".
      let isFirstConsultation = true;
      let upcoming: any = null;
      if (patient) {
        const { data: allAppts } = await supabaseClient.from("appointments")
          .select("id, date, time, status, doctor:doctors(id, name)")
          .eq("clinic_id", clinic_id).eq("patient_id", patient.id);
        const appts = allAppts || [];
        stats.appointments_total = appts.length;
        stats.appointments_realized = appts.filter((a: any) => a.status === "realizado" || a.status === "compareceu").length;

        // "Primeira consulta" = nunca COMPARECEU. Ter agendamento marcado (ou ter faltado) nao
        // consome a primeira consulta: a pessoa continua sem nunca ter sido atendida.
        isFirstConsultation = stats.appointments_realized === 0;

        const futuros = appts
          .filter((a: any) => a.date >= hojeSP && a.status !== "cancelado")
          .sort((a: any, b: any) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
        if (futuros.length > 0) {
          const f = futuros[0];
          upcoming = {
            appointment_id: f.id, date: f.date, time: (f.time || "").toString().substring(0, 5),
            doctor_name: f.doctor?.name || "—",
            status: f.status, status_label: STATUS_LABEL[f.status] || f.status,
          };
        }

        const { data: txs } = await supabaseClient.from("financial_transactions")
          .select("amount").eq("clinic_id", clinic_id).eq("patient_id", patient.id).eq("status", "pago");
        stats.total_paid = (txs || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
      }

      // So jornadas ENCERRADAS: o ticket aberto aqui e o desta conversa (aberto pelo trigger antes
      // de a IA rodar), e listar a conversa em curso como "jornada anterior" e o mesmo erro que
      // inflava o had_previous_journey.
      const ticketLines = tickets.filter((t: any) => t.closed_at != null).map((t: any, i: number) => {
        const date = t.closed_at ? new Date(t.closed_at).toISOString().split("T")[0] : (t.opened_at ? new Date(t.opened_at).toISOString().split("T")[0] : "?");
        const outcome = t.outcome ? ` [${t.outcome}]` : "";
        const sum = t.summary ? `: ${t.summary}` : (t.notes ? `: ${t.notes}` : "");
        return `${i + 1}. ${date}${outcome}${sum}`;
      });

      const lines: string[] = [];
      // A conclusao vem PRIMEIRO: e ela que decide a natureza do modelo em LISTAR_TIPOS_CONSULTA.
      lines.push(isFirstConsultation
        ? "PRIMEIRA CONSULTA: esta pessoa nunca compareceu a uma consulta aqui. Use um tipo de natureza 'primeira'."
        : "JA E PACIENTE: ja compareceu a consulta aqui. NAO use tipo de natureza 'primeira'.");
      if (upcoming) {
        lines.push(
          `ATENCAO, JA TEM CONSULTA MARCADA para ${upcoming.date} as ${upcoming.time} com ${upcoming.doctor_name} ` +
          `(${upcoming.status_label}). Nao ofereca agendamento novo: descubra se ela quer CONFIRMAR, REMARCAR ` +
          `(REAGENDAR_HORARIO) ou CANCELAR (CANCELAR_HORARIO). appointment_id: ${upcoming.appointment_id}`
        );
      }
      if (patient) lines.push(`Paciente ${patient.name} já cadastrado.`);
      else lines.push(`Phone reconhecido (lead antigo) mas sem paciente cadastrado. Ainda nao ha cadastro: colete os dados conforme a instrucao da clinica.`);
      if (stats.appointments_total > 0) lines.push(`${stats.appointments_realized}/${stats.appointments_total} consulta(s) realizada(s). Total pago: R$ ${stats.total_paid.toFixed(2).replace(".", ",")}.`);
      if (ticketLines.length > 0) {
        lines.push(`Jornadas anteriores encerradas:`);
        lines.push(...ticketLines);
      } else {
        lines.push(`Sem jornadas anteriores encerradas.`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          patient_found: !!patient,
          // So conta jornada ENCERRADA. Antes era `tickets.length > 0`, e o ticket desta propria
          // conversa entrava na conta: o trigger trg_auto_open_ticket abre o ticket no insert em
          // chat_messages, ou seja, ANTES de a IA rodar. Resultado medido na Lorena: 263 dos 264
          // leads voltavam had_previous_journey = true, 197 deles sem nem ter cadastro de paciente,
          // e o prompt do sistema manda nao recoletar cadastro de quem tem esse flag ligado.
          had_previous_journey: tickets.some((t: any) => t.closed_at != null),
          is_first_consultation: isFirstConsultation,
          has_upcoming_appointment: !!upcoming,
          upcoming,
          patient: patient ? { id: patient.id, name: patient.name, cpf: patient.cpf } : null,
          tickets,
          stats,
          readable_summary: lines.join("\n")
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "trigger_handoff") {
      // Aciona o transbordo de handoff: pausa IA, muda etapa, envia despedida, notifica grupo — conforme handoff_rules.
      const { lead_phone, trigger_keyword } = payload;
      if (!lead_phone) {
        return new Response(JSON.stringify({ success: false, error: "lead_phone is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      const { data: cfg } = await supabaseClient.from("ai_config")
        .select("handoff_enabled, handoff_rules").eq("clinic_id", clinic_id).maybeSingle();

      if (!cfg || cfg.handoff_enabled === false) {
        return new Response(JSON.stringify({ success: true, applied: false, reason: "handoff_disabled", next_step: "Continue a conversa normalmente." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      const rules = (cfg.handoff_rules || []).filter((r: any) => r && r.keywords);
      if (rules.length === 0) {
        return new Response(JSON.stringify({ success: true, applied: false, reason: "no_rules_configured", next_step: "Continue a conversa normalmente." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      const tk = String(trigger_keyword || "").toLowerCase().trim();
      let matched: any = null;
      if (tk) {
        for (const rule of rules) {
          const kws = String(rule.keywords).toLowerCase().split(",").map((s: string) => s.trim()).filter(Boolean);
          if (kws.some((k: string) => tk.includes(k) || k.includes(tk))) {
            matched = rule;
            break;
          }
        }
      }

      if (!matched) {
        return new Response(JSON.stringify({ success: true, applied: false, reason: "no_rule_matched", trigger_keyword: tk, next_step: "Continue a conversa normalmente — nenhuma regra de transbordo bateu." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // Lookup do lead por telefone NORMALIZADO (sessao pode vir com 9o digito)
      const { data: hLookup } = await supabaseClient.rpc("find_patient_by_phone", { p_clinic_id: clinic_id, p_phone: lead_phone });
      const canonicalLeadPhone = (hLookup as any)?.canonical_phone || lead_phone;
      const { data: lead } = await supabaseClient.from("leads")
        .select("id, name, phone, stage_id, is_simulation").eq("clinic_id", clinic_id).eq("phone", canonicalLeadPhone).maybeSingle();
      if (!lead) {
        return new Response(JSON.stringify({ success: false, error_code: "lead_not_found", error: "Lead não encontrado para esse telefone" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      const actionsTaken: string[] = [];
      const matchedAction = String(matched.action || "notify_human");
      const willPauseIA = matchedAction === "pause_ai" || matchedAction === "transfer";
      const willNotify = matchedAction === "notify_human" || matchedAction === "transfer";
      const willFarewell = matchedAction === "transfer" && (matched.farewell_enabled !== false) && !!matched.farewell_message;

      // 1. Pausa IA + marca handoff
      // handoff_triggered_at é o sinal que impede o follow-up de reengajamento durante
      // atendimento humano (a query de follow-up filtra por handoff_triggered_at IS NULL).
      // A coluna é timestamp SEM timezone, armazenada em horário de São Paulo (UTC-3).
      if (willPauseIA) {
        const nowSP = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace("Z", "");
        await supabaseClient.from("leads")
          .update({ ai_enabled: false, handoff_triggered_at: nowSP })
          .eq("id", lead.id);
        actionsTaken.push("ai_paused");
      }

      // 2. Move etapa (se configurado) — via RPC-dona set_ticket_stage.
      // A etapa do lead vive no ticket aberto (tickets.stage_id, nao em leads.stage_id).
      // set_ticket_stage audita a origem (source='ia'), dispara o log de historico e,
      // com p_on_resolved='block', NUNCA mexe num ticket ja resolvido (nao desganha venda).
      let stage_changed = false;
      if (matched.move_to_stage) {
        const { data: openTicket } = await supabaseClient.from("tickets")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (openTicket?.id) {
          // ⚠️ MESMA régua da transferência do SDR: a IA não manda card para etapa de desfecho,
          // agendamento ou conversão. Aqui o destino vem do cadastro `handoff_rules` da clínica,
          // não do modelo, mas o efeito é idêntico: apontar uma regra de transbordo para "Ganho"
          // faz o trigger de invariante gravar tickets.outcome='ganho' + outcome_at sozinho, e
          // vira faturamento no painel sem ninguém aprovar. Nenhuma regra em produção aponta para
          // lá hoje (conferido em ai_config.handoff_rules), então isto é trava, não conserto.
          const { data: alvoHandoff } = await supabaseClient.from("funnel_stages")
            .select("id, name, slug, is_conversion").eq("id", matched.move_to_stage)
            .eq("clinic_id", clinic_id).maybeSingle();
          if (etapaProibida(alvoHandoff)) {
            await registrarErro(
              "handoff_etapa_bloqueada",
              `A regra de transbordo aponta para "${(alvoHandoff as any)?.name ?? "etapa desconhecida"}", que registra venda, perda ou agendamento. O card NÃO foi movido: desfecho não se decide por transbordo. Aponte a regra para uma etapa intermediária.`,
              "warning", clinic_id,
              { lead_id: lead.id, etapa_id: matched.move_to_stage, etapa: (alvoHandoff as any)?.name ?? null },
            );
          } else {
            const { data: moveRes } = await supabaseClient.rpc("set_ticket_stage", {
              p_ticket_id: openTicket.id,
              p_new_stage_id: matched.move_to_stage,
              p_source: "ia",
              p_on_resolved: "block",
            });
            const res = moveRes as any;
            if (res?.success && !res?.blocked && !res?.noop) {
              actionsTaken.push("stage_moved");
              stage_changed = true;
            }
          }
        }
      }

      // 3. Pega creds do uazapi (mesmo se não vai usar, deixa pronto)
      let uazapiToken: string | null = null;
      if (willNotify || willFarewell) {
        const { data: instance } = await supabaseClient.from("whatsapp_instances")
          .select("api_token").eq("clinic_id", clinic_id).maybeSingle();
        uazapiToken = instance?.api_token || null;
      }
      // Lead de simulacao (sandbox) sempre roteia pela fila (mesmo com a chave off).
      const viaEmissor = await emissorAtivo(supabaseClient, clinic_id, lead?.id ?? null);
      const leadIsSim = !!(lead as any)?.is_simulation;

      // 4. Notifica grupo. Pulado p/ lead de SIMULACAO: o aviso ao grupo nao tem lead_id, entao nao
      //    passa pelo roteamento de sandbox e vazaria para o grupo real da clinica.
      let notified = false;
      if (willNotify && !leadIsSim) {
        const { data: clinic } = await supabaseClient.from("clinics")
          .select("notification_group_id").eq("id", clinic_id).maybeSingle();
        const groupId = clinic?.notification_group_id;
        // Com o Emissor, o worker resolve o token; sem ele, exige uazapiToken (comportamento antigo).
        if (groupId && matched.notification_message && (viaEmissor || uazapiToken)) {
          const rendered = String(matched.notification_message)
            .replace(/\{lead_name\}/g, lead.name || "")
            .replace(/\{lead_phone\}/g, lead.phone || "")
            .replace(/\{trigger_keyword\}/g, tk);
          notified = await enviarOuEnfileirar(supabaseClient, uazapiToken || "", groupId, rendered, clinic_id, "aviso_ao_grupo", viaEmissor, "group", null);
          if (notified) actionsTaken.push("group_notified");
        }
      }

      // 5. Despedida (só em transfer)
      let farewell_sent = false;
      if (willFarewell && (viaEmissor || uazapiToken)) {
        // Emissor normaliza o telefone (to_kind='lead'); o inline usa o JID com @s.whatsapp.net.
        const bareNum = lead_phone.replace(/@.*/, "");
        const contactNum = viaEmissor ? bareNum : (lead_phone.includes("@") ? lead_phone : `${lead_phone}@s.whatsapp.net`);
        farewell_sent = await enviarOuEnfileirar(supabaseClient, uazapiToken || "", contactNum, matched.farewell_message, clinic_id, "despedida", viaEmissor, "lead", lead?.id ?? null, leadIsSim);
        if (farewell_sent) actionsTaken.push("farewell_sent");
      }

      // 5b. Registro in-app no centro de notificações (o grupo já foi avisado no passo 4,
      // se aplicável; p_notify_group=false evita duplicar o envio ao WhatsApp).
      try {
        await supabaseClient.rpc("notify_ops", {
          p_clinic_id: clinic_id,
          p_event: "handoff",
          p_title: matchedAction === "transfer"
            ? "Transbordo para humano"
            : matchedAction === "pause_ai" ? "IA pausada" : "Equipe notificada",
          p_body: `${lead.name || lead.phone} — gatilho: "${tk}"`,
          p_level: "warning",
          p_lead_id: lead.id,
          p_notify_group: false,
        });
      } catch (_e) { /* in-app é best-effort; nunca quebra o handoff */ }

      // 6. Mensagem de instrução pro LLM (next_step)
      let next_step: string;
      if (matchedAction === "transfer") {
        next_step = "Transbordo executado. A despedida já foi enviada ao cliente e a equipe foi avisada. NÃO responda mais nada — a IA está pausada para este lead.";
      } else if (matchedAction === "pause_ai") {
        next_step = "A IA foi pausada para este lead. Encerre brevemente sua resposta atual e não continue a conversa.";
      } else {
        next_step = "A equipe foi notificada por WhatsApp. Continue a conversa normalmente sem mencionar o transbordo.";
      }

      return new Response(
        JSON.stringify({
          success: true,
          applied: true,
          action_taken: matchedAction,
          matched_keyword: tk,
          actions: actionsTaken,
          stage_changed,
          farewell_sent,
          notified,
          next_step,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "request_card_link") {
      // Paciente quer pagar no CARTÃO. A IA nunca manda link nem valor com taxa (esse dado não
      // mora em lugar nenhum do sistema): ela avisa a equipe e segue a conversa. O aviso sai
      // pelos dois canais do notify_ops (sino do app + grupo do WhatsApp), respeitando as
      // preferências da clínica. Diferente do handoff, NÃO pausa a IA nem mexe na etapa.
      const { lead_phone, detail } = payload;
      if (!lead_phone) {
        return new Response(JSON.stringify({ success: false, error: "lead_phone is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // Lookup por telefone NORMALIZADO (a sessão pode vir com/sem o 9º dígito) — mesmo
      // padrão do trigger_handoff e do close_as_lost.
      const { data: cLookup } = await supabaseClient.rpc("find_patient_by_phone", { p_clinic_id: clinic_id, p_phone: lead_phone });
      const canonicalLeadPhone = (cLookup as any)?.canonical_phone || lead_phone;
      const { data: lead } = await supabaseClient.from("leads")
        .select("id, name, phone, is_simulation").eq("clinic_id", clinic_id).eq("phone", canonicalLeadPhone).maybeSingle();
      if (!lead) {
        return new Response(JSON.stringify({ success: false, error_code: "lead_not_found", error: "Lead não encontrado para esse telefone" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      const cardIsSim = !!(lead as any).is_simulation;

      const { data: cardTickets } = await supabaseClient.from("tickets")
        .select("id").eq("lead_id", lead.id).eq("status", "open")
        .order("created_at", { ascending: false }).limit(1);
      const cardTicket = cardTickets && cardTickets.length > 0 ? cardTickets[0] : null;

      const quem = lead.name || lead.phone;
      const oQue = String(detail || "").trim();

      // Diagnóstico ANTES de notificar: com sino_all e group_all desligados o notify_ops não
      // entrega em canal nenhum e não reclama. Sem esta checagem o pedido do paciente sumiria
      // em silêncio, que é o modo de falha que este sistema mais paga caro. Não é defeito de
      // código, é chave desligada — por isso entra como warning, e a IA não promete ao paciente
      // que "a equipe foi avisada": ela diz que o link vem por aqui, que é o que a equipe faz.
      const { data: prefClinic } = await supabaseClient.from("clinics")
        .select("notification_prefs, notification_group_id").eq("id", clinic_id).maybeSingle();
      const prefs = (prefClinic?.notification_prefs ?? {}) as Record<string, any>;
      const ev = prefs?.events?.link_cartao ?? {};
      const sinoOn = (prefs.sino_all ?? true) !== false && (ev.sino ?? true) !== false;
      const grupoOn = (prefs.group_all ?? true) !== false && (ev.grupo ?? true) !== false
        && !!prefClinic?.notification_group_id;
      // Lead de simulação não acende a Central: o notify_ops já ignora simulação, então "não
      // chegou a ninguém" ali é o comportamento correto do sandbox, não um alerta de verdade.
      if (!sinoOn && !grupoOn && !cardIsSim) {
        await registrarErro(
          "link_cartao_sem_canal",
          "Paciente pediu o link do cartão e o aviso não tem para onde ir — sino e grupo desligados nesta clínica",
          "warning", clinic_id,
          { lead_id: lead.id, telefone: lead.phone, sino_all: prefs.sino_all ?? true, group_all: prefs.group_all ?? true },
        );
      }

      let avisado = false;
      try {
        // p_notify_group=true: o notify_ops decide o envio ao grupo pelas prefs da clínica e
        // já ignora lead de simulação (sandbox não vaza para o grupo real).
        await supabaseClient.rpc("notify_ops", {
          p_clinic_id: clinic_id,
          p_event: "link_cartao",
          p_title: "Link do cartão pendente",
          p_body: `${quem} quer pagar no cartão e está esperando o link${oQue ? ` — ${oQue}` : ""}.`,
          p_level: "warning",
          p_lead_id: lead.id,
          p_ticket_id: cardTicket?.id ?? null,
          p_notify_group: true,
          p_group_text: `💳 *Link do cartão pendente*\n${quem} (${lead.phone}) pediu para pagar no cartão e está esperando o link.${oQue ? `\n${oQue}` : ""}`,
        });
        avisado = true;
      } catch (e) {
        // Falha muda aqui = paciente esperando um link que ninguém sabe que foi pedido.
        await registrarErro(
          "aviso_link_cartao_falhou",
          "Não deu para avisar a equipe que o paciente pediu o link do cartão — ele pode ficar esperando",
          "critical", clinic_id,
          { lead_id: lead.id, telefone: lead.phone, erro: (e as Error)?.message ?? String(e) },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          applied: avisado,
          notified: avisado,
          canais: { sino: sinoOn, grupo: grupoOn },
          // A redação é a MESMA nos dois casos de propósito: o que a IA promete ao paciente é o
          // link chegando por aqui (a equipe lê a conversa), nunca "fulano já foi avisado".
          next_step:
            "Diga ao paciente que o link do cartão vem por aqui pela equipe, sem prometer prazo. " +
            "NÃO envie link, NÃO informe valor de taxa nem de parcela, NÃO ofereça outra chave de " +
            "pagamento. Depois siga a conversa normalmente.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "transfer_to_specialist") {
      // SDR: fim do PRÉ-atendimento. Move o card para a etapa escolhida, pausa a IA para este lead
      // e avisa a equipe com o resumo dos dados coletados. É o "passei para o especialista".
      //
      // ⚠️ O destino é validado AQUI, não no enum do modelo. O enum é dica ao provedor (o Gemini
      // pode devolver valor fora dele), e mover um card para 'ganho' faz o trigger
      // fn_enforce_ticket_resolution_consistency gravar tickets.outcome='ganho' + outcome_at
      // sozinho — ou seja, uma alucinação viraria FATURAMENTO nos painéis, e ninguém veria até o
      // fechamento do mês. Etapa de desfecho é recusada mesmo que o modelo peça.
      const { lead_phone, etapa, resumo } = payload;
      if (!lead_phone) {
        return new Response(JSON.stringify({ success: false, error: "lead_phone is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // A regra de etapa proibida (`etapaProibida`) e o normalizador de acento (`normalizarTexto`)
      // vêm IMPORTADOS de _shared/agent/tools.ts, o mesmo módulo que monta o enum. Revalidar no
      // servidor é a defesa correta; recopiar a regra é só criar uma segunda verdade que envelhece
      // sozinha. Se um slug novo entrar lá, o worker para de oferecer E o servidor para de aceitar,
      // no mesmo commit.
      const norm = normalizarTexto;

      // GATE, revalidado no servidor pela MESMA função que o worker usa para decidir se a tool
      // entra no spec (clinicaEmModoSdr). Revalidar é defesa em profundidade barata:
      // `executeToolCall` resolve a tool pelo NOME, sem allowlist do turno, então um modelo que
      // "lembrasse" o nome chamaria assim mesmo.
      //
      // ⚠️ "Não consegui ler" e "não é SDR" são respostas DIFERENTES, com códigos diferentes. Um
      // timeout de banco respondido como "esta empresa não é SDR" mandava o agente desistir de vez
      // e jogar fora os dados que ele já tinha coletado, sem caminho de volta.
      const modoSdr = await clinicaEmModoSdr(supabaseClient, clinic_id);
      if (modoSdr.erro) {
        await registrarErro(
          "transferencia_gate_ilegivel",
          "O SDR tentou transferir e não consegui ler o Prompt Fixo da clínica para confirmar o modo SDR; a transferência não aconteceu nesta tentativa",
          "error", clinic_id, { erro: modoSdr.erro },
        );
        return new Response(JSON.stringify({
          success: false, error_code: "gate_unavailable",
          error: "Não consegui confirmar a configuração da empresa agora.",
          next_step: "Tente TRANSFERIR_PARA_ESPECIALISTA mais UMA vez. Se falhar de novo, diga ao cliente que anotou tudo e que o especialista retorna, e encerre.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      if (!modoSdr.sdr) {
        return new Response(JSON.stringify({
          success: false, error_code: "sdr_disabled",
          error: "Esta empresa não opera em modo SDR (o Prompt Fixo dela não é do tipo SDR).",
          next_step: "Continue a conversa normalmente e NÃO mencione transferência.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // Lookup por telefone NORMALIZADO (a sessão pode vir com/sem o 9º dígito) — mesmo padrão
      // do trigger_handoff, do request_card_link e do close_as_lost.
      //
      // ⚠️ O erro é capturado, não engolido. Telefone duplicado na mesma clínica (acontece: lead de
      // formulário sem DDD escapa do índice de unicidade) faz o maybeSingle devolver ERRO com
      // data=null, e sem separar os dois o agente concluía "esse cliente não existe" para alguém
      // que existe duas vezes, sem nada na Central para ninguém desconfiar.
      const { data: tLookup } = await supabaseClient.rpc("find_patient_by_phone", { p_clinic_id: clinic_id, p_phone: lead_phone });
      const canonicalLeadPhone = (tLookup as any)?.canonical_phone || lead_phone;
      const { data: lead, error: leadErr } = await supabaseClient.from("leads")
        .select("id, name, phone, is_simulation").eq("clinic_id", clinic_id).eq("phone", canonicalLeadPhone).maybeSingle();
      if (leadErr) {
        await registrarErro(
          "transferencia_lead_ilegivel",
          "O SDR tentou transferir e a busca do contato falhou (pode ser telefone duplicado nesta clínica); a transferência não aconteceu",
          "error", clinic_id, { telefone: canonicalLeadPhone, erro: leadErr.message ?? String(leadErr) },
        );
        return new Response(JSON.stringify({
          success: false, error_code: "lead_lookup_failed",
          error: "Não consegui localizar o cadastro deste contato agora.",
          next_step: "Tente TRANSFERIR_PARA_ESPECIALISTA mais UMA vez. Se falhar de novo, diga ao cliente que anotou tudo e que o especialista retorna, e encerre.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      if (!lead) {
        return new Response(JSON.stringify({ success: false, error_code: "lead_not_found", error: "Lead não encontrado para esse telefone" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      const transfIsSim = !!(lead as any).is_simulation;

      // Resolve a etapa pelo NOME (é o que vai no enum, porque etapa criada pela tela nasce com
      // slug NULL). Cai para o slug se o modelo mandar o slug. Sem acento e sem caixa.
      const { data: stages, error: stErr } = await supabaseClient.from("funnel_stages")
        .select("id, name, slug, is_hidden, is_conversion").eq("clinic_id", clinic_id).order("position", { ascending: true });

      // ⚠️ Falha de leitura NÃO aborta a transferência, e essa escolha é deliberada. Abortar
      // deixava o pior estado possível: o modelo já vai se despedir, e o contato ficaria com a IA
      // ligada, o card parado e ninguém avisado. Aqui a transferência DEGRADA: o card não anda,
      // mas a IA para e a equipe recebe o resumo, então um humano assume. O card errado é
      // conserto de um arrasto no Kanban; contato esquecido é cliente perdido.
      // ⚠️ Todos os alertas daqui para baixo checam `transfIsSim`: lead de simulação é o Super Admin
      // testando, e acender a Central com o MESMO fingerprint de um incidente real faz ele caçar um
      // problema que ele mesmo acabou de provocar. É a régua que o notify_ops já usa.
      let destino: any = null;
      if (stErr) {
        if (!transfIsSim) {
          await registrarErro(
            "transferencia_etapas_ilegiveis",
            "O SDR transferiu o contato mas não consegui ler as etapas do funil; o card NÃO mudou de coluna (a equipe foi avisada assim mesmo)",
            "error", clinic_id, { lead_id: lead.id, erro: stErr.message ?? String(stErr) },
          );
        }
      } else {
        const elegiveis = (stages ?? []).filter((e: any) =>
          e?.id && e?.name && e.is_hidden !== true && !etapaProibida(e));
        const alvo = norm(etapa);
        destino = elegiveis.find((e: any) => norm(e.name) === alvo)
          ?? elegiveis.find((e: any) => e.slug && norm(e.slug) === alvo);

        if (!destino) {
          // Etapa proibida pedida explicitamente é RECUSA de segurança, não "não achei": vale um
          // código próprio, para o modelo parar de insistir no mesmo valor em vez de tentar de novo.
          const pediuProibida = (stages ?? []).some((e: any) =>
            (norm(e.name) === alvo || (e.slug && norm(e.slug) === alvo)) && etapaProibida(e));
          // ⚠️ Este é o caminho de degradação MAIS PROVÁVEL (o enum é dica ao provedor, não trava),
          // e era o único mudo: o agente já ia se despedir, e o contato ficava com a IA ligada, o
          // card parado e ninguém avisado. Silêncio aqui é o modo de falha que a §0.5 proíbe.
          if (!transfIsSim) {
            await registrarErro(
              "transferencia_etapa_invalida",
              `O SDR tentou transferir para a etapa "${etapa}", que ${pediuProibida ? "registra desfecho e não pode receber card por IA" : "não existe nesta empresa"}; a transferência não aconteceu nesta tentativa`,
              "warning", clinic_id,
              { lead_id: lead.id, etapa_pedida: etapa, disponiveis: elegiveis.map((e: any) => e.name), resumo: String(resumo ?? "").slice(0, 500) },
            );
          }
          return new Response(JSON.stringify({
            success: false,
            error_code: pediuProibida ? "stage_forbidden" : "stage_not_found",
            error: pediuProibida
              ? `A etapa "${etapa}" registra desfecho ou conversão e não pode ser usada para transferência.`
              : `Etapa "${etapa}" não existe nesta empresa.`,
            etapas_disponiveis: elegiveis.map((e: any) => e.name),
            next_step: "Chame TRANSFERIR_PARA_ESPECIALISTA de novo usando EXATAMENTE um dos nomes de `etapas_disponiveis`.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
        }
      }

      // 1. TOMADA DE POSSE ATÔMICA + pausa da IA, no mesmo comando.
      //
      // ⚠️ Ler o estado e decidir depois (check-then-act) NÃO segura duas chamadas em paralelo, que
      // é justamente o caso que a trava existe para cobrir: o worker executa as tool calls do turno
      // em Promise.all, então as duas leem "ainda não transferido" antes de qualquer uma escrever.
      // Aqui quem escreve é o próprio filtro: `not ai_enabled is false` só casa uma vez, e o
      // perdedor recebe zero linhas. É a diferença entre uma trava e a aparência de uma.
      //
      // A condição é `is not false` (e não `= true`) de propósito: lead com ai_enabled NULL conversa
      // normalmente (ingest_wa_message usa a MESMA régua), e `= true` recusaria a transferência dele.
      //
      // handoff_triggered_at, além de parar o agente, é o sinal que impede o follow-up de
      // reengajamento de cutucar quem já está em atendimento humano. Coluna timestamp SEM timezone,
      // gravada em horário de São Paulo.
      const nowSPTransf = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace("Z", "");
      const { data: claimed, error: pauseErr } = await supabaseClient.from("leads")
        .update({ ai_enabled: false, handoff_triggered_at: nowSPTransf })
        .eq("id", lead.id).not("ai_enabled", "is", false)
        .select("id");
      if (pauseErr && !transfIsSim) {
        // IA não pausada = ela continua respondendo depois de dizer "passei para o especialista",
        // que é exatamente a incoerência que mais assusta o cliente.
        await registrarErro(
          "transferencia_pausa_ia_falhou",
          "O SDR transferiu o contato mas NÃO consegui pausar a IA; ela pode continuar respondendo por cima do vendedor",
          "critical", clinic_id,
          { lead_id: lead.id, erro: pauseErr.message ?? String(pauseErr) },
        );
      }

      // Perdeu a posse: alguém já pausou este lead neste instante. Duas causas possíveis (outra
      // transferência em paralelo, ou um transbordo no mesmo turno) e, nas duas, alguém JÁ está
      // cuidando deste contato e JÁ avisou a equipe pelo caminho dele.
      //
      // ⚠️ A versão anterior consultava `notifications` para decidir. Não funciona: o notify_ops só
      // grava lá quando o SINO da clínica está ligado, e 27 das 28 clínicas ativas estão com sino e
      // grupo desligados. A consulta voltaria vazia quase sempre e a "trava" deixaria passar.
      //
      // O card ainda é movido (é idempotente e o vendedor precisa achá-lo na coluna certa), mas o
      // aviso NÃO é repetido. E o dado não se perde por isso: a ficha do contato (leads.ai_long_memory,
      // gravada a cada turno e nunca apagada) aparece no próprio card do Kanban.
      const perdeuPosse = !pauseErr && (claimed ?? []).length === 0;

      // 2. Move o card. A etapa vive no ticket ABERTO (tickets.stage_id, não em leads.stage_id).
      // p_source='ia' audita a origem no histórico; p_on_resolved='block' nunca mexe em ticket já
      // resolvido (não desganha venda) e NÃO abre ciclo novo — por isso set_ticket_stage e nunca
      // move_lead_stage, que passa 'new_cycle' e partiria o atendimento em dois cards.
      let stage_changed = false;  // o card MUDOU de coluna nesta chamada
      let stage_ok = false;       // o card ESTÁ na coluna certa (inclui já estar lá antes)
      const { data: tTickets, error: tkErr } = await supabaseClient.from("tickets")
        .select("id").eq("lead_id", lead.id).eq("status", "open")
        .order("opened_at", { ascending: false }).limit(1);
      const tTicket = tTickets && tTickets.length > 0 ? tTickets[0] : null;
      if (tkErr && !transfIsSim) {
        // Sem isto, uma consulta que FALHOU virava a afirmação "este contato não tem atendimento
        // aberto", e o operador ia procurar um card sumido que existe.
        await registrarErro(
          "transferencia_ticket_ilegivel",
          "O SDR transferiu o contato e a busca do atendimento aberto falhou; o card não foi movido (a equipe foi avisada assim mesmo)",
          "error", clinic_id, { lead_id: lead.id, erro: tkErr.message ?? String(tkErr) },
        );
      }
      if (destino && tTicket?.id) {
        const { data: moveRes, error: moveErr } = await supabaseClient.rpc("set_ticket_stage", {
          p_ticket_id: tTicket.id,
          p_new_stage_id: destino.id,
          p_source: "ia",
          p_on_resolved: "block",
        });
        const mv = moveRes as any;
        stage_changed = !!(mv?.success && !mv?.blocked && !mv?.noop);
        // `noop` = o card JÁ ESTAVA na coluna de destino. Para o aviso à equipe isso é sucesso, não
        // falha: tratá-lo como falha escondia a coluna justo no caso em que ela estava certa, e o
        // vendedor ficava sem saber onde procurar.
        stage_ok = !!(mv?.success && !mv?.blocked);
        // ⚠️ `blocked` vem com success=TRUE (o ticket já tinha desfecho e a RPC recusa por
        // segurança). Sem testá-lo à parte, o card não anda e nada acende: a equipe leria no
        // grupo uma coluna onde o card não está.
        if ((moveErr || (mv && mv.success === false) || mv?.blocked === true) && !transfIsSim) {
          await registrarErro(
            "transferencia_etapa_falhou",
            mv?.blocked === true
              ? "O SDR transferiu um contato cujo atendimento JÁ tinha desfecho; o card ficou onde estava (a equipe foi avisada assim mesmo)"
              : "O SDR transferiu o contato mas o card NÃO mudou de etapa; ele fica invisível na fila do vendedor",
            mv?.blocked === true ? "warning" : "error", clinic_id,
            { lead_id: lead.id, ticket_id: tTicket.id, etapa: destino.name, blocked: mv?.blocked === true, erro: moveErr?.message ?? mv?.error ?? null },
          );
        }
      } else if (destino && !tTicket?.id && !tkErr && !transfIsSim) {
        // Sem ticket aberto não há onde gravar etapa. Raro (o card nasce junto da conversa), mas
        // calado seria pior: a equipe é avisada e o card não aparece na coluna.
        await registrarErro(
          "transferencia_sem_ticket",
          "O SDR transferiu um contato que não tem atendimento aberto; não há card para mover (a equipe foi avisada assim mesmo)",
          "warning", clinic_id, { lead_id: lead.id, telefone: lead.phone, etapa: destino.name },
        );
      }

      // 3. Avisa a equipe. Diagnóstico ANTES: com sino_all e group_all desligados (ou sem grupo
      // cadastrado) o notify_ops não entrega em canal nenhum e não reclama. Sem esta checagem o
      // pedido de orçamento sumiria em silêncio. Não é defeito de código, é chave desligada —
      // por isso warning, e por isso o card já foi movido antes: a fila do Kanban é o backup.
      //
      // ⚠️ O erro é capturado: com a leitura falhando, todos os `?? true` abaixo diziam "está tudo
      // ligado" e o alerta de "não tem para onde avisar" nunca sairia — justo o alerta que este
      // bloco existe para produzir.
      const { data: prefClinicT, error: prefErr } = await supabaseClient.from("clinics")
        .select("notification_prefs, notification_group_id").eq("id", clinic_id).maybeSingle();
      if (prefErr && !transfIsSim) {
        await registrarErro(
          "transferencia_prefs_ilegiveis",
          "Não consegui ler as preferências de notificação da clínica ao transferir; não dá para saber se o aviso do orçamento chegou a alguém",
          "warning", clinic_id, { lead_id: lead.id, erro: prefErr.message ?? String(prefErr) },
        );
      }
      const prefsT = (prefClinicT?.notification_prefs ?? {}) as Record<string, any>;
      const evT = (prefsT?.events as any)?.solicitacao_orcamento ?? {};
      const sinoOnT = (prefsT.sino_all ?? true) !== false && (evT.sino ?? true) !== false;
      const grupoOnT = (prefsT.group_all ?? true) !== false && (evT.grupo ?? true) !== false
        && !!prefClinicT?.notification_group_id;
      const nomeT = String(lead.name ?? "").trim();
      const quemT = nomeT || lead.phone;
      const cabecalhoT = nomeT ? `${nomeT}\n${lead.phone}` : String(lead.phone ?? "");
      const resumoT = String(resumo || "").trim();

      // ⚠️ SEM CANAL, O RESUMO VAI PARA A CENTRAL. Medido em 12/08/2026: 27 das 28 clínicas ativas
      // estão com sino e grupo desligados, então este é o caso COMUM, não a exceção. O dado do
      // atendimento não se perde (a ficha do contato, leads.ai_long_memory, é gravada a cada turno,
      // nunca apagada, e aparece no próprio card do Kanban), mas o resumo curto que o modelo montou
      // só existe nesta chamada: sem gravá-lo aqui, ele evapora. Vai no contexto do alerta, que é
      // registro durável e já é onde o operador olha.
      const semCanalT = !sinoOnT && !grupoOnT;
      if (semCanalT && !transfIsSim) {
        await registrarErro(
          "solicitacao_orcamento_sem_canal",
          "O SDR terminou a coleta e o aviso não tem para onde ir (sino e grupo desligados nesta clínica). O card foi movido no Kanban e os dados coletados estão no contexto deste alerta e na ficha do contato.",
          "warning", clinic_id,
          {
            lead_id: lead.id, telefone: lead.phone, nome: nomeT || null,
            etapa: destino?.name ?? null,
            dados_coletados: resumoT || null,
            sino_all: prefsT.sino_all ?? true, group_all: prefsT.group_all ?? true,
          },
        );
      }

      // ⚠️ O resumo É a entrega desta feature: é com ele que o vendedor orça sem reler a conversa.
      // Chegar vazio não impede a transferência (deixar o contato para trás é pior que entregá-lo
      // sem ficha), mas TEM que aparecer, senão o defeito fica invisível: a equipe recebe um aviso
      // oco, a IA já está desligada e ninguém mais consegue perguntar ao cliente.
      if (!resumoT && !transfIsSim) {
        await registrarErro(
          "transferencia_resumo_vazio",
          "O SDR transferiu o contato SEM os dados coletados; o vendedor recebeu só nome e telefone e vai ter que abrir o card para ler a ficha do contato",
          "warning", clinic_id, { lead_id: lead.id, telefone: lead.phone, etapa: destino?.name ?? null },
        );
      }

      // Só afirma a coluna quando o card ESTÁ mesmo lá (inclui já estar antes, ver stage_ok).
      // Dizer "Card em: X" sem isso manda o vendedor procurar numa coluna vazia, e ele conclui que
      // o sistema perdeu o lead.
      const ondeT = stage_ok && destino ? `\n\n_Card em: ${destino.name}_` : "";
      let avisadoT = false;
      // Quem perdeu a posse NÃO reavisa: o dono da posse já avisou pelo caminho dele, e duas
      // mensagens iguais no grupo para o mesmo contato confundem mais do que ajudam.
      if (!perdeuPosse) {
        // ⚠️ Sem try/catch: o supabase-js NÃO lança em erro de RPC, devolve `{ error }`. Um
        // try/catch aqui é código morto que finge cobertura — o alerta nunca dispararia e a falha
        // do aviso sairia calada, que é o modo de falha que este sistema mais paga caro (§0.5).
        const { error: notifyErr } = await supabaseClient.rpc("notify_ops", {
          p_clinic_id: clinic_id,
          p_event: "solicitacao_orcamento",
          p_title: "Solicitação de orçamento",
          p_body: `${quemT} — ${resumoT || "dados coletados pelo pré-atendimento"}`,
          p_level: "warning",
          p_lead_id: lead.id,
          p_ticket_id: tTicket?.id ?? null,
          p_notify_group: true,
          p_group_text: `📐 *Solicitação de orçamento*\n${cabecalhoT}\n\n${resumoT || "Dados coletados pelo pré-atendimento."}${ondeT}`,
        });
        if (notifyErr) {
          await registrarErro(
            "aviso_solicitacao_orcamento_falhou",
            "Não deu para avisar a equipe que o pré-atendimento terminou; o cliente está esperando um orçamento que ninguém sabe que foi pedido",
            "critical", clinic_id,
            { lead_id: lead.id, telefone: lead.phone, etapa: destino?.name ?? null, dados_coletados: resumoT || null, erro: notifyErr.message ?? String(notifyErr) },
          );
        } else {
          // ⚠️ `notified` só é verdade quando havia CANAL. O notify_ops devolve sucesso mesmo sem
          // entregar em lugar nenhum (é o comportamento dele quando as chaves estão desligadas), e
          // reportar `notified: true` nesse caso fazia o retorno afirmar uma entrega que não houve.
          avisadoT = sinoOnT || grupoOnT;
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          applied: !perdeuPosse,
          etapa: destino?.name ?? null,
          stage_changed,
          stage_ok,
          notified: avisadoT,
          canais: { sino: sinoOnT, grupo: grupoOnT },
          // A redação NÃO muda conforme deu certo ou não: o que o cliente ouve é sempre "está com
          // o especialista". Dizer "a equipe foi avisada" seria prometer em nome de um canal que
          // pode estar desligado, e o cliente não tem nada a ver com isso.
          next_step:
            "Feito. Diga ao cliente, em UMA mensagem curta, que você passou os dados para o especialista " +
            "e que ele retorna o mais breve possível. NÃO prometa prazo, NÃO passe preço final, NÃO faça " +
            "mais perguntas. Esta é sua ÚLTIMA mensagem neste atendimento: a partir daqui você está em " +
            "silêncio para este contato.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "close_as_lost") {
      // Encerra o ticket aberto do lead como PERDIDO, com MOTIVO escolhido do catálogo da clínica.
      // Mantém o card aberto na etapa Perdido (resolve=false) e NÃO desliga a IA: o follow-up de
      // reengajamento para sozinho porque fn_followup_candidates_reengagement exclui a etapa
      // 'perdido'. A despedida é a resposta final do próprio agente (instruída via next_step).
      //
      // ⚠️ Este caminho NÃO mexe em `leads.is_not_lead`, nem para 'contato_indevido'. Decisão do
      // dono (10/08): quem adiciona à lista de não-lead é a secretária, e contato dessa lista já
      // sai de todos os KPIs por conta da v_kpi_outcomes.
      const { lead_phone, detail, motivo, detalhe: detalheArg } = payload;
      // `detail` é o nome antigo do campo; aceito enquanto houver worker antigo em voo no deploy.
      const detalhe = detalheArg || detail || null;
      if (!lead_phone) {
        return new Response(JSON.stringify({ success: false, error: "lead_phone is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // Lookup do lead por telefone NORMALIZADO (sessao pode vir com 9o digito) — mesmo
      // padrão do trigger_handoff.
      const { data: lLookup } = await supabaseClient.rpc("find_patient_by_phone", { p_clinic_id: clinic_id, p_phone: lead_phone });
      const canonicalLeadPhone = (lLookup as any)?.canonical_phone || lead_phone;
      const { data: lead } = await supabaseClient.from("leads")
        .select("id, name, phone").eq("clinic_id", clinic_id).eq("phone", canonicalLeadPhone).maybeSingle();
      if (!lead) {
        return new Response(JSON.stringify({ success: false, error_code: "lead_not_found", error: "Lead não encontrado para esse telefone" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // Acha o ticket aberto do lead (invariante: no máximo 1 aberto por lead)
      const { data: openTickets } = await supabaseClient.from("tickets")
        .select("id").eq("lead_id", lead.id).eq("status", "open")
        .order("created_at", { ascending: false }).limit(1);
      const openTicket = openTickets && openTickets.length > 0 ? openTickets[0] : null;
      if (!openTicket) {
        return new Response(JSON.stringify({
          // Texto NEUTRO e sem causa presumida: a tool agora encerra por qualquer motivo (preço,
          // desinteresse, concorrente...), e mandar dizer "não atendemos esse caso" faria o agente
          // dispensar quem só achou caro. "Clínica" também sai: 13 tenants são loja e metalúrgica.
          success: true, applied: false, reason: "no_open_ticket",
          next_step: "Não há atendimento aberto para encerrar. Apenas conclua a conversa com gentileza, coerente com o que já foi conversado, sem oferecer agendamento.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // ---- Validação do motivo NO SERVIDOR ----
      // O `enum` no schema da tool é dica ao provedor, não garantia: dois terços do tráfego rodam
      // num modelo em preview com formato próprio de tool. A trava de verdade é esta.
      const { data: catalogo, error: catErr } = await supabaseClient.rpc("fn_clinic_loss_reasons", { p_clinic_id: clinic_id });
      if (catErr) {
        // Engolir este erro DESLIGA a trava em silêncio: sem catálogo, `permitidos` fica vazio, a
        // exigência de motivo é pulada e o encerramento sai com o rótulo legado — a perda volta a
        // nascer muda e ninguém fica sabendo. Melhor recusar e deixar a IA seguir conversando.
        await registrarErro(
          "catalogo_motivos_falhou",
          "Nao consegui ler o catalogo de motivos de perda; o encerramento foi recusado para nao gravar perda sem motivo",
          "error", clinic_id, { erro: catErr.message, lead_id: lead.id },
        );
        return new Response(JSON.stringify({
          success: false, error_code: "catalogo_indisponivel",
          error: "Nao consegui carregar a lista de motivos agora.",
          next_step: "Nao encerre o atendimento agora. Siga a conversa normalmente e, se o caso realmente nao for seguir, acione o atendimento humano (ACIONAR_HANDOFF).",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      const permitidos = ((catalogo as any[]) || []).filter((m) => m.ia_pode_escolher);
      const escolhido = permitidos.find((m) => m.slug === motivo);

      // Sem motivo nenhum: recusa e devolve a lista. Não encerra às cegas — perda muda é
      // exatamente o problema que este caminho existe para acabar.
      // ⚠️ Sem `&& permitidos.length > 0`: com catálogo vazio (sem erro) a exigência era PULADA e o
      // encerramento saía com o rótulo legado, ou seja o buraco que este bloco fecha reaparecia
      // pela porta dos fundos. Catálogo vazio é defeito de configuração, não licença para gravar
      // perda muda.
      if (!motivo) {
        return new Response(JSON.stringify({
          success: false, error_code: "motivo_obrigatorio",
          error: "É obrigatório escolher um motivo da lista.",
          motivos: permitidos.map((m: any) => ({ motivo: m.slug, quando_usar: m.descricao })),
          next_step: "Escolha UM motivo da lista em `motivos` e chame ENCERRAR_COMO_PERDIDO de novo. Não responda ao paciente antes disso.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // 'outro' sem detalhe vira lixo no relatório: é a única forma de exigir a explicação.
      if (motivo === "outro" && !detalhe) {
        return new Response(JSON.stringify({
          success: false, error_code: "detalhe_obrigatorio",
          error: 'O motivo "outro" exige o campo `detalhe`.',
          next_step: "Chame ENCERRAR_COMO_PERDIDO de novo preenchendo `detalhe` com o caso em uma frase.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // Motivo fora da lista: NÃO aceita o texto inventado como categoria. Cai em 'outro', guarda
      // o que o modelo escreveu na anotação e acende a Central (prompt/catálogo desalinhados).
      let slugFinal = escolhido?.slug ?? null;
      let rotuloFinal = escolhido?.label ?? null;
      let anotacao = detalhe || null;
      if (motivo && !escolhido) {
        // O rótulo tem que sair do CATÁLOGO, não ser a string "Outro" na mão: o rótulo real é
        // "Outro (descreva)", e "Outro" sozinho não tem tradução no de-para — o slug ficaria nulo
        // e a finalize_ticket ainda acenderia um SEGUNDO alerta em cima do que já registramos aqui.
        const balde = permitidos.find((m: any) => m.slug === "outro");
        slugFinal = balde?.slug ?? null;
        rotuloFinal = balde?.label ?? null;
        anotacao = [`[motivo fora da lista: ${motivo}]`, detalhe].filter(Boolean).join(" ");
        await registrarErro(
          "motivo_perda_invalido",
          `A IA escolheu um motivo de perda que não existe no catálogo da clínica: "${motivo}"`,
          "warning", clinic_id,
          { motivo_recebido: motivo, lead_id: lead.id, permitidos: permitidos.map((m: any) => m.slug) },
        );
      }

      // Marca PERDIDO + motivo, mantendo o card aberto (resolve=false). O trigger de
      // invariante (fn_enforce_ticket_resolution_consistency) move o card para a etapa
      // slug 'perdido' e trg_log_ticket_stage_change registra em lead_stage_history.
      const { data: fin, error: finErr } = await supabaseClient.rpc("finalize_ticket", {
        p_ticket_id: openTicket.id,
        p_outcome: "perdido",
        p_loss_reason: rotuloFinal ?? "Fora do perfil",
        // p_notes NÃO: `tickets.notes` é campo compartilhado e três rotinas o apagam. A anotação
        // da perda tem coluna própria agora.
        p_notes: null,
        p_resolve: false,
        p_loss_reason_slug: slugFinal,
        p_loss_note: anotacao,
      });
      if (finErr || !(fin as any)?.success) {
        return new Response(JSON.stringify({
          success: false, error_code: (fin as any)?.error_code || "finalize_failed",
          error: finErr?.message || "Falha ao encerrar o ticket como perdido",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      return new Response(JSON.stringify({
        success: true,
        applied: true,
        ticket_id: openTicket.id,
        lead_id: lead.id,
        outcome: "perdido",
        loss_reason: rotuloFinal ?? "Fora do perfil",
        loss_reason_slug: slugFinal,
        next_step: "Atendimento encerrado como perdido. Despeça-se com gentileza, explicando brevemente o motivo e, se útil, indique onde a pessoa pode ser atendida. NÃO ofereça agendamento.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    } else {
      return new Response(JSON.stringify({ success: false, error: "Invalid action" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }
  } catch (error) {
    console.error(error);
    // Qualquer exceção aqui significa que a ferramenta da IA explodiu no meio de um atendimento
    // real. A IA recebe um erro, se desculpa e segue conversando — e o paciente NÃO é agendado.
    // Era o buraco mais caro do sistema: 839 linhas e este `console.error` como única testemunha.
    await registrarErro(
      "ferramenta_quebrou_" + (acaoAtual ?? "desconhecida"),
      'A ferramenta "' + (acaoAtual ?? "?") + '" da IA quebrou durante um atendimento',
      "critical", clinicAtual,
      { acao: acaoAtual, erro: (error as Error).message, stack: (error as Error).stack?.slice(0, 500) },
    );
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});
