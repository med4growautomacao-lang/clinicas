import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente", confirmado: "Confirmado", compareceu: "Compareceu",
  realizado: "Realizado", cancelado: "Cancelado", faltou: "Faltou",
};

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";

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
      .select("id, slug, modality, is_active").eq("id", ctId).eq("doctor_id", doctorId).maybeSingle();
    if (data) return data.is_active === false ? [] : [data];
    // ctId não pertence a este médico -> tenta resolver por modalidade/slug abaixo
  }
  const key = (modalityOrSlug || "").trim().toLowerCase();
  const { data: types } = await supabaseClient.from("consultation_types")
    .select("id, slug, modality, is_active").eq("doctor_id", doctorId).eq("is_active", true);
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

async function fetchSlotsForDoctorDate(
  supabaseClient: any,
  doctorId: string,
  date: string,
  modality: string = "presencial",
  consultationTypeId?: string,
): Promise<string[]> {
  const matches = await findDoctorTypes(supabaseClient, doctorId, consultationTypeId, modality);
  if (matches.length === 0) return [];
  const typeId = preferType(matches).id;
  const { data, error } = await supabaseClient.rpc("get_available_slots", {
    p_doctor_id: doctorId, p_date: date, p_consultation_type_id: typeId,
  });
  if (error) {
    console.error("get_available_slots error", { doctorId, date, typeId, msg: error.message });
    return [];
  }
  return (data || []).map((s: any) => (s.slot_time || "").toString().substring(0, 5));
}

// Busca alternativas de horario para a IA oferecer: tenta a data pedida e os 14 dias seguintes.
async function findAlternativeSlots(
  supabaseClient: any,
  doctorId: string,
  fromDate: string,
  modality: string,
  consultationTypeId?: string,
): Promise<{ date: string; slots: string[] } | null> {
  for (let i = 0; i <= 14; i++) {
    const d = addDays(fromDate, i);
    const slots = await fetchSlotsForDoctorDate(supabaseClient, doctorId, d, modality, consultationTypeId);
    if (slots.length > 0) return { date: d, slots: slots.slice(0, 8) };
  }
  return null;
}

async function sendWhatsAppText(token: string, number: string, text: string): Promise<boolean> {
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
    return resp.ok;
  } catch (e) {
    console.error("uazapi send error", e);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const payload = await req.json();
    const { action, clinic_id } = payload;

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
      }));
      const lines = list.map((t: any) =>
        `- [${t.id}] ${t.name} (${t.modality}, ${t.duration}min) com ${t.doctor_name}` +
        (t.description ? `: ${t.description}` : "")
      );
      const readable_summary = list.length === 0
        ? "Nenhum tipo de consulta cadastrado para esta clinica."
        : `Tipos disponiveis (use o ID em VER_HORARIOS e MARCAR_HORARIO):\n${lines.join("\n")}`;
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

      const days_availability: any[] = [];
      for (const d of dateList) {
        const perDoctor = await Promise.all(
          (doctors || []).map(async (doc: any) => {
            const available_slots = await fetchSlotsForDoctorDate(supabaseClient, doc.id, d, modality, ctId);
            return {
              doctor_id: doc.id,
              doctor_name: doc.name || doc.clinic_users?.full_name || "Médico sem nome",
              available_slots,
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
          for (let i = 1; i <= 14; i++) {
            const tryDate = addDays(date, i);
            const probe = await Promise.all(
              (doctors || []).map(async (doc: any) => ({
                doctor_id: doc.id,
                doctor_name: doc.name || doc.clinic_users?.full_name || "Médico sem nome",
                available_slots: await fetchSlotsForDoctorDate(supabaseClient, doc.id, tryDate, modality, ctId),
              }))
            );
            const probeTotal = probe.reduce((s, a) => s + a.available_slots.length, 0);
            if (probeTotal > 0) {
              next_available = { date: tryDate, availability: probe };
              break;
            }
          }
        }

        let readable_summary = single.availability
          .map((a: any) =>
            a.available_slots.length === 0
              ? `${a.doctor_name}: Sem horários disponíveis em ${single.date}.`
              : `${a.doctor_name}: Horários disponíveis em ${single.date} às ${a.available_slots.join(", ")}.`
          )
          .join("\n");

        if (totalSlots === 0 && next_available) {
          const lines = next_available.availability
            .filter((a: any) => a.available_slots.length > 0)
            .map((a: any) => `  ${a.doctor_name}: ${a.available_slots.join(", ")}`);
          readable_summary += `\n\nPróxima data disponível: ${next_available.date}\n${lines.join("\n")}`;
        } else if (totalSlots === 0 && !next_available) {
          readable_summary += `\n\nSem disponibilidade nos próximos 14 dias.`;
        }

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
          .map((a: any) => `  ${a.doctor_name}: ${a.available_slots.join(", ")}`);
        if (dayLines.length > 0) {
          summaryLines.push(`${day.date}:`);
          summaryLines.push(...dayLines);
        }
      }
      const readable_summary = summaryLines.length > 0
        ? summaryLines.join("\n")
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
          const alt = await findAlternativeSlots(supabaseClient, doctor_id, date, finalModality, resolvedTypeId);
          if (alt) {
            extra.alternatives = alt;
            next_step = `NÃO repita o mesmo horário. Ofereça ao paciente estes horários disponíveis em ${alt.date}: ${alt.slots.join(", ")}. Quando ele escolher, chame MARCAR_HORARIO novamente com o horário escolhido.`;
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
        }

        return new Response(
          JSON.stringify({ success: false, error_code: code, error: errorMsg, next_step, ...extra }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const { data: apt } = await supabaseClient.from("appointments").select("*").eq("id", result.appointment_id).maybeSingle();
      return new Response(
        JSON.stringify({ success: true, idempotent: result.idempotent || false, appointment: apt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "reschedule_appointment") {
      // Reagenda uma consulta DO PROPRIO paciente da conversa (titularidade validada na RPC
      // via p_requester_phone). appointment_id vem de CONSULTAR_AGENDAMENTOS ou do erro
      // ticket_has_active_appointment de MARCAR_HORARIO.
      const { appointment_id, patient_phone, doctor_id, date, time, consultation_type_id } = payload;
      if (!appointment_id || !patient_phone || !date || !time) {
        return new Response(
          JSON.stringify({ success: false, error_code: "missing_fields", error: "Campos obrigatórios: appointment_id, patient_phone, date, time.", next_step: "Obtenha o appointment_id em CONSULTAR_AGENDAMENTOS e tente novamente." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const { data: curApt } = await supabaseClient.from("appointments")
        .select("doctor_id, consultation_type_id, consultation_type_slug, modality").eq("id", appointment_id).maybeSingle();
      if (!curApt) {
        return new Response(
          JSON.stringify({ success: false, error_code: "appointment_not_found", error: "Agendamento não encontrado.", next_step: "Use CONSULTAR_AGENDAMENTOS para obter um appointment_id válido deste paciente." }),
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
          next_step = "Use CONSULTAR_AGENDAMENTOS com o telefone da sessão e escolha um appointment_id que pertença a este paciente.";
        } else if (code === "appointment_not_reschedulable") {
          errorMsg = "Esta consulta não pode mais ser alterada (já aconteceu ou foi cancelada).";
          next_step = "Se o paciente quer uma NOVA consulta, use MARCAR_HORARIO normalmente.";
        } else if (code === "slot_unavailable" || code === "slot_conflict") {
          errorMsg = `O horário ${time} de ${date} não está disponível para reagendamento.`;
          // Alternativas pelo tipo real do agendamento (consultation_type_slug), não pela
          // coluna modality (que não é slug e devolvia lista vazia p/ agendamentos legados).
          const altModality = curApt.consultation_type_slug || curApt.modality || "presencial";
          const alt = await findAlternativeSlots(supabaseClient, targetDoctor, date, altModality, rctId);
          if (alt) {
            extra.alternatives = alt;
            next_step = `Ofereça ao paciente os horários disponíveis em ${alt.date}: ${alt.slots.join(", ")} e chame REAGENDAR_HORARIO novamente com o escolhido.`;
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
        JSON.stringify({ success: true, appointment_id, date: rr.date, time: rr.time, doctor_name: rr.doctor_name, readable_summary: `Consulta reagendada para ${rr.date} às ${rr.time} com ${rr.doctor_name}. Confirme os novos dados ao paciente.` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (action === "cancel_appointment") {
      // Cancela uma consulta DO PROPRIO paciente (titularidade na RPC). So consultas
      // futuras/pendentes podem ser canceladas pelo WhatsApp.
      const { appointment_id, patient_phone, reason } = payload;
      if (!appointment_id || !patient_phone) {
        return new Response(
          JSON.stringify({ success: false, error_code: "missing_fields", error: "Campos obrigatórios: appointment_id, patient_phone.", next_step: "Obtenha o appointment_id em CONSULTAR_AGENDAMENTOS e confirme o cancelamento com o paciente antes de chamar esta tool." }),
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
          next_step = "Use CONSULTAR_AGENDAMENTOS com o telefone da sessão e escolha um appointment_id que pertença a este paciente.";
        } else if (code === "appointment_not_cancellable") {
          errorMsg = "Esta consulta não pode ser cancelada pelo WhatsApp (já foi realizada ou finalizada).";
          next_step = "Explique ao paciente e, se necessário, acione o atendimento humano (ACIONAR_HANDOFF).";
        } else if (code === "appointment_not_found") {
          errorMsg = "Agendamento não encontrado.";
          next_step = "Use CONSULTAR_AGENDAMENTOS para obter um appointment_id válido.";
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
          JSON.stringify({ success: true, patient_found: false, had_previous_journey: false, tickets: [], readable_summary: "Primeiro contato — sem histórico anterior." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      let stats: any = { appointments_realized: 0, appointments_total: 0, total_paid: 0 };
      if (patient) {
        const { data: allAppts } = await supabaseClient.from("appointments")
          .select("status").eq("clinic_id", clinic_id).eq("patient_id", patient.id);
        stats.appointments_total = (allAppts || []).length;
        stats.appointments_realized = (allAppts || []).filter((a: any) => a.status === "realizado" || a.status === "compareceu").length;

        const { data: txs } = await supabaseClient.from("financial_transactions")
          .select("amount").eq("clinic_id", clinic_id).eq("patient_id", patient.id).eq("status", "pago");
        stats.total_paid = (txs || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
      }

      const ticketLines = tickets.map((t: any, i: number) => {
        const date = t.closed_at ? new Date(t.closed_at).toISOString().split("T")[0] : (t.opened_at ? new Date(t.opened_at).toISOString().split("T")[0] : "?");
        const outcome = t.outcome ? ` [${t.outcome}]` : "";
        const sum = t.summary ? `: ${t.summary}` : (t.notes ? `: ${t.notes}` : "");
        return `${i + 1}. ${date}${outcome}${sum}`;
      });

      const lines: string[] = [];
      if (patient) lines.push(`Paciente ${patient.name} já cadastrado.`);
      else lines.push(`Phone reconhecido (lead antigo) mas sem paciente cadastrado.`);
      if (stats.appointments_total > 0) lines.push(`${stats.appointments_realized}/${stats.appointments_total} consulta(s) realizada(s). Total pago: R$ ${stats.total_paid.toFixed(2).replace(".", ",")}.`);
      if (ticketLines.length > 0) {
        lines.push(`Jornadas anteriores:`);
        lines.push(...ticketLines);
      } else {
        lines.push(`Sem jornadas anteriores registradas.`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          patient_found: !!patient,
          had_previous_journey: tickets.length > 0,
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
        .select("id, name, phone, stage_id").eq("clinic_id", clinic_id).eq("phone", canonicalLeadPhone).maybeSingle();
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

      // 2. Move etapa (se configurado)
      // A etapa do lead vive no ticket aberto (tickets.stage_id), nao em leads.stage_id
      // (campo deprecado). Atualizar o ticket dispara trg_log_ticket_stage_change,
      // que registra o historico e mantem o funil/vw_lead_active_stage corretos.
      let stage_changed = false;
      if (matched.move_to_stage) {
        const { data: movedTickets } = await supabaseClient.from("tickets")
          .update({ stage_id: matched.move_to_stage })
          .eq("lead_id", lead.id)
          .eq("status", "open")
          .select("id");
        if (movedTickets && movedTickets.length > 0) {
          actionsTaken.push("stage_moved");
          stage_changed = true;
        }
      }

      // 3. Pega creds do uazapi (mesmo se não vai usar, deixa pronto)
      let uazapiToken: string | null = null;
      if (willNotify || willFarewell) {
        const { data: instance } = await supabaseClient.from("whatsapp_instances")
          .select("api_token").eq("clinic_id", clinic_id).maybeSingle();
        uazapiToken = instance?.api_token || null;
      }

      // 4. Notifica grupo
      let notified = false;
      if (willNotify) {
        const { data: clinic } = await supabaseClient.from("clinics")
          .select("notification_group_id").eq("id", clinic_id).maybeSingle();
        const groupId = clinic?.notification_group_id;
        if (groupId && matched.notification_message && uazapiToken) {
          const rendered = String(matched.notification_message)
            .replace(/\{lead_name\}/g, lead.name || "")
            .replace(/\{lead_phone\}/g, lead.phone || "")
            .replace(/\{trigger_keyword\}/g, tk);
          notified = await sendWhatsAppText(uazapiToken, groupId, rendered);
          if (notified) actionsTaken.push("group_notified");
        }
      }

      // 5. Despedida (só em transfer)
      let farewell_sent = false;
      if (willFarewell && uazapiToken) {
        const contactNum = lead_phone.includes("@") ? lead_phone : `${lead_phone}@s.whatsapp.net`;
        farewell_sent = await sendWhatsAppText(uazapiToken, contactNum, matched.farewell_message);
        if (farewell_sent) actionsTaken.push("farewell_sent");
      }

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
    } else if (action === "close_as_lost") {
      // Encerra o ticket aberto do lead como PERDIDO quando ele está fora do perfil
      // (ex.: pede cirurgia ou quer tratar uma dor que a clínica não atende).
      // Mantém o card aberto na etapa Perdido (resolve=false), grava o motivo, e NÃO
      // desliga a IA: o follow-up de reengajamento já para sozinho porque o slug 'perdido'
      // está na lista de etapas excluídas da query do n8n. A despedida é a resposta final
      // do próprio agente (instruída via next_step).
      const { lead_phone, detail } = payload;
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
          success: true, applied: false, reason: "no_open_ticket",
          next_step: "Não há atendimento aberto para encerrar. Apenas se despeça com gentileza, explicando que a clínica não atende esse caso, sem oferecer agendamento.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // Marca PERDIDO + motivo, mantendo o card aberto (resolve=false). O trigger de
      // invariante (fn_enforce_ticket_resolution_consistency) move o card para a etapa
      // slug 'perdido' e trg_log_ticket_stage_change registra em lead_stage_history.
      const { data: fin, error: finErr } = await supabaseClient.rpc("finalize_ticket", {
        p_ticket_id: openTicket.id,
        p_outcome: "perdido",
        p_loss_reason: "Fora do perfil",
        p_notes: detail || null,
        p_resolve: false,
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
        loss_reason: "Fora do perfil",
        next_step: "Lead marcado como perdido (fora do perfil). Despeça-se com gentileza, explicando brevemente que a clínica não atende esse caso e, se útil, sugira procurar um especialista adequado. NÃO ofereça agendamento.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    } else {
      return new Response(JSON.stringify({ success: false, error: "Invalid action" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});
