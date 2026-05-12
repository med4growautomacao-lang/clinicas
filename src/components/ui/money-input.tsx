import React, { useState, useEffect } from "react";
import { cn } from "@/src/lib/utils";

/**
 * Componente de entrada monetária padronizado para o sistema.
 *
 * - Aceita digitação em formato BR: "2.500,50" ou "2500,50" ou "2500.50"
 * - Internamente trabalha com number (BRL em reais, ex: 2500.5)
 * - Exibe sempre formatado em BR ao perder o foco: "R$ 2.500,50"
 * - onChange retorna number (não string) — fonte da verdade
 *
 * Uso:
 *   <MoneyInput value={amount} onChange={setAmount} />
 *   amount é number (ex: 2500.5)
 */

interface MoneyInputProps {
  value: number | null | undefined;
  onChange: (v: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  prefix?: string;
}

function parseBR(input: string): number {
  // Remove tudo que não é dígito, vírgula ou ponto
  const cleaned = input.replace(/[^\d.,]/g, "").trim();
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  // Se tem ambos: ponto = separador de milhar, vírgula = decimal (formato BR padrão)
  // Ex: "2.500,50" → 2500.50
  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // BR: pontos são milhar, vírgula é decimal
      return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    } else {
      // US: vírgulas são milhar, ponto é decimal
      return parseFloat(cleaned.replace(/,/g, ""));
    }
  }

  // Só vírgula → decimal BR (ex: "2500,50")
  if (hasComma) {
    return parseFloat(cleaned.replace(",", "."));
  }

  // Só ponto: ambíguo. Se tem 3 dígitos depois do ponto, provavelmente é separador de milhar
  // Ex: "4.122" pode ser 4,122 (US decimal) OU 4.122 (BR milhar = 4122)
  // Heurística: se tem exatamente 3 dígitos após o último ponto E o número antes é < 1000, é milhar BR
  if (hasDot) {
    const parts = cleaned.split(".");
    const lastPart = parts[parts.length - 1];
    if (lastPart.length === 3 && parts.length === 2 && parts[0].length <= 3) {
      // Provável milhar: "4.122" → 4122
      return parseFloat(cleaned.replace(/\./g, ""));
    }
    return parseFloat(cleaned);
  }

  return parseFloat(cleaned);
}

function formatBR(n: number | null | undefined): string {
  if (n == null || isNaN(n as number)) return "";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n));
}

export function MoneyInput({
  value,
  onChange,
  placeholder = "0,00",
  className,
  disabled,
  autoFocus,
  prefix = "R$",
}: MoneyInputProps) {
  const [text, setText] = useState<string>(value ? formatBR(value) : "");
  const [focused, setFocused] = useState(false);

  // Sincroniza display com value externo (quando reseta o form, por ex)
  useEffect(() => {
    if (!focused) {
      setText(value ? formatBR(value) : "");
    }
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    const num = parseBR(raw);
    onChange(isNaN(num) ? 0 : num);
  };

  const handleBlur = () => {
    setFocused(false);
    if (value && !isNaN(value)) {
      setText(formatBR(value));
    } else {
      setText("");
    }
  };

  const handleFocus = () => {
    setFocused(true);
  };

  return (
    <div className={cn("relative flex items-center", className)}>
      <span className="absolute left-3 text-sm font-bold text-slate-400 pointer-events-none">{prefix}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100/30 focus:bg-white transition-all"
      />
    </div>
  );
}
