import React, { useState } from "react";
import { Boxes, Factory, Wrench } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { InventoryTab } from "./InventoryTab";
import { ProductionOrdersTab } from "./ProductionOrdersTab";
import { MaintenanceTab } from "./MaintenanceTab";

type TabId = "estoque" | "producao" | "manutencao";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "estoque", label: "Estoque", icon: Boxes },
  { id: "producao", label: "Ordens de Produção", icon: Factory },
  { id: "manutencao", label: "Manutenção", icon: Wrench },
];

export function Production() {
  const [tab, setTab] = useState<TabId>(() => (localStorage.getItem("productionTab") as TabId) || "estoque");

  const go = (id: TabId) => { setTab(id); localStorage.setItem("productionTab", id); };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Produção</h1>
        <p className="text-sm text-slate-500 mt-0.5">Controle de estoque, PCP e manutenção da fábrica.</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-all",
                active ? "border-teal-600 text-teal-700" : "border-transparent text-slate-400 hover:text-slate-600",
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "estoque" && <InventoryTab />}
      {tab === "producao" && <ProductionOrdersTab />}
      {tab === "manutencao" && <MaintenanceTab />}
    </div>
  );
}
