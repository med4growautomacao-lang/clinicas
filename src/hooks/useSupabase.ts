import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// Cache module-level: persiste entre re-renders e remontagens de componentes
const _cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getCached<T>(key: string): T | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.data as T;
}
function setCached(key: string, data: any) { _cache.set(key, { data, ts: Date.now() }); }
function invalidateCache(key: string) { _cache.delete(key); }

// ==========================================
// DOCTORS
// ==========================================
export interface Doctor {
  id: string;
  clinic_id: string;
  user_id: string | null;
  name: string;
  specialty: string | null;
  crm: string | null;
  status: 'atendendo' | 'pausa' | 'offline';
  is_active: boolean;
  created_at: string;
  working_hours?: any;
  /** @deprecated use ConsultationType */
  consultation_duration?: number;
  /** @deprecated use ConsultationType */
  slot_step?: number | null;
  /** @deprecated use ConsultationType */
  min_notice_minutes?: number;
  /** @deprecated use ConsultationType */
  buffer_before_minutes?: number;
  /** @deprecated use ConsultationType */
  buffer_after_minutes?: number;
  days_off?: string[];
  blocked_times?: { date: string; start: string; end: string }[];
}

export interface ConsultationType {
  id: string;
  clinic_id: string;
  doctor_id: string;
  slug: string;
  name: string;
  modality: 'presencial' | 'online';
  description: string | null;
  is_active: boolean;
  consultation_duration: number;
  slot_step: number | null;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_minutes: number;
  working_hours_override: Record<string, { start: string; end: string }[]> | null;
  created_at: string;
}

export function useClinicConsultationTypes(clinicId: string | null | undefined) {
  const [data, setData] = useState<ConsultationType[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!clinicId) { setData([]); setLoading(false); return; }
    setLoading(true);
    const { data: rows } = await supabase
      .from('consultation_types')
      .select('*')
      .eq('clinic_id', clinicId);
    setData((rows || []) as ConsultationType[]);
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    fetch();
    if (!clinicId) return;
    const channel = supabase
      .channel(`consultation_types_${clinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_types', filter: `clinic_id=eq.${clinicId}` }, () => { fetch(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetch, clinicId]);

  const byDoctor = useMemo(() => {
    const m = new Map<string, ConsultationType[]>();
    for (const ct of data) {
      const arr = m.get(ct.doctor_id) || [];
      arr.push(ct);
      m.set(ct.doctor_id, arr);
    }
    return m;
  }, [data]);

  const findType = useCallback((doctorId: string, slug: string): ConsultationType | null => {
    return byDoctor.get(doctorId)?.find(ct => ct.slug === slug) ?? null;
  }, [byDoctor]);

  const findTypeById = useCallback((id: string | null | undefined): ConsultationType | null => {
    if (!id) return null;
    return data.find(ct => ct.id === id) ?? null;
  }, [data]);

  return { data, loading, byDoctor, findType, findTypeById };
}

export function useConsultationTypes(doctorId: string | null | undefined) {
  const [data, setData] = useState<ConsultationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!doctorId) { setData([]); setLoading(false); return; }
    if (!silent) setLoading(true);
    const { data: rows, error: err } = await supabase
      .from('consultation_types')
      .select('*')
      .eq('doctor_id', doctorId)
      .order('created_at', { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setData((rows || []) as ConsultationType[]);
    setError(null);
    if (!silent) setLoading(false);
  }, [doctorId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (input: Omit<ConsultationType, 'id' | 'created_at'>) => {
    const { data: row, error: err } = await supabase
      .from('consultation_types').insert(input).select().single();
    if (err) { setError(err.message); return null; }
    setData(prev => [...prev, row as ConsultationType]);
    return row as ConsultationType;
  };

  const update = async (id: string, patch: Partial<ConsultationType>) => {
    const { error: err } = await supabase
      .from('consultation_types').update(patch).eq('id', id);
    if (err) { setError(err.message); return false; }
    setData(prev => prev.map(ct => ct.id === id ? { ...ct, ...patch } as ConsultationType : ct));
    return true;
  };

  const remove = async (id: string) => {
    const { error: err } = await supabase.from('consultation_types').delete().eq('id', id);
    if (err) { setError(err.message); return false; }
    setData(prev => prev.filter(ct => ct.id !== id));
    return true;
  };

  return { data, loading, error, refetch: fetch, create, update, remove };
}

export function useDoctors() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false, force = false) => {
    if (!activeClinicId) return;
    const cacheKey = `doctors:${activeClinicId}`;
    if (force) invalidateCache(cacheKey);
    const cached = getCached<Doctor[]>(cacheKey);
    if (cached) { setData(cached); setLoading(false); return; }
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('doctors')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('name');

    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setCached(cacheKey, data || []);
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;

    const interval = setInterval(() => {
      invalidateCache(`doctors:${activeClinicId}`);
      fetch(true);
    }, 120_000);

    const channel = supabase
      .channel(`doctors_realtime:${activeClinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doctors', filter: `clinic_id=eq.${activeClinicId}` }, () => {
        invalidateCache(`doctors:${activeClinicId}`);
        fetch(true);
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetch, activeClinicId]);

  const create = async (doc: Partial<Doctor>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('doctors')
      .insert({ ...doc, clinic_id: activeClinicId })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    invalidateCache(`doctors:${activeClinicId}`);
    setData(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  };

  const createWithAuth = async (params: any) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase.functions.invoke('create-professional', {
      body: { ...params, clinic_id: activeClinicId }
    });
    if (error) { setError(error.message); return null; }
    if (data.error) { setError(data.error); return null; }
    invalidateCache(`doctors:${activeClinicId}`);
    fetch(true);
    return data;
  };

  const update = async (id: string, updates: Partial<Doctor>) => {
    const { error } = await supabase.from('doctors').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    invalidateCache(`doctors:${activeClinicId}`);
    setData(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('doctors').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    invalidateCache(`doctors:${activeClinicId}`);
    setData(prev => prev.filter(d => d.id !== id));
    return true;
  };

  return { 
    data, 
    loading, 
    error, 
    refetch: fetch, 
    create, 
    createWithAuth, 
    update, 
    remove 
  };
}

// ==========================================
// PATIENTS
// ==========================================
export interface Patient {
  id: string;
  clinic_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  cpf: string | null;
  birth_date: string | null;
  gender: string | null;
  weight: string | null;
  height: string | null;
  allergies: string[] | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export function usePatients() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('name');
    
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;

    const interval = setInterval(() => fetch(true), 60_000);
    return () => clearInterval(interval);
  }, [fetch, activeClinicId]);

  const create = async (p: Partial<Patient>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('patients')
      .insert({ ...p, clinic_id: activeClinicId })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    setData(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  };

  const update = async (id: string, updates: Partial<Patient>) => {
    setData(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    const { error } = await supabase.from('patients').update(updates).eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(p => p.id !== id));
    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
    return true;
  };

  return { data, loading, error, refetch: fetch, create, update, remove };
}

// ==========================================
// APPOINTMENTS
// ==========================================
export interface Appointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  date: string;
  time: string;
  status: 'pendente' | 'confirmado' | 'compareceu' | 'realizado' | 'cancelado' | 'faltou';
  source: 'ia' | 'manual' | 'site' | null;
  modality: 'presencial' | 'online';
  consultation_type_id?: string | null;
  consultation_type_slug?: string | null;
  duration_minutes?: number;
  notes: string | null;
  created_at: string;
  // Joined
  patient?: { name: string; cpf?: string | null; phone?: string | null };
  doctor?: { name: string };
}

// Mensagens amigaveis para os error_code das RPCs de agendamento (book/convert/reschedule).
export const BOOKING_ERROR_MESSAGES: Record<string, string> = {
  slot_conflict: 'Esse horário já foi reservado. Atualize a lista e escolha outro.',
  slot_unavailable: 'Horário fora da disponibilidade do médico. Escolha um horário válido.',
  invalid_phone: 'Telefone do paciente inválido. Use o número do WhatsApp (apenas dígitos, com DDD).',
  doctor_not_found: 'Médico não encontrado.',
  doctor_inactive: 'Médico inativo.',
  doctor_clinic_mismatch: 'Médico não pertence à clínica.',
  consultation_type_not_found: 'Tipo de consulta não configurado para este médico.',
  consultation_type_inactive: 'Tipo de consulta inativo.',
  lead_not_found: 'Lead não encontrado.',
  patient_not_found: 'Paciente não encontrado.',
  ticket_has_active_appointment: 'Este paciente já tem um agendamento ativo nesta jornada. Finalize ou cancele o atual antes.',
  appointment_not_found: 'Agendamento não encontrado.',
  appointment_not_reschedulable: 'Este agendamento não pode ser reagendado (já finalizado/cancelado).',
};

export type BookingResult = { row: any | null; error: string | null; error_code?: string };

export function useAppointments(options?: { daysBack?: number; daysForward?: number }) {
  const DAYS_BACK = options?.daysBack ?? 365;
  const DAYS_FORWARD = options?.daysForward ?? 180;
  const { profile, userRole, activeClinicId } = useAuth();
  const [data, setData] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);

    const today = new Date();
    const fromDate = new Date(today); fromDate.setDate(today.getDate() - DAYS_BACK);
    const toDate = new Date(today); toDate.setDate(today.getDate() + DAYS_FORWARD);
    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];

    let query = supabase
      .from('appointments')
      .select('*, patient:patients(name, cpf, phone), doctor:doctors!inner(name, user_id)')
      .eq('clinic_id', activeClinicId)
      .gte('date', fromStr)
      .lte('date', toStr);

    if (userRole === 'medico') {
      query = query.eq('doctor.user_id', profile.id);
    }

    const { data, error } = await query
      .order('date', { ascending: false })
      .order('time', { ascending: true });

    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [activeClinicId, userRole, profile?.id, DAYS_BACK, DAYS_FORWARD]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;

    const channel = supabase
      .channel(`appointments_realtime_${activeClinicId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'appointments',
        filter: `clinic_id=eq.${activeClinicId}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    // Polling defensivo: cobre casos em que o WebSocket do realtime cai sem notificar
    // (aba em background, oscilação de rede, n8n inserindo por outro caminho)
    const interval = setInterval(() => { fetch(true); }, 30_000);

    // Refetch ao voltar pra aba (caso o realtime tenha perdido eventos enquanto em background)
    const onVisible = () => { if (document.visibilityState === 'visible') fetch(true); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetch, activeClinicId]);

  // Cria via RPC canonica book_appointment (mesma usada por IA e Kanban): valida medico/tipo,
  // resolve paciente+lead+ticket e protege contra conflito/duplicidade. NUNCA mais INSERT cru.
  const create = async (apt: Partial<Appointment> & { source?: string }): Promise<BookingResult> => {
    if (!activeClinicId) return { row: null, error: 'Sem clínica ativa.' };
    const { data: res, error } = await supabase.rpc('book_appointment', {
      p_clinic_id: activeClinicId,
      p_doctor_id: apt.doctor_id,
      p_date: apt.date,
      p_time: apt.time,
      p_patient_name: null,
      p_patient_phone: null,
      p_patient_id: apt.patient_id ?? null,
      p_consultation_type_id: apt.consultation_type_id ?? null,
      p_notes: apt.notes ?? null,
      p_source: apt.source ?? 'manual',
      p_request_id: globalThis.crypto?.randomUUID?.() ?? null,
    });
    if (error) { return { row: null, error: error.message }; }
    const r = res as any;
    if (!r?.success) {
      if (r?.error_code === 'slot_conflict') fetch(true);
      return { row: null, error_code: r?.error_code, error: BOOKING_ERROR_MESSAGES[r?.error_code] || 'Não foi possível agendar.' };
    }
    // book_appointment cria como 'pendente'; aplica outro status escolhido no modal, se houver
    if (apt.status && apt.status !== 'pendente') {
      await supabase.from('appointments').update({ status: apt.status }).eq('id', r.appointment_id);
    }
    const { data: row } = await supabase
      .from('appointments')
      .select('*, patient:patients(name, cpf, phone), doctor:doctors(name, user_id)')
      .eq('id', r.appointment_id).single();
    if (row) setData(prev => [row, ...prev.filter(a => a.id !== row.id)]);
    return { row, error: null };
  };

  const update = async (id: string, updates: Partial<Appointment>) => {
    setData(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    const { error } = await supabase.from('appointments').update(updates).eq('id', id);
    if (error) {
      const msg = error.code === '23P01'
        ? 'Esse horário foi reservado por outra pessoa. Atualize a lista e escolha outro.'
        : error.message;
      setError(msg);
      fetch(true);
      return false;
    }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(a => a.id !== id));
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
    return true;
  };

  return { data, loading, error, refetch: fetch, create, update, remove };
}

// ==========================================
// LEADS + FUNNEL STAGES
// ==========================================
export interface FunnelStage {
  id: string;
  clinic_id: string;
  name: string;
  position: number;
  slug: string | null;
  is_system: boolean;
  is_fixed: boolean;
  is_conversion: boolean;
  color: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  clinic_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  capture_channel: string | null;
  /** @deprecated Use vw_lead_active_stage ou tickets.stage_id (lead = só identidade, etapa vive no ticket aberto). */
  stage_id: string | null;
  estimated_value: number | null;
  notes: string | null;
  ai_summary: string | null;
  session_id: string | null;
  ai_enabled: boolean;
  followup_enabled: boolean;
  converted_patient_id: string | null;
  sla_breach_count: number;
  last_message_at: string | null;
  last_outbound_at: string | null;
  last_activity_at: string | null;
  ctwa_clid: string | null;
  fb_clid: string | null;
  g_clid: string | null;
  fb_campaign_name: string | null;
  fb_adset_name: string | null;
  fb_ad_name: string | null;
  g_campaign_name: string | null;
  g_adset_name: string | null;
  g_ad_name: string | null;
  g_term_name: string | null;
  g_source_name: string | null;
  rast_id: string | null;
  created_at: string;
  updated_at: string;
  avatar_url: string | null;
  loss_reason: string | null;
  /** "Não Lead": registro que não é oportunidade real. Sai do funil/Conversas, não conta em métrica e não recebe automação. Reversível. */
  is_not_lead: boolean;
  not_lead_at: string | null;
  /** Número confirmado SEM WhatsApp (uazapi /chat/check no envio do welcome). Sinaliza no card e em Conversas; não recebe envio automático. */
  whatsapp_invalid: boolean;
}

export function useFunnelStages() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false, force = false) => {
    if (!activeClinicId) return;
    const cacheKey = `funnel_stages:${activeClinicId}`;
    if (force) invalidateCache(cacheKey);
    const cached = getCached<FunnelStage[]>(cacheKey);
    if (cached) { setData(cached); setLoading(false); return; }
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('funnel_stages')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('position');
    setCached(cacheKey, data || []);
    setData(data || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;

    const channel = supabase
      .channel(`funnel_stages_realtime_${activeClinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_stages', filter: `clinic_id=eq.${activeClinicId}` }, () => {
        fetch(true, true);
      })
      .subscribe();

    // Polling defensivo
    const interval = setInterval(() => { fetch(true, true); }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') fetch(true, true); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetch, activeClinicId]);

  const update = async (id: string, updates: Partial<FunnelStage>) => {
    const { error } = await supabase.from('funnel_stages').update(updates).eq('id', id);
    if (error) return false;
    invalidateCache(`funnel_stages:${activeClinicId}`);
    setData(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('funnel_stages').delete().eq('id', id);
    if (error) return false;
    invalidateCache(`funnel_stages:${activeClinicId}`);
    setData(prev => prev.filter(s => s.id !== id));
    return true;
  };

  const reorder = async (stages: FunnelStage[]) => {
    setData(stages);
    invalidateCache(`funnel_stages:${activeClinicId}`);
    const updates = stages.map((s, idx) =>
      supabase.from('funnel_stages').update({ position: idx }).eq('id', s.id)
    );
    await Promise.all(updates);
    return true;
  };

  const create = async (stage: Partial<FunnelStage>) => {
    if (!activeClinicId) return null;
    const { data: lastStage } = await supabase
      .from('funnel_stages')
      .select('position')
      .eq('clinic_id', activeClinicId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = (lastStage?.position ?? -1) + 1;
    const { data, error } = await supabase
      .from('funnel_stages')
      .insert({ ...stage, clinic_id: activeClinicId, position: newPosition })
      .select()
      .single();
    if (error) return null;
    invalidateCache(`funnel_stages:${activeClinicId}`);
    setData(prev => [...prev, data]);
    return data;
  };

  return { data, loading, refetch: fetch, create, update, remove, reorder };
}

export interface FollowupStep {
  id: string;
  clinic_id: string;
  step_no: number;
  message_text: string;
  delay_minutes: number;
  enabled: boolean;
  is_closing: boolean;
}

// Régua de reengajamento (drip): passos por clínica em followup_steps.
export function useFollowupSteps() {
  const { activeClinicId } = useAuth();
  const [steps, setSteps] = useState<FollowupStep[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId) { setSteps([]); setLoading(false); return; }
    const { data } = await supabase
      .from('followup_steps')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('step_no', { ascending: true });
    setSteps(data || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  const addStep = async (message_text: string, delay_minutes: number) => {
    if (!activeClinicId) return false;
    const nextNo = (steps[steps.length - 1]?.step_no ?? 0) + 1;
    const { error } = await supabase.from('followup_steps').insert({
      clinic_id: activeClinicId, step_no: nextNo, message_text, delay_minutes, enabled: true,
    });
    if (error) return false;
    await fetch();
    return true;
  };

  const updateStep = async (id: string, updates: Partial<FollowupStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    const { error } = await supabase.from('followup_steps').update(updates).eq('id', id);
    if (error) { await fetch(); return false; }
    return true;
  };

  const removeStep = async (id: string) => {
    const { error } = await supabase.from('followup_steps').delete().eq('id', id);
    if (error) return false;
    await fetch();
    return true;
  };

  // Encerramento é exclusivo: ligar num passo desliga dos outros (no máx. 1 por clínica).
  const setClosing = async (id: string, value: boolean) => {
    if (!activeClinicId) return false;
    setSteps(prev => prev.map(s => (value ? { ...s, is_closing: s.id === id } : (s.id === id ? { ...s, is_closing: false } : s))));
    if (value) {
      // ordem importa pro índice único: zera os outros antes de ligar este
      await supabase.from('followup_steps').update({ is_closing: false }).eq('clinic_id', activeClinicId).neq('id', id);
      await supabase.from('followup_steps').update({ is_closing: true }).eq('id', id);
    } else {
      await supabase.from('followup_steps').update({ is_closing: false }).eq('id', id);
    }
    await fetch();
    return true;
  };

  return { steps, loading, addStep, updateStep, removeStep, setClosing, refetch: fetch };
}

export function useLeads(options?: { pageSize?: number }) {
  const PAGE_SIZE = options?.pageSize ?? null;
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedCountRef = useRef(0);

  const baseQuery = useCallback(() => {
    return supabase
      .from('leads')
      .select('*')
      .eq('clinic_id', activeClinicId!)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false, nullsFirst: false });
  }, [activeClinicId]);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    let query = baseQuery();
    if (PAGE_SIZE) {
      // Refetch silencioso mantém todos os itens já carregados
      const limit = silent ? Math.max(loadedCountRef.current, PAGE_SIZE) : PAGE_SIZE;
      query = query.range(0, limit - 1);
    }
    const { data, error } = await query;
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    const result = data || [];
    setData(result);
    loadedCountRef.current = result.length;
    setHasMore(!!PAGE_SIZE && result.length >= PAGE_SIZE);
    setError(null);
    if (!silent) setLoading(false);
  }, [activeClinicId, PAGE_SIZE, baseQuery]);

  const loadMore = useCallback(async () => {
    if (!PAGE_SIZE || !hasMore || !activeClinicId) return;
    setLoadingMore(true);
    const from = loadedCountRef.current;
    const { data: more } = await baseQuery().range(from, from + PAGE_SIZE - 1);
    if (more && more.length > 0) {
      setData(prev => [...prev, ...more]);
      loadedCountRef.current += more.length;
      setHasMore(more.length >= PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  }, [activeClinicId, PAGE_SIZE, hasMore, baseQuery]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;

    const channel = supabase
      .channel(`leads_realtime_${activeClinicId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'leads',
        filter: `clinic_id=eq.${activeClinicId}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const create = async (lead: Partial<Lead>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('leads')
      .insert({ ...lead, clinic_id: activeClinicId })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    setData(prev => [data, ...prev]);
    return data;
  };

  const createWithTicket = async (lead: Partial<Lead> & { stage_id?: string | null }) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase.rpc('create_lead_with_ticket', {
      p_clinic_id: activeClinicId,
      p_name: lead.name || '',
      p_phone: lead.phone || null,
      p_email: lead.email || null,
      p_source: lead.source || 'manual',
      p_capture_channel: lead.capture_channel || 'manual',
      p_stage_id: lead.stage_id || null,
      p_estimated_value: lead.estimated_value ?? null,
      p_avatar_url: lead.avatar_url || null,
    });
    if (error) { setError(error.message); return null; }
    const result = data as any;
    if (!result?.success) { setError(result?.error || 'Erro ao criar lead'); return null; }
    await fetch(true);
    return { id: result.lead_id, ticket_id: result.ticket_id, stage_id: result.stage_id } as any;
  };

  const update = async (id: string, updates: Partial<Lead>) => {
    setData(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
    const { error } = await supabase.from('leads').update(updates).eq('id', id);
    if (error) {
      setError(error.message);
      fetch(true);
      return false;
    }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(l => l.id !== id));
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
    return true;
  };

  // "Não Lead": tira o registro do funil/Conversas/métricas e desliga as
  // automações (IA + follow-up) do lead. Reversível via restoreLead.
  const markNotLead = async (id: string) =>
    update(id, { is_not_lead: true, ai_enabled: false, followup_enabled: false, not_lead_at: new Date().toISOString() });

  // "Tornar Lead": volta ao normal e religa IA + follow-up.
  const restoreLead = async (id: string) =>
    update(id, { is_not_lead: false, ai_enabled: true, followup_enabled: true, not_lead_at: null });

  return { data, loading, loadingMore, hasMore, error, refetch: fetch, loadMore, create, createWithTicket, update, remove, markNotLead, restoreLead };
}

// Leads marcados como "Não Lead" (caixa de anexo do Kanban e de Conversas).
// Lista os poucos registros is_not_lead da clínica + restaura ("Tornar Lead").
export function useNotLeads() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId) { setData([]); setLoading(false); return; }
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .eq('is_not_lead', true)
      .order('not_lead_at', { ascending: false, nullsFirst: false });
    setData(data || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    const channel = supabase
      .channel(`not_leads_realtime_${activeClinicId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'leads',
        filter: `clinic_id=eq.${activeClinicId}`
      }, () => { fetch(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const restore = useCallback(async (id: string) => {
    setData(prev => prev.filter(l => l.id !== id));
    const { error } = await supabase
      .from('leads')
      .update({ is_not_lead: false, ai_enabled: true, followup_enabled: true, not_lead_at: null })
      .eq('id', id);
    if (error) { fetch(); return false; }
    return true;
  }, [fetch]);

  return { data, loading, refetch: fetch, restore };
}

// ==========================================
// TICKETS
// ==========================================
export interface Ticket {
  id: string;
  clinic_id: string;
  lead_id: string;
  stage_id: string | null;
  opened_at: string;
  closed_at: string | null;
  status: 'open' | 'closed';
  outcome: 'ganho' | 'perdido' | null;
  outcome_at: string | null;
  loss_reason: string | null;
  notes: string | null;
  created_at: string;
  lead_phone: string | null;
  quote_data?: any | null;
  lead?: Lead;
}

// Funil de coorte da tela de marketing: dos leads criados em [start, end],
// quantos entraram em cada etapa (lead_stage_history). Chama o RPC marketing_funnel_cohort.
export function useFunnelCohort(start: string | null, end: string | null) {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<{ stage_id: string; platform: string; channel: string; entry_date: string; leads: number }[]>([]);

  useEffect(() => {
    if (!activeClinicId || !start || !end) { setData([]); return; }
    let cancelled = false;
    supabase
      .rpc('marketing_funnel_cohort', { p_clinic_id: activeClinicId, p_start: start, p_end: end })
      .then(({ data: rows }: any) => {
        if (!cancelled) setData(Array.isArray(rows) ? rows : []);
      });
    return () => { cancelled = true; };
  }, [activeClinicId, start, end]);

  return data;
}

// Igual ao useFunnelCohort, mas chama o RPC marketing_utm_funnel_cohort, que adiciona
// as dimensões de UTM (campanha/conjunto/anúncio/termo/origem) ao agrupamento. Alimenta
// a seção "Análise por UTM × Etapa" do Marketing. Contagem por ticket / última entrada
// (idêntica ao funil canônico — só com detalhe de UTM a mais).
export interface UtmFunnelRow {
  stage_id: string;
  platform: string;
  channel: string;
  loss_reason: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_adset: string | null;
  utm_ad: string | null;
  utm_term: string | null;
  entry_date: string;
  leads: number;
}

export function useUtmFunnelCohort(start: string | null, end: string | null) {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<UtmFunnelRow[]>([]);

  useEffect(() => {
    if (!activeClinicId || !start || !end) { setData([]); return; }
    let cancelled = false;
    supabase
      .rpc('marketing_utm_funnel_cohort', { p_clinic_id: activeClinicId, p_start: start, p_end: end })
      .then(({ data: rows }: any) => {
        if (!cancelled) setData(Array.isArray(rows) ? rows : []);
      });
    return () => { cancelled = true; };
  }, [activeClinicId, start, end]);

  return data;
}

// Entradas na etapa de conversão (lead_stage_history), por evento (changed_at).
// Alimenta o card "Conversões" do Marketing no modelo por evento, igual ao módulo
// Comercial. Carrega todas as entradas da etapa (como useConversions); o
// calculateStats filtra por período. Volume pequeno (≈ nº de conversões da clínica).
export function useConversionStageEntries(stageId: string | null) {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<{ lead_id: string; changed_at: string }[]>([]);

  useEffect(() => {
    if (!activeClinicId || !stageId) { setData([]); return; }
    let cancelled = false;
    supabase
      .from('lead_stage_history')
      .select('lead_id, changed_at')
      .eq('clinic_id', activeClinicId)
      .eq('new_stage_id', stageId)
      .then(({ data: rows }: any) => {
        if (!cancelled) setData(Array.isArray(rows) ? rows : []);
      });
    return () => { cancelled = true; };
  }, [activeClinicId, stageId]);

  return data;
}

export function useTickets() {
  const { activeClinicId, profile, activeClinicName, clinicName } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data, error } = await supabase
      .from('tickets')
      .select('*, lead:leads(*)')
      .eq('clinic_id', activeClinicId)
      .or(`status.eq.open,closed_at.gte.${ninetyDaysAgo}`)
      .order('opened_at', { ascending: false })
      .limit(5000);

    if (error) {
      console.error('Erro ao buscar tickets:', error);
      setTickets([]);
    } else {
      setTickets(data || []);
    }
    if (!silent) setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    const channel = supabase
      .channel(`tickets_realtime_${activeClinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `clinic_id=eq.${activeClinicId}` }, () => { fetch(true); })
      .subscribe();

    // Polling defensivo: cobre WebSocket caído / aba em background
    const interval = setInterval(() => { fetch(true); }, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') fetch(true); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetch, activeClinicId]);

  const moveTicket = async (ticketId: string, stageId: string) => {
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, stage_id: stageId } : t));
    const { data, error } = await supabase.rpc('move_lead_stage', {
      p_ticket_id: ticketId,
      p_new_stage_id: stageId,
    });
    if (error || !(data as any)?.success) {
      console.error('[moveTicket] move_lead_stage falhou', { ticketId, stageId, error, data });
      fetch(true);
      return false;
    }
    return true;
  };

  // Cancela o desfecho (venda/perda) reabrindo o MESMO ticket na etapa-alvo — diferente do
  // moveTicket, que num ticket resolvido dispara "novo ciclo" (ticket novo). A RPC reopen_ticket
  // zera outcome (via trigger de consistência), reabre status/closed_at e, para venda, apaga a
  // receita órfã (conversions + financial_transactions) e desvincula o paciente se não houver
  // consulta ativa. p_cancel_appointment cancela também a consulta ativa, se houver.
  const reopenTicket = async (ticketId: string, stageId: string, cancelAppointment = false) => {
    setTickets(prev => prev.map(t => t.id === ticketId
      ? { ...t, stage_id: stageId, status: 'open', outcome: null, outcome_at: null, closed_at: null, loss_reason: null }
      : t));
    const { data, error } = await supabase.rpc('reopen_ticket', {
      p_ticket_id: ticketId,
      p_new_stage_id: stageId,
      p_cancel_appointment: cancelAppointment,
    });
    if (error || !(data as any)?.success) {
      console.error('[reopenTicket] reopen_ticket falhou', { ticketId, stageId, error, data });
      fetch(true);
      return false;
    }
    return true;
  };

  // "Manter venda/perda": move o MESMO ticket para outra coluna PRESERVANDO o desfecho
  // (ganho/perdido) — mantém a conversão, todas as propriedades e o botão "Resolver".
  // Pipeline de vendas: o negócio é ganho e avança pelas etapas sem deixar de ser venda.
  const moveTicketKeepOutcome = async (ticketId: string, stageId: string) => {
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, stage_id: stageId } : t)); // outcome mantido
    const { data, error } = await supabase.rpc('move_ticket_keep_outcome', {
      p_ticket_id: ticketId,
      p_new_stage_id: stageId,
    });
    if (error || !(data as any)?.success) {
      console.error('[moveTicketKeepOutcome] move_ticket_keep_outcome falhou', { ticketId, stageId, error, data });
      fetch(true);
      return false;
    }
    return true;
  };

  const openTicket = async (leadId: string, stageId: string) => {
    const alreadyOpen = tickets.some(t => t.lead_id === leadId && t.status === 'open');
    if (alreadyOpen) return null;
    const { data, error } = await supabase.from('tickets').insert({ clinic_id: activeClinicId, lead_id: leadId, stage_id: stageId }).select('*, lead:leads(*)').single();
    if (!error && data) setTickets(prev => [data as Ticket, ...prev]);
    return error ? null : (data as Ticket);
  };

  const triggerTicketWebhook = async (ticketId: string, eventOutcome: string | null) => {
    try {
      const ticketToTrigger = tickets.find(t => t.id === ticketId);
      if (!ticketToTrigger || !activeClinicId) return;

      const { data: config } = await supabase
        .from('ai_config')
        .select('id, finish_service_enabled, finish_service_message, finish_ganho_enabled, finish_ganho_message, finish_perdido_enabled, finish_perdido_message')
        .eq('clinic_id', activeClinicId)
        .single();

      const { data: whatsapp } = await supabase
        .from('whatsapp_instances')
        .select('api_token')
        .eq('clinic_id', activeClinicId)
        .maybeSingle();

      if (config?.finish_service_enabled || config?.finish_ganho_enabled || config?.finish_perdido_enabled) {
        const eventName = eventOutcome === 'ganho' ? 'ticket_ganho' 
                        : eventOutcome === 'perdido' ? 'ticket_perdido' 
                        : 'ticket_closed';

        const payload = {
          event: eventName,
          ticket_id: ticketId,
          token: whatsapp?.api_token,
          lead: ticketToTrigger.lead,
          agent: profile,
          outcome: eventOutcome || ticketToTrigger.outcome,
          clinic: {
            id: activeClinicId,
            name: activeClinicName || clinicName || ''
          },
          followup_config: {
            finish_service_enabled: config.finish_service_enabled,
            finish_service_message: config.finish_service_message,
            finish_ganho_enabled: config.finish_ganho_enabled,
            finish_ganho_message: config.finish_ganho_message,
            finish_perdido_enabled: config.finish_perdido_enabled,
            finish_perdido_message: config.finish_perdido_message
          }
        };

        console.log(`[Webhook Encerramento] Disparando payload via proxy para ${eventName}:`, payload);

        supabase.functions.invoke('webhook-proxy', {
          body: {
            target_url: 'https://webhook.med4growautomacao.com.br/webhook/meddesk/followup/encerramentocomum',
            payload
          }
        }).then(({ data, error }) => {
          if (error) console.error('Webhook proxy error:', error);
          else console.log(`[Webhook Encerramento] Resposta ${eventName}:`, data);
        });
      }
    } catch (e) {
      console.error('Error firing webhook:', e);
    }
  };

  const closeTicket = async (ticketId: string, outcome: 'ganho' | 'perdido', lossReason?: string) => {
    const now = new Date().toISOString();
    // Marca o RESULTADO via RPC canônica (atômica: outcome + outcome_at + estágio terminal).
    // p_resolve:false mantém o card aberto no Kanban (encerrar é o botão "Resolver"/finalizeTicket).
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, outcome, outcome_at: now, ...(lossReason ? { loss_reason: lossReason } : {}) } : t));
    const { error } = await supabase.rpc('finalize_ticket', {
      p_ticket_id: ticketId,
      p_outcome: outcome,
      p_loss_reason: lossReason ?? null,
      p_resolve: false,
    });
    if (error) { fetch(true); }

    // Dispara o webhook imediatamente ao marcar como Ganho ou Perdido
    await triggerTicketWebhook(ticketId, outcome);
  };

  const finalizeTicket = async (ticketId: string) => {
    const closedAt = new Date().toISOString();
    const ticketToClose = tickets.find(t => t.id === ticketId);
    
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: 'closed', closed_at: closedAt } : t));
    await supabase.from('tickets').update({ status: 'closed', closed_at: closedAt }).eq('id', ticketId);

    // Dispara o webhook de encerramento (ticket_closed) sempre que o ticket for arquivado
    if (ticketToClose) {
      await triggerTicketWebhook(ticketId, null);
    }
  };

  return { tickets, loading, refetch: fetch, moveTicket, reopenTicket, moveTicketKeepOutcome, openTicket, closeTicket, finalizeTicket };
}

// ==========================================
// DASHBOARD STATS (Realtime automatic refetch)
// ==========================================
export interface DashboardStats {
  totalAppointments: number;
  totalRevenue: number;
  pendingRevenue: number;
  totalConversionsValue: number;
  totalLeads: number;
  newPatients: number;
  totalSales: number;
  totalInvestment: number;
  totalSlaBreaches: number;
  avgResponseTime: number; // minutes
  avgSalesCycle: number; // days
  defaultTicket: number; // ticket configurado (ai_config.default_ticket_value)
  chartData: {
    date: string;
    agendamentos: number;
    faturamento: number;
    leads: number;
    vendas: number;
    investimento: number;
  }[];
}

export function useDashboardStats(dateRange?: { start: string; end: string }, origin: string = 'todos', channel: string = 'todos', agent: string = 'todos') {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<DashboardStats>({
    totalAppointments: 0,
    totalRevenue: 0,
    pendingRevenue: 0,
    totalConversionsValue: 0,
    totalLeads: 0,
    newPatients: 0,
    totalSales: 0,
    totalInvestment: 0,
    totalSlaBreaches: 0,
    avgResponseTime: 0,
    avgSalesCycle: 0,
    defaultTicket: 0,
    chartData: []
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const now = new Date();
    const startOfMonth = dateRange?.start || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = dateRange?.end || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    try {
      const { data, error } = await supabase.rpc('get_dashboard_stats', {
        p_clinic_id: activeClinicId,
        p_date_from: startOfMonth,
        p_date_to: endOfMonth,
        p_origin: origin,
        p_channel: channel,
        p_agent: agent,
      });
      if (error) throw error;
      const r = data as any;
      setData({
        totalAppointments: r?.totalAppointments || 0,
        totalRevenue: Number(r?.totalRevenue || 0),
        pendingRevenue: Number(r?.pendingRevenue || 0),
        totalConversionsValue: Number(r?.totalConversionsValue || 0),
        totalLeads: r?.totalLeads || 0,
        newPatients: r?.newPatients || 0,
        totalSales: r?.totalSales || 0,
        totalInvestment: Number(r?.totalInvestment || 0),
        totalSlaBreaches: r?.totalSlaBreaches || 0,
        avgResponseTime: Number(r?.avgResponseTime || 0),
        avgSalesCycle: Number(r?.avgSalesCycle || 0),
        defaultTicket: Number(r?.defaultTicket || 0),
        chartData: (r?.chartData || []) as any,
      });
    } catch (error) {
      console.error('Erro ao carregar estatísticas do dashboard:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeClinicId, dateRange?.start, dateRange?.end, origin, channel, agent]);

  useEffect(() => {
    load();
    if (!activeClinicId) return;

    // Sincronizar dashboard com mudanças em tabelas chave
    const channel = supabase
      .channel('dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${activeClinicId}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_transactions', filter: `clinic_id=eq.${activeClinicId}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients', filter: `clinic_id=eq.${activeClinicId}` }, () => load(true))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load, activeClinicId]);

  return { data, loading, refetch: load };
}

// ==========================================
// FINANCIAL TRANSACTIONS
// ==========================================
export interface FinancialTransaction {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  appointment_id: string | null;
  type: 'receita' | 'despesa';
  category: string | null;
  amount: number;
  description: string | null;
  notes: string | null;
  payment_method: 'pix' | 'cartao' | 'dinheiro' | 'plano' | null;
  status: 'pago' | 'pendente' | 'cancelado';
  date: string;
  protocol_ids: string[];
  created_at: string;
}

export function useFinancial() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<FinancialTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('financial_transactions')
      .select(`
        *,
        patient:patients(name, phone),
        appointment:appointments(id, time, ticket_id),
        conversions!conversions_financial_transaction_id_fkey(lead_id, lead:leads(name, phone))
      `)
      .eq('clinic_id', activeClinicId)
      .order('date', { ascending: false });
    
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;

    const interval = setInterval(() => fetch(true), 30_000);
    return () => clearInterval(interval);
  }, [fetch, activeClinicId]);

  const create = async (tx: Partial<FinancialTransaction>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('financial_transactions')
      .insert({ ...tx, clinic_id: activeClinicId })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    setData(prev => [data, ...prev]);
    return data;
  };

  const update = async (id: string, updates: Partial<FinancialTransaction>) => {
    setData(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    const { error } = await supabase.from('financial_transactions').update(updates).eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(t => t.id !== id));
    const { error } = await supabase.from('financial_transactions').delete().eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
    return true;
  };

  return { data, loading, error, refetch: fetch, create, update, remove };
}

// ==========================================
// MEDICAL RECORDS
// ==========================================
export interface MedicalRecord {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  appointment_id: string | null;
  type: 'consulta' | 'retorno' | 'exame' | 'procedimento';
  description: string | null;
  diagnosis: string | null;
  prescription: string | null;
  weight: string | null;
  height: string | null;
  blood_pressure: string | null;
  temperature: string | null;
  attachments: any;
  created_at: string;
  // Joined
  doctor?: { name: string };
}

export function useMedicalRecords(patientId: string | null) {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!patientId) { setData([]); setLoading(false); return; }
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('medical_records')
      .select('*, doctor:doctors(name)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [patientId]);

  useEffect(() => {
    fetch();
  }, [fetch, patientId]);

  const create = async (record: Partial<MedicalRecord>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('medical_records')
      .insert({ ...record, clinic_id: activeClinicId })
      .select('*, doctor:doctors(name)')
      .single();
    if (error) { setError(error.message); return null; }
    setData(prev => [data, ...prev]);
    return data;
  };

  const update = async (id: string, updates: Partial<MedicalRecord>) => {
    setData(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    const { error } = await supabase.from('medical_records').update(updates).eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(r => r.id !== id));
    const { error } = await supabase.from('medical_records').delete().eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
    return true;
  };

  return { data, loading, error, refetch: fetch, create, update, remove };
}

// ==========================================
// SETTINGS: CLINIC, AI & WHATSAPP
// ==========================================
export interface Clinic {
  id: string;
  name: string;
  legal_name?: string | null;  // nome completo/razão social (cabeçalho do orçamento, junto da logo)
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  address: string | null;
  logo_url: string | null;
  primary_color: string | null;
  plan: 'free' | 'pro' | 'enterprise';
  is_active: boolean;
  notification_group_id: string | null;
  meta_token?: string | null;
  meta_ad_account_id?: string | null;
  meta_pixel_id?: string | null;
  meta_forms_id?: string | null;
  wa_pre_msg?: string | null;
  organization_id?: string | null;
  category: string | null;
  google_ad_account_id?: string | null;
  google_ad_mcc_id?: string | null;
  google_ad_mcc_token?: string | null;
  features?: { feature_followup?: boolean; feature_ia?: boolean; agenda_via_funil?: boolean } | null;
  meta_status?: 'none' | 'inactive' | 'active';
  google_status?: 'none' | 'inactive' | 'active';
  site_status?: 'none' | 'inactive' | 'active';
  forms_status?: 'none' | 'inactive' | 'active';
  quote_use_products?: boolean;
  quote_use_protocols?: boolean;
  quote_show_total?: boolean;  // mostra/envia o valor total da soma no orçamento (default true)
  quote_template?: {
    saudacao?: string;
    rodape?: string;
    validade?: string;
    pagamento?: string;
    include_specs?: boolean;
    format?: 'texto' | 'imagem' | 'pdf';
  } | null;
  production_order_template?: {
    responsavel?: string;
    prazo?: string;
    observacoes?: string;
    show_prices?: boolean;
    format?: 'imagem' | 'pdf';
  } | null;
  lead_time_expedicao_dias?: number;   // fábrica: folga (dias) entre OP pronta e entrega (separar/expedir)
  horas_uteis_producao_dia?: number;   // fábrica: jornada diária (horas) p/ converter tempo de produção em dias
  custo_mao_obra_hora?: number;        // fábrica: R$/hora de mão de obra p/ compor o custo real por SKU
  custo_fixo_hora?: number;            // fábrica: R$/hora de rateio de custos fixos p/ compor o custo real por SKU
}

export interface CompanyPrompt {
  id: string;
  name: string;
  content: string;
}

export interface AIConfig {
  id: string;
  clinic_id: string;
  name: string | null;
  tone: number;
  response_style: 'tecnica' | 'objetiva' | 'cordial';
  response_speed: 'instantanea' | 'cadenciada';
  bio_text: string | null;
  prompt: string | null;
  prompt_template_id: string | null;
  company_prompts: CompanyPrompt[];
  company_prompt_id: string | null;
  phone: string | null;
  auto_schedule: boolean;
  confirm_enabled: boolean;
  confirm_message: string;
  confirm_lead_time: number;
  confirm_post_enabled: boolean;
  confirm_post_message: string | null;
  followup_enabled: boolean;
  followup_message: string;
  followup_delay: number;
  followup_window_start?: number;
  followup_window_end?: number;
  handoff_enabled: boolean;
  handoff_rules: any[] | null;
  transition_rules: any[] | null;
  finish_service_enabled: boolean;
  finish_service_message: string;
  pos_followup_ganho_enabled: boolean;
  pos_followup_ganho_message: string | null;
  pos_followup_ganho_days: number;
  pos_followup_perdido_enabled: boolean;
  pos_followup_perdido_message: string | null;
  pos_followup_perdido_days: number;
  csat_enabled: boolean;
  csat_type: 'csat' | 'nps' | 'both';
  csat_message: string | null;
  csat_delay_minutes: number;
  sla_minutes: number;
  business_hours: { start: string; end: string; days: number[] };
  default_ticket_value: number;
  welcome_message_enabled: boolean;
  welcome_message_text: string | null;
  welcome_message_delay: number;
  test_mode_enabled: boolean;
  test_numbers: string[];
  test_reset_phrase: string;
  response_wait_seconds: number;
  updated_at: string;
}

export interface WhatsappInstance {
  id: string;
  clinic_id: string;
  api_id?: string;
  api_token: string;
  phone_number: string | null;
  status: 'connected' | 'disconnected' | 'connecting';
  connected_at: string | null;
  qr_code?: string | null;
  connect_token?: string | null;
  redirect_message?: string | null;
}

export function useSettings() {
  const { profile, activeClinicId } = useAuth();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [aiConfig, setAIConfig] = useState<AIConfig | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsappInstance | null>(null);
  const [systemSettings, setSystemSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);

    const [clinicRes, aiRes, waRes, sysRes] = await Promise.all([
      supabase.from('clinics').select('*').eq('id', activeClinicId).maybeSingle(),
      supabase.from('ai_config').select('*').eq('clinic_id', activeClinicId).maybeSingle(),
      supabase.from('whatsapp_instances').select('*').eq('clinic_id', activeClinicId).maybeSingle(),
      supabase.from('system_settings').select('*')
    ]);

    setClinic(clinicRes.data);
    setAIConfig(aiRes.data);
    setWhatsapp(waRes.data);
    
    if (sysRes.data) {
      const sysMap: Record<string, string> = {};
      sysRes.data.forEach(s => { sysMap[s.id] = s.value; });
      setSystemSettings(sysMap);
    }
    
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { 
    fetch(); 
    if (!activeClinicId) return;

    const channel = supabase
      .channel('settings_realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_instances',
        filter: `clinic_id=eq.${activeClinicId}`
      }, (payload) => {
        if (payload.new && (payload.new as any).clinic_id === activeClinicId) {
          fetch(true);
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'ai_config',
        filter: `clinic_id=eq.${activeClinicId}`
      }, (payload) => {
        if ((payload.new as any)?.clinic_id === activeClinicId) {
          fetch(true);
        }
      })
      .subscribe();

    // Fallback defensivo: a uazapi empurra evento connection via webhook -> Realtime.
    // Se o canal Realtime caiu silenciosamente, atualiza a cada 30s enquanto connecting.
    let pollInterval: any;
    if (whatsapp?.status === 'connecting') {
      pollInterval = setInterval(() => { fetch(true); }, 30000);
    }

    return () => {
      supabase.removeChannel(channel);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [fetch, activeClinicId, whatsapp?.status]); // Adicionado whatsapp.status para re-avaliar o polling

  const updateClinic = async (updates: Partial<Clinic>) => {
    if (!activeClinicId) return false;
    // Strip read-only/PK fields to avoid PostgREST conflicts and trigger side-effects
    const { id, created_at, organization_id, ...safeUpdates } = updates as any;
    const { error } = await supabase.from('clinics').update(safeUpdates).eq('id', activeClinicId);
    if (!error) await fetch();
    return !error;
  };

  const updateAI = async (updates: Partial<AIConfig>) => {
    if (!activeClinicId) return false;
    // Optimistic update — atualiza o estado local imediatamente
    setAIConfig(prev => prev ? { ...prev, ...updates } : prev);
    const { error } = await supabase
      .from('ai_config')
      .upsert({
        ...updates,
        clinic_id: activeClinicId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'clinic_id' });
    if (!error) fetch(true);
    return !error;
  };

  const updateWhatsapp = async (updates: Partial<WhatsappInstance>) => {
    if (!activeClinicId) return false;
    
    // Check if instance exists
    if (!whatsapp) {
      const { error } = await supabase.from('whatsapp_instances').insert({
        ...updates,
        clinic_id: activeClinicId
      });
      if (!error) await fetch();
      return !error;
    } else {
      const { error } = await supabase.from('whatsapp_instances').update(updates).eq('clinic_id', activeClinicId);
      if (!error) await fetch();
      return !error;
    }
  };

  const generateConnectToken = async (): Promise<string | null> => {
    const token = crypto.randomUUID();
    const ok = await updateWhatsapp({ connect_token: token });
    return ok ? token : null;
  };

  return { clinic, aiConfig, whatsapp, systemSettings, loading, refetch: fetch, updateClinic, updateAI, updateWhatsapp, generateConnectToken };
}

export function useClinics() {
  const [data, setData] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('clinics').select('*').order('name');
    if (error) { setError(error.message); setLoading(false); return; }
    setData(data || []);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (clinic: Partial<Clinic> & { ownerName?: string; ownerEmail?: string; ownerPassword?: string }) => {
    if (clinic.ownerEmail) {
      const { data, error } = await supabase.rpc('create_clinic_with_owner', {
        p_clinic_name: clinic.name,
        p_plan: clinic.plan || 'pro',
        p_organization_id: clinic.organization_id || null,
        p_owner_name: clinic.ownerName || '',
        p_owner_email: clinic.ownerEmail,
        p_owner_password: clinic.ownerPassword || '',
        p_owner_role: (clinic as any).ownerRole || 'gestor',
        p_category: clinic.category || 'clinica',
      });
      if (!error) fetch();
      return { data, error };
    }
    const { data, error } = await supabase.from('clinics').insert(clinic).select().single();
    if (!error) fetch();
    return { data, error };
  };

  const update = async (id: string, updates: Partial<Clinic>) => {
    const { error } = await supabase.from('clinics').update(updates).eq('id', id);
    if (!error) fetch();
    return !error;
  };

  const deleteClinic = async (id: string) => {
    const { error } = await supabase.rpc('delete_clinic_cascade', { p_clinic_id: id });
    if (!error) fetch();
    return !error;
  };

  return { data, loading, error, refetch: fetch, create, update, deleteClinic };
}


// ==========================================
// CHAT MESSAGES
// ==========================================
export interface ChatMessage {
  id: string;
  clinic_id: string;
  lead_id: string | null;
  patient_id: string | null;
  direction: 'inbound' | 'outbound';
  sender: 'user' | 'ai' | 'system';
  message: {
    role?: string;
    type?: string;
    content?: string;
    text?: string;
    [key: string]: any;
  };
  phone: string | null;
  session_id: string | null;
  ticket_id: string | null;
  metadata: any;
  created_at: string;
}

export function useChatMessages(leadId?: string, leadPhone?: string | null) {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clinicPhone, setClinicPhone] = useState<string | null>(null);

  useEffect(() => {
    if (!activeClinicId) return;
    supabase
      .from('whatsapp_instances')
      .select('phone_number')
      .eq('clinic_id', activeClinicId)
      .maybeSingle()
      .then(({ data }) => setClinicPhone(data?.phone_number || null));
  }, [activeClinicId]);

  const parseMessage = (msg: any): any => {
    try {
      let data = msg;
      
      // Try to parse if it's a string
      if (typeof msg === 'string' && (msg.startsWith('{') || msg.startsWith('['))) {
        try { data = JSON.parse(msg); } catch { data = { content: msg }; }
      }

      // Unwrap arrays
      if (Array.isArray(data)) data = data[0] || {};

      // If it's not an object, wrap it
      if (!data || typeof data !== 'object') data = { content: String(msg || '') };

      // Priority extraction of content
      const rawContent = data.content || data.output || data.text || data.message || "";
      
      // Strip [Used tools: ...] prefix using bracket counting (regex não-greedy falha com JSON aninhado)
      let content = typeof rawContent === 'object' ? JSON.stringify(rawContent) : String(rawContent);
      if (content.includes('[Used tools:')) {
        const startIdx = content.indexOf('[Used tools:');
        let depth = 0;
        let endIdx = -1;
        for (let i = startIdx; i < content.length; i++) {
          if (content[i] === '[') depth++;
          else if (content[i] === ']') {
            depth--;
            if (depth === 0) { endIdx = i; break; }
          }
        }
        if (endIdx !== -1) {
          content = (content.slice(0, startIdx) + content.slice(endIdx + 1)).trimStart();
        }
      }

      return {
        ...data,
        content: content
      };
    } catch (e) {
      return { content: String(msg || '') };
    }
  };

  const fetch = useCallback(async () => {
    if (!activeClinicId) return;
    
    // Safety check: if no leadId and no leadPhone provided, we shouldn't fetch all clinic messages
    if (!leadId && !leadPhone) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let query = supabase
      .from('chat_messages')
      .select('*')
      .eq('clinic_id', activeClinicId);
    
    if (leadId) {
      query = query.eq('lead_id', leadId);
    } else if (leadPhone) {
      query = query.eq('phone', leadPhone);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) { setError(error.message); setLoading(false); return; }

    const formattedData = (data || []).reverse().map(m => ({
      ...m,
      message: parseMessage(m.message)
    }));

    setData(formattedData);
    setError(null);
    setLoading(false);
  }, [activeClinicId, leadId, leadPhone]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    if (!leadId && !leadPhone) return;

    const channelName = leadId ? `chat_lead_${leadId}` : `chat_phone_${leadPhone}`;
    const filter = leadId
      ? `lead_id=eq.${leadId}`
      : `phone=eq.${leadPhone}`;

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter
      }, (payload) => {
        const newMsg = payload.new as ChatMessage;
        if (!leadId || newMsg.lead_id === leadId) {
          setData(prev => {
            // Evita duplicatas se o realtime mandar duas vezes ou fetch coincidir
            if (prev.find(m => m.id === newMsg.id)) return prev;
            return [...prev, {
              ...newMsg,
              message: parseMessage(newMsg.message)
            }];
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId, leadId, leadPhone]);

  const send = async (msg: Partial<ChatMessage>) => {
    if (!activeClinicId) return null;
    
    let rawPhone = msg.phone || null;

    // If the phone is actually a session_id (clinicPhone + leadPhone concatenated),
    // extract only the lead phone by stripping the clinic phone prefix
    if (rawPhone && clinicPhone && rawPhone.startsWith(clinicPhone) && rawPhone.length > clinicPhone.length) {
      rawPhone = rawPhone.slice(clinicPhone.length);
    }

    const leadPhone = rawPhone;
    const finalSessionId = msg.session_id || (clinicPhone && leadPhone ? `${clinicPhone}${leadPhone}` : null);

    // Prepare message object to ensure it matches the JSONB structure
    const messageObject = msg.message || {
      role: 'user',
      content: msg.message?.content || '' // Fallback if someone tried to pass partially
    };

    // If content was passed directly (legacy support while transitioning), wrap it
    if ((msg as any).content && !msg.message) {
      messageObject.content = (msg as any).content;
    }

    const insertData: any = { 
      clinic_id: activeClinicId, 
      direction: 'outbound', 
      sender: 'user',
      lead_id: leadId || msg.lead_id,
      session_id: finalSessionId,
      message: messageObject,
      phone: leadPhone
    };

    // Auto-create lead if missing and phone is present
    if (!insertData.lead_id && leadPhone) {
      // 1. Check if lead already exists for this phone
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('clinic_id', activeClinicId)
        .eq('phone', leadPhone)
        .maybeSingle();

      if (existingLead) {
        insertData.lead_id = existingLead.id;
      } else if (leadPhone !== clinicPhone) {
        // 2. Create new lead if not found and NOT the clinic phone
        const { data: newLead, error: leadError } = await supabase
          .from('leads')
          .insert({
            clinic_id: activeClinicId,
            name: `Lead ${leadPhone}`,
            phone: leadPhone,
            source: null
          })
          .select()
          .single();
        
        if (!leadError && newLead) {
          insertData.lead_id = newLead.id;
        }
      }
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert(insertData)
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    return data;
  };

  return { data, loading, error, refetch: fetch, send };
}
// ==========================================
// MARKETING DATA
// ==========================================
export interface MarketingData {
  id: string;
  clinic_id: string;
  date: string;
  platform: 'meta_ads' | 'google_ads' | 'no_track';
  investment: number;
  conversions_value: number;
  manual_leads_count: number | null;
  manual_appointments_count: number | null;
  manual_conversions_count: number | null;
  created_at: string;
}

export function useMarketing() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<MarketingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentRange = useRef<{ start: string; end: string } | null>(null);

  const fetch = useCallback(async (startDate: string, endDate: string) => {
    if (!activeClinicId) return;
    currentRange.current = { start: startDate, end: endDate };
    setLoading(true);

    const { data, error } = await supabase
      .from('marketing_data')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setData(data || []);
    setError(null);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    if (!activeClinicId) return;

    const channel = supabase
      .channel('marketing_realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'marketing_data',
        filter: `clinic_id=eq.${activeClinicId}`
      }, () => {
        if (currentRange.current) {
          fetch(currentRange.current.start, currentRange.current.end);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeClinicId, fetch]);

  const upsert = async (items: Partial<MarketingData>[]) => {
    if (!activeClinicId) return false;

    const prepared = items.map(item => ({
      ...item,
      clinic_id: activeClinicId
    }));

    const { error } = await supabase
      .from('marketing_data')
      .upsert(prepared, { onConflict: 'clinic_id,date,platform' });

    return !error;
  };

  return { data, loading, error, fetch, upsert };
}

// ==========================================
// TRANSITION RULES
// ==========================================
export interface TransitionRule {
  id: string;
  clinic_id: string;
  keywords: string;
  target_stage_id: string;
  context?: string | null;
  lead_response?: string | null;
  message_to_send?: string | null;
  order_index: number;
  created_at: string;
}

// Webhook de teste isolado no n8n (Opcao B): cria lead se preciso, roda a
// deteccao do gatilho, envia message_to_send e move a etapa destino. A URL pode
// ser sobrescrita em system_settings (id = 'test_gatilho_webhook_url').
const TEST_GATILHO_WEBHOOK_FALLBACK = 'https://webhook.med4growautomacao.com.br/webhook/meddesk/test-gatilho';
export const TEST_GATILHO_SEED_MESSAGE = 'Esta mensagem é um teste de Gatilhos do sistema MedDesk';

export interface RuleTestStageResult {
  leadId: string;
  ticketId: string | null;
  stageId: string | null;
}

export function useTransitionRules() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<TransitionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    const cacheKey = `transition_rules:${activeClinicId}`;
    const cached = getCached<TransitionRule[]>(cacheKey);
    if (cached) { setData(cached); setLoading(false); return; }
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('stage_transition_rules')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('order_index')
      .order('created_at');

    if (error) { setError(error.message); setLoading(false); return; }
    setCached(cacheKey, data || []);
    setData(data || []);
    setError(null);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (rule: Partial<TransitionRule>) => {
    if (!activeClinicId) return null;
    const nextIndex = data.length;
    const { data: created, error } = await supabase
      .from('stage_transition_rules')
      .insert({ ...rule, clinic_id: activeClinicId, order_index: nextIndex })
      .select()
      .single();
    if (!error) {
      invalidateCache(`transition_rules:${activeClinicId}`);
      setData(prev => [...prev, created]);
    }
    return created;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('stage_transition_rules').delete().eq('id', id);
    if (!error) {
      invalidateCache(`transition_rules:${activeClinicId}`);
      setData(prev => prev.filter(r => r.id !== id));
    }
    return !error;
  };

  const update = async (id: string, rule: Partial<TransitionRule>) => {
    const { data: updated, error } = await supabase
      .from('stage_transition_rules')
      .update(rule)
      .eq('id', id)
      .select()
      .single();
    if (!error) {
      invalidateCache(`transition_rules:${activeClinicId}`);
      setData(prev => prev.map(r => r.id === id ? { ...r, ...rule } : r));
    }
    return updated;
  };

  const reorder = async (reordered: TransitionRule[]) => {
    setData(reordered);
    invalidateCache(`transition_rules:${activeClinicId}`);
    await Promise.all(
      reordered.map((rule, idx) =>
        supabase
          .from('stage_transition_rules')
          .update({ order_index: idx })
          .eq('id', rule.id)
      )
    );
  };

  // Aciona o webhook de teste no n8n para a regra/numero informados.
  // O app so dispara; quem cria o lead, envia a mensagem e move a etapa e o n8n.
  const testRule = async (rule: TransitionRule, leadPhone: string) => {
    if (!activeClinicId) return { ok: false as const, error: 'no_clinic' as const };
    const phone = (leadPhone || '').replace(/\D/g, '');
    if (!phone) return { ok: false as const, error: 'invalid_phone' as const };

    const [{ data: instance }, { data: settingsRows }] = await Promise.all([
      supabase.from('whatsapp_instances').select('api_token, phone_number').eq('clinic_id', activeClinicId).maybeSingle(),
      supabase.from('system_settings').select('id, value').eq('id', 'test_gatilho_webhook_url'),
    ]);
    const targetUrl = settingsRows?.[0]?.value || TEST_GATILHO_WEBHOOK_FALLBACK;

    const { error } = await supabase.functions.invoke('webhook-proxy', {
      body: {
        target_url: targetUrl,
        payload: {
          event: 'test_transition_rule',
          clinic_id: activeClinicId,
          clinic_phone: instance?.phone_number || null,
          lead_phone: phone,
          keywords: rule.keywords,
          message_to_send: rule.message_to_send,
          target_stage_id: rule.target_stage_id,
          seed_message: TEST_GATILHO_SEED_MESSAGE,
          token: instance?.api_token || null,
        },
      },
    });
    if (error) return { ok: false as const, error: 'webhook_failed' as const };
    return { ok: true as const };
  };

  // Busca a etapa atual do lead pelo telefone, com match tolerante por sufixo
  // (o numero e normalizado pelo n8n upstream - 9o digito/formatacao podem diferir).
  const lookupActiveStageByPhone = async (leadPhone: string): Promise<RuleTestStageResult | null> => {
    if (!activeClinicId) return null;
    const digits = (leadPhone || '').replace(/\D/g, '');
    if (digits.length < 8) return null;
    const suffix = digits.slice(-8);

    const { data: leadsFound } = await supabase
      .from('leads')
      .select('id')
      .eq('clinic_id', activeClinicId)
      .ilike('phone', `%${suffix}`)
      .order('last_activity_at', { ascending: false })
      .limit(1);
    const leadId = leadsFound?.[0]?.id;
    if (!leadId) return null;

    const { data: ticketRows } = await supabase
      .from('tickets')
      .select('id, stage_id')
      .eq('clinic_id', activeClinicId)
      .eq('lead_id', leadId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1);
    const ticket = ticketRows?.[0];
    return {
      leadId,
      ticketId: ticket?.id ?? null,
      stageId: ticket?.stage_id ?? null,
    };
  };

  return { data, loading, error, refetch: fetch, create, remove, update, reorder, testRule, lookupActiveStageByPhone };
}

// ==========================================
// ORGANIZATIONS
// ==========================================
export interface Organization {
  id: string;
  name: string;
  plan: string;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  google_ad_mcc_id?: string | null;
  google_ad_mcc_token?: string | null;
}

export function useOrganizations() {
  const [data, setData] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('organizations').select('*').order('name');
    setData(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (org: { name: string; plan: string; ownerName?: string; ownerEmail?: string; ownerPassword?: string; ownerRole?: string }) => {
    if (org.ownerEmail) {
      const { data, error } = await supabase.rpc('create_org_with_owner', {
        p_org_name: org.name,
        p_plan: org.plan || 'pro',
        p_owner_name: org.ownerName || '',
        p_owner_email: org.ownerEmail,
        p_owner_password: org.ownerPassword || '',
        p_owner_role: org.ownerRole || 'org_owner',
      });
      if (!error) fetch();
      return { data, error };
    }
    const { data, error } = await supabase.from('organizations').insert({ name: org.name, plan: org.plan }).select().single();
    if (!error) fetch();
    return { data, error };
  };

  const update = async (id: string, updates: Partial<Organization>) => {
    const { error } = await supabase.from('organizations').update(updates).eq('id', id);
    if (!error) fetch();
    return !error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.rpc('delete_organization_cascade', { p_org_id: id });
    if (!error) fetch();
    return !error;
  };

  return { data, loading, create, update, remove, refetch: fetch };
}

// ==========================================
// SUPER ADMIN DATA
// ==========================================
export interface ClinicUser {
  id: string;
  clinic_id: string;
  role: string;
  full_name: string;
  email: string;
  avatar_url?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface OrgUser {
  id: string;
  user_id: string;
  organization_id: string;
  role: string;
  full_name: string;
  email: string;
  created_at: string;
}

export function useGlobalSystemSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('system_settings').select('*');
    if (data) {
      const map: Record<string, string> = {};
      data.forEach(s => { map[s.id] = s.value; });
      setSettings(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const updateSetting = async (id: string, value: string) => {
    const { error } = await supabase.from('system_settings').upsert({ id, value });
    if (!error) {
      setSettings(prev => ({ ...prev, [id]: value }));
      return true;
    }
    return false;
  };

  return { settings, loading, updateSetting, refetch: fetch };
}

// ==========================================
// PROMPT TEMPLATES (biblioteca global de "prompts fixos")
// ==========================================
export interface PromptTemplate {
  id: string;
  name: string;
  focus: string; // sdr | agendamento | suporte | teste | clinica | varejo (livre)
  content: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function usePromptTemplates() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('prompt_templates')
      .select('*')
      .order('focus', { ascending: true })
      .order('name', { ascending: true });
    setTemplates(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  // Criação/edição/remoção exigem super-admin (RLS via is_admin()).
  const create = async (template: Pick<PromptTemplate, 'name' | 'focus' | 'content' | 'is_active'>) => {
    const { error } = await supabase.from('prompt_templates').insert(template);
    if (!error) await fetch();
    return !error;
  };

  const update = async (id: string, patch: Partial<Omit<PromptTemplate, 'id' | 'created_at'>>) => {
    const { error } = await supabase
      .from('prompt_templates')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) await fetch();
    return !error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('prompt_templates').delete().eq('id', id);
    if (!error) await fetch();
    return !error;
  };

  return { templates, loading, create, update, remove, refetch: fetch };
}

export function useSuperAdminData() {
  const [clinicUsers, setClinicUsers] = useState<Record<string, ClinicUser[]>>({});
  const [orgUsers, setOrgUsers] = useState<Record<string, OrgUser[]>>({});
  const [usersLoading, setUsersLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    const [cuRes, ouRes] = await Promise.all([
      supabase.from('clinic_users').select('*').order('full_name'),
      supabase.from('org_users').select('*').order('full_name'),
    ]);
    const grouped: Record<string, ClinicUser[]> = {};
    (cuRes.data || []).forEach((u: ClinicUser) => {
      if (!grouped[u.clinic_id]) grouped[u.clinic_id] = [];
      grouped[u.clinic_id].push(u);
    });
    setClinicUsers(grouped);
    const orgGrouped: Record<string, OrgUser[]> = {};
    (ouRes.data || []).forEach((u: OrgUser) => {
      if (!orgGrouped[u.organization_id]) orgGrouped[u.organization_id] = [];
      orgGrouped[u.organization_id].push(u);
    });
    setOrgUsers(orgGrouped);
    setUsersLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const addClinicUser = async (clinicId: string, user: { name: string; email: string; password: string; role: string }) => {
    const { error } = await supabase.rpc('add_user_to_clinic', {
      p_clinic_id: clinicId, p_full_name: user.name,
      p_email: user.email, p_password: user.password, p_role: user.role,
    });
    if (!error) fetchUsers();
    return !error;
  };

  const addOrgUser = async (orgId: string, user: { name: string; email: string; password: string; role: string }) => {
    const { error } = await supabase.rpc('add_user_to_org', {
      p_org_id: orgId, p_full_name: user.name,
      p_email: user.email, p_password: user.password, p_role: user.role,
    });
    if (!error) fetchUsers();
    return !error;
  };

  const removeClinicUser = async (userId: string, clinicId: string) => {
    const { error } = await supabase.rpc('remove_user_from_clinic', {
      p_user_id: userId, p_clinic_id: clinicId,
    });
    if (!error) fetchUsers();
    return !error;
  };

  const totalUsers = Object.values(clinicUsers).flat().length + Object.values(orgUsers).flat().length;

  return { clinicUsers, orgUsers, usersLoading, addClinicUser, addOrgUser, removeClinicUser, totalUsers, refetchUsers: fetchUsers };
}

// ==========================================
// CONVERSIONS
// ==========================================
export interface Conversion {
  id: string;
  clinic_id: string;
  lead_id: string;
  value: number;
  description: string | null;
  payment_method: string | null;
  protocol_ids: string[];
  converted_at: string;
  created_at: string;
  // Vínculo com o ticket da venda. Permite ao reopen_ticket (Cancelar venda) apagar a conversão
  // com precisão, em vez de depender do casamento por proximidade temporal (vendas antigas).
  ticket_id?: string | null;
  // Vínculo com a receita lançada. Permite ao gatilho fn_purge_ticket_sale apagar a receita
  // junto quando o ticket sai de 'ganho' (invariante: conversão só existe enquanto ganho).
  financial_transaction_id?: string | null;
}

export function useConversions() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Conversion[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId) return;
    const { data } = await supabase
      .from('conversions')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('converted_at', { ascending: false });
    setData(data || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (conversion: Omit<Conversion, 'id' | 'clinic_id' | 'created_at'>) => {
    if (!activeClinicId) return false;
    const { data, error } = await supabase.from('conversions').insert({
      ...conversion,
      clinic_id: activeClinicId,
    }).select().single();
    if (!error && data) setData(prev => [data, ...prev]);
    return !error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('conversions').delete().eq('id', id);
    if (!error) setData(prev => prev.filter(c => c.id !== id));
    return !error;
  };

  const update = async (id: string, patch: Partial<Pick<Conversion, 'value' | 'description' | 'payment_method' | 'converted_at'>>) => {
    setData(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    const { error } = await supabase.from('conversions').update(patch).eq('id', id);
    if (error) fetch();
    return !error;
  };

  // Agrupa por lead_id para uso no Kanban
  const byLead = data.reduce<Record<string, Conversion[]>>((acc, c) => {
    if (!acc[c.lead_id]) acc[c.lead_id] = [];
    acc[c.lead_id].push(c);
    return acc;
  }, {});

  return { data, loading, byLead, create, remove, update, refetch: fetch };
}

// ==========================================
// PROTOCOLS
// ==========================================
export interface Protocol {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  price: number | null;
  is_active: boolean;
  created_at: string;
}

export function useProtocols() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    const cacheKey = `protocols:${activeClinicId}`;
    const cached = getCached<Protocol[]>(cacheKey);
    if (cached) { setData(cached); setLoading(false); return; }
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('protocols')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('name');
    setCached(cacheKey, data || []);
    setData(data || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (protocol: Pick<Protocol, 'name' | 'description' | 'price' | 'is_active'>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('protocols')
      .insert({ ...protocol, clinic_id: activeClinicId })
      .select()
      .single();
    if (!error) {
      invalidateCache(`protocols:${activeClinicId}`);
      setData(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    }
    return error ? null : data;
  };

  const update = async (id: string, updates: Partial<Protocol>) => {
    const { error } = await supabase.from('protocols').update(updates).eq('id', id);
    if (!error) {
      invalidateCache(`protocols:${activeClinicId}`);
      setData(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    }
    return !error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('protocols').delete().eq('id', id);
    if (!error) {
      invalidateCache(`protocols:${activeClinicId}`);
      setData(prev => prev.filter(p => p.id !== id));
    }
    return !error;
  };

  return { data, loading, create, update, remove, refetch: fetch };
}

// ==========================================
// PRODUCTS (catalogo generico e personalizavel)
// ==========================================

// Campo extra livre de um produto (fio, malha, material, comprimento...).
export interface ProductAttribute {
  label: string;
  value: string;
  unit?: string | null;
}

export interface Product {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  unit: string;              // unidade de medida (metro, m2, un, hora, kg...)
  unit_price: number;        // valor por unidade
  attributes: ProductAttribute[];
  is_active: boolean;
  charge_by_area?: boolean;  // cobra por m² (área = comprimento × altura)
  altura?: number | null;    // altura FIXA do SKU (flatten por altura); quando presente, a venda não digita altura
  tipo?: string;             // 'padrao' (estocável) | 'sob_medida' (make-to-order)
  base_product_id?: string | null;  // liga o SKU de altura ao modelo base (agrupamento na aba Estoque)
  quote_image_ids?: string[] | null;  // fotos lembradas p/ envio no orçamento deste produto (null = usa send_by_default global)
  color?: string | null;     // cor de preenchimento (tag visual) no catálogo
  position?: number;         // ordem manual no catálogo
  created_at: string;
}

export type ProductInput = Pick<Product, 'name' | 'description' | 'unit' | 'unit_price' | 'attributes' | 'is_active' | 'charge_by_area' | 'quote_image_ids' | 'color'>;

export function useProducts() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    const cacheKey = `products:${activeClinicId}`;
    const cached = getCached<Product[]>(cacheKey);
    if (cached) { setData(cached); setLoading(false); return; }
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('position')
      .order('name');
    setCached(cacheKey, data || []);
    setData((data as Product[]) || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (product: ProductInput) => {
    if (!activeClinicId) return null;
    const nextPos = data.reduce((m, p) => Math.max(m, p.position ?? 0), -1) + 1; // vai pro fim do catálogo
    const { data: row, error } = await supabase
      .from('products')
      .insert({ ...product, clinic_id: activeClinicId, position: nextPos })
      .select()
      .single();
    if (!error) {
      invalidateCache(`products:${activeClinicId}`);
      setData(prev => [...prev, row as Product]);
    }
    return error ? null : (row as Product);
  };

  const update = async (id: string, updates: Partial<Product>) => {
    const { error } = await supabase.from('products').update(updates).eq('id', id);
    if (!error) {
      invalidateCache(`products:${activeClinicId}`);
      setData(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    }
    return !error;
  };

  // Move o produto p/ cima (-1) ou baixo (+1) no catálogo, trocando a posição com o vizinho.
  const move = async (id: string, direction: -1 | 1) => {
    const idx = data.findIndex(p => p.id === id);
    const j = idx + direction;
    if (idx < 0 || j < 0 || j >= data.length) return false;
    const a = data[idx], b = data[j];
    const aPos = a.position ?? idx, bPos = b.position ?? j;
    setData(prev => { const next = [...prev]; next[idx] = { ...b, position: aPos }; next[j] = { ...a, position: bPos }; return next; });
    invalidateCache(`products:${activeClinicId}`);
    const r1 = await supabase.from('products').update({ position: bPos }).eq('id', a.id);
    const r2 = await supabase.from('products').update({ position: aPos }).eq('id', b.id);
    return !r1.error && !r2.error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (!error) {
      invalidateCache(`products:${activeClinicId}`);
      setData(prev => prev.filter(p => p.id !== id));
    }
    return !error;
  };

  return { data, loading, create, update, move, remove, refetch: fetch };
}

// ==========================================
// QUOTE IMAGES (banco de fotos enviadas com o orçamento)
// ==========================================

export interface QuoteImage {
  id: string;
  clinic_id: string;
  url: string;
  path: string;
  name: string | null;
  send_by_default: boolean;
  created_at: string;
}

export function useQuoteImages() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<QuoteImage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId) return;
    setLoading(true);
    const { data } = await supabase
      .from('quote_images')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('created_at');
    setData((data as QuoteImage[]) || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  const upload = async (file: File) => {
    if (!activeClinicId) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${activeClinicId}/gallery/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('quotes').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
    if (upErr) return null;
    const { data: pub } = supabase.storage.from('quotes').getPublicUrl(path);
    const { data: row, error } = await supabase
      .from('quote_images')
      .insert({ clinic_id: activeClinicId, url: pub.publicUrl, path, name: file.name, send_by_default: true })
      .select()
      .single();
    if (error) return null;
    setData(prev => [...prev, row as QuoteImage]);
    return row as QuoteImage;
  };

  const toggleSend = async (id: string, send: boolean) => {
    const { error } = await supabase.from('quote_images').update({ send_by_default: send }).eq('id', id);
    if (!error) setData(prev => prev.map(x => x.id === id ? { ...x, send_by_default: send } : x));
    return !error;
  };

  const remove = async (img: QuoteImage) => {
    const { error } = await supabase.from('quote_images').delete().eq('id', img.id);
    if (!error) {
      setData(prev => prev.filter(x => x.id !== img.id));
      supabase.storage.from('quotes').remove([img.path]).then(() => {}, () => {});
    }
    return !error;
  };

  return { data, loading, upload, toggleSend, remove, refetch: fetch };
}

// ==========================================
// PRESCRIPTIONS
// ==========================================
export interface PrescriptionMed {
  name: string;
  dosage: string;
  quantity: string;
  instructions: string;
}

export interface Prescription {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string | null;
  record_id: string | null;
  medications: PrescriptionMed[];
  notes: string | null;
  created_at: string;
}

export function usePrescriptions(patientId: string | null) {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId || !patientId) { setData([]); setLoading(false); return; }
    const { data } = await supabase
      .from('prescriptions')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    setData(data || []);
    setLoading(false);
  }, [activeClinicId, patientId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (payload: Omit<Prescription, 'id' | 'clinic_id' | 'created_at'>) => {
    if (!activeClinicId) return false;
    const { data: row, error } = await supabase
      .from('prescriptions')
      .insert({ ...payload, clinic_id: activeClinicId })
      .select()
      .single();
    if (!error && row) setData(prev => [row, ...prev]);
    return !error;
  };

  const remove = async (id: string) => {
    await supabase.from('prescriptions').delete().eq('id', id);
    setData(prev => prev.filter(p => p.id !== id));
  };

  return { data, loading, create, remove, refetch: fetch };
}

// ==========================================
// EXAM REQUESTS
// ==========================================
export interface ExamItem {
  name: string;
  type: 'laboratorial' | 'imagem' | 'funcional' | 'outro';
  urgency: 'rotina' | 'urgente';
}

export interface ExamRequest {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string | null;
  record_id: string | null;
  exams: ExamItem[];
  clinical_indication: string | null;
  notes: string | null;
  created_at: string;
}

export function useExamRequests(patientId: string | null) {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<ExamRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId || !patientId) { setData([]); setLoading(false); return; }
    const { data } = await supabase
      .from('exam_requests')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    setData(data || []);
    setLoading(false);
  }, [activeClinicId, patientId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (payload: Omit<ExamRequest, 'id' | 'clinic_id' | 'created_at'>) => {
    if (!activeClinicId) return false;
    const { data: row, error } = await supabase
      .from('exam_requests')
      .insert({ ...payload, clinic_id: activeClinicId })
      .select()
      .single();
    if (!error && row) setData(prev => [row, ...prev]);
    return !error;
  };

  const remove = async (id: string) => {
    await supabase.from('exam_requests').delete().eq('id', id);
    setData(prev => prev.filter(e => e.id !== id));
  };

  return { data, loading, create, remove, refetch: fetch };
}

// ==========================================
// ORG TASKS (Matriz de Eisenhower - painel de organizacoes)
// ==========================================
export interface OrgTask {
  id: string;
  organization_id: string;
  title: string;
  is_urgent: boolean;
  is_important: boolean;
  responsible_ids: string[];
  clinic_id: string | null;
  position: number;
  due_date: string | null;
  status: 'todo' | 'doing' | 'done';
  is_done: boolean;
  done_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useOrgTasks(organizationId: string | null | undefined) {
  const [data, setData] = useState<OrgTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false, force = false) => {
    if (!organizationId) return;
    const cacheKey = `org_tasks:${organizationId}`;
    if (force) invalidateCache(cacheKey);
    const cached = getCached<OrgTask[]>(cacheKey);
    if (cached) { setData(cached); setLoading(false); return; }
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('org_tasks')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setCached(cacheKey, data || []);
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    fetch();
    if (!organizationId) return;

    const interval = setInterval(() => {
      invalidateCache(`org_tasks:${organizationId}`);
      fetch(true);
    }, 120_000);

    const channel = supabase
      .channel(`org_tasks_realtime:${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_tasks', filter: `organization_id=eq.${organizationId}` }, () => {
        invalidateCache(`org_tasks:${organizationId}`);
        fetch(true);
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetch, organizationId]);

  const create = async (task: Partial<OrgTask>) => {
    if (!organizationId) return null;
    const { data: user } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('org_tasks')
      .insert({ ...task, organization_id: organizationId, created_by: user?.user?.id ?? null })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    invalidateCache(`org_tasks:${organizationId}`);
    setData(prev => [data, ...prev]);
    return data as OrgTask;
  };

  const update = async (id: string, updates: Partial<OrgTask>) => {
    const patch = { ...updates, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('org_tasks').update(patch).eq('id', id);
    if (error) { setError(error.message); return false; }
    invalidateCache(`org_tasks:${organizationId}`);
    setData(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    return true;
  };

  const setStatus = async (task: OrgTask, status: OrgTask['status']) => {
    const done = status === 'done';
    return update(task.id, { status, is_done: done, done_at: done ? new Date().toISOString() : null });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('org_tasks').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    invalidateCache(`org_tasks:${organizationId}`);
    setData(prev => prev.filter(t => t.id !== id));
    return true;
  };

  return { data, loading, error, refetch: fetch, create, update, setStatus, remove };
}

// ==========================================
// PRODUCAO: ESTOQUE + PCP + MANUTENCAO (clientes WakeDesk, clinics.category='outro')
// ==========================================

export type InventoryKind = 'materia_prima' | 'produto_acabado' | 'insumo';

export const INVENTORY_KIND_LABEL: Record<InventoryKind, string> = {
  materia_prima: 'Matéria-prima',
  produto_acabado: 'Produto acabado',
  insumo: 'Insumo',
};

// Item estocavel. current_qty e um saldo cacheado mantido por trigger a partir de inventory_movements.
export interface InventoryItem {
  id: string;
  clinic_id: string;
  kind: InventoryKind;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  current_qty: number;
  min_qty: number;
  unit_cost: number;
  product_id: string | null;   // liga produto acabado ao catalogo `products`
  protocol_id: string | null;  // ou ao catalogo `protocols` (Dados da Clinica) — exclusivo com product_id
  location: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  altura?: number | null;                 // SKU de tela achatado por altura
  tipo?: string;                          // 'padrao' | 'sob_medida'
  lote_minimo?: number | null;
  lead_time_producao?: number | null;     // fallback (dias) enquanto taxa/setup não cadastrados
  taxa_producao_m2_hora?: number | null;  // m²/hora — mesma p/ qualquer altura do modelo (malha+fio)
  tempo_setup_horas?: number | null;      // horas p/ configurar a máquina (só se trocar de modelo)
  // Derivados da view vw_inventory_available (presentes só quando lido via view):
  reserved_qty?: number;                  // Σ reservas ativas (ml)
  available_qty?: number;                 // saldo − reservado
  reposicao_qty?: number;                 // Σ OPs de reposição abertas (o que o operador já programou)
  precisa_reposicao?: boolean;            // alerta: disponível + reposição em andamento < mínimo
}
export type InventoryItemInput = Partial<Omit<InventoryItem, 'id' | 'clinic_id' | 'created_at' | 'current_qty'>>;

export function useInventoryItems(kind?: InventoryKind) {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    // Lê da view (traz disponível/reservado/reposição/precisa_reposicao); mutações continuam na tabela.
    let query = supabase.from('vw_inventory_available').select('*').eq('clinic_id', activeClinicId);
    if (kind) query = query.eq('kind', kind);
    const { data } = await query.order('name');
    setData((data as InventoryItem[]) || []);
    setLoading(false);
  }, [activeClinicId, kind]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    const channel = supabase
      .channel(`inventory_items_${activeClinicId}_${kind || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items', filter: `clinic_id=eq.${activeClinicId}` }, () => fetch(true))
      .subscribe();
    const interval = setInterval(() => fetch(true), 60_000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [fetch, activeClinicId, kind]);

  const create = async (item: InventoryItemInput) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('inventory_items')
      .insert({ ...item, clinic_id: activeClinicId })
      .select()
      .single();
    if (error) return null;
    setData(prev => [...prev, data as InventoryItem].sort((a, b) => a.name.localeCompare(b.name)));
    return data as InventoryItem;
  };

  const update = async (id: string, updates: Partial<InventoryItem>) => {
    setData(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
    const { error } = await supabase.from('inventory_items').update(updates).eq('id', id);
    if (error) { fetch(true); return false; }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(i => i.id !== id));
    const { error } = await supabase.from('inventory_items').delete().eq('id', id);
    if (error) { fetch(true); return false; }
    return true;
  };

  // Itens que precisam de reposição. Usa o alerta da view (disponível + reposição em andamento <
  // mínimo, já descontando reservas); cai na regra antiga (saldo ≤ mínimo) se a view não trouxe o campo.
  const lowStock = useMemo(
    () => data.filter(i => i.is_active && (
      i.precisa_reposicao != null
        ? i.precisa_reposicao
        : (Number(i.min_qty) > 0 && Number(i.current_qty) <= Number(i.min_qty))
    )),
    [data],
  );
  const totalValue = useMemo(
    () => data.reduce((s, i) => s + Number(i.current_qty) * Number(i.unit_cost), 0),
    [data],
  );

  return { data, loading, create, update, remove, refetch: fetch, lowStock, totalValue };
}

// Movimentacao de estoque (razao). O trigger apply_inventory_movement atualiza o saldo do item.
export interface InventoryMovement {
  id: string;
  clinic_id: string;
  item_id: string;
  type: 'entrada' | 'saida';
  qty: number;
  unit_cost: number | null;
  reason: string | null;
  responsavel: string | null;
  altura: number | null;
  production_order_id: string | null;
  maintenance_order_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  item?: { name: string; unit: string } | null;
}

export function useInventoryMovements(itemId?: string | null) {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) { setData([]); setLoading(false); return; }
    if (!silent) setLoading(true);
    let query = supabase
      .from('inventory_movements')
      .select('*, item:inventory_items(name, unit)')
      .eq('clinic_id', activeClinicId);
    if (itemId) query = query.eq('item_id', itemId);
    const { data } = await query.order('created_at', { ascending: false }).limit(500);
    setData((data as InventoryMovement[]) || []);
    setLoading(false);
  }, [activeClinicId, itemId]);

  useEffect(() => { fetch(); }, [fetch]);

  // Registra entrada/saida/ajuste. Ajuste de inventario deve ser calculado pela UI
  // (diferenca ate o saldo alvo) e enviado como entrada/saida com reason='ajuste'.
  const register = async (mov: {
    item_id: string;
    type: 'entrada' | 'saida';
    qty: number;
    unit_cost?: number | null;
    reason?: string | null;
    responsavel?: string | null;
    altura?: number | null;
    notes?: string | null;
    production_order_id?: string | null;
    maintenance_order_id?: string | null;
  }) => {
    if (!activeClinicId) return null;
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('inventory_movements')
      .insert({ ...mov, clinic_id: activeClinicId, created_by: auth?.user?.id ?? null })
      .select()
      .single();
    if (error) return null;
    await fetch(true);
    return data as InventoryMovement;
  };

  return { data, loading, register, refetch: fetch };
}

// Saldo por (item, altura) da view vw_inventory_stock_by_altura, agrupado por item.
// Alimenta a exibicao da altura como "subproduto" na lista de estoque (só saldo > 0).
export interface StockByAltura { item_id: string; altura: number; qty: number; }

export function useStockByAltura() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<StockByAltura[]>([]);

  const fetch = useCallback(async () => {
    if (!activeClinicId) { setData([]); return; }
    const { data } = await supabase
      .from('vw_inventory_stock_by_altura')
      .select('item_id, altura, qty')
      .eq('clinic_id', activeClinicId);
    setData((data as StockByAltura[]) || []);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    const channel = supabase
      .channel(`stock_altura_${activeClinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements', filter: `clinic_id=eq.${activeClinicId}` }, () => fetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  // item_id -> [{altura, qty}] com saldo > 0, ordenado por altura.
  const byItem = useMemo(() => {
    const m = new Map<string, { altura: number; qty: number }[]>();
    for (const r of data) {
      if (Number(r.qty) <= 0) continue;
      const arr = m.get(r.item_id) || [];
      arr.push({ altura: Number(r.altura), qty: Number(r.qty) });
      m.set(r.item_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.altura - b.altura);
    return m;
  }, [data]);

  return { byItem, refetch: fetch };
}

// Cadastro de responsaveis (por clinica) para o seletor das movimentacoes de estoque.
export interface Responsible {
  id: string;
  clinic_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export function useResponsibles() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId) { setData([]); setLoading(false); return; }
    const { data } = await supabase
      .from('production_responsibles')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .eq('is_active', true)
      .order('name');
    setData((data as Responsible[]) || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  // Adiciona um responsavel reutilizavel. Se ja existir (mesmo nome), apenas recarrega.
  const add = async (name: string) => {
    const nome = name.trim();
    if (!activeClinicId || !nome) return null;
    const { data, error } = await supabase
      .from('production_responsibles')
      .insert({ clinic_id: activeClinicId, name: nome })
      .select()
      .single();
    if (error) { await fetch(); return null; }
    setData(prev => [...prev, data as Responsible].sort((a, b) => a.name.localeCompare(b.name)));
    return data as Responsible;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(r => r.id !== id));
    const { error } = await supabase.from('production_responsibles').delete().eq('id', id);
    if (error) { fetch(); return false; }
    return true;
  };

  return { data, loading, add, remove, refetch: fetch };
}

// Ficha tecnica (BOM): linhas material x quantidade por unidade de um produto acabado.
export interface BomLine {
  id: string;
  clinic_id: string;
  product_item_id: string;
  material_item_id: string;
  qty_per_unit: number;
  notes: string | null;
  created_at: string;
  material?: { name: string; unit: string } | null;
}

export function useProductBom(productItemId?: string | null) {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<BomLine[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId || !productItemId) { setData([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('product_bom')
      .select('*, material:inventory_items!product_bom_material_item_id_fkey(name, unit)')
      .eq('product_item_id', productItemId)
      .order('created_at');
    setData((data as BomLine[]) || []);
    setLoading(false);
  }, [activeClinicId, productItemId]);

  useEffect(() => { fetch(); }, [fetch]);

  const add = async (material_item_id: string, qty_per_unit: number) => {
    if (!activeClinicId || !productItemId) return null;
    const { data, error } = await supabase
      .from('product_bom')
      .insert({ clinic_id: activeClinicId, product_item_id: productItemId, material_item_id, qty_per_unit })
      .select('*, material:inventory_items!product_bom_material_item_id_fkey(name, unit)')
      .single();
    if (error) return null;
    setData(prev => [...prev, data as BomLine]);
    return data as BomLine;
  };

  const update = async (id: string, qty_per_unit: number) => {
    setData(prev => prev.map(b => b.id === id ? { ...b, qty_per_unit } : b));
    const { error } = await supabase.from('product_bom').update({ qty_per_unit }).eq('id', id);
    if (error) { fetch(); return false; }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(b => b.id !== id));
    const { error } = await supabase.from('product_bom').delete().eq('id', id);
    if (error) { fetch(); return false; }
    return true;
  };

  return { data, loading, add, update, remove, refetch: fetch };
}

// Custo de material (ficha tecnica) de TODOS os produtos acabados da clinica de uma vez — usado
// para o "Valor em estoque" da lista (useProductBom busca so 1 item, para o modal).
export function useAllProductBomCost() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId) { setData(new Map()); setLoading(false); return; }
    setLoading(true);
    const { data: rows } = await supabase
      .from('product_bom')
      .select('product_item_id, qty_per_unit, material:inventory_items!product_bom_material_item_id_fkey(unit_cost)')
      .eq('clinic_id', activeClinicId);
    const map = new Map<string, number>();
    (rows || []).forEach((r: any) => {
      const cost = Number(r.qty_per_unit) * Number(r.material?.unit_cost ?? 0);
      map.set(r.product_item_id, (map.get(r.product_item_id) ?? 0) + cost);
    });
    setData(map);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refetch: fetch };
}

// Ordem de Producao (PCP). number e sequencial por clinica (definido por trigger).
export type ProductionStatus = 'planejada' | 'em_producao' | 'concluida' | 'cancelada';

export interface ProductionOrder {
  id: string;
  clinic_id: string;
  number: number;
  product_item_id: string | null;
  product_label: string | null;
  qty_planned: number;
  qty_produced: number;
  altura: number | null;
  status: ProductionStatus;
  priority: 'baixa' | 'normal' | 'alta';
  due_date: string | null;
  started_at: string | null;
  finished_at: string | null;
  ticket_id: string | null;
  lead_id: string | null;
  client_name: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  tipo?: string | null;          // 'vinculada' (pedido de cliente) | 'reposicao' (refil de estoque)
  orcamento_id?: string | null;  // pedido de origem (OPs vinculadas)
  product?: { name: string; unit: string } | null;
}
export type ProductionOrderInput = Partial<Omit<ProductionOrder, 'id' | 'clinic_id' | 'number' | 'created_at' | 'product'>>;

export function useProductionOrders() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('production_orders')
      .select('*, product:inventory_items(name, unit)')
      .eq('clinic_id', activeClinicId)
      .order('number', { ascending: false });
    setData((data as ProductionOrder[]) || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    const channel = supabase
      .channel(`production_orders_${activeClinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders', filter: `clinic_id=eq.${activeClinicId}` }, () => fetch(true))
      .subscribe();
    const interval = setInterval(() => fetch(true), 60_000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [fetch, activeClinicId]);

  const create = async (order: ProductionOrderInput) => {
    if (!activeClinicId) return null;
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('production_orders')
      .insert({ ...order, clinic_id: activeClinicId, created_by: auth?.user?.id ?? null })
      .select('*, product:inventory_items(name, unit)')
      .single();
    if (error) return null;
    setData(prev => [data as ProductionOrder, ...prev]);
    return data as ProductionOrder;
  };

  const update = async (id: string, updates: Partial<ProductionOrder>) => {
    setData(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
    const { error } = await supabase.from('production_orders').update(updates).eq('id', id);
    if (error) { fetch(true); return false; }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(o => o.id !== id));
    const { error } = await supabase.from('production_orders').delete().eq('id', id);
    if (error) { fetch(true); return false; }
    return true;
  };

  // Conclui a OP: baixa materia-prima pela ficha tecnica e da entrada no produto acabado (RPC idempotente).
  const complete = async (id: string, qtyProduced: number, altura?: number | null) => {
    const { data: res, error } = await supabase.rpc('complete_production_order', { p_order_id: id, p_qty_produced: qtyProduced, p_altura: altura ?? null });
    await fetch(true);
    if (error) return { success: false, error: error.message };
    return res as { success: boolean; error_code?: string; already_done?: boolean };
  };

  return { data, loading, create, update, remove, complete, refetch: fetch };
}

// ==========================================
// ORÇAMENTOS (Central de Orçamentos, WakeDesk/category='outro')
// ==========================================
export type OrcamentoStatus = 'rascunho' | 'enviado' | 'aprovado' | 'recusado' | 'expirado';

export interface Orcamento {
  id: string;
  clinic_id: string;
  number: number;
  lead_id: string | null;
  ticket_id: string | null;
  approved_ticket_id: string | null;
  status: OrcamentoStatus;
  client_name: string | null;
  client_doc: string | null;
  client_address: string | null;
  subtotal: number | null;
  desconto: number | null;
  frete: number | null;
  total: number;
  validade: string | null;
  vencimento: string | null;
  data_entrega_prevista: string | null;  // data prometida de entrega do pedido (fábrica)
  approved_line_keys?: string[] | null;  // itens aprovados ('L1','L2'…); null = todos do snapshot
  pagamento: string | null;
  notes: string | null;
  reject_reason: string | null;
  snapshot: any;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  lead?: { name: string; phone: string | null } | null;
}

export interface SaveOrcamentoInput {
  id?: string | null;
  leadId: string;
  ticketId?: string | null;
  status: 'rascunho' | 'enviado';
  clientName?: string | null;
  clientDoc?: string | null;
  clientAddress?: string | null;
  subtotal?: number | null;
  desconto?: number | null;
  frete?: number | null;
  total: number;
  validade?: string | null;
  vencimento?: string | null;
  pagamento?: string | null;
  notes?: string | null;
  snapshot?: any;
}

type RpcResult = { success: boolean; error_code?: string; [key: string]: any };

// Orçamento VIGENTE de um lead: espelha get_orcamento_vigente (SQL) para uso client-side sem
// round-trip — prioriza um 'aprovado' cujo approved_ticket_id é o ticket aberto atual do lead;
// senão, o mais recente por created_at.
export function getVigenteOrcamento(list: Orcamento[], leadId: string, openTicketId?: string | null): Orcamento | null {
  const mine = list.filter(o => o.lead_id === leadId);
  if (!mine.length) return null;
  const approvedCurrent = mine.find(o => o.status === 'aprovado' && o.approved_ticket_id && o.approved_ticket_id === openTicketId);
  if (approvedCurrent) return approvedCurrent;
  return mine.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

export function useOrcamentos() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Orcamento[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('orcamentos')
      .select('*, lead:leads(name, phone)')
      .eq('clinic_id', activeClinicId)
      .order('number', { ascending: false });
    setData((data as Orcamento[]) || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    const channel = supabase
      .channel(`orcamentos_${activeClinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orcamentos', filter: `clinic_id=eq.${activeClinicId}` }, () => fetch(true))
      .subscribe();
    const interval = setInterval(() => fetch(true), 60_000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [fetch, activeClinicId]);

  // Único ponto de escrita (criar/editar): grava o cabeçalho e espelha em
  // tickets.quote_data/notes + leads.estimated_value dentro da mesma transação (RPC).
  const save = async (input: SaveOrcamentoInput): Promise<RpcResult> => {
    if (!activeClinicId) return { success: false, error_code: 'no_active_clinic' };
    const { data: res, error } = await supabase.rpc('save_orcamento', {
      p_id: input.id ?? null,
      p_clinic_id: activeClinicId,
      p_lead_id: input.leadId,
      p_status: input.status,
      p_client_name: input.clientName ?? null,
      p_client_doc: input.clientDoc ?? null,
      p_client_address: input.clientAddress ?? null,
      p_subtotal: input.subtotal ?? null,
      p_desconto: input.desconto ?? null,
      p_frete: input.frete ?? null,
      p_total: input.total,
      p_validade: input.validade ?? null,
      p_vencimento: input.vencimento ?? null,
      p_pagamento: input.pagamento ?? null,
      p_notes: input.notes ?? null,
      p_snapshot: input.snapshot ?? null,
      p_ticket_id: input.ticketId ?? null,
    });
    await fetch(true);
    if (error) return { success: false, error_code: error.message };
    return res as RpcResult;
  };

  // Aprovar = fecha a venda (Ganho + receita). Idempotente no servidor.
  const approve = async (id: string, opts: { paymentMethod: string; paymentStatus: 'pago' | 'pendente'; paymentDate: string; category?: string; dataEntrega?: string | null; lineKeys?: string[] | null; total?: number | null }): Promise<RpcResult> => {
    const { data: res, error } = await supabase.rpc('close_sale_from_orcamento', {
      p_orcamento_id: id,
      p_payment_method: opts.paymentMethod,
      p_payment_status: opts.paymentStatus,
      p_payment_date: opts.paymentDate,
      p_category: opts.category ?? 'Venda de produto',
      p_data_entrega: opts.dataEntrega || null,
      p_line_keys: opts.lineKeys ?? null,
      p_total: opts.total ?? null,
    });
    await fetch(true);
    if (error) return { success: false, error_code: error.message };
    return res as RpcResult;
  };

  const updateStatus = async (id: string, status: 'enviado' | 'recusado' | 'expirado', reason?: string | null): Promise<RpcResult> => {
    const { data: res, error } = await supabase.rpc('update_orcamento_status', {
      p_orcamento_id: id,
      p_status: status,
      p_reason: reason ?? null,
    });
    await fetch(true);
    if (error) return { success: false, error_code: error.message };
    return res as RpcResult;
  };

  // Campos "cosméticos" da Ordem de Pedido impressa (doc/endereço do cliente, vencimento) —
  // não afetam a venda, então dá p/ editar mesmo com o orçamento já aprovado.
  const setPrintInfo = async (id: string, info: { clientDoc?: string | null; clientAddress?: string | null; vencimento?: string | null }): Promise<RpcResult> => {
    const { data: res, error } = await supabase.rpc('set_orcamento_print_info', {
      p_orcamento_id: id,
      p_client_doc: info.clientDoc ?? null,
      p_client_address: info.clientAddress ?? null,
      p_vencimento: info.vencimento ?? null,
    });
    await fetch(true);
    if (error) return { success: false, error_code: error.message };
    return res as RpcResult;
  };

  return { data, loading, refetch: fetch, save, approve, updateStatus, setPrintInfo };
}

// Equipamento/maquina (Manutencao).
export interface Equipment {
  id: string;
  clinic_id: string;
  name: string;
  code: string | null;
  location: string | null;
  status: 'operando' | 'parada' | 'manutencao';
  notes: string | null;
  is_active: boolean;
  created_at: string;
}
export type EquipmentInput = Partial<Omit<Equipment, 'id' | 'clinic_id' | 'created_at'>>;

export function useEquipment() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data } = await supabase.from('equipment').select('*').eq('clinic_id', activeClinicId).order('name');
    setData((data as Equipment[]) || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    const channel = supabase
      .channel(`equipment_${activeClinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment', filter: `clinic_id=eq.${activeClinicId}` }, () => fetch(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const create = async (eq: EquipmentInput) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase.from('equipment').insert({ ...eq, clinic_id: activeClinicId }).select().single();
    if (error) return null;
    setData(prev => [...prev, data as Equipment].sort((a, b) => a.name.localeCompare(b.name)));
    return data as Equipment;
  };

  const update = async (id: string, updates: Partial<Equipment>) => {
    setData(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    const { error } = await supabase.from('equipment').update(updates).eq('id', id);
    if (error) { fetch(true); return false; }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(e => e.id !== id));
    const { error } = await supabase.from('equipment').delete().eq('id', id);
    if (error) { fetch(true); return false; }
    return true;
  };

  return { data, loading, create, update, remove, refetch: fetch };
}

// Ordem de Manutencao. number sequencial por clinica (trigger).
export interface MaintenanceOrder {
  id: string;
  clinic_id: string;
  number: number;
  equipment_id: string | null;
  type: 'preventiva' | 'corretiva' | 'preditiva';
  status: 'aberta' | 'em_andamento' | 'concluida' | 'cancelada';
  priority: 'baixa' | 'normal' | 'alta';
  scheduled_date: string | null;
  completed_at: string | null;
  cost: number;
  technician: string | null;
  description: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  equipment?: { name: string } | null;
}
export type MaintenanceOrderInput = Partial<Omit<MaintenanceOrder, 'id' | 'clinic_id' | 'number' | 'created_at' | 'equipment'>>;

export function useMaintenanceOrders() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<MaintenanceOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('maintenance_orders')
      .select('*, equipment:equipment(name)')
      .eq('clinic_id', activeClinicId)
      .order('number', { ascending: false });
    setData((data as MaintenanceOrder[]) || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    fetch();
    if (!activeClinicId) return;
    const channel = supabase
      .channel(`maintenance_orders_${activeClinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_orders', filter: `clinic_id=eq.${activeClinicId}` }, () => fetch(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const create = async (order: MaintenanceOrderInput) => {
    if (!activeClinicId) return null;
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('maintenance_orders')
      .insert({ ...order, clinic_id: activeClinicId, created_by: auth?.user?.id ?? null })
      .select('*, equipment:equipment(name)')
      .single();
    if (error) return null;
    setData(prev => [data as MaintenanceOrder, ...prev]);
    return data as MaintenanceOrder;
  };

  const update = async (id: string, updates: Partial<MaintenanceOrder>) => {
    setData(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
    const { error } = await supabase.from('maintenance_orders').update(updates).eq('id', id);
    if (error) { fetch(true); return false; }
    return true;
  };

  const remove = async (id: string) => {
    setData(prev => prev.filter(o => o.id !== id));
    const { error } = await supabase.from('maintenance_orders').delete().eq('id', id);
    if (error) { fetch(true); return false; }
    return true;
  };

  return { data, loading, create, update, remove, refetch: fetch };
}

// ---------------------------------------------------------------------------
// Links de Redirecionamento (gerenciador)
// A listagem vem da RPC get_redirect_link_stats, que já devolve as métricas
// (cliques -> leads -> conversões) junto do link, evitando um N+1 na UI.
// ---------------------------------------------------------------------------
export interface RedirectLink {
  id: string;
  name: string;
  code: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  lead_source: string | null;   // origem gravada no lead; null = Orgânico
  active: boolean;
  archived_at: string | null;
  created_at: string;
  cliques: number;
  leads: number;
  conversoes: number;
  ultimo_clique: string | null;
}

export interface RedirectLinkInput {
  name: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  lead_source?: string | null;
}

const LINK_CODE_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'; // sem 0/1/l — evita erro ao ler/digitar
function genLinkCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += LINK_CODE_ALPHABET[Math.floor(Math.random() * LINK_CODE_ALPHABET.length)];
  return s;
}

export function useRedirectLinks() {
  const { activeClinicId } = useAuth();
  const [data, setData] = useState<RedirectLink[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data: rows } = await supabase.rpc('get_redirect_link_stats', { p_clinic_id: activeClinicId });
    setData((rows as RedirectLink[]) || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (input: RedirectLinkInput) => {
    if (!activeClinicId) return null;
    // `code` tem UNIQUE: em caso de colisão, re-sorteia em vez de estourar erro na cara do usuário.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: row, error } = await supabase
        .from('redirect_links')
        .insert({ ...input, clinic_id: activeClinicId, code: genLinkCode() })
        .select()
        .single();
      if (!error) { await fetch(true); return row as RedirectLink; }
      if (error.code !== '23505') return null;
    }
    return null;
  };

  const update = async (id: string, updates: Partial<RedirectLinkInput> & { active?: boolean }) => {
    const { error } = await supabase.from('redirect_links').update(updates).eq('id', id);
    if (!error) await fetch(true);
    return !error;
  };

  // Exclusão definitiva. Os cliques em link_sessions NÃO são apagados (a FK é ON DELETE SET NULL),
  // então nenhuma atribuição de lead se perde — o que se perde é a métrica agrupada por este link.
  // Para tirar um link de circulação sem perder o histórico, use `update({ active: false })`.
  const remove = async (id: string) => {
    const { error } = await supabase.from('redirect_links').delete().eq('id', id);
    if (!error) await fetch(true);
    return !error;
  };

  return { data, loading, create, update, remove, refetch: fetch };
}

// ─── Central de Erros (super admin) ───────────────────────────────────────────
// A RLS de system_errors já restringe a super admin — o hook não precisa (nem deve) refiltrar.
export interface SystemError {
  id: string;
  scope: string;
  code: string;
  level: 'warn' | 'error' | 'critical';
  title: string;
  clinic_id: string | null;
  is_monitor: boolean;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  status: 'open' | 'ack' | 'resolved';
  last_context: Record<string, unknown> | null;
}

export function useSystemErrors() {
  const [data, setData] = useState<SystemError[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data: rows } = await supabase
      .from('system_errors')
      .select('*')
      .order('last_seen_at', { ascending: false })
      .limit(300);
    setData((rows as SystemError[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  // Um MONITOR não se resolve na mão: ele reflete uma condição que ou existe ou não existe, e o cron
  // reavalia a cada 5 min. Deixar o super admin "resolver" um WhatsApp que continua caído só
  // esconderia o problema até a próxima rodada. Por isso só eventos podem ser resolvidos aqui.
  const setStatus = async (id: string, status: 'open' | 'ack' | 'resolved') => {
    const { error } = await supabase
      .from('system_errors')
      .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
      .eq('id', id);
    if (!error) await fetch(true);
    return !error;
  };

  return { data, loading, setStatus, refetch: fetch };
}
