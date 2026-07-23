// _shared/agent/split.ts — quebra a resposta final da IA em "bolhas" para o WhatsApp.
// Porta fiel do no particionaMensagem do n8n:
//   1) mascara dominios (evita quebra em pontos de dominio)
//   2) respeita blocos protegidos [[ ... ]] (nao divide)
//   3) split por sentenca (sem quebrar "Dr." / "Dra.")
//   4) teto de 300 chars por bolha, sem cortar palavra
//   5) **negrito** -> *negrito* (formatacao WhatsApp)

const MAX_LENGTH = 300;

export function splitIntoBubbles(texto: string): string[] {
  if (!texto || typeof texto !== "string") return [];

  // Passo 1: mascarar dominios
  const domainRegex = /\b(?:(?!\d\.\d)(?:[a-zA-Z][\w-]*)\.)+(?:[a-zA-Z]{2,})(?:\.[a-zA-Z]{2,})?\b/g;
  const textoMascarado = texto.replace(domainRegex, (m) => m.replace(/\./g, "_DOT_"));

  // Passo 2: separar blocos [[ ]] do texto normal
  const regexPartes = /\[\[([\s\S]*?)\]\]|([\s\S]+?)(?=\[\[|$)/g;
  const resultados: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regexPartes.exec(textoMascarado)) !== null) {
    if (match[1] !== undefined && match[1] !== null && match[1] !== "") {
      resultados.push(match[1].trim());
    } else if (match[2]) {
      const textoNormal = match[2].trim();
      if (!textoNormal) continue;

      const sentenceSplitRegex = /(?<!Dr\.)(?<!Dra\.)(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÜÇ])/;
      const sentencasRaw = textoNormal.split(sentenceSplitRegex).filter((s) => s.trim().length > 0);

      for (const sRaw of sentencasRaw) {
        const t = sRaw.trim();
        if (t.length <= MAX_LENGTH) {
          resultados.push(t);
        } else {
          let buffer = "";
          for (const p of t.split(" ")) {
            const tentativa = buffer ? `${buffer} ${p}` : p;
            if (tentativa.length > MAX_LENGTH) {
              if (buffer) resultados.push(buffer);
              buffer = p;
            } else {
              buffer = tentativa;
            }
          }
          if (buffer) resultados.push(buffer);
        }
      }
    }
  }

  // Passo 3: limpeza + formatacao WhatsApp
  return resultados
    .map((r) => r.replace(/_DOT_/g, ".").replace(/\*\*(.*?)\*\*/g, "*$1*").trim())
    .filter((r) => r.length > 0);
}
