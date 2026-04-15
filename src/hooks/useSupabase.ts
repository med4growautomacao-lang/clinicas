import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

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
}

export function useDoctors() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('doctors')
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

    const channel = supabase
      .channel('doctors_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'doctors',
        filter: `clinic_id=eq.${activeClinicId}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const create = async (doc: Partial<Doctor>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('doctors')
      .insert({ ...doc, clinic_id: activeClinicId })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    await fetch(true);
    return data;
  };

  const createWithAuth = async (params: any) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase.functions.invoke('create-professional', {
      body: { ...params, clinic_id: activeClinicId }
    });
    if (error) { setError(error.message); return null; }
    if (data.error) { setError(data.error); return null; }
    await fetch(true);
    return data;
  };

  const update = async (id: string, updates: Partial<Doctor>) => {
    const { error } = await supabase.from('doctors').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('doctors').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
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

    const channel = supabase
      .channel('patients_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'patients',
        filter: `clinic_id=eq.${activeClinicId}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const create = async (p: Partial<Patient>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('patients')
      .insert({ ...p, clinic_id: activeClinicId })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    await fetch(true);
    return data;
  };

  const update = async (id: string, updates: Partial<Patient>) => {
    const { error } = await supabase.from('patients').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
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
  status: 'pendente' | 'confirmado' | 'realizado' | 'cancelado' | 'faltou';
  source: 'ia' | 'manual' | 'site' | null;
  notes: string | null;
  created_at: string;
  // Joined
  patient?: { name: string };
  doctor?: { name: string };
}

export function useAppointments() {
  const { profile, userRole, activeClinicId } = useAuth();
  const [data, setData] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    
    let query = supabase
      .from('appointments')
      .select('*, patient:patients(name, cpf, phone), doctor:doctors!inner(name, user_id)')
      .eq('clinic_id', activeClinicId);

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
  }, [activeClinicId, userRole, profile?.id]);

  useEffect(() => { 
    fetch(); 
    if (!activeClinicId) return;

    const channel = supabase
      .channel('appointments_realtime')
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
      .select('*, patient:patients(name, cpf, phone), doctor:doctors!inner(name, user_id)')
      .single();
    if (error) { setError(error.message); return null; }
    await fetch(true);
    return data;
  };

  const update = async (id: string, updates: Partial<Appointment>) => {
    const { error } = await supabase.from('appointments').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
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
  color: string | null;
  is_system: boolean;
  is_fixed: boolean;
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
}

export function useFunnelStages() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!activeClinicId) return;
    setLoading(true);
    const { data } = await supabase
      .from('funnel_stages')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('position');
    setData(data || []);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { 
    fetch(); 
    if (!activeClinicId) return;

    const channel = supabase
      .channel('funnel_stages_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'funnel_stages',
        filter: `clinic_id=eq.${activeClinicId}`
      }, () => {
        fetch();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const update = async (id: string, updates: Partial<FunnelStage>) => {
    const { error } = await supabase.from('funnel_stages').update(updates).eq('id', id);
    if (error) return false;
    await fetch();
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('funnel_stages').delete().eq('id', id);
    if (error) return false;
    await fetch();
    return true;
  };

  const reorder = async (stages: FunnelStage[]) => {
    const updates = stages.map((s, idx) => 
      supabase.from('funnel_stages').update({ position: idx }).eq('id', s.id)
    );
    await Promise.all(updates);
    await fetch();
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
    await fetch();
    return data;
  };

  return { data, loading, refetch: fetch, create, update, remove, reorder };
}

export function useLeads() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false, nullsFirst: false });
    
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [activeClinicId]);

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
    await fetch(true);
    return data;
  };

  const update = async (id: string, updates: Partial<Lead>) => {
    const { error } = await supabase.from('leads').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
    return true;
  };

  return { data, loading, error, refetch: fetch, create, update, remove };
}

// ==========================================
// DASHBOARD STATS (Realtime automatic refetch)
// ==========================================
export interface DashboardStats {
  totalAppointments: number;
  totalRevenue: number;
  totalMessages: number;
  newPatients: number;
}

export function useDashboardStats() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<DashboardStats>({
    totalAppointments: 0, totalRevenue: 0, totalMessages: 0, newPatients: 0
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!activeClinicId) return;
    if (!silent) setLoading(true);
    const clinicId = activeClinicId;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const [aptsRes, revenueRes, patientsRes, messagesRes] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).gte('date', startOfMonth).lte('date', endOfMonth),
      supabase.from('financial_transactions').select('amount')
        .eq('clinic_id', clinicId).eq('type', 'receita').eq('status', 'pago')
        .gte('date', startOfMonth).lte('date', endOfMonth),
      supabase.from('patients').select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).gte('created_at', startOfMonth),
      supabase.from('chat_messages').select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).gte('created_at', startOfMonth),
    ]);

    const totalRevenue = (revenueRes.data || []).reduce((sum, t) => sum + Number(t.amount || 0), 0);

    setData({
      totalAppointments: aptsRes.count || 0,
      totalRevenue,
      totalMessages: messagesRes.count || 0,
      newPatients: patientsRes.count || 0,
    });
    if (!silent) setLoading(false);
  }, [activeClinicId]);

  useEffect(() => {
    load();
    if (!activeClinicId) return;

    // Sincronizar dashboard com mudanças em tabelas chave
    const channel = supabase
      .channel('dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${activeClinicId}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_transactions', filter: `clinic_id=eq.${activeClinicId}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients', filter: `clinic_id=eq.${activeClinicId}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `clinic_id=eq.${activeClinicId}` }, () => load(true))
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
  payment_method: 'pix' | 'cartao' | 'dinheiro' | 'plano' | null;
  status: 'pago' | 'pendente' | 'cancelado';
  date: string;
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

    const channel = supabase
      .channel('financial_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'financial_transactions',
        filter: `clinic_id=eq.${activeClinicId}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, activeClinicId]);

  const create = async (tx: Partial<FinancialTransaction>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('financial_transactions')
      .insert({ ...tx, clinic_id: activeClinicId })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    await fetch(true);
    return data;
  };

  const update = async (id: string, updates: Partial<FinancialTransaction>) => {
    const { error } = await supabase.from('financial_transactions').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('financial_transactions').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
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
    if (!patientId) return;

    const channel = supabase
      .channel(`records_${patientId}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'medical_records',
        filter: `patient_id=eq.${patientId}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, patientId]);

  const create = async (record: Partial<MedicalRecord>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('medical_records')
      .insert({ ...record, clinic_id: activeClinicId })
      .select('*, doctor:doctors(name)')
      .single();
    if (error) { setError(error.message); return null; }
    await fetch(true);
    return data;
  };

  const update = async (id: string, updates: Partial<MedicalRecord>) => {
    const { error } = await supabase.from('medical_records').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('medical_records').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    await fetch(true);
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
  notification_group_id: string | null;
  meta_token?: string | null;
  meta_ad_account_id?: string | null;
  meta_pixel_id?: string | null;
  wa_pre_msg?: string | null;
  organization_id?: string | null;
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
        table: 'whatsapp_instances'
      }, (payload) => {
        if (payload.new && (payload.new as any).clinic_id === activeClinicId) {
          fetch(true);
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'ai_config'
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
    const { error } = await supabase.from('clinics').update(updates).eq('id', activeClinicId);
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

    const { data, error } = await query.order('created_at', { ascending: true });
    
    if (error) { setError(error.message); setLoading(false); return; }
    
    const formattedData = (data || []).map(m => ({
      ...m,
      message: parseMessage(m.message)
    }));

    setData(formattedData);
    setError(null);
    setLoading(false);
  }, [activeClinicId, leadId]);

  useEffect(() => { 
    fetch(); 
    if (!activeClinicId) return;

    const channel = supabase
      .channel(`chat_${leadId || 'all'}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'chat_messages',
        filter: leadId ? `lead_id=eq.${leadId}` : `clinic_id=eq.${activeClinicId}`
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
  }, [fetch, activeClinicId, leadId]);

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

  const fetch = useCallback(async (startDate: string, endDate: string) => {
    if (!activeClinicId) return;
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
  created_at: string;
}

export function useTransitionRules() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<TransitionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!activeClinicId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('stage_transition_rules')
      .select('*')
      .eq('clinic_id', activeClinicId)
      .order('created_at');
    
    if (error) { setError(error.message); setLoading(false); return; }
    setData(data || []);
    setError(null);
    setLoading(false);
  }, [activeClinicId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (rule: Partial<TransitionRule>) => {
    if (!activeClinicId) return null;
    const { data, error } = await supabase
      .from('stage_transition_rules')
      .insert({ ...rule, clinic_id: activeClinicId })
      .select()
      .single();
    if (!error) await fetch();
    return data;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('stage_transition_rules').delete().eq('id', id);
    if (!error) await fetch();
    return !error;
  };

  const update = async (id: string, rule: Partial<TransitionRule>) => {
    const { data, error } = await supabase
      .from('stage_transition_rules')
      .update(rule)
      .eq('id', id)
      .select()
      .single();
    if (!error) await fetch();
    return data;
  };

  return { data, loading, error, refetch: fetch, create, remove, update };
}

// ==========================================
// ORGANIZATIONS
// ==========================================
export interface Organization {
  id: string;
  name: string;
  plan: string;
  logo_url: string | null;
  created_at: string;
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

  const create = async (org: { name: string; plan: string }) => {
    const { data, error } = await supabase.from('organizations').insert(org).select().single();
    if (!error) fetch();
    return { data, error };
  };

  return { data, loading, create, refetch: fetch };
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

export function useSuperAdminData() {
  const [clinicUsers, setClinicUsers] = useState<Record<string, ClinicUser[]>>({});
  const [orgUsers, setOrgUsers] = useState<Record<string, OrgUser[]>>({});
  const [usersLoading, setUsersLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    const [cuRes, ouRes] = await Promise.all([
      supabase.from('users').select('*').order('full_name'),
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
