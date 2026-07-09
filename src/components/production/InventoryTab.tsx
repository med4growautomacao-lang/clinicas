import React, { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Plus, Package, ArrowDownUp, Pencil, Trash2, ScrollText, Boxes,
  AlertTriangle, Layers, FileStack, Factory, X, ChevronRight, ChevronDown,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../../lib/supabase";
import {
  useInventoryItems, useInventoryMovements, useProductBom, useProducts, useProtocols, useResponsibles, useStockByAltura,
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
  const { data: items, loading, create, update, remove, refetch, lowStock } = useInventoryItems();
  const { register } = useInventoryMovements(null);
  const { byItem: alturaByItem } = useStockByAltura();
  const { data: products } = useProducts();
  const { data: protocols } = useProtocols();

  // Valor unitário do item: produto acabado puxa o preço do catálogo (Dados da Clínica) do
  // produto/protocolo vinculado; demais itens usam o custo unitário cadastrado.
  const productPrice = useMemo(() => new Map(products.map(p => [p.id, Number(p.unit_price)])), [products]);
  const protocolPrice = useMemo(() => new Map(protocols.map(t => [t.id, Number(t.price ?? 0)])), [protocols]);
  const unitValueOf = (it: InventoryItem) =>
    it.product_id ? (productPrice.get(it.product_id) ?? 0)
      : it.protocol_id ? (protocolPrice.get(it.protocol_id) ?? 0)
        : Number(it.unit_cost);
  const totalValue = items.reduce((s, it) => s + Number(it.current_qty) * unitValueOf(it), 0);
  const [expandedAltura, setExpandedAltura] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpandedAltura(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const [kindFilter, setKindFilter] = useState<InventoryKind | "todos">("todos");
  const [itemModal, setItemModal] = useState<{ item: InventoryItem | null } | null>(null);
  const [movItem, setMovItem] = useState<InventoryItem | null>(null);
  const [prodItem, setProdItem] = useState<InventoryItem | null>(null);
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
                  <th className="text-right px-4 py-2.5">Disponível</th>
                  <th className="text-right px-4 py-2.5">Mínimo</th>
                  <th className="text-right px-4 py-2.5">Custo un.</th>
                  <th className="text-right px-4 py-2.5">Valor</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => {
                  // Alerta de reposição vem da view (desconta reservas e soma OP de reposição já
                  // programada); cai na regra antiga se a view não trouxe o campo.
                  const low = it.precisa_reposicao != null
                    ? it.precisa_reposicao
                    : (Number(it.min_qty) > 0 && Number(it.current_qty) <= Number(it.min_qty));
                  const reserved = Number(it.reserved_qty ?? 0);
                  const emProducao = Number(it.reposicao_qty ?? 0);
                  const alturas = it.kind === "produto_acabado" ? (alturaByItem.get(it.id) ?? []) : [];
                  const isOpen = expandedAltura.has(it.id);
                  return (
                    <React.Fragment key={it.id}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50/60 group">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800 flex items-center gap-1.5">
                          {alturas.length > 0 ? (
                            <button onClick={() => toggleExpand(it.id)} className="p-0.5 -ml-1 text-slate-400 hover:text-slate-700 rounded" title={isOpen ? "Ocultar alturas" : "Ver alturas"}>
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          ) : it.kind === "produto_acabado" ? <span className="inline-block w-4" /> : null}
                          {it.name}
                          {low && it.is_active && <StatusBadge label="repor" tone="rose" />}
                          {!it.is_active && <StatusBadge label="inativo" tone="slate" />}
                        </div>
                        {[it.sku, it.category, it.location].filter(Boolean).length > 0 && (
                          <div className={cn("text-xs text-slate-400", it.kind === "produto_acabado" && "pl-5")}>
                            {[it.sku, it.category, it.location].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3"><StatusBadge label={INVENTORY_KIND_LABEL[it.kind]} tone={KIND_TONE[it.kind]} /></td>
                      <td className={cn("px-4 py-3 text-right font-bold tabular-nums", low ? "text-rose-600" : "text-slate-800")}>
                        {it.kind === "produto_acabado" && alturas.length > 0 ? (
                          // Legado: base com subprodutos por altura -> saldo real nas sub-linhas (em branco aqui).
                          null
                        ) : (
                          <>
                            {fmtQty(it.current_qty)} <span className="text-xs font-medium text-slate-400">{it.unit}</span>
                            {low && <AlertTriangle className="inline w-3.5 h-3.5 ml-1 -mt-0.5 text-rose-500" />}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {it.available_qty == null || (it.kind === "produto_acabado" && alturas.length > 0) ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <>
                            <div className={cn("font-bold", low ? "text-rose-600" : "text-slate-800")}>
                              {fmtQty(it.available_qty)} <span className="text-xs font-medium text-slate-400">{it.unit}</span>
                            </div>
                            {(reserved > 0 || emProducao > 0) && (
                              <div className="text-[11px] text-slate-400 leading-tight">
                                {reserved > 0 && <>reservado {fmtQty(reserved)}</>}
                                {reserved > 0 && emProducao > 0 && " · "}
                                {emProducao > 0 && <>em produção {fmtQty(emProducao)}</>}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{Number(it.min_qty) > 0 ? fmtQty(it.min_qty) : "—"}</td>
                      <td className="px-4 py-3 text-right text-slate-500 tabular-nums">{it.kind === "produto_acabado" ? "" : fmtBRL(unitValueOf(it))}</td>
                      <td className="px-4 py-3 text-right text-slate-700 font-semibold tabular-nums">{fmtBRL(Number(it.current_qty) * unitValueOf(it))}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {it.kind === "produto_acabado" && (
                            <IconBtn title="Registrar produção (baixa a matéria-prima)" onClick={() => setProdItem(it)}><Factory className="w-4 h-4" /></IconBtn>
                          )}
                          <IconBtn title="Movimentar" onClick={() => setMovItem(it)}><ArrowDownUp className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Extrato" onClick={() => setExtratoItem(it)}><ScrollText className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Editar" onClick={() => setItemModal({ item: it })}><Pencil className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Excluir" danger onClick={() => setDelItem(it)}><Trash2 className="w-4 h-4" /></IconBtn>
                        </div>
                      </td>
                    </tr>
                    {isOpen && alturas.map(a => (
                      <tr key={`${it.id}-${a.altura}`} className="bg-slate-50/50 border-t border-slate-100/60">
                        <td className="px-4 py-1.5 pl-12">
                          <span className="text-xs font-bold text-slate-500">Altura {fmtQty(a.altura)} m</span>
                        </td>
                        <td className="px-4 py-1.5 text-[11px] text-slate-400">subproduto</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-slate-700 font-semibold">
                          {a.altura > 0 ? fmtQty(a.qty / a.altura) : fmtQty(a.qty)} <span className="text-xs font-medium text-slate-400">metros lineares</span>
                        </td>
                        <td className="px-4 py-1.5"></td>
                        <td className="px-4 py-1.5"></td>
                        <td className="px-4 py-1.5 text-right text-slate-500 tabular-nums text-xs">{fmtBRL(unitValueOf(it) * a.altura)}</td>
                        <td className="px-4 py-1.5 text-right text-slate-500 tabular-nums text-xs">{fmtBRL(a.qty * unitValueOf(it))}</td>
                        <td className="px-4 py-1.5"></td>
                      </tr>
                    ))}
                    </React.Fragment>
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
        {prodItem && (
          <RegisterProductionModal
            key="prod"
            item={prodItem}
            items={items}
            onClose={() => setProdItem(null)}
            onDone={() => { refetch(true); setProdItem(null); }}
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
  const { data: products } = useProducts();
  const { data: protocols } = useProtocols();
  const [form, setForm] = useState({
    kind: (item?.kind ?? "materia_prima") as InventoryKind,
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    category: item?.category ?? "",
    unit: item?.unit ?? "un",
    min_qty: item?.min_qty ?? 0,
    unit_cost: item?.unit_cost ?? 0,
    lote_minimo: item?.lote_minimo ?? 0,
    lead_time_producao: item?.lead_time_producao ?? 0,
    location: item?.location ?? "",
    is_active: item?.is_active ?? true,
    notes: item?.notes ?? "",
    product_id: (item?.product_id ?? null) as string | null,
    protocol_id: (item?.protocol_id ?? null) as string | null,
  });
  // O item pode passar a existir apos salvar (para liberar a ficha tecnica sem fechar).
  const [savedId, setSavedId] = useState<string | null>(item?.id ?? null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  // Vinculo com o catalogo de Dados da Clinica (produtos OU protocolos, exclusivo).
  const linkKey = form.product_id ? `p:${form.product_id}` : form.protocol_id ? `t:${form.protocol_id}` : "";
  const onLink = (val: string) => {
    if (!val) { set({ product_id: null, protocol_id: null }); return; }
    if (val.startsWith("p:")) {
      const p = products.find(x => x.id === val.slice(2));
      if (p) set({ product_id: p.id, protocol_id: null, name: p.name, unit: p.unit || "un" });
    } else {
      const t = protocols.find(x => x.id === val.slice(2));
      if (t) set({ protocol_id: t.id, product_id: null, name: t.name, unit: "serviço" });
    }
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const isFinished = form.kind === "produto_acabado";
    const input: Partial<InventoryItem> = {
      kind: form.kind, name: form.name.trim(), sku: form.sku.trim() || null,
      category: form.category.trim() || null, unit: form.unit.trim() || "un",
      min_qty: Number(form.min_qty) || 0, unit_cost: Number(form.unit_cost) || 0,
      location: form.location.trim() || null, is_active: form.is_active, notes: form.notes.trim() || null,
      // Vinculo com catalogo so faz sentido para produto acabado.
      product_id: isFinished ? form.product_id : null,
      protocol_id: isFinished ? form.protocol_id : null,
      // Parametros de reposicao/planejamento (usados pelo algoritmo na aprovacao do orcamento).
      lote_minimo: isFinished ? (Number(form.lote_minimo) || 0) : null,
      lead_time_producao: isFinished ? (Math.round(Number(form.lead_time_producao)) || 0) : null,
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
          {form.kind === "produto_acabado" && (
            <Field label="Puxar de cadastro (Dados da Clínica)">
              <select className={inputCls} value={linkKey} onChange={e => onLink(e.target.value)}>
                <option value="">Avulso (sem vínculo)</option>
                {products.filter(p => p.is_active || p.id === form.product_id).length > 0 && (
                  <optgroup label="Produtos">
                    {products.filter(p => p.is_active || p.id === form.product_id).map(p => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
                  </optgroup>
                )}
                {protocols.filter(t => t.is_active || t.id === form.protocol_id).length > 0 && (
                  <optgroup label="Protocolos">
                    {protocols.filter(t => t.is_active || t.id === form.protocol_id).map(t => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}
                  </optgroup>
                )}
              </select>
              {linkKey && <p className="text-[11px] font-semibold text-emerald-600 mt-1">Vinculado ao catálogo — nome e unidade puxados. As OPs geradas do orçamento caem neste item.</p>}
            </Field>
          )}
          <Field label="Nome"><input className={inputCls} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Ex: Arame galvanizado 12" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unidade"><input className={inputCls} value={form.unit} onChange={e => set({ unit: e.target.value })} placeholder="un, kg, m, m²…" /></Field>
            <Field label="Cód. / SKU"><input className={inputCls} value={form.sku} onChange={e => set({ sku: e.target.value })} placeholder="opcional" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Estoque mínimo"><input type="number" min={0} step="any" className={inputCls} value={form.min_qty || ""} onChange={e => set({ min_qty: parseFloat(e.target.value) || 0 })} /></Field>
            <Field label="Custo unitário"><MoneyInput value={form.unit_cost} onChange={v => set({ unit_cost: v })} /></Field>
          </div>
          {form.kind === "produto_acabado" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lote mínimo de produção">
                <input type="number" min={0} step="any" className={inputCls} value={form.lote_minimo || ""} onChange={e => set({ lote_minimo: parseFloat(e.target.value) || 0 })} placeholder="0 = sem lote" />
              </Field>
              <Field label="Lead-time de produção (dias)">
                <input type="number" min={0} step="1" className={inputCls} value={form.lead_time_producao || ""} onChange={e => set({ lead_time_producao: parseInt(e.target.value) || 0 })} />
              </Field>
            </div>
          )}
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
              <BomEditor productItemId={savedId} productUnit={form.unit} materials={allItems.filter(i => i.id !== savedId && i.kind !== "produto_acabado")} />
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
// Para telas (produto em m²), o qty_per_unit e o kg/m² (media da fabrica): a media kg/m²
// x preco/kg da materia-prima da o custo de material por m².
function BomEditor({ productItemId, productUnit, materials }: { productItemId: string; productUnit: string; materials: InventoryItem[] }) {
  const { data: bom, add, update, remove } = useProductBom(productItemId);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState<number>(1);
  const unit = productUnit || "un";

  const available = materials.filter(m => !bom.some(b => b.material_item_id === m.id));
  const matById = useMemo(() => new Map(materials.map(m => [m.id, m])), [materials]);
  // Custo de material por unidade de produto = Σ (kg/unidade × preço/kg).
  const costPerUnit = bom.reduce((s, b) => s + Number(b.qty_per_unit) * Number(matById.get(b.material_item_id)?.unit_cost ?? 0), 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <FileStack className="w-4 h-4 text-teal-600" />
        <h4 className="text-sm font-black text-slate-800">Ficha técnica</h4>
      </div>
      <p className="text-xs text-slate-400 mb-3">Consumo de matéria-prima por <b className="text-slate-500">1 {unit}</b> produzido. Ex.: tela em m² → informe o <b className="text-slate-500">kg/{unit}</b> do arame. Concluir a OP baixa o estoque automaticamente.</p>

      <div className="space-y-2 mb-3">
        {bom.length === 0 && <p className="text-xs text-slate-400 italic">Sem ficha técnica — a baixa será manual.</p>}
        {bom.map(b => (
          <div key={b.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
            <span className="flex-1 text-sm font-semibold text-slate-700 truncate">{b.material?.name ?? "—"}</span>
            <input
              type="number" min={0} step="any"
              className="w-20 px-2 py-1 text-sm text-right bg-white border border-slate-200 rounded-lg"
              value={b.qty_per_unit || ""}
              onChange={e => update(b.id, parseFloat(e.target.value) || 0)}
            />
            <span className="text-xs text-slate-400 whitespace-nowrap w-14">{b.material?.unit ?? ""}/{unit}</span>
            <button onClick={() => remove(b.id)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      {available.length > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <select className={cn(inputCls, "flex-1")} value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">Adicionar matéria-prima…</option>
              {available.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input type="number" min={0} step="any" title={`Quantidade por ${unit}`} className="w-20 px-2 py-2 text-sm text-right bg-slate-50 border border-slate-200 rounded-xl" value={qty || ""} onChange={e => setQty(parseFloat(e.target.value) || 0)} />
            <Button size="sm" variant="secondary" disabled={!pick || qty <= 0} onClick={async () => { await add(pick, qty); setPick(""); setQty(1); }}>Add</Button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Quantidade de matéria-prima por <b className="text-slate-500">1 {unit}</b> produzido (ex.: <b className="text-slate-500">kg/{unit}</b>).</p>
        </>
      ) : (
        <p className="text-xs text-slate-400 italic">Cadastre matérias-primas (em kg) para compor a ficha.</p>
      )}

      {costPerUnit > 0 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
          <span className="text-sm font-semibold text-slate-500">Custo de material</span>
          <span className="text-sm font-black text-slate-800">{fmtBRL(costPerUnit)}/{unit}</span>
        </div>
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
  onSubmit: (mov: { item_id: string; type: "entrada" | "saida"; qty: number; unit_cost?: number | null; reason?: string | null; responsavel?: string | null; altura?: number | null; notes?: string | null }) => Promise<void>;
}) {
  const { data: responsibles, add: addResponsible } = useResponsibles();
  const [kind, setKind] = useState<MovKind>("entrada");
  const [qty, setQty] = useState<number>(0);       // entrada/saida: quantidade; ajuste: saldo alvo
  const [reason, setReason] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [addingResp, setAddingResp] = useState(false);
  const [newResp, setNewResp] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const confirmAddResp = async () => {
    const nome = newResp.trim();
    if (!nome) return;
    await addResponsible(nome);
    setResponsavel(nome);
    setNewResp("");
    setAddingResp(false);
  };
  // Telas (m²): permite informar por medidas (comprimento × altura × peças).
  // Telas (m²): sempre por medidas (comprimento × altura × peças). Demais itens: quantidade direta.
  const isArea = /m²|m2/i.test(item.unit);
  const [comp, setComp] = useState<number>(0);
  const [alt, setAlt] = useState<number>(0);
  const [pcs, setPcs] = useState<number>(1);
  const q = isArea ? Number(comp) * Number(alt) * Number(pcs) : Number(qty);
  const efAltura = isArea ? Number(alt) : 0;

  const current = Number(item.current_qty);
  const delta = kind === "ajuste" ? q - current : (kind === "entrada" ? q : -q);
  const resultBalance = current + delta;
  const invalid = kind === "ajuste" ? q < 0 || delta === 0 : q <= 0;

  const submit = async () => {
    if (invalid) return;
    setSaving(true);
    // Ajuste vira entrada/saida pela diferenca ate o saldo alvo, com reason='ajuste'.
    const moveType: "entrada" | "saida" = kind === "ajuste" ? (delta >= 0 ? "entrada" : "saida") : (kind === "entrada" ? "entrada" : "saida");
    const moveQty = kind === "ajuste" ? Math.abs(delta) : q;
    await onSubmit({
      item_id: item.id,
      type: moveType,
      qty: moveQty,
      reason: (reason.trim() || (kind === "ajuste" ? "ajuste" : null)),
      responsavel: responsavel.trim() || null,
      altura: (isArea && efAltura > 0) ? efAltura : null,
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
        {isArea ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Comprimento (m)"><input type="number" min={0} step="any" className={inputCls} value={comp || ""} onChange={e => setComp(parseFloat(e.target.value) || 0)} autoFocus /></Field>
              <Field label="Altura (m)"><input type="number" min={0} step="any" className={inputCls} value={alt || ""} onChange={e => setAlt(parseFloat(e.target.value) || 0)} /></Field>
              <Field label="Peças"><input type="number" min={1} step="1" className={inputCls} value={pcs || ""} onChange={e => setPcs(parseFloat(e.target.value) || 0)} /></Field>
            </div>
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
              <span className="font-semibold text-slate-500">{kind === "ajuste" ? "Saldo real contado" : "Quantidade"}</span>
              <span className="font-black text-slate-900 tabular-nums">{fmtQty(q)} {item.unit}</span>
            </div>
          </>
        ) : (
          <Field label={kind === "ajuste" ? `Saldo real contado (${item.unit})` : `Quantidade (${item.unit})`}>
            <input type="number" min={0} step="any" className={inputCls} value={qty || ""} onChange={e => setQty(parseFloat(e.target.value) || 0)} autoFocus />
          </Field>
        )}
        <Field label="Motivo">
          <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)}
            placeholder={kind === "entrada" ? "compra, devolução…" : kind === "saida" ? "venda, perda, consumo…" : "contagem de inventário"} />
        </Field>
        <Field label="Responsável">
          {addingResp ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus className={cn(inputCls, "flex-1")} value={newResp}
                onChange={e => setNewResp(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmAddResp(); } }}
                placeholder="Nome do responsável"
              />
              <Button size="sm" variant="secondary" disabled={!newResp.trim()} onClick={confirmAddResp}>Salvar</Button>
              <button type="button" onClick={() => { setAddingResp(false); setNewResp(""); }} className="p-2 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select className={cn(inputCls, "flex-1")} value={responsavel} onChange={e => setResponsavel(e.target.value)}>
                <option value="">— Sem responsável —</option>
                {responsibles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
              <Button size="sm" variant="outline" title="Adicionar responsável" onClick={() => { setAddingResp(true); setNewResp(""); }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          )}
        </Field>
        <Field label="Observações"><textarea className={cn(inputCls, "min-h-[56px] resize-y")} value={notes} onChange={e => setNotes(e.target.value)} /></Field>

        <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 text-sm">
          <span className="font-semibold text-slate-500">Saldo após</span>
          <span className={cn("font-black tabular-nums", resultBalance < 0 ? "text-rose-600" : "text-slate-900")}>
            {fmtQty(resultBalance)} {item.unit}
            {kind !== "ajuste" && q > 0 && <span className="text-xs font-medium text-slate-400 ml-1">({delta >= 0 ? "+" : ""}{fmtQty(delta)})</span>}
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

  // Saldo por altura (soma das movimentações com altura, m² e metros lineares).
  const byAltura = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of movs) {
      if (m.altura == null) continue;
      const a = Number(m.altura);
      map.set(a, (map.get(a) ?? 0) + (m.type === "entrada" ? 1 : -1) * Number(m.qty));
    }
    return Array.from(map.entries()).map(([altura, qty]) => ({ altura, qty })).sort((x, y) => x.altura - y.altura);
  }, [movs]);

  return (
    <Modal title="Extrato de movimentações" subtitle={item.name} onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Carregando…</p>
      ) : movs.length === 0 ? (
        <EmptyState icon={<ScrollText className="w-7 h-7" />} title="Sem movimentações" />
      ) : (
        <>
          {byAltura.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Estoque por altura</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {byAltura.map(r => (
                  <div key={r.altura} className={cn("rounded-xl px-3 py-2 border", r.qty < 0 ? "bg-rose-50 border-rose-200" : "bg-slate-50 border-slate-200")}>
                    <div className="text-[11px] font-bold text-slate-400 uppercase">Altura {fmtQty(r.altura)} m</div>
                    <div className={cn("text-lg font-black tabular-nums", r.qty < 0 ? "text-rose-600" : "text-slate-800")}>{r.altura > 0 ? fmtQty(r.qty / r.altura) : fmtQty(r.qty)} <span className="text-sm font-bold text-slate-400">m</span></div>
                    <div className="text-[11px] text-slate-400">{fmtQty(r.qty)} m²</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 font-bold">
                  <th className="text-left py-2">Data</th>
                  <th className="text-left py-2">Tipo</th>
                  <th className="text-right py-2">Qtd</th>
                  <th className="text-right py-2 pl-4">Altura</th>
                  <th className="text-left py-2 pl-4">Motivo</th>
                  <th className="text-left py-2 pl-4">Responsável</th>
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
                    <td className="py-2 pl-4 text-right text-slate-500 tabular-nums">{m.altura != null ? `${fmtQty(m.altura)} m` : "—"}</td>
                    <td className="py-2 pl-4 text-slate-600">{[m.reason, m.notes].filter(Boolean).join(" — ") || "—"}</td>
                    <td className="py-2 pl-4 text-slate-600">{m.responsavel || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Registrar produção de uma tela: entrada do produto acabado (m²) + baixa da
// matéria-prima pela ficha técnica (via RPC register_production). Aceita m² direto
// ou calcula por comprimento × altura × peças.
// ---------------------------------------------------------------------------
function RegisterProductionModal({ item, items, onClose, onDone }: {
  item: InventoryItem;
  items: InventoryItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const showToast = useToast();
  const { data: bom } = useProductBom(item.id);
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const [comp, setComp] = useState<number>(0);
  const [alt, setAlt] = useState<number>(0);
  const [pcs, setPcs] = useState<number>(1);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const produced = Number(comp) * Number(alt) * Number(pcs);
  const efAltura = Number(alt);
  const rows = bom.map(b => {
    const mat = itemById.get(b.material_item_id);
    const need = Number(b.qty_per_unit) * produced;
    const have = Number(mat?.current_qty ?? 0);
    return { id: b.id, name: b.material?.name ?? mat?.name ?? "—", unit: b.material?.unit ?? mat?.unit ?? "", need, have, short: need > have };
  });
  const anyShort = rows.some(r => r.short);

  const submit = async () => {
    if (produced <= 0) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("register_production", {
      p_clinic_id: item.clinic_id,
      p_product_item_id: item.id,
      p_qty: produced,
      p_notes: notes.trim() || null,
      p_altura: efAltura > 0 ? efAltura : null,
    });
    setSaving(false);
    if (error || !(data as any)?.success) { showToast("Erro ao registrar produção.", "error"); return; }
    showToast(`Produção registrada: ${fmtQty(produced)} ${item.unit}. Matéria-prima baixada.`, "success");
    onDone();
  };

  return (
    <Modal
      title="Registrar produção"
      subtitle={item.name}
      onClose={onClose}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={submit} disabled={saving || produced <= 0}>{saving ? "Registrando…" : "Registrar e baixar estoque"}</Button>
      </>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Comprimento (m)"><input type="number" min={0} step="any" className={inputCls} value={comp || ""} onChange={e => setComp(parseFloat(e.target.value) || 0)} autoFocus /></Field>
          <Field label="Altura (m)"><input type="number" min={0} step="any" className={inputCls} value={alt || ""} onChange={e => setAlt(parseFloat(e.target.value) || 0)} /></Field>
          <Field label="Peças"><input type="number" min={1} step="1" className={inputCls} value={pcs || ""} onChange={e => setPcs(parseFloat(e.target.value) || 0)} /></Field>
        </div>
        <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
          <span className="font-semibold text-slate-500">Total produzido</span>
          <span className="font-black text-slate-900 tabular-nums">{fmtQty(produced)} {item.unit}</span>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Baixa de matéria-prima</p>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Sem ficha técnica — dá entrada da tela mas não baixa matéria-prima automaticamente.</p>
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
          </div>
        )}
        {anyShort && <p className="text-xs text-rose-500 font-semibold mt-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Matéria-prima insuficiente — o saldo ficará negativo.</p>}
      </div>

      <Field label="Observações" className="mt-4"><input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="opcional (ex.: cliente, nº do pedido)" /></Field>
    </Modal>
  );
}
