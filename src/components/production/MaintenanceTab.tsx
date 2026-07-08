import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus, Wrench, Cog, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  useEquipment, useMaintenanceOrders, Equipment, MaintenanceOrder,
} from "../../hooks/useSupabase";
import { useToast } from "../ui/toast";
import { MoneyInput } from "../ui/money-input";
import { Button, Modal, Field, StatCard, StatusBadge, EmptyState, inputCls, fmtBRL, fmtDate } from "./shared";

const EQ_STATUS: Record<Equipment["status"], { label: string; tone: "emerald" | "rose" | "amber" }> = {
  operando: { label: "Operando", tone: "emerald" },
  parada: { label: "Parada", tone: "rose" },
  manutencao: { label: "Em manutenção", tone: "amber" },
};
const OM_STATUS: Record<MaintenanceOrder["status"], { label: string; tone: "slate" | "amber" | "emerald" | "rose" }> = {
  aberta: { label: "Aberta", tone: "slate" },
  em_andamento: { label: "Em andamento", tone: "amber" },
  concluida: { label: "Concluída", tone: "emerald" },
  cancelada: { label: "Cancelada", tone: "rose" },
};
const OM_TYPE: Record<MaintenanceOrder["type"], string> = { preventiva: "Preventiva", corretiva: "Corretiva", preditiva: "Preditiva" };

export function MaintenanceTab() {
  const showToast = useToast();
  const { data: equipment, create: createEq, update: updateEq, remove: removeEq } = useEquipment();
  const { data: orders, create: createOm, update: updateOm, remove: removeOm } = useMaintenanceOrders();

  const [eqModal, setEqModal] = useState<{ eq: Equipment | null } | null>(null);
  const [omModal, setOmModal] = useState<{ om: MaintenanceOrder | null } | null>(null);

  const operando = equipment.filter(e => e.status === "operando").length;
  const paradas = equipment.filter(e => e.status !== "operando").length;
  const abertas = orders.filter(o => o.status === "aberta" || o.status === "em_andamento").length;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-5">
        <StatCard label="Equipamentos" value={String(equipment.length)} icon={<Cog className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Parados / manut." value={String(paradas)} tone={paradas ? "rose" : "emerald"} />
        <StatCard label="OMs abertas" value={String(abertas)} tone={abertas ? "amber" : "emerald"} icon={<Wrench className="w-4 h-4 text-slate-300" />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Equipamentos */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Cog className="w-4 h-4 text-slate-400" /> Equipamentos</h3>
            <Button size="sm" variant="secondary" onClick={() => setEqModal({ eq: null })}><Plus className="w-4 h-4 mr-1" /> Equipamento</Button>
          </div>
          {equipment.length === 0 ? (
            <EmptyState icon={<Cog className="w-7 h-7" />} title="Nenhum equipamento" hint="Cadastre máquinas para controlar manutenção." />
          ) : (
            <div className="space-y-2">
              {equipment.map(e => (
                <div key={e.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 group shadow-sm">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 flex items-center gap-2">{e.name} {!e.is_active && <StatusBadge label="inativo" tone="slate" />}</div>
                    <div className="text-xs text-slate-400">{[e.code, e.location].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={e.status}
                      onChange={ev => updateEq(e.id, { status: ev.target.value as Equipment["status"] })}
                      className={cn("text-xs font-bold rounded-lg px-2 py-1 border-0 cursor-pointer",
                        e.status === "operando" ? "bg-emerald-100 text-emerald-700" : e.status === "parada" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700")}
                    >
                      <option value="operando">Operando</option>
                      <option value="parada">Parada</option>
                      <option value="manutencao">Em manutenção</option>
                    </select>
                    <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                      <button title="Editar" onClick={() => setEqModal({ eq: e })} className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><Pencil className="w-4 h-4" /></button>
                      <button title="Excluir" onClick={async () => { await removeEq(e.id); showToast("Equipamento excluído.", "success"); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Ordens de manutencao */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Wrench className="w-4 h-4 text-slate-400" /> Ordens de manutenção</h3>
            <Button size="sm" onClick={() => setOmModal({ om: null })}><Plus className="w-4 h-4 mr-1" /> Nova OM</Button>
          </div>
          {orders.length === 0 ? (
            <EmptyState icon={<Wrench className="w-7 h-7" />} title="Nenhuma ordem de manutenção" hint="Abra OMs preventivas ou corretivas para os equipamentos." />
          ) : (
            <div className="space-y-2">
              {orders.map(o => (
                <div key={o.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 group shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-400">OM #{o.number}</span>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge label={OM_TYPE[o.type]} tone="violet" />
                      <StatusBadge label={OM_STATUS[o.status].label} tone={OM_STATUS[o.status].tone} />
                    </div>
                  </div>
                  <p className="font-bold text-slate-800 text-sm mt-1">{o.equipment?.name ?? "Sem equipamento"}</p>
                  {o.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{o.description}</p>}
                  <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {o.scheduled_date && <span>Agendada: {fmtDate(o.scheduled_date)}</span>}
                    {o.technician && <span>Téc.: {o.technician}</span>}
                    {Number(o.cost) > 0 && <span>Custo: {fmtBRL(o.cost)}</span>}
                  </div>
                  <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
                    {o.status !== "concluida" && o.status !== "cancelada" && (
                      <select
                        value={o.status}
                        onChange={ev => updateOm(o.id, { status: ev.target.value as MaintenanceOrder["status"], completed_at: ev.target.value === "concluida" ? new Date().toISOString() : null })}
                        className="text-xs font-bold rounded-lg px-2 py-1 bg-slate-100 text-slate-700 border-0 cursor-pointer flex-1"
                      >
                        <option value="aberta">Aberta</option>
                        <option value="em_andamento">Em andamento</option>
                        <option value="concluida">Concluída</option>
                        <option value="cancelada">Cancelada</option>
                      </select>
                    )}
                    <button title="Editar" onClick={() => setOmModal({ om: o })} className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><Pencil className="w-4 h-4" /></button>
                    <button title="Excluir" onClick={async () => { await removeOm(o.id); showToast("OM excluída.", "success"); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <AnimatePresence>
        {eqModal && (
          <EquipmentModal
            key="eq"
            eq={eqModal.eq}
            onClose={() => setEqModal(null)}
            onSave={async (input, id) => {
              if (id) { await updateEq(id, input); showToast("Equipamento atualizado.", "success"); }
              else { const c = await createEq(input); showToast(c ? "Equipamento criado." : "Erro ao criar.", c ? "success" : "error"); }
              setEqModal(null);
            }}
          />
        )}
        {omModal && (
          <MaintenanceOrderModal
            key="om"
            om={omModal.om}
            equipment={equipment}
            onClose={() => setOmModal(null)}
            onSave={async (input, id) => {
              if (id) { await updateOm(id, input); showToast("OM atualizada.", "success"); }
              else { const c = await createOm(input); showToast(c ? `OM #${c.number} criada.` : "Erro ao criar.", c ? "success" : "error"); }
              setOmModal(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function EquipmentModal({ eq, onClose, onSave }: {
  eq: Equipment | null;
  onClose: () => void;
  onSave: (input: Partial<Equipment>, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: eq?.name ?? "", code: eq?.code ?? "", location: eq?.location ?? "",
    status: (eq?.status ?? "operando") as Equipment["status"], notes: eq?.notes ?? "", is_active: eq?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }));

  return (
    <Modal
      title={eq ? "Editar equipamento" : "Novo equipamento"}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" disabled={saving || !form.name.trim()} onClick={async () => {
          setSaving(true);
          await onSave({ name: form.name.trim(), code: form.code.trim() || null, location: form.location.trim() || null, status: form.status, notes: form.notes.trim() || null, is_active: form.is_active }, eq?.id);
          setSaving(false);
        }}>{saving ? "Salvando…" : eq ? "Salvar" : "Criar"}</Button>
      </>}
    >
      <div className="space-y-4">
        <Field label="Nome"><input className={inputCls} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Ex: Máquina de trefilação 01" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código / TAG"><input className={inputCls} value={form.code} onChange={e => set({ code: e.target.value })} placeholder="opcional" /></Field>
          <Field label="Localização"><input className={inputCls} value={form.location} onChange={e => set({ location: e.target.value })} placeholder="setor, linha…" /></Field>
        </div>
        <Field label="Situação">
          <select className={inputCls} value={form.status} onChange={e => set({ status: e.target.value as Equipment["status"] })}>
            <option value="operando">Operando</option>
            <option value="parada">Parada</option>
            <option value="manutencao">Em manutenção</option>
          </select>
        </Field>
        <Field label="Observações"><textarea className={cn(inputCls, "min-h-[56px] resize-y")} value={form.notes} onChange={e => set({ notes: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={form.is_active} onChange={e => set({ is_active: e.target.checked })} className="w-4 h-4 accent-teal-600" /> Ativo
        </label>
      </div>
    </Modal>
  );
}

function MaintenanceOrderModal({ om, equipment, onClose, onSave }: {
  om: MaintenanceOrder | null;
  equipment: Equipment[];
  onClose: () => void;
  onSave: (input: Partial<MaintenanceOrder>, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    equipment_id: om?.equipment_id ?? "",
    type: (om?.type ?? "corretiva") as MaintenanceOrder["type"],
    status: (om?.status ?? "aberta") as MaintenanceOrder["status"],
    priority: (om?.priority ?? "normal") as MaintenanceOrder["priority"],
    scheduled_date: om?.scheduled_date ?? "",
    technician: om?.technician ?? "",
    cost: om?.cost ?? 0,
    description: om?.description ?? "",
    notes: om?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }));

  return (
    <Modal
      title={om ? `Editar OM #${om.number}` : "Nova ordem de manutenção"}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" disabled={saving} onClick={async () => {
          setSaving(true);
          await onSave({
            equipment_id: form.equipment_id || null, type: form.type, status: form.status, priority: form.priority,
            scheduled_date: form.scheduled_date || null, technician: form.technician.trim() || null,
            cost: Number(form.cost) || 0, description: form.description.trim() || null, notes: form.notes.trim() || null,
            completed_at: form.status === "concluida" ? (om?.completed_at ?? new Date().toISOString()) : null,
          }, om?.id);
          setSaving(false);
        }}>{saving ? "Salvando…" : om ? "Salvar" : "Criar OM"}</Button>
      </>}
    >
      <div className="space-y-4">
        <Field label="Equipamento">
          <select className={inputCls} value={form.equipment_id} onChange={e => set({ equipment_id: e.target.value })}>
            <option value="">Selecione…</option>
            {equipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select className={inputCls} value={form.type} onChange={e => set({ type: e.target.value as MaintenanceOrder["type"] })}>
              <option value="corretiva">Corretiva</option>
              <option value="preventiva">Preventiva</option>
              <option value="preditiva">Preditiva</option>
            </select>
          </Field>
          <Field label="Situação">
            <select className={inputCls} value={form.status} onChange={e => set({ status: e.target.value as MaintenanceOrder["status"] })}>
              <option value="aberta">Aberta</option>
              <option value="em_andamento">Em andamento</option>
              <option value="concluida">Concluída</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data agendada"><input type="date" className={inputCls} value={form.scheduled_date} onChange={e => set({ scheduled_date: e.target.value })} /></Field>
          <Field label="Custo"><MoneyInput value={form.cost} onChange={v => set({ cost: v })} /></Field>
        </div>
        <Field label="Técnico responsável"><input className={inputCls} value={form.technician} onChange={e => set({ technician: e.target.value })} placeholder="opcional" /></Field>
        <Field label="Descrição do serviço"><textarea className={cn(inputCls, "min-h-[64px] resize-y")} value={form.description} onChange={e => set({ description: e.target.value })} placeholder="O que precisa ser feito" /></Field>
      </div>
    </Modal>
  );
}
