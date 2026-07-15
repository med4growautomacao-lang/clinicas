
// ==========================================
// 1. BLINDAGEM DO GCLID
// ==========================================
const urlParamsGlobal = new URLSearchParams(window.location.search);
['gclid','fbclid','wbraid','gbraid'].forEach(function(p){
    if(urlParamsGlobal.has(p)) {
        localStorage.setItem('meu_' + p + '_salvo', urlParamsGlobal.get(p));
    }
});

// ==========================================
// 2. MOTOR DE RASTREAMENTO (INTACTO)
// ==========================================
/* rastracking_nod v4.7.5.2 | Comunidade Nova Ordem do Digital */
console.log(
  "%crastracking_nod v4.7.5.2 | Comunidade Nova Ordem do Digital",
  "color:#00ffcc;font-size:18px;font-weight:bold"
);

(function () {
  const rastracking_nod = {
    version: "4.7.5.2",
    cookieTTL: 63072000, 
    cookieSameSite: "Lax",
    cookieSecure: "auto", 
    visitorIdUrlParamName: "rast_id",
    paidClickParams: [
      "fbclid", "gclid", "msclkid", "ttclid", "tblci", 
      "ob_click_id", "epik", "wbraid", "gbraid", "dclid"
    ],
    propagateAllUrlParams: true,
    iframeMode: "same-origin", 
    iframeAllowedHosts: [window.location.hostname],
    observerMode: "on", 
    observerTimeout: 0, 
    blockedParams: [
      "token", "access_token", "session", "state", "code", "auth",
      "signature", "expires", "jwt", "key", "hash"
    ],
    dynamicScan: {
      enabled: true,
      visibleIntervalMs: 2000,
      hiddenIntervalMs: 15000
    },
    vturb: {
      enabled: true,
      preserveExistingSrcInVturbCtas: true,
      preserveExistingSckInVturbCtas: false
    },
    formTracking: {
      enabled: true,
      autoDetect: true,
      mode: "generic", 
      createHiddenFields: true,
      autoDisableCreateHidden: true,
      testFieldName: "__rastracking_nod_test_field",
      writeModes: { primary: true, shadow: true },
      shadowPrefix: "rastracking_",
      respectExistingValues: true,
      extraFields: ["rastracking_visitor_id", "page_url", "page_path", "page_title", "page_slug", "pagina_captura", "gclid", "wbraid", "gbraid"],
      pushDataLayerOnSubmit: true,
      dataLayerEventName: "rastracking_form_submit_context",
      redirectDetectedEventName: "rastracking_form_redirect_detected",
      redirectTrackingWindowMs: 15000,
      debug: true
    }
  };

  function logInfo(...args) { if (rastracking_nod.formTracking.debug) console.info("[rastracking_nod]", ...args); }
  function logWarn(...args) { if (rastracking_nod.formTracking.debug) console.warn("[rastracking_nod]", ...args); }

  function setCookie(name, value) {
    const d = new Date(Date.now() + rastracking_nod.cookieTTL * 1000);
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      `expires=${d.toUTCString()}`,
      "path=/"
    ];
    if (rastracking_nod.cookieSameSite) {
      parts.push(`SameSite=${rastracking_nod.cookieSameSite}`);
    }
    const secure =
      rastracking_nod.cookieSecure === "auto"
        ? location.protocol === "https:"
        : !!rastracking_nod.cookieSecure;
    if (secure) parts.push("Secure");
    document.cookie = parts.join(";");
  }
  function getCookie(name) {
    return document.cookie.split("; ").find(c => c.startsWith(name + "="))?.split("=")[1] || null;
  }
  function setLS(k, v) { try { localStorage.setItem(k, v); } catch { } }
  function getLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function getValue(k) { return getCookie(k) || getLS(k); }
  function setSS(k, v) { try { sessionStorage.setItem(k, v); } catch { } }
  function getSS(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function setSessionUtm(key, value) {
    const ssKey = `rastracking_session_${key}`;
    if (value === null || value === undefined) value = "";
    setSS(ssKey, value);
  }
  function getSessionUtm(key) {
    const ssKey = `rastracking_session_${key}`;
    return getSS(ssKey);
  }

  function isHttp(u) { return u.protocol === "http:" || u.protocol === "https:"; }
  function isAllowedIframe(u) {
    return rastracking_nod.iframeMode !== "off" &&
      rastracking_nod.iframeAllowedHosts.includes(u.hostname);
  }
  function isBlockedParam(p) {
    return rastracking_nod.blockedParams.some(b => p.toLowerCase().includes(b));
  }
  function safeDecode(v) {
    if (v === null || v === undefined) return v;
    try { return decodeURIComponent(v); } catch { return v; }
  }
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function safeHostname(urlStr) {
    try { return new URL(urlStr).hostname; } catch { return null; }
  }
  function onBodyReady(fn) {
    if (document.body) { fn(); return; }
    const handler = () => {
      document.removeEventListener("DOMContentLoaded", handler);
      fn();
    };
    document.addEventListener("DOMContentLoaded", handler);
  }
  function buildQueryString(obj) {
    const parts = [];
    Object.entries(obj).forEach(([k, v]) => {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`);
    });
    return parts.join("&");
  }

  let greatPagesCompatInstalled = false;
  function getGreatPagesParams() {
    const out = {};
    try {
      const u = new URL(location.href);
      u.searchParams.forEach((v, k) => {
        if (isBlockedParam(k)) return;
        out[k] = safeDecode(v ?? "");
      });
    } catch { }
    return out;
  }
  function collectForms(root, modal) {
    const forms = [];
    const selector = `${modal ? ".gpc_modal " : ""}form`;
    if (root && root.querySelectorAll) {
      root.querySelectorAll(selector).forEach(f => forms.push(f));
    }
    if (root && root.matches && root.matches(selector)) {
      forms.push(root);
    }
    return forms;
  }
  function applyGreatPagesCompat(modal = false, root = document) {
    const params = getGreatPagesParams();
    const forms = collectForms(root, modal);
    if (!forms.length) return;
    const hasOwn = Object.prototype.hasOwnProperty;
    const queryString = buildQueryString(params);
    forms.forEach(form => {
      form.querySelectorAll(".gpc_campo").forEach(campo => {
        if (!campo.dataset.rastrackingGpTemplate) {
          campo.dataset.rastrackingGpTemplate = campo.value ?? "";
        }
        const template = campo.dataset.rastrackingGpTemplate || "";
        if (template.indexOf("{") === -1 || template.indexOf("}") === -1) return;
        const key = template.replace("{", "").replace("}", "");
        campo.value = hasOwn.call(params, key) ? (params[key] ?? "") : "";
      });
      const botao = form.querySelector(".gpc_botao");
      if (!botao) return;
      const currentLink = (botao.getAttribute("gpc-link") || "").trim();
      if (!currentLink) return;
      if (!botao.dataset.rastrackingGpOriginalLink) {
        botao.dataset.rastrackingGpOriginalLink = currentLink;
      }
      const baseLink = botao.dataset.rastrackingGpOriginalLink || currentLink;
      try {
        const linkNew = new URL(baseLink, location.href);
        Object.entries(params).forEach(([k, v]) => {
          linkNew.searchParams.set(k, v ?? "");
        });
        botao.setAttribute("gpc-link", linkNew.toString());
      } catch {
        if (!queryString) return;
        const concat = baseLink.indexOf("?") !== -1 ? "&" : "?";
        botao.setAttribute("gpc-link", `${baseLink}${concat}${queryString}`);
      }
    });
  }
  function shouldInstallGreatPagesCompat() {
    return !!(
      document.querySelector(".gpc_campo") ||
      document.querySelector(".gpc_botao") ||
      document.querySelector(".link_popup") ||
      document.querySelector(".gpc_modal form")
    );
  }
  function installGreatPagesCompat() {
    if (greatPagesCompatInstalled) return;
    if (!shouldInstallGreatPagesCompat()) return;
    if (!document.body) return;
    greatPagesCompatInstalled = true;
    if (typeof window.CamposUTM !== "function") {
      window.CamposUTM = function (modal) {
        applyGreatPagesCompat(!!modal);
      };
    }
    document.body.addEventListener("click", evt => {
      const target = evt.target;
      const popupTrigger = target && target.closest ? target.closest(".link_popup") : null;
      if (!popupTrigger) return;
      setTimeout(() => applyGreatPagesCompat(true), 200);
    });
    applyGreatPagesCompat(false);
    setTimeout(() => applyGreatPagesCompat(true), 200);
  }

  function generateUUIDv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  let rastracking_visitor_id = getValue("rastracking_visitor_id") || getSS("rastracking_visitor_id");
  let is_first_visit = false;

  if (!rastracking_visitor_id) {
    rastracking_visitor_id = generateUUIDv4();
    setCookie("rastracking_visitor_id", rastracking_visitor_id);
    setLS("rastracking_visitor_id", rastracking_visitor_id);
    setSS("rastracking_visitor_id", rastracking_visitor_id);
    is_first_visit = true;
  } else {
    setSS("rastracking_visitor_id", rastracking_visitor_id);
  }

  const visitorIdUrlParamName = (() => {
    const raw = (rastracking_nod.visitorIdUrlParamName ?? "xcod").toString().trim();
    return raw || "xcod";
  })();

  function isReservedVisitorIdUrlParamName(name) {
    const n = (name || "").toString().trim().toLowerCase();
    if (!n) return true;
    const reserved = new Set([
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "sck", "src", "ras_src"
    ]);
    if (reserved.has(n)) return true;
    return rastracking_nod.paidClickParams.some(p => p.toLowerCase() === n);
  }

  const shouldPropagateVisitorIdUrlParam =
    !!rastracking_visitor_id &&
    !isReservedVisitorIdUrlParamName(visitorIdUrlParamName);

  if (!shouldPropagateVisitorIdUrlParam) {
    logWarn(`visitorIdUrlParamName inválido ou reservado ("${visitorIdUrlParamName}"). Param de visitor ID na URL foi desativado.`);
  }

  function getSearchInfo() {
    if (!document.referrer) return { engine: null, term: null };
    try {
      const u = new URL(document.referrer);
      const h = u.hostname.replace(/^www\./, "").toLowerCase();
      const p = u.searchParams;
      const engines = [
        { n: "google", r: /google\./, q: "q" },
        { n: "bing", r: /bing\.com$/, q: "q" },
        { n: "yahoo", r: /search\.yahoo\.com$/, q: "p" },
        { n: "duckduckgo", r: /duckduckgo\.com$/, q: "q" },
        { n: "yandex", r: /yandex\./, q: "text" },
        { n: "baidu", r: /baidu\.com$/, q: "wd" },
        { n: "ecosia", r: /ecosia\.org$/, q: "q" }
      ];
      const e = engines.find(x => x.r.test(h));
      if (!e) return { engine: null, term: null };
      const raw = p.get(e.q);
      if (!raw) return { engine: null, term: null };
      return {
        engine: e.n,
        term: safeDecode(raw.replace(/\+/g, " ")).trim().slice(0, 120)
      };
    } catch {
      return { engine: null, term: null };
    }
  }

  function validTerm(t) {
    if (!t) return false;
    const x = t.toLowerCase();
    return x.length >= 2 && !["not provided", "not set", "undefined", "null"].includes(x);
  }

  const search = getSearchInfo();
  if (search.engine) { setCookie("cookieSearchEngine", search.engine); setLS("cookieSearchEngine", search.engine); }
  if (validTerm(search.term)) { setCookie("cookieSearchTerm", search.term); setLS("cookieSearchTerm", search.term); }

  function getBaseSource() {
    if (document.referrer) {
      try { return new URL(document.referrer).hostname.replace(/^www\./, ""); } catch { }
    }
    return "direto";
  }

  function getBaseMedium() {
    return document.referrer ? "referral" : "direct";
  }

  const qs = new URLSearchParams(location.search);

  function isPaidClickNow() {
    return rastracking_nod.paidClickParams.some(p => qs.has(p));
  }
  const paidClickNow = isPaidClickNow();

  function computeCurrentAcquisition() {
    const hasAnyUtm = qs.has("utm_source") || qs.has("utm_medium") || qs.has("utm_campaign") || qs.has("utm_content") || qs.has("utm_term");
    const baseSource = getBaseSource(); 
    const baseMedium = getBaseMedium(); 

    if (hasAnyUtm) {
      setSessionUtm("utm_source", qs.get("utm_source") || "");
      setSessionUtm("utm_medium", qs.get("utm_medium") || "");
      setSessionUtm("utm_campaign", qs.get("utm_campaign") || "");
      setSessionUtm("utm_content", qs.get("utm_content") || "");
      setSessionUtm("utm_term", qs.get("utm_term") || "");
      return;
    }

    setSessionUtm("utm_source", baseSource);
    setSessionUtm("utm_medium", baseMedium);
    setSessionUtm("utm_campaign", "");
    setSessionUtm("utm_content", "");

    const st = getValue("cookieSearchTerm");
    setSessionUtm("utm_term", st ? safeDecode(st) : "");
  }

  computeCurrentAcquisition();

  (function persistBaseUtm() {
    const urlUtmSource = qs.get("utm_source");
    const urlUtmMedium = qs.get("utm_medium");
    const urlUtmCampaign = qs.get("utm_campaign");
    const urlUtmContent = qs.get("utm_content");
    const urlUtmTerm = qs.get("utm_term");

    if (urlUtmSource) { setCookie("cookieUtmSource", urlUtmSource); setLS("cookieUtmSource", urlUtmSource); }
    if (urlUtmMedium) { setCookie("cookieUtmMedium", urlUtmMedium); setLS("cookieUtmMedium", urlUtmMedium); }
    if (urlUtmCampaign) { setCookie("cookieUtmCampaign", urlUtmCampaign); setLS("cookieUtmCampaign", urlUtmCampaign); }
    if (urlUtmContent) { setCookie("cookieUtmContent", urlUtmContent); setLS("cookieUtmContent", urlUtmContent); }
    if (urlUtmTerm) { setCookie("cookieUtmTerm", urlUtmTerm); setLS("cookieUtmTerm", urlUtmTerm); }

    if (!getValue("cookieUtmSource")) {
      const baseSource = getBaseSource();
      setCookie("cookieUtmSource", baseSource);
      setLS("cookieUtmSource", baseSource);
    }
    if (!getValue("cookieUtmMedium")) {
      const baseMedium = getBaseMedium();
      setCookie("cookieUtmMedium", baseMedium);
      setLS("cookieUtmMedium", baseMedium);
    }

    const st = getValue("cookieSearchTerm");
    if (st && !getValue("cookieUtmTerm")) {
      setCookie("cookieUtmTerm", safeDecode(st));
      setLS("cookieUtmTerm", safeDecode(st));
    }
  })();

  (function persistPaidUtm() {
    if (!paidClickNow) return;

    const hasAnyUtm = qs.has("utm_source") || qs.has("utm_medium") || qs.has("utm_campaign") || qs.has("utm_content") || qs.has("utm_term");
    if (!hasAnyUtm) { return; }

    const paidSource = qs.get("utm_source") || "";
    const paidMedium = qs.get("utm_medium") || "";
    const paidCampaign = qs.get("utm_campaign") || "";
    const paidContent = qs.get("utm_content") || "";
    const paidTerm = qs.get("utm_term") || "";

    if (paidSource) { setCookie("cookiePaidUtmSource", paidSource); setLS("cookiePaidUtmSource", paidSource); }
    if (paidMedium) { setCookie("cookiePaidUtmMedium", paidMedium); setLS("cookiePaidUtmMedium", paidMedium); }
    if (paidCampaign) { setCookie("cookiePaidUtmCampaign", paidCampaign); setLS("cookiePaidUtmCampaign", paidCampaign); }
    if (paidContent) { setCookie("cookiePaidUtmContent", paidContent); setLS("cookiePaidUtmContent", paidContent); }
    if (paidTerm) { setCookie("cookiePaidUtmTerm", paidTerm); setLS("cookiePaidUtmTerm", paidTerm); }
  })();

  function getUtmValue(key) {
    const v = qs.get(key);
    if (v) return v;
    const ss = getSessionUtm(key);
    if (ss !== null && ss !== undefined && ss !== "") return ss;
    if (key === "utm_source") return getBaseSource();
    if (key === "utm_medium") return getBaseMedium();
    if (key === "utm_term") {
      const st = getValue("cookieSearchTerm");
      if (st) return safeDecode(st);
    }
    return null;
  }

  function buildSck() {
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    const values = keys.map(k => (getUtmValue(k) || "").trim()).filter(Boolean);
    return values.length ? values.join("|") : null;
  }
  function buildSrc() {
    const paid = [
      getValue("cookiePaidUtmSource"),
      getValue("cookiePaidUtmMedium"),
      getValue("cookiePaidUtmCampaign"),
      getValue("cookiePaidUtmContent"),
      getValue("cookiePaidUtmTerm")
    ].map(v => (v ? safeDecode(v) : "").trim()).filter(Boolean);
    return paid.length ? paid.join("|") : null;
  }

  const sckValue = buildSck();
  const srcValue = buildSrc();
  const CONTROLLED = {};

  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(k => {
    const uv = getUtmValue(k);
    if (uv) CONTROLLED[k] = uv;
  });

  if (sckValue) CONTROLLED.sck = sckValue;
  if (srcValue) CONTROLLED.src = srcValue;
  if (shouldPropagateVisitorIdUrlParam) CONTROLLED[visitorIdUrlParamName] = rastracking_visitor_id;

  rastracking_nod.paidClickParams.forEach(p => {
    const v = qs.get(p);
    if (v) CONTROLLED[p] = v;
  });

  [
    "cookieUtmSource", "cookieUtmMedium", "cookieUtmCampaign", "cookieUtmContent", "cookieUtmTerm",
    "cookiePaidUtmSource", "cookiePaidUtmMedium", "cookiePaidUtmCampaign", "cookiePaidUtmContent", "cookiePaidUtmTerm",
    "cookieSearchEngine", "cookieSearchTerm"
  ].forEach(k => {
    const v = getValue(k);
    if (v) CONTROLLED[k] = safeDecode(v);
  });

  const FREE = {};
  if (rastracking_nod.propagateAllUrlParams) {
    qs.forEach((v, k) => { if (!isBlockedParam(k)) FREE[k] = v; });
  }

  const HISTORY_CONTROLLED = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(k => {
    const v = getUtmValue(k);
    if (v && !isBlockedParam(k)) HISTORY_CONTROLLED[k] = v;
  });

  let preservePageSrcForVturb = false;
  try {
    const preserveSrcFlag =
      !!(rastracking_nod.vturb && rastracking_nod.vturb.enabled) &&
      (rastracking_nod.vturb.preserveExistingSrcInVturbCtas || rastracking_nod.vturb.preserveExistingSckInVturbCtas);

    const vturbPresent =
      !!document.querySelector("vturb-smartplayer, vturb-player, vturb-anchor-button") ||
      !!document.querySelector('iframe[src*="scripts.converteai.net"][src*="/embed.html"]') ||
      !!document.querySelector('script[src*="scripts.converteai.net/lib/js/smartplayer-wc/"]');

    preservePageSrcForVturb = preserveSrcFlag && qs.has("src") && vturbPresent;

    if (vturbPresent && srcValue && !isBlockedParam("ras_src")) {
      HISTORY_CONTROLLED.ras_src = srcValue;
    }
  } catch { }

  if (sckValue && !isBlockedParam("sck")) HISTORY_CONTROLLED.sck = sckValue;
  if (srcValue && !isBlockedParam("src") && !preservePageSrcForVturb) HISTORY_CONTROLLED.src = srcValue;
  if (shouldPropagateVisitorIdUrlParam) HISTORY_CONTROLLED[visitorIdUrlParamName] = rastracking_visitor_id;

  rastracking_nod.paidClickParams.forEach(p => {
    if (isBlockedParam(p)) return;
    const v = qs.get(p);
    if (v) HISTORY_CONTROLLED[p] = v;
  });

  function applyCurrentUrlParams() {
    try {
      const current = new URL(location.href);
      let changed = false;

      Object.entries(FREE).forEach(([k, v]) => {
        if (current.searchParams.get(k) !== v) {
          current.searchParams.set(k, v);
          changed = true;
        }
      });

      const dynamic = {};
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(k => {
        const v = getUtmValue(k);
        if (v && !isBlockedParam(k)) dynamic[k] = v;
      });

      if (sckValue && !isBlockedParam("sck")) dynamic.sck = sckValue;
      if (shouldPropagateVisitorIdUrlParam) dynamic[visitorIdUrlParamName] = rastracking_visitor_id;

      let vturbPresentNow = false;
      let preserveVturbSrcNow = false;
      try {
        vturbPresentNow =
          !!document.querySelector("vturb-smartplayer, vturb-player, vturb-anchor-button") ||
          !!document.querySelector('iframe[src*="scripts.converteai.net"][src*="/embed.html"]') ||
          !!document.querySelector('script[src*="scripts.converteai.net/lib/js/smartplayer-wc/"]');

        preserveVturbSrcNow =
          vturbPresentNow &&
          !!(rastracking_nod.vturb && rastracking_nod.vturb.enabled) &&
          (rastracking_nod.vturb.preserveExistingSrcInVturbCtas || rastracking_nod.vturb.preserveExistingSckInVturbCtas) &&
          current.searchParams.has("src");
      } catch { }

      if (srcValue && !isBlockedParam("src") && !preserveVturbSrcNow) dynamic.src = srcValue;
      if (vturbPresentNow && srcValue && !isBlockedParam("ras_src")) dynamic.ras_src = srcValue;

      rastracking_nod.paidClickParams.forEach(p => {
        if (isBlockedParam(p)) return;
        const v = current.searchParams.get(p);
        if (v) dynamic[p] = v;
      });

      Object.entries(dynamic).forEach(([k, v]) => {
        if (current.searchParams.get(k) !== v) {
          current.searchParams.set(k, v);
          changed = true;
        }
      });

      if (changed) {
        const nextUrl = `${current.pathname}${current.search}${current.hash}`;
        const currentUrl = `${location.pathname}${location.search}${location.hash}`;
        if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
      }
    } catch { }
  }

  function updateURL(url, isIframe) {
    const u = new URL(url, location.origin);
    if (!isHttp(u)) return url;
    let changed = false;
    if (!isIframe) {
      Object.entries(FREE).forEach(([k, v]) => {
        if (u.searchParams.get(k) !== v) { u.searchParams.set(k, v); changed = true; }
      });
    }
    Object.entries(CONTROLLED).forEach(([k, v]) => {
      if (u.searchParams.get(k) !== v) { u.searchParams.set(k, v); changed = true; }
    });
    return changed ? u.toString() : url;
  }

  function updateURLWithPreserve(url, isIframe, preserveKeys = []) {
    const u = new URL(url, location.origin);
    if (!isHttp(u)) return url;
    let changed = false;
    if (!isIframe) {
      Object.entries(FREE).forEach(([k, v]) => {
        if (u.searchParams.get(k) !== v) { u.searchParams.set(k, v); changed = true; }
      });
    }
    Object.entries(CONTROLLED).forEach(([k, v]) => {
      if (preserveKeys.includes(k) && u.searchParams.has(k)) return;
      if (u.searchParams.get(k) !== v) { u.searchParams.set(k, v); changed = true; }
    });
    return changed ? u.toString() : url;
  }

  function updateURLForVturb(url) {
    const u = new URL(url, location.origin);
    if (!isHttp(u)) return url;
    let changed = false;
    Object.entries(FREE).forEach(([k, v]) => {
      if (u.searchParams.get(k) !== v) { u.searchParams.set(k, v); changed = true; }
    });
    const preserveVturbSrc =
      !!(rastracking_nod.vturb && (rastracking_nod.vturb.preserveExistingSrcInVturbCtas || rastracking_nod.vturb.preserveExistingSckInVturbCtas));
    Object.entries(CONTROLLED).forEach(([k, v]) => {
      if (preserveVturbSrc && k === "src" && u.searchParams.has("src")) return;
      if (u.searchParams.get(k) !== v) { u.searchParams.set(k, v); changed = true; }
    });
    if (srcValue && !isBlockedParam("ras_src")) {
      if (u.searchParams.get("ras_src") !== srcValue) {
        u.searchParams.set("ras_src", srcValue);
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  }

  function getUpdatedLinkHref(a) {
    const rawHref = (a.getAttribute("href") || "").trim();
    const lower = rawHref.toLowerCase();
    if (rawHref.startsWith("#")) return null;
    if (!rawHref || lower.startsWith("javascript:") || lower.startsWith("mailto:") || lower.startsWith("tel:")) {
      return null;
    }
    try {
      const u = new URL(a.href, location.origin);
      const samePage =
        u.origin === location.origin && u.pathname === location.pathname && u.search === location.search && !!u.hash;
      if (samePage) return null;
      return updateURL(u.toString(), false);
    } catch { return null; }
  }

  function getUpdatedLinkHrefWithPreserve(a, preserveKeys = []) {
    const rawHref = (a.getAttribute("href") || "").trim();
    const lower = rawHref.toLowerCase();
    if (rawHref.startsWith("#")) return null;
    if (!rawHref || lower.startsWith("javascript:") || lower.startsWith("mailto:") || lower.startsWith("tel:")) {
      return null;
    }
    try {
      const u = new URL(a.href, location.origin);
      const samePage =
        u.origin === location.origin && u.pathname === location.pathname && u.search === location.search && !!u.hash;
      if (samePage) return null;
      return updateURLWithPreserve(u.toString(), false, preserveKeys);
    } catch { return null; }
  }

  function getUpdatedLinkHrefForVturb(a) {
    const rawHref = (a.getAttribute("href") || "").trim();
    const lower = rawHref.toLowerCase();
    if (rawHref.startsWith("#")) return null;
    if (!rawHref || lower.startsWith("javascript:") || lower.startsWith("mailto:") || lower.startsWith("tel:")) {
      return null;
    }
    try {
      const u = new URL(a.href, location.origin);
      const samePage =
        u.origin === location.origin && u.pathname === location.pathname && u.search === location.search && !!u.hash;
      if (samePage) return null;
      return updateURLForVturb(u.toString());
    } catch { return null; }
  }

  function closestAnchor(node) {
    let el = node;
    while (el && el !== document && el !== document.documentElement) {
      if (el.tagName && el.tagName.toLowerCase() === "a") return el;
      el = el.parentNode;
    }
    return null;
  }

  function processLinks(root = document) {
    root.querySelectorAll("a").forEach(a => {
      const currentHref = a.href || "";
      if (a.dataset.rastrackingNodHref === currentHref) return;
      const nextHref = getUpdatedLinkHref(a);
      if (nextHref && nextHref !== currentHref) a.href = nextHref;
      a.dataset.rastrackingNodHref = a.href || currentHref;
    });
  }

  function processIframes(root = document) {
    if (rastracking_nod.iframeMode === "off") return;
    root.querySelectorAll("iframe").forEach(f => {
      const src = (f.getAttribute("data-src") || f.src || "").trim();
      if (!src) return;
      if (f.dataset.rastrackingNodSrc === src) return;
      try {
        const u = new URL(src, location.origin);
        if (!isAllowedIframe(u)) {
          f.dataset.rastrackingNodSrc = src;
          return;
        }
        const n = updateURL(u.toString(), true);
        if (n !== src) {
          f.hasAttribute("data-src") ? f.setAttribute("data-src", n) : (f.src = n);
        }
        f.dataset.rastrackingNodSrc = (f.getAttribute("data-src") || f.src || "").trim();
      } catch { }
    });
  }

  const CTA_URL_ATTRS = ["data-href", "data-url", "data-link"];
  function getCtaUrlInfo(el) {
    for (let i = 0; i < CTA_URL_ATTRS.length; i++) {
      const attr = CTA_URL_ATTRS[i];
      const value = (el.getAttribute(attr) || "").trim();
      if (value) return { attr, value };
    }
    return null;
  }

  function processDynamicCtas(root = document) {
    root.querySelectorAll("[data-href],[data-url],[data-link]").forEach(el => {
      const info = getCtaUrlInfo(el);
      if (!info) return;
      const signature = `${info.attr}:${info.value}`;
      if (el.dataset.rastrackingNodCta === signature) return;
      try {
        const u = new URL(info.value, location.origin);
        if (isHttp(u)) {
          const next = updateURL(u.toString(), false);
          if (next !== info.value) el.setAttribute(info.attr, next);
        }
      } catch { }
      const updated = getCtaUrlInfo(el);
      if (updated) el.dataset.rastrackingNodCta = `${updated.attr}:${updated.value}`;
    });
  }

  function closestTrackedCta(node) {
    let el = node;
    while (el && el !== document && el !== document.documentElement) {
      if (el.matches && el.matches("[data-href],[data-url],[data-link]")) return el;
      el = el.parentNode;
    }
    return null;
  }

  function handleGlobalClick(evt) {
    try { processVturbClick(evt); } catch { }
    const a = closestAnchor(evt.target);
    if (a) {
      let preserveSrc = false;
      try {
        preserveSrc =
          !!(rastracking_nod.vturb && (rastracking_nod.vturb.preserveExistingSrcInVturbCtas || rastracking_nod.vturb.preserveExistingSckInVturbCtas)) &&
          !!(a.closest && a.closest("vturb-smartplayer"));
      } catch { }
      const nextHref = preserveSrc ? getUpdatedLinkHrefForVturb(a) : getUpdatedLinkHref(a);
      if (nextHref && nextHref !== a.href) a.href = nextHref;
      return;
    }
    const cta = closestTrackedCta(evt.target);
    if (!cta) return;
    const info = getCtaUrlInfo(cta);
    if (!info) return;
    try {
      const u = new URL(info.value, location.origin);
      if (!isHttp(u)) return;
      const next = updateURL(u.toString(), false);
      if (next !== info.value) cta.setAttribute(info.attr, next);
      cta.dataset.rastrackingNodCta = `${info.attr}:${cta.getAttribute(info.attr) || ""}`;
    } catch { }
  }

  const VTURB_CTA_SELECTOR = "vturb-anchor-button[href]";
  const VTURB_SMARTPLAYER_SELECTOR = "vturb-smartplayer";
  const VTURB_IFRAME_SELECTOR =
    'iframe[src*="scripts.converteai.net"][src*="/embed.html"],iframe[data-src*="scripts.converteai.net"][data-src*="/embed.html"]';

  function vturbEnabled() { return !!(rastracking_nod.vturb && rastracking_nod.vturb.enabled); }

  function findFirstInComposedPath(evt, predicate) {
    if (!evt || typeof evt.composedPath !== "function") return null;
    const path = evt.composedPath() || [];
    for (let i = 0; i < path.length; i++) {
      const n = path[i];
      if (n && n.nodeType === 1 && predicate(n)) return n;
    }
    return null;
  }

  function updateVturbCtaHref(el) {
    if (!el || el.nodeType !== 1) return;
    const raw = (el.getAttribute("href") || "").trim();
    if (!raw) return;
    if (el.dataset.rastrackingNodVturbHref === raw) return;
    try {
      const u = new URL(raw, location.origin);
      if (!isHttp(u)) return;
      const next = updateURLForVturb(u.toString());
      if (next !== raw) el.setAttribute("href", next);
    } catch { }
    el.dataset.rastrackingNodVturbHref = (el.getAttribute("href") || raw).trim();
  }

  function processVturb(root = document) {
    if (!vturbEnabled()) return;
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(VTURB_CTA_SELECTOR).forEach(updateVturbCtaHref);
    root.querySelectorAll(VTURB_IFRAME_SELECTOR).forEach(f => {
      const src = (f.getAttribute("data-src") || f.getAttribute("src") || "").trim();
      if (!src) return;
      if (f.dataset.rastrackingNodVturbEmbedSrc === src) return;
      try {
        const u = new URL(src, location.origin);
        if (!isHttp(u)) {
          f.dataset.rastrackingNodVturbEmbedSrc = src;
          return;
        }
        if (u.searchParams.has("vl")) {
          try {
            const currentHref = location.href;
            if (u.searchParams.get("vl") !== currentHref) u.searchParams.set("vl", currentHref);
          } catch { }
        }
        const next = updateURLForVturb(u.toString());
        if (next !== src) {
          f.hasAttribute("data-src") ? f.setAttribute("data-src", next) : f.setAttribute("src", next);
        }
      } catch { }
      f.dataset.rastrackingNodVturbEmbedSrc = (f.getAttribute("data-src") || f.getAttribute("src") || src).trim();
    });
    root.querySelectorAll(`${VTURB_SMARTPLAYER_SELECTOR} a[href]`).forEach(a => {
      const currentHref = a.href || "";
      if (a.dataset.rastrackingNodHref === currentHref) return;
      const preserveSrc = !!(rastracking_nod.vturb && (rastracking_nod.vturb.preserveExistingSrcInVturbCtas || rastracking_nod.vturb.preserveExistingSckInVturbCtas));
      const nextHref = preserveSrc ? getUpdatedLinkHrefForVturb(a) : getUpdatedLinkHref(a);
      if (nextHref && nextHref !== currentHref) a.href = nextHref;
      a.dataset.rastrackingNodHref = a.href || currentHref;
    });
  }

  function processVturbClick(evt) {
    if (!vturbEnabled()) return;
    const cta = findFirstInComposedPath(evt, (n) => n.matches && n.matches(VTURB_CTA_SELECTOR));
    if (cta) {
      updateVturbCtaHref(cta);
      try {
        const a = cta.querySelector && cta.querySelector("a[href]");
        if (a) {
          const preserveSrc = !!(rastracking_nod.vturb && (rastracking_nod.vturb.preserveExistingSrcInVturbCtas || rastracking_nod.vturb.preserveExistingSckInVturbCtas));
          const nextHref = preserveSrc ? getUpdatedLinkHrefForVturb(a) : getUpdatedLinkHref(a);
          if (nextHref && nextHref !== a.href) a.href = nextHref;
        }
      } catch { }
      return;
    }
    const smart = findFirstInComposedPath(evt, (n) => n.matches && n.matches(VTURB_SMARTPLAYER_SELECTOR));
    if (smart) processVturb(smart);
  }

  const redirectTracker = {
    lastDetectedUrl: null, lastDetectedAt: 0, lastDetectedSource: null, lastReportedKey: "",
    lastSubmit: { at: 0, form_id: null, form_name: null, redirect_target_pre: null }
  };

  function toAbsoluteUrl(url) {
    if (!url) return null;
    try { const u = new URL(url, location.href); return isHttp(u) ? u.toString() : null; } catch { return null; }
  }

  function getFormRedirectTargetPre(form) {
    const action = (form.getAttribute("action") || "").trim();
    if (!action || action === "#") return location.href;
    return toAbsoluteUrl(action) || location.href;
  }

  function getRecentRedirectTargetFinal(maxAgeMs) {
    const age = Date.now() - redirectTracker.lastDetectedAt;
    if (!redirectTracker.lastDetectedUrl || age > maxAgeMs) return null;
    return redirectTracker.lastDetectedUrl;
  }

  function getRedirectFromPayload(payload) {
    if (!payload) return null;
    if (typeof payload === "string") return toAbsoluteUrl(payload);
    if (typeof payload !== "object") return null;
    const keys = ["redirect", "redirect_url", "redirectUrl", "next", "next_url", "nextUrl", "url"];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!Object.prototype.hasOwnProperty.call(payload, k)) continue;
      const candidate = toAbsoluteUrl(payload[k]);
      if (candidate) return candidate;
    }
    return null;
  }

  function pushRedirectDetectedEvent(finalUrl) {
    if (!rastracking_nod.formTracking.pushDataLayerOnSubmit) return;
    if (!finalUrl) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: rastracking_nod.formTracking.redirectDetectedEventName,
      rastracking_visitor_id: rastracking_visitor_id,
      form: { id: redirectTracker.lastSubmit.form_id, name: redirectTracker.lastSubmit.form_name, redirect_target_pre: redirectTracker.lastSubmit.redirect_target_pre, redirect_target_final: finalUrl },
      page: { url: location.href, path: location.pathname, title: document.title },
      rastracking: { version: rastracking_nod.version },
      meta: { timestamp: Date.now(), source: redirectTracker.lastDetectedSource }
    });
  }

  function setDetectedRedirect(finalUrl, source) {
    const normalized = toAbsoluteUrl(finalUrl);
    if (!normalized) return;
    redirectTracker.lastDetectedUrl = normalized;
    redirectTracker.lastDetectedAt = Date.now();
    redirectTracker.lastDetectedSource = source || "unknown";
    const withinSubmitWindow = redirectTracker.lastSubmit.at > 0 && (Date.now() - redirectTracker.lastSubmit.at) <= rastracking_nod.formTracking.redirectTrackingWindowMs;
    if (!withinSubmitWindow) return;
    const key = `${redirectTracker.lastSubmit.at}|${normalized}`;
    if (redirectTracker.lastReportedKey === key) return;
    redirectTracker.lastReportedKey = key;
    pushRedirectDetectedEvent(normalized);
  }

  function installRedirectHooks() {
    if (window.__rastrackingRedirectHooksInstalled) return;
    window.__rastrackingRedirectHooksInstalled = true;
    if (typeof window.fetch === "function") {
      const originalFetch = window.fetch.bind(window);
      window.fetch = function (...args) {
        return originalFetch(...args).then(response => {
          try {
            if (response && response.redirected && response.url) { setDetectedRedirect(response.url, "fetch.redirected"); }
            const contentType = response && response.headers ? (response.headers.get("content-type") || "") : "";
            if (/application\/json/i.test(contentType) && response && response.clone) {
              response.clone().json().then(payload => {
                const candidate = getRedirectFromPayload(payload);
                if (candidate) setDetectedRedirect(candidate, "fetch.json");
              }).catch(() => { });
            }
          } catch { }
          return response;
        });
      };
    }
    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
      const proto = window.XMLHttpRequest.prototype;
      if (!proto.__rastrackingOpenWrapped) {
        const originalOpen = proto.open;
        proto.open = function (method, url) {
          this.__rastrackingRequestUrl = toAbsoluteUrl(url);
          return originalOpen.apply(this, arguments);
        };
        proto.__rastrackingOpenWrapped = true;
      }
      if (!proto.__rastrackingSendWrapped) {
        const originalSend = proto.send;
        proto.send = function () {
          this.addEventListener("loadend", () => {
            try {
              const responseUrl = toAbsoluteUrl(this.responseURL);
              if (responseUrl && responseUrl !== this.__rastrackingRequestUrl) {
                setDetectedRedirect(responseUrl, "xhr.responseURL");
              }
              const contentType = this.getResponseHeader ? (this.getResponseHeader("content-type") || "") : "";
              if (/application\/json/i.test(contentType) && typeof this.responseText === "string") {
                try {
                  const payload = JSON.parse(this.responseText);
                  const candidate = getRedirectFromPayload(payload);
                  if (candidate) setDetectedRedirect(candidate, "xhr.json");
                } catch { }
              }
            } catch { }
          }, { once: true });
          return originalSend.apply(this, arguments);
        };
        proto.__rastrackingSendWrapped = true;
      }
    }
  }

  function detectFormEnvironment() {
    const isElementor = !!window.elementorFrontend || !!document.querySelector(".elementor-form") || !!document.querySelector('[id^="form-field-"]') || !!document.querySelector(".elementor-field");
    const isGreatPages = !!document.querySelector(".gpc_campo") || !!document.querySelector(".gpc_botao") || typeof window.CamposUTM === "function";
    if (isGreatPages) return { platform: "greatpages", mode: "generic", allowCreateHidden: false };
    if (isElementor) return { platform: "elementor", mode: "elementor", allowCreateHidden: true };
    return { platform: "generic", mode: "generic", allowCreateHidden: true };
  }

  function isElementorForm(form) {
    if (!form || form.nodeType !== 1) return false;
    if (form.classList && form.classList.contains("elementor-form")) return true;
    return !!(form.querySelector('[id^="form-field-"]') || form.querySelector('[name^="form_fields["]') || form.querySelector(".elementor-field"));
  }

  function isElementorModeForForm(form) {
    return rastracking_nod.formTracking.mode === "elementor" || isElementorForm(form);
  }

  function ensureElementorHiddenGroup(form, name) {
    const groupClass = `elementor-field-group-${name}`;
    let group = form.querySelector(`.${cssEscape(groupClass)}`);
    if (group) return group;
    group = document.createElement("div");
    group.className = `elementor-field-type-hidden elementor-field-group elementor-column ${groupClass} elementor-col-100`;
    group.style.display = "none";
    const fieldsWrapper = form.querySelector(".elementor-form-fields-wrapper");
    if (!fieldsWrapper) { form.appendChild(group); return group; }
    const submitGroup = fieldsWrapper.querySelector(".elementor-field-type-submit");
    if (submitGroup && submitGroup.parentNode === fieldsWrapper) { fieldsWrapper.insertBefore(group, submitGroup); } 
    else { fieldsWrapper.appendChild(group); }
    return group;
  }

  function ensureHiddenField(form, name) {
    const elementorMode = isElementorModeForForm(form);
    let el = null;
    if (elementorMode) {
      el = form.querySelector(`[id="form-field-${cssEscape(name)}"]`) || form.querySelector(`[name="form_fields[${cssEscape(name)}]"]`) || form.querySelector(`[name="${cssEscape(name)}"]`);
    } else {
      el = form.querySelector(`[name="${cssEscape(name)}"]`);
    }
    if (el) {
      if (elementorMode) {
        el.type = "hidden"; el.name = `form_fields[${name}]`; el.id = `form-field-${name}`;
        if (!/\belementor-field\b/.test(el.className)) { el.className = `${el.className ? `${el.className} ` : ""}elementor-field elementor-size-sm`.trim(); }
        const group = ensureElementorHiddenGroup(form, name);
        if (group && el.parentNode !== group) group.appendChild(el);
      }
      return el;
    }
    if (elementorMode) return null;
    if (!rastracking_nod.formTracking.createHiddenFields) return null;
    el = document.createElement("input");
    el.type = "hidden";
    el.setAttribute("data-rastracking-created", "1");
    if (elementorMode) {
      el.name = `form_fields[${name}]`; el.id = `form-field-${name}`; el.className = "elementor-field elementor-size-sm";
      const group = ensureElementorHiddenGroup(form, name);
      if (group) group.appendChild(el); else form.appendChild(el);
    } else {
      el.name = name; form.appendChild(el);
    }
    return el;
  }

  function shouldWriteField(el) {
    if (!el) return false;
    if (!rastracking_nod.formTracking.respectExistingValues) return true;
    const val = (el.value ?? "").toString().trim();
    return val === "";
  }

  function findElementorField(form, baseName) {
    return (
      form.querySelector(`[id="form-field-${cssEscape(baseName)}"]`) ||
      form.querySelector(`[name="form_fields[${cssEscape(baseName)}]"]`) ||
      form.querySelector(`[id^="form-field-${cssEscape(baseName)}"]`) ||
      form.querySelector(`[name="${cssEscape(baseName)}"]`) ||
      form.querySelector(`[name*="${cssEscape(baseName)}"]`) ||
      form.querySelector(`[id*="${cssEscape(baseName)}"]`)
    );
  }

  function setFieldValue(el, value) {
    if (!el) return;
    if (!shouldWriteField(el)) return;
    el.value = value ?? "";
    try { el.setAttribute("value", value ?? ""); } catch { }
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch { }
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch { }
  }

  function writeFormFields(form) {
    const ft = rastracking_nod.formTracking;
    if (!ft.enabled) return;
    const elementorMode = isElementorModeForForm(form);
    const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    const values = {};
    utmKeys.forEach(k => values[k] = getUtmValue(k));

    const extras = {
      rastracking_visitor_id: rastracking_visitor_id,
      page_url: location.href, page_path: location.pathname, page_title: document.title,
      page_slug: (location.pathname.split("/").filter(Boolean)[0] || ""),
      pagina_captura: (location.pathname.split("/").filter(Boolean)[0] || ""),
      sck: sckValue || "", src: srcValue || "",
      gclid: getUtmValue("gclid") || qs.get("gclid") || "",
      wbraid: getUtmValue("wbraid") || qs.get("wbraid") || "",
      gbraid: getUtmValue("gbraid") || qs.get("gbraid") || ""
    };

    const getField = (name) => {
      if (elementorMode) return findElementorField(form, name);
      return form.querySelector(`[name="${cssEscape(name)}"]`) || form.querySelector(`[id="${cssEscape(name)}"]`);
    };

    if (ft.writeModes.primary) {
      utmKeys.forEach(k => {
        let el = getField(k) || ensureHiddenField(form, k);
        setFieldValue(el, values[k]);
      });
      const sckEl = getField("sck"); const srcEl = getField("src");
      if (sckEl) setFieldValue(sckEl, extras.sck);
      if (srcEl) setFieldValue(srcEl, extras.src);
    }

    if (ft.writeModes.shadow) {
      utmKeys.forEach(k => {
        const shadowName = `${ft.shadowPrefix}${k}`;
        let el = getField(shadowName) || ensureHiddenField(form, shadowName);
        setFieldValue(el, values[k]);
      });
      const shSck = `${ft.shadowPrefix}sck`; const shSrc = `${ft.shadowPrefix}src`;
      let sckShadowEl = getField(shSck) || ensureHiddenField(form, shSck);
      let srcShadowEl = getField(shSrc) || ensureHiddenField(form, shSrc);
      setFieldValue(sckShadowEl, extras.sck); setFieldValue(srcShadowEl, extras.src);
    }

    ft.extraFields.forEach(f => {
      const val = extras[f] ?? "";
      let el = getField(f) || ensureHiddenField(form, f);
      setFieldValue(el, val);
    });

    const paginaCapturaEl = getField("pagina_captura");
    if (paginaCapturaEl) setFieldValue(paginaCapturaEl, extras.pagina_captura);
    const visitorIdParamEl = getField(visitorIdUrlParamName);
    if (visitorIdParamEl) setFieldValue(visitorIdParamEl, rastracking_visitor_id);
  }

  function testCreateHiddenSupport(form) {
    const ft = rastracking_nod.formTracking;
    if (!ft.autoDisableCreateHidden) return;
    if (!ft.createHiddenFields) return;
    if (form.dataset.rastrackingHiddenTested) return;
    form.dataset.rastrackingHiddenTested = "1";
    if (typeof FormData === "undefined") return;

    const testName = ft.testFieldName;
    const testEl = ensureHiddenField(form, testName);
    if (!testEl) return;
    testEl.value = "1";
    try {
      const fd = new FormData(form);
      const accepted = fd.has(testName) || fd.has(`form_fields[${testName}]`);
      if (!accepted) { ft.createHiddenFields = false; logWarn("Builder parece ignorar campos criados via JS. Desligando createHiddenFields automaticamente."); } 
      else { logInfo("Teste de hidden fields OK (FormData aceita campos criados via JS)."); }
    } catch { }
    try { testEl.remove(); } catch { }
  }

  function bindFormSubmit(form) {
    if (form.dataset.rastrackingFormBound) return;
    form.dataset.rastrackingFormBound = "1";
    testCreateHiddenSupport(form);
    writeFormFields(form);
    form.addEventListener("submit", () => {
      testCreateHiddenSupport(form);
      writeFormFields(form);
      const redirectTargetPre = getFormRedirectTargetPre(form);
      const redirectTargetFinal = getRecentRedirectTargetFinal(2000);
      redirectTracker.lastSubmit.at = Date.now();
      redirectTracker.lastSubmit.form_id = form.id || null;
      redirectTracker.lastSubmit.form_name = form.getAttribute("name") || null;
      redirectTracker.lastSubmit.redirect_target_pre = redirectTargetPre;
      redirectTracker.lastReportedKey = "";

      if (rastracking_nod.formTracking.pushDataLayerOnSubmit) {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          event: rastracking_nod.formTracking.dataLayerEventName,
          rastracking_visitor_id: rastracking_visitor_id,
          page: { url: location.href, path: location.pathname, title: document.title, referrer: document.referrer || null, referrer_host: document.referrer ? safeHostname(document.referrer) : null },
          acquisition: { utm_source: getUtmValue("utm_source"), utm_medium: getUtmValue("utm_medium"), utm_campaign: getUtmValue("utm_campaign"), utm_content: getUtmValue("utm_content"), utm_term: getUtmValue("utm_term"), sck: sckValue || null, src: srcValue || null, visitor_id_url_param_name: shouldPropagateVisitorIdUrlParam ? visitorIdUrlParamName : null, visitor_id_url_param_value: shouldPropagateVisitorIdUrlParam ? rastracking_visitor_id : null, search_engine: getValue("cookieSearchEngine") || null, source_type: paidClickNow ? "paid" : (document.referrer ? "referral" : "direct") },
          form: { id: form.id || null, name: form.getAttribute("name") || null, action: form.getAttribute("action") || null, method: (form.getAttribute("method") || "GET").toUpperCase(), redirect_target_pre: redirectTargetPre, redirect_target_final: redirectTargetFinal },
          rastracking: { version: rastracking_nod.version }, meta: { timestamp: Date.now() }
        });
      }
    }, { capture: true });
  }

  function processForms(root = document) {
    const ft = rastracking_nod.formTracking;
    if (!ft.enabled) return;
    root.querySelectorAll("form").forEach(form => bindFormSubmit(form));
    root.querySelectorAll("form input, form select, form textarea").forEach(el => {
      if (el.dataset.rastrackingRebind) return;
      el.dataset.rastrackingRebind = "1";
      el.addEventListener("blur", () => {
        const f = el.closest("form");
        if (f) writeFormFields(f);
      }, { passive: true });
    });
  }

  (function applyAutoDetect() {
    const ft = rastracking_nod.formTracking;
    if (!ft.enabled) return;
    if (!ft.autoDetect) { logInfo("FormTracking autoDetect desligado. Mode:", ft.mode, "createHiddenFields:", ft.createHiddenFields); return; }
    const env = detectFormEnvironment();
    ft.mode = env.mode;
    if (!env.allowCreateHidden) ft.createHiddenFields = false;
    logInfo("FormTracking autoDetect:", env.platform, "| mode:", ft.mode, "| createHiddenFields:", ft.createHiddenFields);
  })();

  installRedirectHooks();
  applyCurrentUrlParams();
  document.addEventListener("click", handleGlobalClick, true);

  function shouldAutoObserve() {
    if (rastracking_nod.observerMode === "on") return true;
    if (rastracking_nod.observerMode === "off") return false;
    return (window.__NEXT_DATA__ || window.__NUXT__ || document.querySelector('[data-reactroot]') || window.angular);
  }

  const shouldObserve = shouldAutoObserve();
  let observerActive = shouldObserve;
  let dynamicScanActive = false;
  let dynamicScanTimer = null;

  function startObserver() {
    if (!shouldObserve) return;
    const observer = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          processLinks(n); processIframes(n); processDynamicCtas(n); processVturb(n); processForms(n);
          installGreatPagesCompat(); applyGreatPagesCompat(false, n); applyGreatPagesCompat(true, n);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    if (rastracking_nod.observerTimeout > 0) { setTimeout(() => observer.disconnect(), rastracking_nod.observerTimeout); }
  }

  function scheduleDynamicScan() {
    if (!rastracking_nod.dynamicScan.enabled) return;
    if (dynamicScanTimer) clearTimeout(dynamicScanTimer);
    const interval = document.hidden ? rastracking_nod.dynamicScan.hiddenIntervalMs : rastracking_nod.dynamicScan.visibleIntervalMs;
    const safeInterval = Math.max(250, Number(interval) || 2000);
    dynamicScanTimer = setTimeout(runDynamicScan, safeInterval);
  }

  function runDynamicScan() {
    if (!rastracking_nod.dynamicScan.enabled) return;
    applyCurrentUrlParams(); processLinks(); processIframes(); processDynamicCtas(); processVturb();
    installGreatPagesCompat(); applyGreatPagesCompat(false); applyGreatPagesCompat(true);
    scheduleDynamicScan();
  }

  function startDynamicScan() {
    if (!rastracking_nod.dynamicScan.enabled) return;
    if (dynamicScanActive) return;
    dynamicScanActive = true;
    runDynamicScan();
    document.addEventListener("visibilitychange", scheduleDynamicScan);
  }

  function initDomFeatures() {
    applyCurrentUrlParams(); processLinks(); processIframes(); processDynamicCtas(); processVturb(); processForms();
    installGreatPagesCompat(); applyGreatPagesCompat(false); applyGreatPagesCompat(true);
    startObserver(); startDynamicScan();
  }

  onBodyReady(initDomFeatures);

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: "rastracking_init",
    rastracking_visitor_id: rastracking_visitor_id,
    session: { is_first_visit: is_first_visit, landing_page: !document.referrer, session_start_ts: Date.now() },
    page: { url: location.href, path: location.pathname, title: document.title, referrer: document.referrer || null, referrer_host: document.referrer ? safeHostname(document.referrer) : null },
    acquisition: { utm_source: getUtmValue("utm_source"), utm_medium: getUtmValue("utm_medium"), utm_campaign: getUtmValue("utm_campaign"), utm_content: getUtmValue("utm_content"), utm_term: getUtmValue("utm_term"), sck: sckValue || null, src: srcValue || null, visitor_id_url_param_name: shouldPropagateVisitorIdUrlParam ? visitorIdUrlParamName : null, visitor_id_url_param_value: shouldPropagateVisitorIdUrlParam ? rastracking_visitor_id : null, search_engine: getValue("cookieSearchEngine") || null, source_type: paidClickNow ? "paid" : (document.referrer ? "referral" : "direct") },
    environment: { viewport_width: window.innerWidth, viewport_height: window.innerHeight, screen_width: screen.width, screen_height: screen.height, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    rastracking: { version: rastracking_nod.version, observer_active: observerActive, observer_timeout_ms: rastracking_nod.observerTimeout, iframe_mode: rastracking_nod.iframeMode, paid_click_params: rastracking_nod.paidClickParams.slice(0, 12), dynamic_scan_enabled: rastracking_nod.dynamicScan.enabled, dynamic_scan_active: dynamicScanActive, dynamic_scan_visible_interval_ms: rastracking_nod.dynamicScan.visibleIntervalMs, dynamic_scan_hidden_interval_ms: rastracking_nod.dynamicScan.hiddenIntervalMs, form_tracking_enabled: rastracking_nod.formTracking.enabled, form_tracking_mode: rastracking_nod.formTracking.mode, form_tracking_auto_detect: rastracking_nod.formTracking.autoDetect, form_tracking_create_hidden: rastracking_nod.formTracking.createHiddenFields, form_tracking_shadow_prefix: rastracking_nod.formTracking.shadowPrefix, form_redirect_tracking_window_ms: rastracking_nod.formTracking.redirectTrackingWindowMs, form_redirect_detected_event_name: rastracking_nod.formTracking.redirectDetectedEventName },
    meta: { timestamp: Date.now(), consent: "unknown" }
  });

})();

// ==========================================
// 3. GATILHO WEBHOOK (MINHACLINICA)
// ==========================================
document.addEventListener("DOMContentLoaded", function() {
    const botoesWhats = document.querySelectorAll('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
    
    // >>> VARIÁVEIS CONFIGURÁVEIS PELO PAINEL SAAS <<<
    const msgPadrao = "Olá! Gostaria de mais informações.";
    const numeroWhatsFixo = "551796486338";

    botoesWhats.forEach(botao => {
        botao.addEventListener("click", async function(event) {
            event.preventDefault(); 
            
            const urlBotao = new URL(botao.href);
            const numeroWhats = numeroWhatsFixo !== "SEUNUMERO" ? numeroWhatsFixo : (urlBotao.pathname.replace('/', '') || urlBotao.searchParams.get("phone"));

            const payload = {
                telefone_destino: numeroWhats,
                clinic_id: "52791f72-7b08-47df-990d-45b7ec332b22",
                utm_source: localStorage.getItem('cookiePaidUtmSource') || localStorage.getItem('cookieUtmSource') || "direto",
                utm_medium: localStorage.getItem('cookiePaidUtmMedium') || localStorage.getItem('cookieUtmMedium') || "",
                utm_campaign: localStorage.getItem('cookiePaidUtmCampaign') || localStorage.getItem('cookieUtmCampaign') || "",
                utm_term: localStorage.getItem('cookiePaidUtmTerm') || localStorage.getItem('cookieUtmTerm') || "",
                utm_content: localStorage.getItem('cookiePaidUtmContent') || localStorage.getItem('cookieUtmContent') || "",
                gclid: localStorage.getItem('meu_gclid_salvo') || urlParamsGlobal.get('gclid') || "",
                fbclid: localStorage.getItem('meu_fbclid_salvo') || urlParamsGlobal.get('fbclid') || "",
                wbraid: localStorage.getItem('meu_wbraid_salvo') || urlParamsGlobal.get('wbraid') || "",
                gbraid: localStorage.getItem('meu_gbraid_salvo') || urlParamsGlobal.get('gbraid') || "",
                rast_id: localStorage.getItem('rastracking_visitor_id') || "",
                pagina: window.location.href,
                src_historico: urlBotao.searchParams.get("src") || ""
            };

            const textoOriginal = botao.innerText;
            if(botao.innerText) botao.innerText = "Gerando protocolo...";

            try {
                const resposta = await fetch('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/site-tracking', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const dados = await resposta.json();
                const protocolo = dados.id_protocolo || "0000"; 

                const mensagemFinal = msgPadrao + " [Protocolo " + protocolo + "]";

                window.location.href = "https://wa.me/" + numeroWhats + "?text=" + encodeURIComponent(mensagemFinal);

            } catch (erro) {
                console.error("Erro no Webhook:", erro);
                window.location.href = "https://wa.me/" + numeroWhats + "?text=" + encodeURIComponent(msgPadrao);
                if(botao.innerText) botao.innerText = textoOriginal;
            }
        });
    });
});
