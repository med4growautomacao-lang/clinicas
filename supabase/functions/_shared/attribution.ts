// Mapeamento canônico de atribuição do SITE (clique e formulário) — fonte única.
//
// Antes deste módulo havia TRÊS convenções de UTM em produção, uma por rota:
//   clique (site-tracking):      adset=utm_medium · ad=utm_content · term=utm_term
//   forms n8n (forms_tracking):  adset=utm_content · ad=utm_medium
//   external-forms-ingest:       adset=utm_term · ad=utm_content · term=utm_medium
// O mesmo UTM caía em colunas diferentes conforme o caminho de entrada — qualquer painel que
// agrupe por conjunto/anúncio misturava os eixos. Este módulo é a convenção única; as duas edges
// (site-tracking e external-forms-ingest) importam daqui. O histórico NÃO foi reescrito.
//
// A regra é SOURCE-AWARE porque Google e Meta usam utm_term para coisas diferentes:
//   · Google: utm_term = PALAVRA-CHAVE; utm_medium = rede (cpc/display); utm_content = anúncio.
//   · Meta (parâmetros dinâmicos): utm_term = {{adset.name}}; utm_content = {{ad.name}};
//     utm_medium = POSICIONAMENTO (Instagram_Reels, Facebook_Stories…).
// Uma convenção fixa erraria sempre num dos dois lados.

export interface UtmsBrutos {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
}

export interface AtribuicaoMapeada {
  origem: string | null;      // google_ads | meta_ads | instagram | null (= orgânico)
  adPlatform: string | null;  // instagram | facebook | null (derivado do posicionamento)
  campaign: string | null;
  adset: string | null;
  ad: string | null;
  term: string | null;
}

// utm_source (+ click-ids) -> a ORIGEM do nosso modelo. NULL = orgânico: não inventamos origem
// para "direto"/"referral"/desconhecido. O click-id é prova mais forte que a UTM (a UTM o cliente
// digita; o clid o anunciante emite).
export function mapearOrigem(utmSource: string, gclid: string, fbclid: string): string | null {
  const s = (utmSource ?? '').trim().toLowerCase();
  if (gclid) return 'google_ads';
  if (fbclid) return 'meta_ads';
  if (s === 'google' || s === 'google_ads' || s === 'googleads' || s === 'adwords') return 'google_ads';
  if (s === 'facebook' || s === 'fb' || s === 'meta' || s === 'facebook_ads' || s === 'meta_ads' || s === 'metaads') return 'meta_ads';
  if (s === 'instagram' || s === 'ig') return 'instagram';
  return null;
}

// utm_medium (posicionamento) carrega a PLATAFORMA nos anúncios Meta: "Instagram_Reels" ->
// instagram, "Facebook_Stories" -> facebook. Encaixa no enum leads.ad_platform que o CTWA usa.
export function derivarPlataforma(utmMedium: string, utmSource: string): string | null {
  const m = (utmMedium ?? '').toLowerCase();
  const s = (utmSource ?? '').trim().toLowerCase();
  if (m.includes('instagram') || s === 'instagram' || s === 'ig') return 'instagram';
  if (m.includes('facebook') || m.includes('messenger') || /(^|_)fb(_|$)/.test(m)) return 'facebook';
  return null;
}

const limpo = (v: string): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

// A convenção canônica. Os RPCs recebem campaign/adset/ad/term já com o SIGNIFICADO certo e
// roteiam para as colunas g_*/fb_* pela origem — a edge não conhece colunas, só semântica.
export function mapearAtribuicao(utms: UtmsBrutos, gclid: string, fbclid: string): AtribuicaoMapeada {
  const origem = mapearOrigem(utms.utm_source, gclid, fbclid);
  const adPlatform = derivarPlataforma(utms.utm_medium, utms.utm_source);

  if (origem === 'meta_ads' || origem === 'instagram') {
    // Padrão de parâmetros dinâmicos do Meta. O posicionamento (utm_medium) NÃO vira "term":
    // já foi destilado em adPlatform, e o texto cru fica no raw de quem chamou.
    return {
      origem, adPlatform,
      campaign: limpo(utms.utm_campaign),
      adset: limpo(utms.utm_term),
      ad: limpo(utms.utm_content),
      term: null,
    };
  }

  // Google — e também o genérico (orgânico/newsletter/etc.), onde os rótulos do Google são a
  // leitura mais neutra: medium=rede, content=anúncio, term=palavra-chave.
  return {
    origem, adPlatform,
    campaign: limpo(utms.utm_campaign),
    adset: limpo(utms.utm_medium),
    ad: limpo(utms.utm_content),
    term: limpo(utms.utm_term),
  };
}
