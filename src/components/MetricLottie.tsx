import React, { Suspense } from "react";
import { MetricAnimation } from "./MetricAnimation";

// Player Lottie carregado sob demanda (lottie-web só entra no bundle quando há animação).
const LottiePlayer = React.lazy(() => import("lottie-react"));

// metric id -> nome do arquivo em src/assets/lottie/<file>.json
// (custos compartilham "cost"; conversão/agendamento podem compartilhar se quiser).
const FILE_BY_METRIC: Record<string, string> = {
  leads: "leads",
  patients: "patients",
  sales: "sales",
  lost: "lost",
  schedulingRate: "scheduling",
  conversion: "conversion",
  revenue: "revenue",
  investment: "investment",
  roas: "roas",
  ticketMedio: "ticket",
  cpl: "cost",
  custoAgendamento: "cost",
  cpa: "cost",
};

// Todos os JSON da pasta são resolvidos em build-time pelo Vite. Enquanto a pasta
// estiver vazia, o objeto é {} e cai no fallback SVG — nenhum erro de build.
const modules = import.meta.glob("../assets/lottie/*.json", { eager: true, import: "default" }) as Record<string, any>;

function jsonFor(name: string): any | null {
  const entry = Object.entries(modules).find(([path]) => path.endsWith(`/${name}.json`));
  return entry ? entry[1] : null;
}

export function MetricLottie({ metricId, accent }: { metricId: string; accent: string }) {
  const name = FILE_BY_METRIC[metricId];
  const data = name ? jsonFor(name) : null;

  // Sem Lottie disponível p/ essa métrica → ilustração SVG animada on-brand.
  if (!data) return <MetricAnimation metricId={metricId} accent={accent} />;

  return (
    <div className="w-full max-w-[200px]">
      <Suspense fallback={<MetricAnimation metricId={metricId} accent={accent} />}>
        <LottiePlayer animationData={data} loop autoplay />
      </Suspense>
    </div>
  );
}
