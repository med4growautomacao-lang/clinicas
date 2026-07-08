import React, { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Plus, Package, ArrowDownUp, Pencil, Trash2, ScrollText, Boxes,
  AlertTriangle, Layers, FileStack,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  useInventoryItems, useInventoryMovements, useProductBom,
  InventoryItem, InventoryKind, INVENTORY_KIND_LABEL,
} from "../../hooks/useSupabase";
import { useToast } from "../ui/toast";
import { MoneyInput } from "../ui/money-input";
import { Button, Modal, Field, StatCard, StatusBadge, EmptyState, inputCls, fmtQty, fmtBRL, fmtDate } from "./shared";

const KIND_TONE: Record<InventoryKind, "amber" | "emerald" | "sky"> = {
  materia_prima: "amber",
  produto_acabado: "emerald",
  insumo: "sky",
};

export function InventoryTab() {
  const showToast = useToast();
  const { data: items, loading, create, update, remove, lowStock, totalValue } = useInventoryItems();
  const { register } = useInventoryMovements(null);

  const [kindFilter, setKindFilter] = useState<InventoryKind | "todos">("todos");
  const [itemModal, setItemModal] = useState<{ item: InventoryItem | null } | null>(null);
  const [movItem, setMovItem] = useState<InventoryItem | null>(null);
  const [extratoItem, setExtratoItem] = useState<InventoryItem | null>(null);
  const [delItem, setDelItem] = useState<InventoryItem | null>(null);

  const filtered = useMemo(
    () => (kindFilter === "todos" ? items : items.filter(i => i.kind === kindFilter)),
    [items, kindFilter],
  );

  const kindTabs: { id: InventoryKind | "todos"; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "materia_prima", label: "Matéria-prima" },
    { id: "produto_acabado", label: "Produto acabado" },
    { id: "insumo", label: "Insumo" },
  ];

  return (
    <div>
      {/* Resumo */}
      <div className="flex flex-wrap gap-3 mb-5">
        <StatCard label="Itens cadastrados" value={String(items.length)} icon={<Boxes className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Abaixo do mínimo" value={String(lowStock.length)} tone={lowStock.length ? "rose" : "emerald"} icon={<AlertTriangle className="w-4 h-4 text-slate-300" />} />
        <StatCard label="Valor em estoque" value={fmtBRL(totalValue)} tone="teal" icon={<Layers className="w-4 h-4 text-slate-300" />} />
      </div>

      {/* Filtro + acao */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex bg-slate-100 rounded-xl p-1">
          {kindTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setKindFilter(t.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                kindFilter === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setItemModal({ item: null })}>
          <Plus className="w-4 h-4 mr-1.5" /> Novo item
        </Button>
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-slate-400 py-10 text-center">Carregando…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="w-7 h-7" />}
          title="Nenhum item de estoque"
          hint="Cadastre matérias-primas, produtos acabados e insumos para controlar entradas e saídas."
          action={<Button size="sm" onClick={() => setItemModal({ item: null })}><Plus className="w-4 h-4 mr-1.5" /> Novo item</Button>}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 font-bold">
                  <th className="text-left px-4 py-2.5">Item</th>
                  <th className="text-left px-4 py-2.5">Tipo</th>
                  <th className="text-right px-4 py-2.5">Saldo</th>
                  <th className="text-right px-4 py-2.5">Mínimo</th>
                  <th className="text-right px-4 py-2.5">Custo un.</th>
                  <th className="text-right px-4 py-2.5">Valor</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => {
                  const low = Number(it.min_qty) > 0 && Number(it.current_qty) <= Number(it.min_qty);
                  return (
                    <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50/60 group">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800 flex items-center gap-2">
                          {it.name}
                          {!it.is_active && <StatusBadge label="inativo" tone="slate" />}
                        </div>
                        <div className="text-xs text-slate-400">
                          {[it.sku, it.category, it.location].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge label={INVENTORY_KIND_LABEL[it.kind]} tone={KIND_TONE[it.kind]} /></td>
                      <td className={cn("px-4 py-3 text-right font-bold tabular-nums", low ? "text-rose-600" : "text-slate-800")}>
                        {fmtQty(it.current_qty)} <span className="text-xs font-medium text-slate-400">{it.unit}</span>
                        {low && <AlertTriangle className="inline w-3.5 h-3.5 ml-1 -mt-0.5 text-rose-500" />}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{Number(it.min_qty) > 0 ? fmtQty(it.min_qty) : "—"}</td>
                      <td className="px-4 py-3 text-right text-slate-500 tabular-nums">{fmtBRL(it.unit_cost)}</td>
                      <td className="px-4 py-3 text-right text-slate-700 font-semibold tabular-nums">{fmtBRL(Number(it.current_qty) * Number(it.unit_cost))}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <IconBtn title="Movimentar" onClick={() => setMovItem(it)}><ArrowDownUp className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Extrato" onClick={() => setExtratoItem(it)}><ScrollText className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Editar" onClick={() => setItemModal({ item: it })}><Pencil className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Excluir" danger onClick={() => setDelItem(it)}><Trash2 className="w-4 h-4" /></IconBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {itemModal && (
          <ItemModal
            key="item"
            item={itemModal.item}
            allItems={items}
            onClose={() => setItemModal(null)}
            onSave={async (input, id) => {
              if (id) { await update(id, input); showToast("Item atualizado.", "success"); }
              else {
                const created = await create(input);
                if (!created) { showToast("Não foi possível criar o item.", "error"); return null; }
                showToast("Item criado.", "success");
                return created;
              }
              return null;
            }}
          />
        )}
        {movItem && (
          <MovementModal
            key="mov"
            item={movItem}
            onClose={() => setMovItem(null)}
            onSubmit={async (mov) => {
              const ok = await register(mov);
              if (ok) { showToast("Movimentação registrada.", "success"); setMovItem(null); }
              else showToast("Erro ao registrar movimentação.", "error");
            }}
          />
        )}
        {extratoItem && <ExtratoModal key="ext" item={extratoItem} onClose={() => setExtratoItem(null)} />}
        {delItem && (
          <Modal
            key="del"
            title="Excluir item"
            subtitle={delItem.name}
            onClose={() => setDelItem(null)}
            footer={<>
              <Button variant="outline" size="sm" onClick={() => setDelItem(null)}>Cancelar</Button>
              <Button variant="destructive" size="sm" onClick={async () => { await remove(delItem.id); showToast("Item excluído.", "success"); setDelItem(null); }}>Excluir</Button>
            </>}
          >
            <p className="text-sm text-slate-600">Isso remove o item e todo o seu histórico de movimentações. Esta ação não pode ser desfeita.</p>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn("p-1.5 rounded-lg transition-all text-slate-400", danger ? "hover:text-rose-600 hover:bg-rose-50" : "hover:text-teal-600 hover:bg-teal-50")}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal de item (create/edit) + editor de ficha tecnica p/ produto acabado
// ---------------------------------------------------------------------------
function ItemModal({
  item, allItems, onClose, onSave,
}: {
  item: InventoryItem | null;
  allItems: InventoryItem[];
  onClose: () => void;
  onSave: (input: Partial<InventoryItem>, id?: string) => Promise<InventoryItem | null>;
}) {
  const [form, setForm] = useState({
    kind: (item?.kind ?? "materia_prima") as InventoryKind,
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    category: item?.category ?? "",
    unit: item?.unit ?? "un",
    min_qty: item?.min_qty ?? 0,
    unit_cost: item?.unit_cost ?? 0,
    location: item?.location ?? "",
    is_active: item?.is_active ?? true,
    notes: item?.notes ?? "",
  });
  // O item pode passar a existir apos salvar (para liberar a ficha tecnica sem fechar).
  const [savedId, setSavedId] = useState<string | null>(item?.id ?? null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const input: Partial<InventoryItem> = {
      kind: form.kind, name: form.name.trim(), sku: form.sku.trim() || null,
      category: form.category.trim() || null, unit: form.unit.trim() || "un",
      min_qty: Number(form.min_qty) || 0, unit_cost: Number(form.unit_cost) || 0,
      location: form.location.trim() || null, is_active: form.is_active, notes: form.notes.trim() || null,
    };
    const created = await onSave(input, savedId ?? undefined);
    if (created) setSavedId(created.id);
    setSaving(false);
    if (savedId) onClose(); // edicao existente: fecha ao salvar
  };

  return (
    <Modal
      title={item ? "Editar item" : "Novo item de estoque"}
      subtitle={form.kind === "produto_acabado" ? "Produto acabado — pode ter ficha técnica" : undefined}
      onClose={onClose}
      wide={form.kind === "produto_acabado"}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>
        <Button size="sm" onClick={save} disabled={saving || !form.name.trim()}>{saving ? "Salvando…" : savedId ? "Salvar" : "Criar item"}</Button>
      </>}
    >
      <div className={cn("grid gap-4", form.kind === "produto_acabado" ? "md:grid-cols-2" : "grid-cols-1")}>
        <div className="space-y-4">
          <Field label="Tipo">
            <select className={inputCls} value={form.kind} onChange={e => set({ kind: e.target.value as InventoryKind })}>
              <option value="materia_prima">Matéria-prima</option>
              <option value="produto_acabado">Produto acabado</option>
              <option value="insumo">Insumo</option>
            </select>
          </Field>
          <Field label="Nome"><input className={inputCls} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Ex: Arame galvanizado 12" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unidade"><input className={inputCls} value={form.unit} onChange={e => set({ unit: e.target.value })} placeholder="un, kg, m, m²…" /></Field>
            <Field label="Cód. / SKU"><input className={inputCls} value={form.sku} onChange={e => set({ sku: e.target.value })} placeholder="opcional" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Estoque mínimo"><input type="number" min={0} step="any" className={inputCls} value={form.min_qty} onChange={e => set({ min_qty: parseFloat(e.target.value) || 0 })} /></Field>
            <Field label="Custo unitário"><MoneyInput value={form.unit_cost} onChange={v => set({ unit_cost: v })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria"><input className={inputCls} value={form.category} onChange={e => set({ category: e.target.value })} placeholder="opcional" /></Field>
            <Field label="Localização"><input className={inputCls} value={form.location} onChange={e => set({ location: e.target.value })} placeholder="prateleira, setor…" /></Field>
          </div>
          <Field label="Observações"><textarea className={cn(inputCls, "min-h-[64px] resize-y")} value={form.notes} onChange={e => set({ notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => set({ is_active: e.target.checked })} className="w-4 h-4 accent-teal-600" />
            Item ativo
          </label>
        </div>

        {form.kind === "produto_acabado" && (
          <div className="md:border-l md:border-slate-100 md:pl-4">
            {savedId ? (
              <BomEditor productItemId={savedId} materials={allItems.filter(i => i.id !== savedId && i.kind !== "produto_acabado")} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl p-6">
                <FileStack className="w-8 h-8 mb-2 text-slate-300" />
                Salve o produto para montar a ficha técnica (matérias-primas consumidas por unidade).
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Ficha tecnica: linhas material x quantidade por unidade produzida.
function BomEditor({ productItemId, materials }: { productItemId: string; materials: InventoryItem[] }) {
  const { data: bom, add, update, remove } = useProductBom(productItemId);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState<number>(1);

  const available = materials.filter(m => !bom.some(b => b.material_item_id === m.id));

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FileStack className="w-4 h-4 text-teal-600" />
        <h4 className="text-sm font-black text-slate-800">Ficha técnica</h4>
      </div>
      <p className="text-xs text-slate-400 mb-3">Consumo de matéria-prima por 1 unidade produzida. Ao concluir uma OP deste produto, a baixa é automática.</p>

      <div className="space-y-2 mb-3">
        {bom.length === 0 && <p className="text-xs text-slate-400 italic">Sem ficha técnica — a baixa será manual.</p>}
        {bom.map(b => (
          <div key={b.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
            <span className="flex-1 text-sm font-semibold text-slate-700 truncate">{b.material?.name ?? "—"}</span>
            <input
              type="number" min={0} step="any"
              className="w-20 px-2 py-1 text-sm text-right bg-white border border-slate-200 rounded-lg"
              value={b.qty_per_unit}
              onChange={e => update(b.id, parseFloat(e.target.value) || 0)}
            />
            <span className="text-xs text-slate-400 w-8">{b.material?.unit}</span>
            <button onClick={() => remove(b.id)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      {available.length > 0 ? (
        <div className="flex items-center gap-2">
          <select className={cn(inputCls, "flex-1")} value={pick} onChange={e => setPick(e.target.value)}>
            <option value="">Adicionar matéria-prima…</option>
            {available.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input type="number" min={0} step="any" className="w-20 px-2 py-2 text-sm text-right bg-slate-50 border border-slate-200 rounded-xl" value={qty} onChange={e => setQty(parseFloat(e.target.value) || 0)} />
          <Button size="sm" variant="secondary" disabled={!pick || qty <= 0} onClick={async () => { await add(pick, qty); setPick(""); setQty(1); }}>Add</Button>
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic">Cadastre matérias-primas para compor a ficha.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de movimentacao (entrada / saida / ajuste)
// ---------------------------------------------------------------------------
type MovKind = "entrada" | "saida" | "ajuste";

function MovementModal({
  item, onClose, onSubmit,
}: {
  item: InventoryItem;
  onClose: () => void;
  onSubmit: (mov: { item_id: string; type: "entrada" | "saida"; qty: number; unit_cost?: number | null; reason?: string | null; notes?: string | null }) => Promise<void>;
}) {
  const [kind, setKind] = useState<MovKind>("entrada");
  const [qty, setQty] = useState<number>(0);       // entrada/saida: quantidade; ajuste: saldo alvo
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const current = Number(item.current_qty);
  const target = kind === "ajuste" ? qty : null;
  const delta = kind === "ajuste" ? qty - current : (kind === "entrada" ? qty : -qty);
  const resultBalance = current + (kind === "ajuste" ? (qty - current) : (kind === "entrada" ? qty : -qty));
  const invalid = kind === "ajuste" ? qty < 0 || delta === 0 : qty <= 0;

  const submit = async () => {
    if (invalid) return;
    setSaving(true);
    // Ajuste vira entrada/saida pela diferenca ate o saldo alvo, com reason='ajuste'.
    const moveType: "entrada" | "saida" = kind === "ajuste" ? (delta >= 0 ? "entrada" : "saida") : (kind === "entrada" ? "entrada" : "saida");
    const moveQty = kind === "ajuste" ? Math.abs(delta) : qty;
    await onSubmit({
      item_id: item.id,
      type: moveType,
      qty: moveQty,
      reason: (reason.trim() || (kind === "ajuste" ? "ajuste" : null)),
      notes: notes.trim() || null,
    });
    setSaving(false);
  };

  const kinds: { id: MovKind; label: string; tone: string }[] = [
    { id: "entrada", label: "Entrada", tone: "emerald" },
    { id: "saida", label: "Saída", tone: "rose" },
    { id: "ajuste", label: "Ajuste", tone: "sky" },
  ];

  return (
    <Modal
      title="Movimentar estoque"
      subtitle={`${item.name} · saldo atual ${fmtQty(current)} ${item.unit}`}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={submit} disabled={saving || invalid}>{saving ? "Registrando…" : "Registrar"}</Button>
      </>}
    >
      <div className="flex bg-slate-100 rounded-xl p-1 mb-4">
        {kinds.map(k => (
          <button key={k.id} onClick={() => setKind(k.id)}
            className={cn("flex-1 py-1.5 rounded-lg text-sm font-bold transition-all", kind === k.id ? "bg-white shadow-sm text-slate-900" : "text-slate-500")}>
            {k.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <Field label={kind === "ajuste" ? `Saldo real contado (${item.unit})` : `Quantidade (${item.unit})`}>
          <input type="number" min={0} step="any" className={inputCls} value={qty} onChange={e => setQty(parseFloat(e.target.value) || 0)} autoFocus />
        </Field>
        <Field label="Motivo">
          <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)}
            placeholder={kind === "entrada" ? "compra, devolução…" : kind === "saida" ? "venda, perda, consumo…" : "contagem de inventário"} />
        </Field>
        <Field label="Observações"><textarea className={cn(inputCls, "min-h-[56px] resize-y")} value={notes} onChange={e => setNotes(e.target.value)} /></Field>

        <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 text-sm">
          <span className="font-semibold text-slate-500">Saldo após</span>
          <span className={cn("font-black tabular-nums", resultBalance < 0 ? "text-rose-600" : "text-slate-900")}>
            {fmtQty(resultBalance)} {item.unit}
            {kind !== "ajuste" && qty > 0 && <span className="text-xs font-medium text-slate-400 ml-1">({delta >= 0 ? "+" : ""}{fmtQty(delta)})</span>}
          </span>
        </div>
        {resultBalance < 0 && <p className="text-xs text-rose-500 font-semibold">Atenção: o saldo ficará negativo.</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Extrato de movimentacoes de um item
// ---------------------------------------------------------------------------
function ExtratoModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { data: movs, loading } = useInventoryMovements(item.id);
  return (
    <Modal title="Extrato de movimentações" subtitle={item.name} onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Carregando…</p>
      ) : movs.length === 0 ? (
        <EmptyState icon={<ScrollText className="w-7 h-7" />} title="Sem movimentações" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400 font-bold">
                <th className="text-left py-2">Data</th>
                <th className="text-left py-2">Tipo</th>
                <th className="text-right py-2">Qtd</th>
                <th className="text-left py-2 pl-4">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movs.map(m => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="py-2 text-slate-500 whitespace-nowrap">{new Date(m.created_at).toLocaleString("pt-BR")}</td>
                  <td className="py-2"><StatusBadge label={m.type === "entrada" ? "Entrada" : "Saída"} tone={m.type === "entrada" ? "emerald" : "rose"} /></td>
                  <td className={cn("py-2 text-right font-bold tabular-nums", m.type === "entrada" ? "text-emerald-600" : "text-rose-600")}>
                    {m.type === "entrada" ? "+" : "−"}{fmtQty(m.qty)} {item.unit}
                  </td>
                  <td className="py-2 pl-4 text-slate-600">{[m.reason, m.notes].filter(Boolean).join(" — ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
