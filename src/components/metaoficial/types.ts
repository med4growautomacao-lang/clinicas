// Tipos do módulo "API Oficial Meta" (WhatsApp Cloud API). Espelham as tabelas
// meta_cloud_channels / meta_cloud_templates / meta_cloud_sends.

export interface MetaChannel {
  id: string;
  clinic_id: string;
  label: string | null;
  phone_display: string | null;
  phone_number_id: string;
  waba_id: string | null;
  status: 'connected' | 'disconnected' | string;
  created_at: string;
}

export interface MetaTemplate {
  id: string;
  clinic_id: string;
  channel_id: string | null;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | string;
  body_text: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  rejected_reason: string | null;
  created_at: string;
  synced_at: string | null;
}

export interface MetaSend {
  id: string;
  channel_id: string | null;
  template_name: string | null;
  to_phone: string;
  wamid: string | null;
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  error: any;
  created_at: string;
}

// Rótulos e cores de status de template (agrupamento das imagens).
export const TEMPLATE_STATUS_GROUP = {
  APPROVED: { label: 'Disponível', tone: 'emerald' },
  PENDING: { label: 'Em análise', tone: 'amber' },
  REJECTED: { label: 'Recusado', tone: 'rose' },
} as const;
