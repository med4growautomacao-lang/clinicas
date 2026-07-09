import React from "react";

// Ilustração animada (SVG inline, sem asset externo) que acompanha a métrica escolhida
// no Pódio. Cada métrica tem um "tema": ímã atraindo bolinhas (leads), calendário com
// check (pacientes), troféu (consultas), funil (conversão/agendamento), moedas
// (faturamento), megafone (investimento), gráfico subindo (ROAS), etiqueta (ticket),
// alvo (custos). Fallback = pulso genérico. Cor puxa do accent da métrica.

type AnimType =
  | "magnet" | "calendar" | "trophy" | "funnel" | "coins"
  | "megaphone" | "chartup" | "tag" | "target" | "fade" | "pulse";

const TYPE_BY_METRIC: Record<string, AnimType> = {
  leads: "magnet",
  patients: "calendar",
  sales: "trophy",
  lost: "fade",
  schedulingRate: "funnel",
  conversion: "funnel",
  revenue: "coins",
  investment: "megaphone",
  roas: "chartup",
  ticketMedio: "tag",
  cpl: "target",
  custoAgendamento: "target",
  cpa: "target",
};

const CSS = `
.ma-root { width: 100%; max-width: 200px; }
.ma-svg { width: 100%; height: auto; display: block; overflow: visible; }
.ma-el { transform-box: fill-box; transform-origin: center; }
@keyframes maPull { 0%{transform:translateX(-4px);opacity:0} 15%{opacity:1} 80%{opacity:.95} 100%{transform:translateX(80px);opacity:0} }
@keyframes maDrop { 0%{transform:translateY(-16px);opacity:0} 15%{opacity:1} 82%{opacity:1} 100%{transform:translateY(40px);opacity:0} }
@keyframes maBob  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
@keyframes maSpark{ 0%,100%{opacity:.15;transform:scale(.5)} 50%{opacity:1;transform:scale(1)} }
@keyframes maSwing{ 0%,100%{transform:rotate(-7deg)} 50%{transform:rotate(7deg)} }
@keyframes maDraw { 0%{stroke-dashoffset:var(--len,120);opacity:0} 12%{opacity:1} 60%{stroke-dashoffset:0} 88%{stroke-dashoffset:0;opacity:1} 100%{stroke-dashoffset:0;opacity:0} }
@keyframes maFade { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(22px,-14px);opacity:0} }
@keyframes maPulseRing { 0%{transform:scale(.5);opacity:.6} 100%{transform:scale(1.5);opacity:0} }
@media (prefers-reduced-motion: reduce) {
  .ma-svg * { animation: none !important; }
}
`;

function Magnet({ c }: { c: string }) {
  const balls = [
    { cx: 34, cy: 52, r: 6, d: 0 }, { cx: 16, cy: 54, r: 5, d: 0.7 }, { cx: 52, cy: 46, r: 4, d: 1.3 },
    { cx: 34, cy: 100, r: 6, d: 0.4 }, { cx: 16, cy: 98, r: 5, d: 1.1 }, { cx: 52, cy: 106, r: 4, d: 1.7 },
    { cx: 40, cy: 76, r: 5, d: 0.9 },
  ];
  return (
    <svg viewBox="0 0 210 150" className="ma-svg">
      <g>
        {balls.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1"
            style={{ animation: `maPull 2.4s ${b.d}s cubic-bezier(.5,0,.9,.5) infinite` }} />
        ))}
      </g>
      {/* Ímã em ferradura, abertura à esquerda */}
      <path d="M120 46 A 40 40 0 1 1 120 104" fill="none" stroke={c} strokeWidth="16" strokeLinecap="butt" />
      <rect x="110" y="38" width="18" height="11" rx="2" fill="#e2e8f0" stroke="#cbd5e1" />
      <rect x="110" y="101" width="18" height="11" rx="2" fill="#e2e8f0" stroke="#cbd5e1" />
      {/* Campo magnético pulsando nas pontas */}
      <circle cx="112" cy="44" r="6" fill="none" stroke={c} strokeWidth="2" className="ma-el" style={{ animation: "maPulseRing 1.6s ease-out infinite" }} />
      <circle cx="112" cy="106" r="6" fill="none" stroke={c} strokeWidth="2" className="ma-el" style={{ animation: "maPulseRing 1.6s ease-out .5s infinite" }} />
    </svg>
  );
}

function Calendar({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      <g className="ma-el" style={{ animation: "maBob 3s ease-in-out infinite" }}>
        <rect x="55" y="42" width="90" height="78" rx="10" fill="#fff" stroke={c} strokeWidth="4" />
        <rect x="55" y="42" width="90" height="22" rx="10" fill={c} />
        <rect x="72" y="34" width="6" height="16" rx="3" fill={c} />
        <rect x="122" y="34" width="6" height="16" rx="3" fill={c} />
        <path d="M74 90 l14 15 l26 -32" fill="none" stroke={c} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
          style={{ strokeDasharray: 70, ["--len" as any]: 70, animation: "maDraw 2.4s ease-in-out infinite" }} />
      </g>
    </svg>
  );
}

function Trophy({ c }: { c: string }) {
  const sparks = [{ x: 55, y: 40, d: 0 }, { x: 148, y: 52, d: 0.6 }, { x: 60, y: 96, d: 1.1 }, { x: 150, y: 100, d: 1.6 }];
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      {sparks.map((s, i) => (
        <path key={i} className="ma-el" d={`M${s.x} ${s.y - 7} l2.2 4.8 l4.8 2.2 l-4.8 2.2 l-2.2 4.8 l-2.2 -4.8 l-4.8 -2.2 l4.8 -2.2 z`}
          fill={c} style={{ animation: `maSpark 1.8s ${s.d}s ease-in-out infinite` }} />
      ))}
      <g className="ma-el" style={{ animation: "maBob 3s ease-in-out infinite" }}>
        <path d="M78 44 h44 v14 a22 22 0 0 1 -44 0 z" fill={c} />
        <path d="M78 48 h-12 a10 10 0 0 0 10 14" fill="none" stroke={c} strokeWidth="5" />
        <path d="M122 48 h12 a10 10 0 0 1 -10 14" fill="none" stroke={c} strokeWidth="5" />
        <rect x="94" y="78" width="12" height="14" fill={c} />
        <rect x="82" y="92" width="36" height="9" rx="3" fill={c} />
        <rect x="86" y="101" width="28" height="8" rx="3" fill={c} opacity="0.7" />
      </g>
    </svg>
  );
}

function Funnel({ c }: { c: string }) {
  const drops = [{ x: 82, d: 0 }, { x: 100, d: 0.5 }, { x: 118, d: 1 }, { x: 100, d: 1.6 }];
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      {drops.map((p, i) => (
        <circle key={i} cx={p.x} cy={34} r="5" fill="#cbd5e1"
          style={{ animation: `maDrop 2.2s ${p.d}s ease-in infinite` }} />
      ))}
      <path d="M62 54 h76 l-24 30 v22 h-4 v-22 z" fill="none" stroke={c} strokeWidth="4" strokeLinejoin="round" />
      <path d="M62 54 h76 l-10 12 h-56 z" fill={c} opacity="0.18" />
      {/* gota convertida saindo por baixo */}
      <circle cx="100" cy="118" r="5" fill={c} style={{ animation: "maDrop 2.2s .3s ease-in infinite" }} />
    </svg>
  );
}

function Coins({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      {[{ x: 78, d: 0 }, { x: 100, d: 0.6 }, { x: 122, d: 1.2 }].map((p, i) => (
        <g key={i} style={{ animation: `maDrop 2.4s ${p.d}s ease-in infinite` }}>
          <ellipse cx={p.x} cy={30} rx="12" ry="6" fill={c} />
        </g>
      ))}
      {/* pilha */}
      {[104, 92, 80].map((y, i) => (
        <g key={i}>
          <rect x={70 + i * 3} y={y} width={60 - i * 6} height="12" rx="6" fill={c} opacity={0.55 + i * 0.15} />
          <ellipse cx={100} cy={y} rx={30 - i * 3} ry="6" fill={c} />
        </g>
      ))}
    </svg>
  );
}

function Megaphone({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      <g className="ma-el" style={{ animation: "maBob 3.2s ease-in-out infinite" }}>
        <path d="M60 66 l40 -16 v50 l-40 -16 z" fill={c} />
        <rect x="48" y="66" width="14" height="18" rx="3" fill={c} />
        <path d="M100 50 v50 l14 5 v-60 z" fill={c} opacity="0.75" />
      </g>
      {[0, 0.5, 1].map((d, i) => (
        <circle key={i} cx="120" cy="75" r="10" fill="none" stroke={c} strokeWidth="3" className="ma-el"
          style={{ transformOrigin: "120px 75px", animation: `maPulseRing 1.8s ${d}s ease-out infinite` }} />
      ))}
    </svg>
  );
}

function ChartUp({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      <line x1="52" y1="112" x2="150" y2="112" stroke="#e2e8f0" strokeWidth="3" />
      <line x1="52" y1="112" x2="52" y2="40" stroke="#e2e8f0" strokeWidth="3" />
      <polyline points="58,102 82,86 104,94 128,60 146,48" fill="none" stroke={c} strokeWidth="5"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ strokeDasharray: 150, ["--len" as any]: 150, animation: "maDraw 2.6s ease-in-out infinite" }} />
      <path d="M132 46 l16 0 l0 16" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
        style={{ strokeDasharray: 40, ["--len" as any]: 40, animation: "maDraw 2.6s .3s ease-in-out infinite" }} />
    </svg>
  );
}

function Tag({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      <line x1="100" y1="30" x2="100" y2="48" stroke="#cbd5e1" strokeWidth="3" />
      <g className="ma-el" style={{ transformOrigin: "100px 46px", animation: "maSwing 2.8s ease-in-out infinite" }}>
        <path d="M100 46 l40 40 a10 10 0 0 1 0 14 l-24 24 a10 10 0 0 1 -14 0 l-40 -40 v-28 a10 10 0 0 1 10 -10 z"
          transform="rotate(45 100 92)" fill={c} />
        <circle cx="84" cy="76" r="6" fill="#fff" />
      </g>
    </svg>
  );
}

function Target({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      <circle cx="100" cy="76" r="42" fill="none" stroke={c} strokeWidth="5" opacity="0.85" />
      <circle cx="100" cy="76" r="28" fill="none" stroke={c} strokeWidth="5" opacity="0.55" />
      <circle cx="100" cy="76" r="13" fill={c} />
      {[0, 0.7].map((d, i) => (
        <circle key={i} cx="100" cy="76" r="42" fill="none" stroke={c} strokeWidth="3" className="ma-el"
          style={{ transformOrigin: "100px 76px", animation: `maPulseRing 2s ${d}s ease-out infinite` }} />
      ))}
    </svg>
  );
}

function FadeAway({ c }: { c: string }) {
  const dots = [{ x: 78, y: 70, d: 0 }, { x: 92, y: 84, d: 0.5 }, { x: 100, y: 62, d: 1 }, { x: 110, y: 80, d: 1.5 }];
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      {dots.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="7" fill={c}
          style={{ animation: `maFade 2.4s ${p.d}s ease-out infinite` }} />
      ))}
    </svg>
  );
}

function Pulse({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 200 150" className="ma-svg">
      <circle cx="100" cy="76" r="14" fill={c} />
      {[0, 0.6, 1.2].map((d, i) => (
        <circle key={i} cx="100" cy="76" r="20" fill="none" stroke={c} strokeWidth="3" className="ma-el"
          style={{ transformOrigin: "100px 76px", animation: `maPulseRing 2s ${d}s ease-out infinite` }} />
      ))}
    </svg>
  );
}

export function MetricAnimation({ metricId, accent }: { metricId: string; accent: string }) {
  const type = TYPE_BY_METRIC[metricId] ?? "pulse";
  const map: Record<AnimType, React.FC<{ c: string }>> = {
    magnet: Magnet, calendar: Calendar, trophy: Trophy, funnel: Funnel, coins: Coins,
    megaphone: Megaphone, chartup: ChartUp, tag: Tag, target: Target, fade: FadeAway, pulse: Pulse,
  };
  const Comp = map[type];
  return (
    <div className="ma-root">
      <style>{CSS}</style>
      <Comp c={accent} />
    </div>
  );
}
