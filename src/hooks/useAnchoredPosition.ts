import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Posição de um popup ancorado a um elemento, em coordenadas de viewport.
 *
 * Menu `absolute` dentro de um container com `overflow-y-auto` (o corpo de um
 * modal, por exemplo) é recortado. A saída daqui alimenta um elemento `fixed`,
 * que escapa do recorte. Em troca, a posição precisa ser recalculada enquanto
 * o popup está aberto: qualquer scroll de qualquer ancestral move a âncora.
 */

export interface AnchoredPosition {
  top: number;
  left: number;
  width: number;
  /** Altura máxima já limitada ao espaço real: o popup nunca vaza a janela. */
  maxH: number;
}

interface Options {
  /** Teto de altura desejado. O espaço disponível pode reduzi-lo. */
  maxHeight: number;
  /** Abaixo disto vale a pena virar para cima, se couber mais lá. */
  flipBelow?: number;
  /** Distância entre a âncora e o popup. */
  gap?: number;
  /** Largura do popup: "anchor" acompanha a âncora, número fixa em px. */
  width?: number | "anchor";
  /** Borda do popup alinhada à mesma borda da âncora. */
  align?: "left" | "right";
  /** Valores que mudam o tamanho do popup e exigem reposicionar (ex.: nº de itens). */
  deps?: unknown[];
}

/**
 * Parte puramente aritmética, separada do DOM para poder ser exercitada
 * diretamente: o invariante que importa (o popup nunca sai da janela) é fácil
 * de quebrar num ajuste e impossível de ver num type-check.
 */
export function computeAnchoredPosition(
  rect: { top: number; bottom: number; left: number; right: number; width: number },
  viewport: { width: number; height: number },
  { maxHeight, flipBelow = maxHeight, gap = 8, width = "anchor", align = "left" }: Omit<Options, "deps">,
): AnchoredPosition {
  const below = viewport.height - rect.bottom - gap;
  const above = rect.top - gap;
  const flip = below < Math.min(maxHeight, flipBelow) && above > below;
  // Clampa ao espaço do lado escolhido. Um piso fixo aqui faria o popup
  // transbordar a janela justamente quando o espaço é curto.
  const maxH = Math.max(0, Math.min(maxHeight, flip ? above : below));
  const w = width === "anchor" ? rect.width : width;
  // Mantém o popup dentro da janela também na horizontal.
  const rawLeft = align === "right" ? rect.right - w : rect.left;
  const left = Math.max(gap, Math.min(rawLeft, viewport.width - w - gap));
  return {
    top: flip ? rect.top - gap - maxH : rect.bottom + gap,
    left,
    width: w,
    maxH,
  };
}

export function useAnchoredPosition(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  { maxHeight, flipBelow = maxHeight, gap = 8, width = "anchor", align = "left", deps = [] }: Options,
): AnchoredPosition | null {
  const [pos, setPos] = useState<AnchoredPosition | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setPos(computeAnchoredPosition(
      el.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { maxHeight, flipBelow, gap, width, align },
    ));
  }, [anchorRef, maxHeight, flipBelow, gap, width, align]);

  // useLayoutEffect: posiciona antes da pintura, senão o popup aparece um frame
  // no lugar errado (ou não aparece, enquanto pos é null).
  useLayoutEffect(() => {
    if (!open) return;
    place();

    // Agrupa a rajada de eventos de scroll num único recálculo por frame:
    // getBoundingClientRect força reflow síncrono.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    // capture=true para enxergar o scroll de containers internos, que não borbulha.
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place, ...deps]);

  return open ? pos : null;
}

/** Mantém o último valor não-nulo, para o conteúdo sobreviver à animação de saída. */
export function useLatched<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(null);
  if (value !== null && value !== undefined) ref.current = value;
  return ref.current;
}
