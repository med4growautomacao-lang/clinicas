import { useState, useEffect, useCallback, useRef } from 'react';
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
  consultation_duration?: number;
  days_off?: string[];
  blocked_times?: { date: string; start: string; end: string }[];
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
  notes: string | null;
  created_at: string;
  // Joined
  patient?: { name: string; cpf?: string | null; phone?: string | null };
  doctor?: { name: string };
}

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

    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const create = async (apt: Partial<Appointment>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('appointments')
      .insert({ ...apt, clinic_id: activeClinicId })
      .select('*, patient:patients(name, cpf, phone), doctor:doctors(name, user_id)')
      .single();
    if (error) { setError(error.message); return null; }
    setData(prev => [data, ...prev]);
    return data;
  };

  const update = async (id: string, updates: Partial<Appointment>) => {
    setData(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    const { error } = await supabase.from('appointments').update(updates).eq('id', id);
    if (error) { setError(error.message); fetch(true); return false; }
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
  stage_id: string | null;
  estimated_value: number | null;
  notes: string | null;
  ai_enabled: boolean;
  converted_patient_id: string | null;
  sla_breach_count: number;
  last_message_at: string | null;
  last_outbound_at: string | null;
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
}

export function useFunnelStages() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    const cacheKey = `funnel_stages:${activeClinicId}`;
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

  return { data, loading, loadingMore, hasMore, error, refetch: fetch, loadMore, create, update, remove };
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
  lead?: Lead;
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
    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const moveTicket = async (ticketId: string, stageId: string) => {
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, stage_id: stageId } : t));
    const { data, error } = await supabase.from('tickets').update({ stage_id: stageId }).eq('id', ticketId).select('lead_id').single();
    if (error) { fetch(true); return false; }
    if (data?.lead_id) await supabase.from('leads').update({ stage_id: stageId }).eq('id', data.lead_id);
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
    const updates: Record<string, any> = { outcome, outcome_at: now };
    if (lossReason) updates.loss_reason = lossReason;
    
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    await supabase.from('tickets').update(updates).eq('id', ticketId);

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

  return { tickets, loading, refetch: fetch, moveTicket, openTicket, closeTicket, finalizeTicket };
}

// ==========================================
// DASHBOARD STATS (Realtime automatic refetch)
// ==========================================
export interface DashboardStats {
  totalAppointments: number;
  totalRevenue: number;
  totalLeads: number;
  newPatients: number;
  totalSales: number;
  totalInvestment: number;
  totalSlaBreaches: number;
  avgResponseTime: number; // minutes
  avgSalesCycle: number; // days
  chartData: {
    date: string;
    agendamentos: number;
    faturamento: number;
    leads: number;
    vendas: number;
    investimento: number;
  }[];
}

export function useDashboardStats(dateRange?: { start: string; end: string }) {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<DashboardStats>({
    totalAppointments: 0, 
    totalRevenue: 0, 
    totalLeads: 0, 
    newPatients: 0, 
    totalSales: 0, 
    totalInvestment: 0,
    totalSlaBreaches: 0,
    avgResponseTime: 0,
    avgSalesCycle: 0,
    chartData: []
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const clinicId = activeClinicId;

    const now = new Date();
    const startOfMonth = dateRange?.start || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = dateRange?.end || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    try {
      // Buscar o stage "Conversão" (is_fixed=true) da clínica
      const { data: convStage } = await supabase
        .from('funnel_stages')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('is_fixed', true)
        .maybeSingle();

      const [aptsRes, revenueRes, patientsRes, leadsRes, salesRes, investRes, slaRes, cycleRes, responseTimeRes] = await Promise.all([
        supabase.from('appointments').select('id, date')
          .eq('clinic_id', clinicId).gte('date', startOfMonth).lte('date', endOfMonth),
        supabase.from('financial_transactions').select('amount, date')
          .eq('clinic_id', clinicId).eq('type', 'receita').eq('status', 'pago')
          .gte('date', startOfMonth).lte('date', endOfMonth),
        supabase.from('patients').select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinicId).gte('created_at', startOfMonth).lte('created_at', endOfMonth + 'T23:59:59'),
        supabase.from('leads').select('id, created_at, sla_breach_count')
          .eq('clinic_id', clinicId).gte('created_at', startOfMonth).lte('created_at', endOfMonth + 'T23:59:59'),
        // Vendas: leads no stage de Conversão
        convStage?.id
          ? supabase.from('leads').select('id, created_at')
              .eq('clinic_id', clinicId).eq('stage_id', convStage.id).gte('created_at', startOfMonth).lte('created_at', endOfMonth + 'T23:59:59')
          : Promise.resolve({ data: [] }),
        // Investimento em marketing
        supabase.from('marketing_data').select('investment, date')
          .eq('clinic_id', clinicId).gte('date', startOfMonth).lte('date', endOfMonth),
        // Estouros de SLA (soma do campo na tabela leads no período)
        supabase.from('leads').select('sla_breach_count')
          .eq('clinic_id', clinicId).gte('created_at', startOfMonth).lte('created_at', endOfMonth + 'T23:59:59'),
        // Ciclo de vendas (histórico de conversão)
        convStage?.id
          ? supabase.from('lead_stage_history')
              .select('lead_id, changed_at, leads(created_at)')
              .eq('clinic_id', clinicId)
              .eq('new_stage_id', convStage.id)
              .gte('changed_at', startOfMonth)
              .lte('changed_at', endOfMonth + 'T23:59:59')
          : Promise.resolve({ data: [] }),
        // Tempo de resposta (estimativa simplificada baseada no handoff se existir, ou mensagens)
        supabase.from('leads').select('created_at, handoff_triggered_at')
          .eq('clinic_id', clinicId)
          .not('handoff_triggered_at', 'is', null)
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth + 'T23:59:59')
      ]);

      const dailyData: Record<string, any> = {};

      // Helper para inicializar datas no range sem problemas de timezone
      const startParts = startOfMonth.split('-').map(Number);
      const endParts = endOfMonth.split('-').map(Number);
      const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
      const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);

      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        dailyData[dateStr] = { date: dateStr, agendamentos: 0, faturamento: 0, leads: 0, vendas: 0, investimento: 0 };
      }

      const toLocalDateStr = (utcString: string) => {
        if (!utcString) return "";
        const d = new Date(utcString);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      (aptsRes.data || []).forEach(a => {
        if (dailyData[a.date]) dailyData[a.date].agendamentos++;
      });
      (revenueRes.data || []).forEach(r => {
        if (dailyData[r.date]) dailyData[r.date].faturamento += Number(r.amount || 0);
      });
      (leadsRes.data || []).forEach(l => {
        const date = toLocalDateStr(l.created_at);
        if (dailyData[date]) dailyData[date].leads++;
      });
      (salesRes.data || []).forEach(s => {
        const date = toLocalDateStr(s.created_at);
        if (dailyData[date]) dailyData[date].vendas++;
      });
      (investRes.data || []).forEach(i => {
        if (dailyData[i.date]) dailyData[i.date].investimento += Number(i.investment || 0);
      });

      const totalRevenue = (revenueRes.data || []).reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const totalInvestment = (investRes.data || []).reduce((sum, t) => sum + Number(t.investment || 0), 0);
      const totalSlaBreaches = (slaRes.data || []).reduce((sum, l) => sum + (l.sla_breach_count || 0), 0);

      // Ciclo de Vendas (Dias)
      const cycles = (cycleRes.data || []).filter((h: any) => h.leads?.created_at).map((h: any) => {
        const created = new Date(h.leads.created_at);
        const converted = new Date(h.changed_at);
        return (converted.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
      });
      const avgSalesCycle = cycles.length > 0 ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;

      // Tempo de Resposta (Minutos)
      const responseTimes = (responseTimeRes.data || []).map(l => {
        const created = new Date(l.created_at);
        const responded = new Date(l.handoff_triggered_at);
        return (responded.getTime() - created.getTime()) / (1000 * 60);
      });
      const avgResponseTime = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;

      setData({
        totalAppointments: (aptsRes.data || []).length,
        totalRevenue,
        totalLeads: (leadsRes.data || []).length,
        newPatients: patientsRes.count || 0,
        totalSales: (salesRes.data || []).length,
        totalInvestment,
        totalSlaBreaches,
        avgResponseTime,
        avgSalesCycle,
        chartData: Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)) as any
      });
    } catch (error) {
      console.error('Erro ao carregar estatísticas do dashboard:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeClinicId, dateRange?.start, dateRange?.end]);

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
      .select('*')
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
  cnpj: string | null;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  primary_color: string | null;
  plan: 'free' | 'pro' | 'enterprise';
  is_active: boolean;
  notification_group_id: string | null;
  meta_token?: string | null;
  meta_ad_account_id?: string | null;
  meta_pixel_id?: string | null;
  wa_pre_msg?: string | null;
  organization_id?: string | null;
  category: string | null;
  google_ad_account_id?: string | null;
  google_ad_mcc_id?: string | null;
  google_ad_mcc_token?: string | null;
  features?: { feature_followup?: boolean; feature_ia?: boolean } | null;
  meta_status?: 'none' | 'inactive' | 'active';
  google_status?: 'none' | 'inactive' | 'active';
  site_status?: 'none' | 'inactive' | 'active';
  forms_status?: 'none' | 'inactive' | 'active';
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
  phone: string | null;
  auto_schedule: boolean;
  confirm_enabled: boolean;
  confirm_message: string;
  confirm_lead_time: number;
  followup_enabled: boolean;
  followup_message: string;
  followup_delay: number;
  handoff_enabled: boolean;
  handoff_rules: any[] | null;
  transition_rules: any[] | null;
  finish_service_enabled: boolean;
  finish_service_message: string;
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
  updated_at: string;
}

export interface WhatsappInstance {
  id: string;
  clinic_id: string;
  api_id?: string;
  api_token: string;
  phone_number: string | null;
  status: 'connected' | 'disconnected' | 'qr_pending' | 'connecting';
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

    // Polling fallback: busca dados a cada 5 segundos se estiver aguardando conexão
    let pollInterval: any;
    if (whatsapp?.status === 'connecting' || whatsapp?.status === 'qr_pending') {
      pollInterval = setInterval(() => {
        console.log('Polling for WhatsApp update...');
        fetch(true);
      }, 5000);
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

  return { data, loading, error, refetch: fetch, create, remove, update, reorder };
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

  // Agrupa por lead_id para uso no Kanban
  const byLead = data.reduce<Record<string, Conversion[]>>((acc, c) => {
    if (!acc[c.lead_id]) acc[c.lead_id] = [];
    acc[c.lead_id].push(c);
    return acc;
  }, {});

  return { data, loading, byLead, create, remove, refetch: fetch };
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
