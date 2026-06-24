import React, { useState, useMemo } from "react";
import { cn } from "@/src/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X, Trash2, Loader2, CalendarDays, User, Check, ListTodo, ChevronDown, Circle, Building2 } from "lucide-react";
import { useOrgTasks, OrgTask } from "../hooks/useSupabase";

interface OrgUserLite {
  id: string;
  full_name: string | null;
  email?: string | null;
}

interface ClinicLite {
  id: string;
  name: string;
}

interface OrgTasksProps {
  organizationId: string;
  orgUsers: OrgUserLite[];
  clinics: ClinicLite[];
  canManage?: boolean;
}

type QuadrantId = "do" | "schedule" | "delegate" | "eliminate";

const QUADRANTS: {
  id: QuadrantId;
  title: string;
  subtitle: string;
  is_urgent: boolean;
  is_important: boolean;
  bg: string;          // fundo do quadrante
  accent: string;      // borda
  badge: string;       // small tag
  dot: string;
}[] = [
  { id: "do",        title: "Fazer agora", subtitle: "Urgente e importante",     is_urgent: true,  is_important: true,  bg: "bg-rose-100",   accent: "border-rose-300",  badge: "bg-white text-rose-600",     dot: "bg-rose-500" },
  { id: "schedule",  title: "Agendar",     subtitle: "Importante, não urgente",  is_urgent: false, is_important: true,  bg: "bg-blue-100",   accent: "border-blue-300",  badge: "bg-white text-blue-600",     dot: "bg-blue-500" },
  { id: "delegate",  title: "Delegar",     subtitle: "Urgente, não importante",  is_urgent: true,  is_important: false, bg: "bg-violet-100", accent: "border-violet-300",badge: "bg-white text-violet-600", dot: "bg-violet-500" },
  { id: "eliminate", title: "Eliminar",    subtitle: "Nem urgente nem importante",is_urgent: false,is_important: false, bg: "bg-slate-200",  accent: "border-slate-300", badge: "bg-white text-slate-500",  dot: "bg-slate-400" },
];

// Paleta leve e deterministica de cores por responsavel (classes estaticas p/ Tailwind)
const RESP_COLORS = [
  "bg-rose-50 text-rose-600 border-rose-200",
  "bg-amber-50 text-amber-600 border-amber-200",
  "bg-emerald-50 text-emerald-600 border-emerald-200",
  "bg-sky-50 text-sky-600 border-sky-200",
  "bg-violet-50 text-violet-600 border-violet-200",
  "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200",
  "bg-teal-50 text-teal-600 border-teal-200",
  "bg-indigo-50 text-indigo-600 border-indigo-200",
  "bg-orange-50 text-orange-600 border-orange-200",
  "bg-cyan-50 text-cyan-600 border-cyan-200",
];
function colorForResp(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return RESP_COLORS[h % RESP_COLORS.length];
}

type StatusId = 'todo' | 'doing' | 'done';
const STATUSES: { id: StatusId; label: string; cls: string; dot: string }[] = [
  { id: 'todo',  label: 'A fazer',      cls: 'bg-slate-100 text-slate-600 border-slate-200',     dot: 'bg-slate-400' },
  { id: 'doing', label: 'Em andamento', cls: 'bg-amber-100 text-amber-700 border-amber-200',      dot: 'bg-amber-500' },
  { id: 'done',  label: 'Concluída',    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
];
const statusMeta = (s: StatusId) => STATUSES.find(x => x.id === s) ?? STATUSES[0];
const nextStatus = (s: StatusId): StatusId => (s === 'todo' ? 'doing' : s === 'doing' ? 'done' : 'todo');

function quadrantOf(t: { is_urgent: boolean; is_important: boolean }): QuadrantId {
  if (t.is_urgent && t.is_important) return "do";
  if (!t.is_urgent && t.is_important) return "schedule";
  if (t.is_urgent && !t.is_important) return "delegate";
  return "eliminate";
}

const MONTHS_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function dateParts(d: string) {
  const [, m, day] = d.split("-");
  return { day, mon: MONTHS_ABBR[parseInt(m, 10) - 1] ?? m };
}
function isOverdue(d: string) {
  return d < new Date().toISOString().slice(0, 10);
}

function FilterSelect({ icon: Icon, value, onChange, options }: {
  icon: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <Icon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          "appearance-none pl-8 pr-8 py-2 rounded-xl text-xs font-bold border outline-none transition-all cursor-pointer",
          value ? "bg-violet-50 text-violet-700 border-violet-300" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
        )}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

export function OrgTasks({ organizationId, orgUsers, clinics, canManage = true }: OrgTasksProps) {
  const { data: tasks, loading, create, update, setStatus, remove } = useOrgTasks(organizationId);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OrgTask | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<QuadrantId | null>(null);
  const [dragOverCard, setDragOverCard] = useState<string | null>(null);
  const [filterResp, setFilterResp] = useState<string>(""); // "" = todos | "none" = sem responsavel | id
  const [filterStatus, setFilterStatus] = useState<string>(""); // "" = todos | StatusId
  const [filterDate, setFilterDate] = useState<string>(""); // "" = todas | "today" | "week" | "month"
  const [filterClinic, setFilterClinic] = useState<string>(""); // "" = todos | "none" | clinic id

  const [form, setForm] = useState<{ title: string; responsible_ids: string[]; clinic_id: string; due_date: string; is_urgent: boolean; is_important: boolean; status: StatusId }>({
    title: "", responsible_ids: [], clinic_id: "", due_date: "", is_urgent: true, is_important: true, status: "todo",
  });
  const [saving, setSaving] = useState(false);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    orgUsers.forEach(u => map.set(u.id, u.full_name || u.email || "Sem nome"));
    return (id: string) => map.get(id) ?? "—";
  }, [orgUsers]);

  // Cor por posicao na lista -> sem repeticao entre pessoas distintas (ate 10)
  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    orgUsers.forEach((u, i) => map.set(u.id, RESP_COLORS[i % RESP_COLORS.length]));
    return (id: string) => map.get(id) ?? colorForResp(id);
  }, [orgUsers]);

  const clinicName = useMemo(() => {
    const map = new Map<string, string>();
    clinics.forEach(c => map.set(c.id, c.name));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [clinics]);

  const byQuadrant = useMemo(() => {
    const groups: Record<QuadrantId, OrgTask[]> = { do: [], schedule: [], delegate: [], eliminate: [] };

    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const sw = new Date(now); sw.setDate(now.getDate() - now.getDay());           // domingo
    const ew = new Date(sw); ew.setDate(sw.getDate() + 6);                        // sabado
    const weekStart = `${sw.getFullYear()}-${pad(sw.getMonth() + 1)}-${pad(sw.getDate())}`;
    const weekEnd = `${ew.getFullYear()}-${pad(ew.getMonth() + 1)}-${pad(ew.getDate())}`;
    const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

    const matchesResp = (t: OrgTask) => {
      if (!filterResp) return true;
      const ids = t.responsible_ids ?? [];
      if (filterResp === "none") return ids.length === 0;
      return ids.includes(filterResp);
    };
    const matchesStatus = (t: OrgTask) => !filterStatus || (t.status ?? "todo") === filterStatus;
    const matchesClinic = (t: OrgTask) => {
      if (!filterClinic) return true;
      if (filterClinic === "none") return !t.clinic_id;
      return t.clinic_id === filterClinic;
    };
    const matchesDate = (t: OrgTask) => {
      if (!filterDate) return true;
      if (!t.due_date) return false;
      if (filterDate === "today") return t.due_date === todayStr;
      if (filterDate === "week") return t.due_date >= weekStart && t.due_date <= weekEnd;
      if (filterDate === "month") return t.due_date.startsWith(monthPrefix);
      return true;
    };

    for (const t of tasks) if (matchesResp(t) && matchesStatus(t) && matchesDate(t) && matchesClinic(t)) groups[quadrantOf(t)].push(t);
    // pendentes primeiro, depois por posicao manual, concluidas no fim
    (Object.keys(groups) as QuadrantId[]).forEach(q =>
      groups[q].sort((a, b) =>
        Number(a.status === 'done') - Number(b.status === 'done') ||
        (a.position - b.position) ||
        (a.created_at < b.created_at ? 1 : -1)
      )
    );
    return groups;
  }, [tasks, filterResp, filterStatus, filterDate, filterClinic]);

  function openCreate() {
    setEditing(null);
    setForm({ title: "", responsible_ids: [], clinic_id: "", due_date: "", is_urgent: true, is_important: true, status: "todo" });
    setModalOpen(true);
  }
  function openEdit(t: OrgTask) {
    if (!canManage) return;
    setEditing(t);
    setForm({
      title: t.title,
      responsible_ids: t.responsible_ids ?? [],
      clinic_id: t.clinic_id ?? "",
      due_date: t.due_date ?? "",
      is_urgent: t.is_urgent,
      is_important: t.is_important,
      status: t.status ?? "todo",
    });
    setModalOpen(true);
  }

  function toggleResponsible(id: string) {
    setForm(f => ({
      ...f,
      responsible_ids: f.responsible_ids.includes(id)
        ? f.responsible_ids.filter(x => x !== id)
        : [...f.responsible_ids, id],
    }));
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    const done = form.status === "done";
    const payload = {
      title: form.title.trim(),
      responsible_ids: form.responsible_ids,
      clinic_id: form.clinic_id || null,
      due_date: form.due_date || null,
      is_urgent: form.is_urgent,
      is_important: form.is_important,
      status: form.status,
      is_done: done,
      done_at: done ? (editing?.done_at ?? new Date().toISOString()) : null,
    };
    if (editing) await update(editing.id, payload);
    else await create(payload);
    setSaving(false);
    setModalOpen(false);
  }

  async function handleDelete() {
    if (!editing) return;
    setSaving(true);
    await remove(editing.id);
    setSaving(false);
    setModalOpen(false);
  }

  // Move/reordena a tarefa arrastada para o quadrante `q`.
  // targetId = card sobre o qual foi solta (insere antes dele); null = fim da lista.
  async function reorder(q: typeof QUADRANTS[number], targetId: string | null) {
    setDragOver(null);
    setDragOverCard(null);
    const id = dragId;
    setDragId(null);
    if (!id || id === targetId) return;
    const dragged = tasks.find(x => x.id === id);
    if (!dragged) return;

    const list = byQuadrant[q.id].filter(x => x.id !== id);
    let insertAt = list.length;
    if (targetId) {
      const idx = list.findIndex(x => x.id === targetId);
      if (idx >= 0) insertAt = idx;
    }
    list.splice(insertAt, 0, dragged);

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const patch: Partial<OrgTask> = {};
      if (t.position !== i) patch.position = i;
      if (t.id === id && (t.is_urgent !== q.is_urgent || t.is_important !== q.is_important)) {
        patch.is_urgent = q.is_urgent;
        patch.is_important = q.is_important;
      }
      if (Object.keys(patch).length) await update(t.id, patch);
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-slate-500">
          <ListTodo className="w-4 h-4 text-violet-500" />
          <span className="text-xs font-bold uppercase tracking-wider">Matriz de Eisenhower</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect
            icon={User}
            value={filterResp}
            onChange={setFilterResp}
            options={[
              { value: "", label: "Todos os responsáveis" },
              { value: "none", label: "Sem responsável" },
              ...orgUsers.map(u => ({ value: u.id, label: u.full_name || u.email || "Sem nome" })),
            ]}
          />
          <FilterSelect
            icon={Circle}
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: "", label: "Todos os status" },
              ...STATUSES.map(s => ({ value: s.id, label: s.label })),
            ]}
          />
          <FilterSelect
            icon={CalendarDays}
            value={filterDate}
            onChange={setFilterDate}
            options={[
              { value: "", label: "Qualquer data" },
              { value: "today", label: "Hoje" },
              { value: "week", label: "Esta semana" },
              { value: "month", label: "Este mês" },
            ]}
          />
          <FilterSelect
            icon={Building2}
            value={filterClinic}
            onChange={setFilterClinic}
            options={[
              { value: "", label: "Todos os clientes" },
              { value: "none", label: "Sem cliente" },
              ...clinics.map(c => ({ value: c.id, label: c.name })),
            ]}
          />
          {canManage && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> Nova Tarefa
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {QUADRANTS.map(q => {
            const items = byQuadrant[q.id];
            return (
              <div
                key={q.id}
                onDragOver={canManage ? (e) => { e.preventDefault(); setDragOver(q.id); } : undefined}
                onDragLeave={() => setDragOver(prev => (prev === q.id ? null : prev))}
                onDrop={canManage ? () => reorder(q, null) : undefined}
                className={cn(
                  "rounded-2xl border flex flex-col min-h-[200px] transition-all",
                  q.bg,
                  q.accent,
                  dragOver === q.id && "ring-2 ring-violet-400 ring-offset-1"
                )}
              >
                <div className="px-4 py-3 border-b border-black/5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={cn("w-2.5 h-2.5 rounded-full", q.dot)} />
                    <div>
                      <p className="text-sm font-bold text-slate-800 leading-tight">{q.title}</p>
                      <p className="text-[11px] text-slate-400">{q.subtitle}</p>
                    </div>
                  </div>
                  <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", q.badge)}>{items.length}</span>
                </div>

                <div className="flex-1 p-3 space-y-2">
                  {items.length === 0 && (
                    <p className="text-[11px] text-slate-500/70 text-center py-6">Sem tarefas</p>
                  )}
                  {items.map(t => {
                    const done = t.status === 'done';
                    const overdue = t.due_date && !done && isOverdue(t.due_date);
                    const sm = statusMeta(t.status ?? 'todo');
                    return (
                      <div
                        key={t.id}
                        draggable={canManage}
                        onDragStart={() => setDragId(t.id)}
                        onDragEnd={() => { setDragId(null); setDragOver(null); setDragOverCard(null); }}
                        onDragOver={canManage ? (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(q.id); if (dragId && dragId !== t.id) setDragOverCard(t.id); } : undefined}
                        onDragLeave={() => setDragOverCard(prev => (prev === t.id ? null : prev))}
                        onDrop={canManage ? (e) => { e.stopPropagation(); reorder(q, t.id); } : undefined}
                        onClick={() => openEdit(t)}
                        className={cn(
                          "group rounded-xl border border-slate-200 bg-white px-3 py-2.5 flex items-start gap-2.5 transition-all",
                          canManage && "cursor-pointer hover:border-violet-300 hover:shadow-sm",
                          dragId === t.id && "opacity-50",
                          dragOverCard === t.id && "border-t-2 border-t-violet-500",
                          done && "bg-slate-50"
                        )}
                      >
                        {t.due_date ? (
                          <div className={cn(
                            "shrink-0 self-center w-9 flex flex-col items-center justify-center text-center leading-none",
                            done ? "text-slate-300" : overdue ? "text-rose-500" : "text-slate-600"
                          )}>
                            <span className="text-[15px] font-bold">{dateParts(t.due_date).day}</span>
                            <span className="text-[9px] font-medium uppercase tracking-wide text-slate-400 mt-0.5">{dateParts(t.due_date).mon}</span>
                          </div>
                        ) : (
                          <div className="shrink-0 self-center w-9 flex items-center justify-center text-slate-200 text-sm">–</div>
                        )}

                        <button
                          title={`Status: ${sm.label} (clique para avançar)`}
                          onClick={(e) => { e.stopPropagation(); canManage && setStatus(t, nextStatus(t.status ?? 'todo')); }}
                          disabled={!canManage}
                          className={cn(
                            "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                            done ? "bg-emerald-500 border-emerald-500 text-white"
                                 : t.status === 'doing' ? "bg-amber-400 border-amber-400"
                                 : "border-slate-300 hover:border-slate-400"
                          )}
                        >
                          {done && <Check className="w-2.5 h-2.5" />}
                        </button>

                        <div className="flex-1 min-w-0">
                          {clinicName(t.clinic_id) && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-500 mb-1">
                              <Building2 className="w-2.5 h-2.5" /> {clinicName(t.clinic_id)}
                            </span>
                          )}
                          <p className={cn("text-[13px] font-semibold text-slate-700 leading-snug break-words", done && "line-through text-slate-400")}>
                            {t.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border", sm.cls)}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", sm.dot)} /> {sm.label}
                            </span>
                            {(t.responsible_ids ?? []).map(rid => (
                              <span key={rid} className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border", colorOf(rid))}>
                                <User className="w-2.5 h-2.5" /> {nameOf(rid)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: nova / editar tarefa */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">{editing ? "Editar Tarefa" : "Nova Tarefa"}</p>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Título</label>
                  <input
                    type="text"
                    autoFocus
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="O que precisa ser feito?"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-violet-100 focus:border-violet-400 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Responsáveis</label>
                  {orgUsers.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Nenhum usuário na organização.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {orgUsers.map(u => {
                        const active = form.responsible_ids.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => toggleResponsible(u.id)}
                            className={cn(
                              "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                              active
                                ? colorOf(u.id)
                                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                            )}
                          >
                            {active && <Check className="w-3 h-3" />}
                            {u.full_name || u.email || "Sem nome"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</label>
                  <select
                    value={form.clinic_id}
                    onChange={e => setForm(f => ({ ...f, clinic_id: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-violet-100 focus:border-violet-400 outline-none transition-all bg-white"
                  >
                    <option value="">Sem cliente</option>
                    {clinics.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Prazo</label>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-violet-100 focus:border-violet-400 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status</label>
                  <div className="grid grid-cols-3 gap-2">
                    {STATUSES.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, status: s.id }))}
                        className={cn(
                          "px-2 py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5",
                          form.status === s.id ? s.cls : "bg-white text-slate-400 border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full", form.status === s.id ? s.dot : "bg-slate-300")} />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Classificação</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, is_urgent: !f.is_urgent }))}
                      className={cn(
                        "px-3 py-2.5 rounded-xl text-xs font-bold border transition-all",
                        form.is_urgent ? "bg-rose-50 text-rose-600 border-rose-300" : "bg-white text-slate-400 border-slate-200 hover:border-slate-300"
                      )}
                    >
                      Urgente
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, is_important: !f.is_important }))}
                      className={cn(
                        "px-3 py-2.5 rounded-xl text-xs font-bold border transition-all",
                        form.is_important ? "bg-blue-50 text-blue-600 border-blue-300" : "bg-white text-slate-400 border-slate-200 hover:border-slate-300"
                      )}
                    >
                      Importante
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    → {QUADRANTS.find(q => q.is_urgent === form.is_urgent && q.is_important === form.is_important)?.title}
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                {editing ? (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-2 text-rose-500 hover:bg-rose-50 rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Excluir
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-xs font-bold transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !form.title.trim()}
                    className="flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {editing ? "Salvar" : "Criar"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
