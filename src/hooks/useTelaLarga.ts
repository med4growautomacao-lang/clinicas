import { useEffect, useState } from 'react';

/** ⚠️ A MESMA unidade do Tailwind, não o valor em pixels.
 *
 *  O Tailwind 4 define `xl` como **80rem** (`--breakpoint-xl: 80rem`, em tailwindcss/theme.css) e
 *  publica a media query em rem. Escrever `1280px` aqui só coincide enquanto a fonte-base do
 *  navegador for 16px: com fonte aumentada (ajuste de acessibilidade comum em público mais velho)
 *  o CSS troca de layout num tamanho e o JavaScript noutro, e o painel que só existe no modo largo
 *  é montado dentro do layout estreito, ou o layout largo abre com um buraco onde ele deveria estar.
 *  Em rem, os dois leem a mesma régua sempre. */
const CONSULTA_XL = '(min-width: 80rem)';

/** A tela está no modo largo do Tailwind (`xl`)?
 *
 *  Existe para o COMPORTAMENTO acompanhar o layout. Esconder um painel com `hidden xl:flex` tira do
 *  olho, mas o componente continua montado: buscando dados, abrindo inscrição de tempo real e
 *  observando o rolo, tudo para ninguém ver. Com isto ele nem chega a ser criado.
 *
 *  ⚠️ Quem usa precisa aguentar a resposta MUDAR em tempo de execução (encaixar o notebook num
 *  monitor, mudar o zoom, girar o tablet). Montar e desmontar por causa disso é normal aqui, então
 *  o que estiver atrás desta chave tem que suportar ser desligado e religado. */
export function useTelaLarga(): boolean {
  const [larga, setLarga] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(CONSULTA_XL).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(CONSULTA_XL);
    const aoMudar = (e: MediaQueryListEvent) => setLarga(e.matches);
    setLarga(mq.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return larga;
}
