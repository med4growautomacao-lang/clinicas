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

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

async function fetchSlotsForDoctorDate(
  supabaseClient: any,
  doctorId: string,
  date: string,
  modality: string = "presencial",
  consultationTypeId?: string,
): Promise<string[]> {
  const params: any = { p_doctor_id: doctorId, p_date: date };
  if (consultationTypeId) {
    params.p_consultation_type_id = consultationTypeId;
  } else {
    params.p_modality = modality;
  }
  const { data } = await supabaseClient.rpc("get_available_slots", params);
  return (data || []).map((s: any) => (s.slot_time || "").toString().substring(0, 5));
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

      // Pré-validação só pelo slug (modality legado). Se vier id, a RPC valida internamente.
      if (!ctId) {
        const { data: ct } = await supabaseClient
          .from("consultation_types")
          .select("slug, is_active")
          .eq("doctor_id", doctor_id)
          .eq("slug", finalModality)
          .maybeSingle();
        if (!ct) {
          return new Response(
            JSON.stringify({ success: false, error_code: "consultation_type_not_found", error: `Tipo de consulta "${finalModality}" não está configurado para este médico.` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }
        if (ct.is_active === false) {
          return new Response(
            JSON.stringify({ success: false, error_code: "consultation_type_inactive", error: `Tipo de consulta "${finalModality}" está inativo.` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }
      }

      const derived = await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(`${clinic_id}|${doctor_id}|${date}|${time}|${patient_phone}`));
      const hash = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const computed_request_id = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
      const final_request_id = request_id || computed_request_id;
      const rpcParams: Record<string, unknown> = {
        p_clinic_id: clinic_id, p_doctor_id: doctor_id, p_date: date, p_time: time,
        p_patient_name: patient_name, p_patient_phone: patient_phone, p_source: "ia",
        p_notes: notes || null, p_request_id: final_request_id,
      };
      if (ctId) rpcParams.p_consultation_type_id = ctId;
      else rpcParams.p_modality = finalModality;
      const { data, error } = await supabaseClient.rpc("book_appointment", rpcParams);
      if (error) throw error;
      const result = data as any;
      if (!result.success) {
        const errMessages: Record<string, string> = {
          slot_conflict: "Horário já foi reservado. Escolha outro.",
          doctor_not_found: "Médico não encontrado.",
          doctor_clinic_mismatch: "Médico não pertence à clínica.",
          doctor_inactive: "Médico inativo.",
          consultation_type_not_found: ctId
            ? `Tipo de consulta com id "${ctId}" não encontrado para este médico.`
            : `Tipo de consulta "${finalModality}" não está configurado para este médico.`,
          consultation_type_inactive: "Tipo de consulta inativo.",
        };
        return new Response(
          JSON.stringify({ success: false, error_code: result.error_code, error: errMessages[result.error_code || ""] || "Erro ao agendar." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const { data: apt } = await supabaseClient.from("appointments").select("*").eq("id", result.appointment_id).maybeSingle();
      return new Response(
        JSON.stringify({ success: true, idempotent: result.idempotent || false, appointment: apt }),
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
      const today = new Date().toISOString().split("T")[0];
      const { data: patient } = await supabaseClient.from("patients")
        .select("id, name, cpf").eq("clinic_id", clinic_id).eq("phone", patient_phone).maybeSingle();
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
      const summarize = (arr: any[]) => arr.map((a) => `${a.date} ${a.time} — ${a.doctor_name} (${a.status_label}, ${a.modality})`).join("; ");
      const readable_summary = `Paciente ${patient.name} encontrado. ` +
        (future.length ? `${future.length} agendamento(s) futuro(s): ${summarize(future)}. ` : "Sem agendamentos futuros. ") +
        (past.length ? `${past.length} agendamento(s) passado(s): ${summarize(past.slice(0, 5))}.` : "Sem histórico passado.");
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

      const { data: patient } = await supabaseClient.from("patients")
        .select("id, name, cpf, created_at").eq("clinic_id", clinic_id).eq("phone", patient_phone).maybeSingle();

      const { data: oldLeads } = await supabaseClient.from("leads")
        .select("id, created_at").eq("clinic_id", clinic_id).eq("phone", patient_phone).order("created_at", { ascending: false });
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

      const { data: lead } = await supabaseClient.from("leads")
        .select("id, name, phone, stage_id").eq("clinic_id", clinic_id).eq("phone", lead_phone).maybeSingle();
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
