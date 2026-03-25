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
  const { profile } = useAuth();
  const [data, setData] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!profile?.clinic_id) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('doctors')
      .select('*')
      .eq('clinic_id', profile.clinic_id)
      .order('name');
    
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [profile?.clinic_id]);

  useEffect(() => { 
    fetch(); 
    if (!profile?.clinic_id) return;

    const channel = supabase
      .channel('doctors_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'doctors',
        filter: `clinic_id=eq.${profile.clinic_id}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, profile?.clinic_id]);

  const create = async (doc: Partial<Doctor>) => {
    if (!profile?.clinic_id) return null;
    const { data, error } = await supabase
      .from('doctors')
      .insert({ ...doc, clinic_id: profile.clinic_id })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    return data;
  };

  const update = async (id: string, updates: Partial<Doctor>) => {
    const { error } = await supabase.from('doctors').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('doctors').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
    return true;
  };

  return { data, loading, error, refetch: fetch, create, update, remove };
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
  const { profile } = useAuth();
  const [data, setData] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!profile?.clinic_id) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('clinic_id', profile.clinic_id)
      .order('name');
    
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [profile?.clinic_id]);

  useEffect(() => { 
    fetch(); 
    if (!profile?.clinic_id) return;

    const channel = supabase
      .channel('patients_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'patients',
        filter: `clinic_id=eq.${profile.clinic_id}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, profile?.clinic_id]);

  const create = async (p: Partial<Patient>) => {
    if (!profile?.clinic_id) return null;
    const { data, error } = await supabase
      .from('patients')
      .insert({ ...p, clinic_id: profile.clinic_id })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    return data;
  };

  const update = async (id: string, updates: Partial<Patient>) => {
    const { error } = await supabase.from('patients').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
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
  const { profile, userRole } = useAuth();
  const [data, setData] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!profile?.clinic_id) return;
    if (!silent) setLoading(true);
    
    let query = supabase
      .from('appointments')
      .select('*, patient:patients(name, cpf, phone), doctor:doctors!inner(name, user_id)')
      .eq('clinic_id', profile.clinic_id);

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
  }, [profile?.clinic_id, userRole, profile?.id]);

  useEffect(() => { 
    fetch(); 
    if (!profile?.clinic_id) return;

    const channel = supabase
      .channel('appointments_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'appointments',
        filter: `clinic_id=eq.${profile.clinic_id}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, profile?.clinic_id]);

  const create = async (apt: Partial<Appointment>) => {
    if (!profile?.clinic_id) return null;
    const { data, error } = await supabase
      .from('appointments')
      .insert({ ...apt, clinic_id: profile.clinic_id })
      .select('*, patient:patients(name, cpf, phone), doctor:doctors!inner(name, user_id)')
      .single();
    if (error) { setError(error.message); return null; }
    return data;
  };

  const update = async (id: string, updates: Partial<Appointment>) => {
    const { error } = await supabase.from('appointments').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
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
  stage_id: string | null;
  estimated_value: number | null;
  notes: string | null;
  ai_enabled: boolean;
  converted_patient_id: string | null;
  sla_breach_count: number;
  last_message_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useFunnelStages() {
  const { profile } = useAuth();
  const [data, setData] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!profile?.clinic_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('funnel_stages')
      .select('*')
      .eq('clinic_id', profile.clinic_id)
      .order('position');
    setData(data || []);
    setLoading(false);
  }, [profile?.clinic_id]);

  useEffect(() => { 
    fetch(); 
    if (!profile?.clinic_id) return;

    const channel = supabase
      .channel('funnel_stages_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'funnel_stages',
        filter: `clinic_id=eq.${profile.clinic_id}`
      }, () => {
        fetch();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, profile?.clinic_id]);

  const update = async (id: string, updates: Partial<FunnelStage>) => {
    const { error } = await supabase.from('funnel_stages').update(updates).eq('id', id);
    if (error) return false;
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('funnel_stages').delete().eq('id', id);
    if (error) return false;
    return true;
  };

  const reorder = async (stages: FunnelStage[]) => {
    const updates = stages.map((s, idx) => 
      supabase.from('funnel_stages').update({ position: idx }).eq('id', s.id)
    );
    await Promise.all(updates);
    return true;
  };

  const create = async (stage: Partial<FunnelStage>) => {
    if (!profile?.clinic_id) return null;
    const { data: lastStage } = await supabase
      .from('funnel_stages')
      .select('position')
      .eq('clinic_id', profile.clinic_id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = (lastStage?.position ?? -1) + 1;
    const { data, error } = await supabase
      .from('funnel_stages')
      .insert({ ...stage, clinic_id: profile.clinic_id, position: newPosition })
      .select()
      .single();
    if (error) return null;
    return data;
  };

  return { data, loading, refetch: fetch, create, update, remove, reorder };
}

export function useLeads() {
  const { profile } = useAuth();
  const [data, setData] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!profile?.clinic_id) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('clinic_id', profile.clinic_id)
      .order('updated_at', { ascending: false, nullsFirst: false });
    
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [profile?.clinic_id]);

  useEffect(() => { 
    fetch(); 
    if (!profile?.clinic_id) return;

    const channel = supabase
      .channel('leads_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'leads',
        filter: `clinic_id=eq.${profile.clinic_id}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, profile?.clinic_id]);

  const create = async (lead: Partial<Lead>) => {
    if (!profile?.clinic_id) return null;
    const { data, error } = await supabase
      .from('leads')
      .insert({ ...lead, clinic_id: profile.clinic_id })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    return data;
  };

  const update = async (id: string, updates: Partial<Lead>) => {
    const { error } = await supabase.from('leads').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
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
  const { profile } = useAuth();
  const [data, setData] = useState<DashboardStats>({
    totalAppointments: 0, totalRevenue: 0, totalMessages: 0, newPatients: 0
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!profile?.clinic_id) return;
    if (!silent) setLoading(true);
    const clinicId = profile!.clinic_id;

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
  }, [profile?.clinic_id]);

  useEffect(() => {
    load();
    if (!profile?.clinic_id) return;

    // Sincronizar dashboard com mudanças em tabelas chave
    const channel = supabase
      .channel('dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${profile.clinic_id}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_transactions', filter: `clinic_id=eq.${profile.clinic_id}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients', filter: `clinic_id=eq.${profile.clinic_id}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `clinic_id=eq.${profile.clinic_id}` }, () => load(true))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load, profile?.clinic_id]);

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
  const { profile } = useAuth();
  const [data, setData] = useState<FinancialTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!profile?.clinic_id) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('financial_transactions')
      .select('*')
      .eq('clinic_id', profile.clinic_id)
      .order('date', { ascending: false });
    
    if (error) { setError(error.message); if (!silent) setLoading(false); return; }
    setData(data || []);
    setError(null);
    if (!silent) setLoading(false);
  }, [profile?.clinic_id]);

  useEffect(() => { 
    fetch(); 
    if (!profile?.clinic_id) return;

    const channel = supabase
      .channel('financial_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'financial_transactions',
        filter: `clinic_id=eq.${profile.clinic_id}`
      }, () => {
        fetch(true);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch, profile?.clinic_id]);

  const create = async (tx: Partial<FinancialTransaction>) => {
    if (!profile?.clinic_id) return null;
    const { data, error } = await supabase
      .from('financial_transactions')
      .insert({ ...tx, clinic_id: profile.clinic_id })
      .select()
      .single();
    if (error) { setError(error.message); return null; }
    return data;
  };

  const update = async (id: string, updates: Partial<FinancialTransaction>) => {
    const { error } = await supabase.from('financial_transactions').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('financial_transactions').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
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
  const { profile } = useAuth();
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
    if (!profile?.clinic_id) return null;
    const { data, error } = await supabase
      .from('medical_records')
      .insert({ ...record, clinic_id: profile.clinic_id })
      .select('*, doctor:doctors(name)')
      .single();
    if (error) { setError(error.message); return null; }
    return data;
  };

  const update = async (id: string, updates: Partial<MedicalRecord>) => {
    const { error } = await supabase.from('medical_records').update(updates).eq('id', id);
    if (error) { setError(error.message); return false; }
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('medical_records').delete().eq('id', id);
    if (error) { setError(error.message); return false; }
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
  sla_minutes: number;
  business_hours: { start: string; end: string; days: number[] };
  default_ticket_value: number;
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
}

export function useSettings() {
  const { profile } = useAuth();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [aiConfig, setAIConfig] = useState<AIConfig | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsappInstance | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (silent = false) => {
    if (!profile?.clinic_id) return;
    if (!silent) setLoading(true);

    const [clinicRes, aiRes, waRes] = await Promise.all([
      supabase.from('clinics').select('*').eq('id', profile.clinic_id).maybeSingle(),
      supabase.from('ai_config').select('*').eq('clinic_id', profile.clinic_id).maybeSingle(),
      supabase.from('whatsapp_instances').select('*').eq('clinic_id', profile.clinic_id).maybeSingle(),
    ]);

    setClinic(clinicRes.data);
    setAIConfig(aiRes.data);
    setWhatsapp(waRes.data);
    setLoading(false);
  }, [profile?.clinic_id]);

  useEffect(() => { 
    fetch(); 
    if (!profile?.clinic_id) return;

    const channel = supabase
      .channel('whatsapp_instances_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'whatsapp_instances'
      }, (payload) => {
        console.log('Realtime event received:', payload);
        if (payload.new && (payload.new as any).clinic_id === profile.clinic_id) {
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
  }, [fetch, profile?.clinic_id, whatsapp?.status]); // Adicionado whatsapp.status para re-avaliar o polling

  const updateClinic = async (updates: Partial<Clinic>) => {
    if (!profile?.clinic_id) return false;
    const { error } = await supabase.from('clinics').update(updates).eq('id', profile.clinic_id);
    if (!error) await fetch();
    return !error;
  };

  const updateAI = async (updates: Partial<AIConfig>) => {
    if (!profile?.clinic_id) return false;
    const { error } = await supabase
      .from('ai_config')
      .upsert({ 
        ...updates, 
        clinic_id: profile.clinic_id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'clinic_id' });
    if (!error) await fetch();
    return !error;
  };

  const updateWhatsapp = async (updates: Partial<WhatsappInstance>) => {
    if (!profile?.clinic_id) return false;
    
    // Check if instance exists
    if (!whatsapp) {
      const { error } = await supabase.from('whatsapp_instances').insert({
        ...updates,
        clinic_id: profile.clinic_id
      });
      if (!error) await fetch();
      return !error;
    } else {
      const { error } = await supabase.from('whatsapp_instances').update(updates).eq('clinic_id', profile.clinic_id);
      if (!error) await fetch();
      return !error;
    }
  };

  return { clinic, aiConfig, whatsapp, loading, refetch: fetch, updateClinic, updateAI, updateWhatsapp };
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

  const create = async (clinic: Partial<Clinic>) => {
    const { data, error } = await supabase.from('clinics').insert(clinic).select().single();
    if (!error) fetch();
    return { data, error };
  };

  const update = async (id: string, updates: Partial<Clinic>) => {
    const { error } = await supabase.from('clinics').update(updates).eq('id', id);
    if (!error) fetch();
    return !error;
  };

  return { data, loading, error, refetch: fetch, create, update };
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

export function useChatMessages(leadId?: string) {
  const { profile } = useAuth();
  const [data, setData] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clinicPhone, setClinicPhone] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.clinic_id) return;
    supabase
      .from('whatsapp_instances')
      .select('phone_number')
      .eq('clinic_id', profile.clinic_id)
      .maybeSingle()
      .then(({ data }) => setClinicPhone(data?.phone_number || null));
  }, [profile?.clinic_id]);

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
    if (!profile?.clinic_id) return;
    setLoading(true);
    let query = supabase
      .from('chat_messages')
      .select('*')
      .eq('clinic_id', profile.clinic_id);
    
    if (leadId) {
      query = query.eq('lead_id', leadId);
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
  }, [profile?.clinic_id, leadId]);

  useEffect(() => { 
    fetch(); 
    if (!profile?.clinic_id) return;

    const channel = supabase
      .channel(`chat_${leadId || 'all'}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'chat_messages',
        filter: leadId ? `lead_id=eq.${leadId}` : `clinic_id=eq.${profile.clinic_id}`
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
  }, [fetch, profile?.clinic_id, leadId]);

  const send = async (msg: Partial<ChatMessage>) => {
    if (!profile?.clinic_id) return null;
    
    const leadPhone = msg.phone;
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
      clinic_id: profile.clinic_id, 
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
        .eq('clinic_id', profile.clinic_id)
        .eq('phone', leadPhone)
        .maybeSingle();

      if (existingLead) {
        insertData.lead_id = existingLead.id;
      } else if (leadPhone !== clinicPhone) {
        // 2. Create new lead if not found and NOT the clinic phone
        const { data: newLead, error: leadError } = await supabase
          .from('leads')
          .insert({
            clinic_id: profile.clinic_id,
            name: `Lead ${leadPhone}`,
            phone: leadPhone,
            source: 'manual'
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
  manual_conversions_count: number | null;
  created_at: string;
}

export function useMarketing() {
  const { profile } = useAuth();
  const [data, setData] = useState<MarketingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (startDate: string, endDate: string) => {
    if (!profile?.clinic_id) return;
    setLoading(true);
    
    const { data, error } = await supabase
      .from('marketing_data')
      .select('*')
      .eq('clinic_id', profile.clinic_id)
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
  }, [profile?.clinic_id]);

  const upsert = async (items: Partial<MarketingData>[]) => {
    if (!profile?.clinic_id) return false;
    
    const prepared = items.map(item => ({
      ...item,
      clinic_id: profile.clinic_id
    }));

    const { error } = await supabase
      .from('marketing_data')
      .upsert(prepared, { onConflict: 'clinic_id,date,platform' });

    return !error;
  };

  return { data, loading, error, fetch, upsert };
}
