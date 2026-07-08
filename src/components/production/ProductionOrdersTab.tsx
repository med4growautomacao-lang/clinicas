import React, { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Plus, Factory, Play, CheckCircle2, Ban, Pencil, Clock, AlertTriangle, Trash2,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  useProductionOrders, useInventoryItems, useProductBom,
  ProductionOrder, ProductionStatus, InventoryItem,
} from "../../hooks/useSupabase";
import { useToast } from "../ui/toast";
import { Button, Modal, Field, StatCard, StatusBadge, EmptyState, inputCls, fmtQty, fmtDate } from "./shared";

const STATUS_META: Record<ProductionStatus, { label: string; tone: "slate" | "amber" | "emerald" | "rose" | "sky" }> = {
  planejada: { label: "Planejada", tone: "slate" },
  em_producao: { label: "Em produção", tone: "amber" },
  concluida: { label: "Concluída", tone: "emerald" },
  cancelada: { label: "Cancelada", tone: "rose" },
};

const isLate = (o: ProductionOrder) =>
  !!o.due_date && o.status !== "concluida" && o.status !== "cancelada" &&
  new Date(o.due_date + "T23:59:59") < new Date();

export function ProductionOrdersTab() {
  const showToast = useToast();
  const { data: orders, loading, create, update, complete } = useProductionOrders();
  const { data: items } = useInventoryItems();
  const finished = useMemo(() => items.filter(i => i.kind === "produto_acabado"), [items]);

  const [showCreate, setShowCreate] = useState(false);
  const [completeOrder, setCompleteOrder] = useState<ProductionOrder | null>(null);
  const [editOrder, setEditOrder] = useState<ProductionOrder | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const open = orders.filter(o => o.status === "planejada" || o.status === "em_producao");
  const late = open.filter(isLate);
  const doneCount = orders.filter(o => o.status === "concluida").length;

  const columns: { status: ProductionStatus; label: string }[] = [
    { status: "planejada", label: "Planejada" },
    { status: "em_producao", label: "Em produção" },
    { status: "concluida", label: "Concluída" },
  ];

  const startOrder = async (o: ProductionOrder) => {
    await update(o.id, { status: "em_producao", started_at: o.started_at ?? new Date().toISOString() });
    showToast(`OP #${o.number} iniciada.`, "success");
  };
  const cancelOrder = async (o: ProductionOrder) => {
    await update(o.id, { status: "cancelada" });
    showToast(`OP #${o.number} cancelada.`, "info");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-5">
        <StatCard label="OPs abertas" value={String(open.length)} icon={<Factory className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Atrasadas" value={String(late.length)} tone={late.length ? "rose" : "emerald"} icon={<Clock className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Concluídas" value={String(doneCount)} tone="emerald" icon={<CheckCircle2 className="w-4 h-4 text-slate-300" />} />
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
          <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} className="w-4 h-4 accent-teal-600" />
          Mostrar canceladas
        </label>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1.5" /> Nova OP</Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-10 text-center">Carregando…</p>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<Factory className="w-7 h-7" />}
          title="Nenhuma ordem de produção"
          hint="Crie OPs manualmente aqui ou gere direto de um orçamento ganho no funil de vendas."
          action={<Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1.5" /> Nova OP</Button>}
        />
      ) : (
        <div className="grid md:grid-cols-3 gap-4">
          {columns.map(col => {
            const list = orders.filter(o => o.status === col.status);
            return (
              <div key={col.status} className="bg-slate-50 rounded-xl p-3 min-h-[120px]">
                <div className="flex items-center justify-between px-1 mb-2.5">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">{col.label}</span>
                  <span className="text-xs font-bold text-slate-400">{list.length}</span>
                </div>
                <div className="space-y-2.5">
                  {list.map(o => (
                    <OrderCard key={o.id} o={o} onStart={startOrder} onComplete={setCompleteOrder} onEdit={setEditOrder} onCancel={cancelOrder} />
                  ))}
                  {list.length === 0 && <p className="text-xs text-slate-300 text-center py-3">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCancelled && (
        <div className="mt-5">
          <p className="text-xs font-black uppercase tracking-wide text-slate-400 mb-2">Canceladas</p>
          <div className="grid md:grid-cols-3 gap-2.5">
            {orders.filter(o => o.status === "cancelada").map(o => (
              <OrderCard key={o.id} o={o} onStart={startOrder} onComplete={setCompleteOrder} onEdit={setEditOrder} onCancel={cancelOrder} />
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {(showCreate || editOrder) && (
          <OrderModal
            key="order"
            order={editOrder}
            finished={finished}
            onClose={() => { setShowCreate(false); setEditOrder(null); }}
            onSave={async (input, id) => {
              if (id) { await update(id, input); showToast("OP atualizada.", "success"); }
              else {
                const created = await create(input);
                if (created) showToast(`OP #${created.number} criada.`, "success");
                else showToast("Erro ao criar OP.", "error");
              }
              setShowCreate(false); setEditOrder(null);
            }}
          />
        )}
        {completeOrder && (
          <CompleteModal
            key="complete"
            order={completeOrder}
            items={items}
            onClose={() => setCompleteOrder(null)}
            onConfirm={async (qty, altura) => {
              const res = await complete(completeOrder.id, qty, altura);
              if (res?.success) showToast((res as any).already_done ? "OP já estava concluída." : `OP #${completeOrder.number} concluída. Estoque atualizado.`, "success");
              else showToast("Erro ao concluir OP.", "error");
              setCompleteOrder(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function OrderCard({ o, onStart, onComplete, onEdit, onCancel }: {
  o: ProductionOrder;
  onStart: (o: ProductionOrder) => void;
  onComplete: (o: ProductionOrder) => void;
  onEdit: (o: ProductionOrder) => void;
  onCancel: (o: ProductionOrder) => void;
}) {
  const late = isLate(o);
  const productName = o.product?.name ?? o.product_label ?? "—";
  const unit = o.product?.unit ?? "un";
  const terminal = o.status === "concluida" || o.status === "cancelada";
  return (
    <div className={cn("bg-white border rounded-xl p-3 shadow-sm group", o.status === "cancelada" ? "border-slate-200 opacity-70" : "border-slate-200")}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-black text-slate-400">OP #{o.number}</span>
        <div className="flex items-center gap-1">
          {o.priority === "alta" && <StatusBadge label="alta" tone="rose" />}
          <StatusBadge label={STATUS_META[o.status].label} tone={STATUS_META[o.status].tone} />
        </div>
      </div>
      <p className="font-bold text-slate-800 text-sm leading-snug">{productName}</p>
      <div className="text-xs text-slate-500 mt-1 space-y-0.5">
        <div>Qtd: <span className="font-semibold text-slate-700">{fmtQty(o.qty_planned)} {unit}</span>{o.altura ? <span className="text-slate-400"> · alt {fmtQty(o.altura)}m</span> : null}{o.status === "concluida" && <span className="text-emerald-600"> · produzido {fmtQty(o.qty_produced)}</span>}</div>
        {o.client_name && <div className="truncate">Cliente: {o.client_name}</div>}
        <div className={cn(late && "text-rose-600 font-semibold flex items-center gap-1")}>
          {late && <AlertTriangle className="w-3 h-3" />}
          Prazo: {fmtDate(o.due_date)}
        </div>
      </div>

      {!terminal && (
        <div className="flex items-center gap-1 mt-2.5 pt-2.5 border-t border-slate-100">
          {o.status === "planejada" && (
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => onStart(o)}><Play className="w-3.5 h-3.5 mr-1" /> Iniciar</Button>
          )}
          <Button size="sm" className="flex-1" onClick={() => onComplete(o)}><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Concluir</Button>
          <button title="Editar" onClick={() => onEdit(o)} className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><Pencil className="w-4 h-4" /></button>
          <button title="Cancelar OP" onClick={() => onCancel(o)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"><Ban className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}

// Modal criar/editar OP
function OrderModal({ order, finished, onClose, onSave }: {
  order: ProductionOrder | null;
  finished: InventoryItem[];
  onClose: () => void;
  onSave: (input: Partial<ProductionOrder>, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    product_item_id: order?.product_item_id ?? "",
    product_label: order?.product_label ?? "",
    qty_planned: order?.qty_planned ?? 1,
    altura: order?.altura ?? 0,
    due_date: order?.due_date ?? "",
    priority: (order?.priority ?? "normal") as ProductionOrder["priority"],
    client_name: order?.client_name ?? "",
    notes: order?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [freeText, setFreeText] = useState(!order?.product_item_id && !!order?.product_label);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const valid = (freeText ? form.product_label.trim() : form.product_item_id) && Number(form.qty_planned) > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    await onSave({
      product_item_id: freeText ? null : (form.product_item_id || null),
      product_label: freeText ? form.product_label.trim() : null,
      qty_planned: Number(form.qty_planned) || 0,
      altura: Number(form.altura) || null,
      due_date: form.due_date || null,
      priority: form.priority,
      client_name: form.client_name.trim() || null,
      notes: form.notes.trim() || null,
    }, order?.id);
    setSaving(false);
  };

  return (
    <Modal
      title={order ? `Editar OP #${order.number}` : "Nova ordem de produção"}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={save} disabled={saving || !valid}>{saving ? "Salvando…" : order ? "Salvar" : "Criar OP"}</Button>
      </>}
    >
      <div className="space-y-4">
        <Field label="Produto a produzir">
          {freeText ? (
            <input className={inputCls} value={form.product_label} onChange={e => set({ product_label: e.target.value })} placeholder="Descrição livre do produto" autoFocus />
          ) : (
            <select className={inputCls} value={form.product_item_id} onChange={e => set({ product_item_id: e.target.value })}>
              <option value="">Selecione um produto acabado…</option>
              {finished.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => setFreeText(v => !v)} className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 text-left">
            {freeText ? "Escolher do catálogo de produtos acabados" : "Digitar produto avulso (sem cadastro)"}
          </button>
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Quantidade"><input type="number" min={0} step="any" className={inputCls} value={form.qty_planned} onChange={e => set({ qty_planned: parseFloat(e.target.value) || 0 })} /></Field>
          <Field label="Altura (m)"><input type="number" min={0} step="any" className={inputCls} value={form.altura} onChange={e => set({ altura: parseFloat(e.target.value) || 0 })} placeholder="telas" /></Field>
          <Field label="Prazo"><input type="date" className={inputCls} value={form.due_date} onChange={e => set({ due_date: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prioridade">
            <select className={inputCls} value={form.priority} onChange={e => set({ priority: e.target.value as ProductionOrder["priority"] })}>
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </Field>
          <Field label="Cliente"><input className={inputCls} value={form.client_name} onChange={e => set({ client_name: e.target.value })} placeholder="opcional" /></Field>
        </div>
        <Field label="Observações"><textarea className={cn(inputCls, "min-h-[56px] resize-y")} value={form.notes} onChange={e => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// Modal concluir OP: pede qtd produzida e mostra previa da baixa (ficha tecnica x estoque).
function CompleteModal({ order, items, onClose, onConfirm }: {
  order: ProductionOrder;
  items: InventoryItem[];
  onClose: () => void;
  onConfirm: (qty: number, altura?: number | null) => Promise<void>;
}) {
  const [qty, setQty] = useState<number>(Number(order.qty_planned) || 0);
  const [altura, setAltura] = useState<number>(Number(order.altura) || 0);
  const [saving, setSaving] = useState(false);
  const { data: bom } = useProductBom(order.product_item_id);
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const rows = bom.map(b => {
    const mat = itemById.get(b.material_item_id);
    const need = Number(b.qty_per_unit) * qty;
    const have = Number(mat?.current_qty ?? 0);
    return { id: b.id, name: b.material?.name ?? mat?.name ?? "—", unit: b.material?.unit ?? mat?.unit ?? "", need, have, short: need > have };
  });
  const anyShort = rows.some(r => r.short);

  return (
    <Modal
      title={`Concluir OP #${order.number}`}
      subtitle={order.product?.name ?? order.product_label ?? undefined}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={async () => { setSaving(true); await onConfirm(qty, altura > 0 ? altura : null); setSaving(false); }} disabled={saving || qty <= 0}>
          {saving ? "Concluindo…" : "Concluir e baixar estoque"}
        </Button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Quantidade produzida (${order.product?.unit ?? "un"})`}>
          <input type="number" min={0} step="any" className={inputCls} value={qty} onChange={e => setQty(parseFloat(e.target.value) || 0)} autoFocus />
        </Field>
        <Field label="Altura (m)">
          <input type="number" min={0} step="any" className={inputCls} value={altura} onChange={e => setAltura(parseFloat(e.target.value) || 0)} placeholder="telas" />
        </Field>
      </div>

      <div className="mt-4">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Baixa de matéria-prima</p>
        {!order.product_item_id ? (
          <p className="text-sm text-slate-400 italic">OP sem produto de catálogo — nenhuma baixa automática.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Este produto não tem ficha técnica — nada será baixado automaticamente.</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map(r => (
              <div key={r.id} className={cn("flex items-center justify-between text-sm rounded-lg px-3 py-2", r.short ? "bg-rose-50" : "bg-slate-50")}>
                <span className="font-semibold text-slate-700">{r.name}</span>
                <span className={cn("tabular-nums font-bold", r.short ? "text-rose-600" : "text-slate-600")}>
                  −{fmtQty(r.need)} {r.unit} <span className="text-xs font-medium text-slate-400">(estoque {fmtQty(r.have)})</span>
                </span>
              </div>
            ))}
            {rows.length > 0 && (
              <div className="flex items-center justify-between text-sm rounded-lg px-3 py-2 bg-emerald-50">
                <span className="font-semibold text-emerald-700">Entrada de produto acabado</span>
                <span className="tabular-nums font-bold text-emerald-700">+{fmtQty(qty)} {order.product?.unit ?? "un"}</span>
              </div>
            )}
          </div>
        )}
        {anyShort && <p className="text-xs text-rose-500 font-semibold mt-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Matéria-prima insuficiente — o saldo ficará negativo.</p>}
      </div>
    </Modal>
  );
}
