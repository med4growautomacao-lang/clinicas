// Tipos e presets de período compartilhados pelos dashboards
// (Visão Geral, Marketing e Comercial). Antes estavam duplicados em cada arquivo.

export type Period = "dia" | "sem" | "mês";

export const RANGE_PRESETS = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "week", label: "Esta Semana" },
  { id: "last_week", label: "Semana Passada" },
  { id: "7days", label: "Últimos 7 dias" },
  { id: "14days", label: "Últimos 14 dias" },
  { id: "28days", label: "Últimos 28 dias" },
  { id: "30days", label: "Últimos 30 dias" },
  { id: "month", label: "Este Mês" },
  { id: "last_month", label: "Mês Passado" },
];
