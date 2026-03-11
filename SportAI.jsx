import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "comunicazione", label: "Comunicazione & Marketing", icon: "📣", color: "#E8B84B" },
  { id: "regolamento",   label: "Regolamento & Leggi",       icon: "⚖️",  color: "#5B8FA8" },
  { id: "news",          label: "News Sportive",             icon: "📰",  color: "#A8C5A0" },
  { id: "fiscalita",     label: "Fiscalità & Legale",        icon: "💼",  color: "#C9956C" },
  { id: "normative",     label: "Normative",                 icon: "📋",  color: "#9B8EA8" },
];

const SOCIAL_FORMATS = [
  { id: "instagram", label: "Instagram", icon: "📸", color: "#E1306C" },
  { id: "facebook",  label: "Facebook",  icon: "👍", color: "#1877F2" },
  { id: "linkedin",  label: "LinkedIn",  icon: "💼", color: "#0A66C2" },
];

const SCHEDULE_OPTIONS = [
  { id: "manual",  label: "Solo manuale" },
  { id: "daily",   label: "1 al giorno" },
  { id: "2daily",  label: "2 al giorno" },
  { id: "weekly",  label: "3 a settimana" },
];

const PLANS = [
  { id: "base", label: "Base",  price: "€149", articles: 8,  color: "#A8C5A0" },
  { id: "pro",  label: "Pro",   price: "€299", articles: 20, color: "#E8B84B" },
  { id: "full", label: "Full",  price: "€499", articles: 99, color: "#C9956C" },
];

const STATUS = { GENERATING: "generating", PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" };

const STATUS_META = {
  generating: { label: "Generazione...", color: "#E8B84B" },
  pending:    { label: "In attesa",      color: "#5B8FA8" },
  approved:   { label: "Approvato ✓",    color: "#A8C5A0" },
  rejected:   { label: "Rifiutato",      color: "#C97B6C" },
};

// ─── FAKE CLIENTS (demo) ──────────────────────────────────────────────────────
const DEMO_CLIENTS = [
  { id: 1, name: "ASD Olimpia Calcio Roma",    plan: "pro",  sport: "Calcio",    active: true,  wpUrl: "", articlesCount: 0 },
  { id: 2, name: "SSD Nuoto Azzurro Milano",   plan: "full", sport: "Nuoto",     active: true,  wpUrl: "", articlesCount: 0 },
  { id: 3, name: "ASD Basket Eagles Torino",   plan: "base", sport: "Basket",    active: false, wpUrl: "", articlesCount: 0 },
];

let _articleId = 1;
const newId = () => _articleId++;

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function callClaude(messages, system) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
      system,
      messages,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  return res.json();
}

function extractText(data) {
  if (!data?.content) return "";
  return data.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function SportAI() {
  const [tab, setTab] = useState("dashboard");
  const [articles, setArticles] = useState([]);
  const [clients, setClients] = useState(DEMO_CLIENTS);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [log, setLog] = useState([]);
  const [schedule, setSchedule] = useState("manual");
  const [wpConfig, setWpConfig] = useState({ url: "", user: "", password: "" });
  const [wpSaved, setWpSaved] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [activeClientId, setActiveClientId] = useState(null);
  const [genCategory, setGenCategory] = useState("comunicazione");
  const [genTopic, setGenTopic] = useState("");
  const [genSocials, setGenSocials] = useState(["instagram", "facebook", "linkedin"]);
  const [genFor, setGenFor] = useState("mysite"); // "mysite" | clientId
  const logRef = useRef(null);
  const scheduleRef = useRef(null);

  const addLog = useCallback((msg, type = "info") => {
    const ts = new Date().toLocaleTimeString("it-IT");
    setLog(prev => [...prev.slice(-80), { msg, type, ts }]);
    setTimeout(() => logRef.current?.scrollTo(0, 99999), 60);
  }, []);

  // ── Scheduler ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (scheduleRef.current) clearInterval(scheduleRef.current);
    if (schedule === "manual") return;
    const intervals = { daily: 86400000, "2daily": 43200000, weekly: 172800000 };
    const ms = intervals[schedule] || null;
    if (!ms) return;
    addLog(`⏱ Scheduler attivo: ${SCHEDULE_OPTIONS.find(s => s.id === schedule)?.label}`, "highlight");
    scheduleRef.current = setInterval(() => {
      const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
      generateArticle(cat.id, "", ["instagram","facebook","linkedin"], "mysite", true);
    }, ms);
    return () => clearInterval(scheduleRef.current);
  }, [schedule]);

  // ── Generation engine ─────────────────────────────────────────────────────
  const generateArticle = useCallback(async (catId, topic, socials, forTarget, auto = false) => {
    if (generating) return;
    setGenerating(true);

    const cat = CATEGORIES.find(c => c.id === catId);
    const client = forTarget !== "mysite" ? clients.find(c => c.id === Number(forTarget)) : null;
    const topicVariants = {
      comunicazione: [
        "come usare i social media per promuovere una ASD nel 2025",
        "strategie di email marketing per società sportive dilettantistiche",
        "come creare un sito web efficace per una ASD",
        "personal branding per atleti dilettanti italiani",
        "come comunicare gli sponsor sui canali social sportivi",
        "video marketing per associazioni sportive: guida pratica",
      ],
      regolamento: [
        "novità regolamentari CONI 2025 per le ASD",
        "riforma dello sport: cosa cambia per le associazioni dilettantistiche",
        "come affiliarsi a una federazione sportiva in Italia",
        "regole antidoping per società sportive dilettantistiche",
        "tutela dei minori nello sport: obblighi per le ASD",
        "statuto ASD: cosa deve contenere secondo la legge italiana",
      ],
      news: [
        "novità dal mondo dello sport dilettantistico italiano questa settimana",
        "aggiornamenti dalle federazioni sportive nazionali",
        "eventi sportivi dilettantistici in programma in Italia",
        "risultati e classifiche dello sport dilettantistico italiano",
        "nuovi bandi e finanziamenti per le ASD italiane",
        "interviste con dirigenti di società sportive dilettantistiche",
      ],
      fiscalita: [
        "detrazioni fiscali per le spese sportive dei figli nel 2025",
        "regime fiscale agevolato per ASD: guida completa 2025",
        "come gestire i rimborsi spese agli atleti dilettanti",
        "IVA e associazioni sportive dilettantistiche: cosa sapere",
        "donazioni alle ASD: come funziona la deducibilità fiscale",
        "contributi previdenziali per collaboratori sportivi nel 2025",
      ],
      normative: [
        "adempimenti annuali obbligatori per le ASD nel 2025",
        "privacy e GDPR nelle associazioni sportive: guida pratica",
        "sicurezza sui luoghi di allenamento: obblighi di legge",
        "certificato medico sportivo: novità normative 2025",
        "assicurazione obbligatoria per ASD: cosa coprire",
        "registro nazionale delle attività sportive dilettantistiche: come iscriversi",
      ],
    };
    const variants = topicVariants[catId] || [];
    const randomTopic = variants[Math.floor(Math.random() * variants.length)] || "";
    const topicFinal = topic.trim() || randomTopic || `aggiornamenti ${cat.label} per lo sport dilettantistico italiano 2025`;
    const id = newId();

    addLog(`${auto ? "⏱ AUTO" : "🚀 MANUALE"} | Categoria: ${cat.label}${client ? ` | Cliente: ${client.name}` : " | Il tuo sito"}`, "info");

    const placeholder = {
      id, catId, topic: topicFinal, title: "Generazione in corso...",
      content: "", socials: {}, status: STATUS.GENERATING,
      forTarget, clientName: client?.name || "Il tuo sito",
      createdAt: new Date(), auto,
    };
    setArticles(prev => [placeholder, ...prev]);

    try {
      // Article
      addLog("🔍 Ricerca fonti autorevoli online...", "info");
      const articleSystem = `Sei un giornalista sportivo esperto in sport dilettantistico italiano.
Cerca informazioni aggiornate da fonti autorevoli (CONI, FIGC, Gazzetta dello Sport, Ministero dello Sport, Agenzia delle Entrate).

REGOLE FONDAMENTALI:
1. Scrivi un articolo COMPLETO di esattamente 5 sezioni. Non fermarti prima.
2. NON troncare MAI il testo. Ogni sezione deve essere completa.
3. L'ultima sezione deve essere una conclusione che riassume e chiude in modo organico.
4. NON copiare testi: comprendi e rielabora con parole tue.
${client ? "5. L'articolo è per la società sportiva: " + client.name + " (" + client.sport + ")." : "5. L'articolo è per un blog rivolto a operatori sportivi dilettantistici italiani."}

FORMATO OUTPUT OBBLIGATORIO - rispetta ESATTAMENTE questa struttura:
TITOLO DELL'ARTICOLO

<h2>Primo sottotitolo</h2>
<p>Primo paragrafo di almeno 80 parole...</p>

<h2>Secondo sottotitolo</h2>
<p>Secondo paragrafo di almeno 80 parole...</p>

<h2>Terzo sottotitolo</h2>
<p>Terzo paragrafo di almeno 80 parole...</p>

<h2>Quarto sottotitolo</h2>
<p>Quarto paragrafo di almeno 80 parole...</p>

<h2>Conclusione</h2>
<p>Paragrafo conclusivo che riassume i punti chiave e chiude in modo organico...</p>

REGOLE FORMATO:
- Prima riga: SOLO il titolo, testo semplice, senza asterischi, senza #, senza HTML
- Usa <strong> per evidenziare concetti chiave
- Tono professionale ma accessibile
- Cita fonti genericamente ("secondo il CONI", "come prevede la normativa")`;

      const articleData = await callClaude(
        [{ role: "user", content: `Scrivi un articolo su: ${topicFinal}. Categoria: ${cat.label}.` }],
        articleSystem
      );
      const text = extractText(articleData);
      const lines = text.split("\n").filter(l => l.trim());
      const rawTitle = lines[0] || `Articolo: ${topicFinal}`;
      const title = rawTitle
        .replace(/[*#_`~]/g, "")
        .replace(/^(Titolo:|TITOLO:|Title:)/i, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      const rawContent = lines.slice(1).join("\n").trim();
      // Ensure content is properly HTML formatted
      const content = rawContent.includes("<h2>") || rawContent.includes("<p>")
        ? rawContent
        : rawContent.split("\n\n").map((para, i) =>
            i === 0 ? `<p>${para}</p>` :
            para.startsWith("**") ? `<h2>${para.replace(/\*\*/g, "")}</h2>` :
            `<p>${para}</p>`
          ).join("\n");
      addLog(`✅ Articolo generato: "${title.slice(0, 55)}..."`, "success");

      // Featured image via Unsplash
      let featuredImageId = null;
      try {
        addLog("🖼 Ricerca immagine di copertina...", "info");
        const catKeywords = {
          comunicazione: "sport marketing digital",
          regolamento: "sport law regulation",
          news: "sport italy",
          fiscalita: "finance business sport",
          normative: "sport association",
        };
        const keyword = catKeywords[catId] || "sport italy";
        const imgRes = await fetch(`/api/unsplash?query=${encodeURIComponent(keyword)}`);
        if (imgRes.ok) {
          const imgData = await imgRes.json();
          const imageUrl = imgData.url;
          if (imageUrl) {
            // Upload via server-side proxy to avoid CORS and binary issues
            const proxyRes = await fetch("/api/upload-media", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageUrl,
                wpUrl: wpConfig.url,
                wpUser: wpConfig.user,
                wpPassword: wpConfig.password,
              }),
            });
            if (proxyRes.ok) {
              const proxyData = await proxyRes.json();
              featuredImageId = proxyData.id;
              addLog("✅ Immagine di copertina caricata", "success");
            } else {
              const errData = await proxyRes.json().catch(() => ({}));
              addLog("⚠️ Upload immagine fallito: " + (errData.error || proxyRes.status), "info");
            }
          }
        } else {
          addLog("⚠️ Unsplash non disponibile: " + imgRes.status, "info");
        }
      } catch(e) {
        addLog("⚠️ Immagine copertina errore: " + e.message, "info");
      }

      // Social posts
      const socialResults = {};
      for (const sid of socials) {
        const sf = SOCIAL_FORMATS.find(s => s.id === sid);
        addLog(`📱 Creazione post ${sf.label}...`, "info");
        const socialSystem = `Sei un social media manager sportivo italiano esperto.
Crea un post ${sf.label} basato sull'articolo. Usa italiano. Includi hashtag rilevanti.
Instagram: emoji, coinvolgente, max 2200 caratteri, call to action.
Facebook: informativo, max 1000 caratteri.
LinkedIn: professionale, orientato a dirigenti e operatori sportivi, max 700 caratteri.
Rispondi SOLO con il testo del post, niente altro.`;
        const sd = await callClaude(
          [{ role: "user", content: `Crea post ${sf.label}:\nTITOLO: ${title}\nARTICOLO: ${content.slice(0, 800)}` }],
          socialSystem
        );
        socialResults[sid] = extractText(sd);
        addLog(`✅ Post ${sf.label} pronto`, "success");
      }

      setArticles(prev => prev.map(a =>
        a.id === id ? { ...a, title, content, socials: socialResults, featuredImageId, status: STATUS.PENDING } : a
      ));
      addLog(`📋 Articolo #${id} in attesa della tua approvazione`, "highlight");
    } catch (err) {
      addLog(`❌ Errore generazione: ${err.message}`, "error");
      setArticles(prev => prev.filter(a => a.id !== id));
    }
    setGenerating(false);
  }, [generating, clients, addLog]);

  // ── WordPress publish ─────────────────────────────────────────────────────
  const publishToWordPress = useCallback(async (article) => {
    const cfg = wpConfig;
    if (!cfg.url || !cfg.user || !cfg.password) {
      addLog("⚠️ Configura prima le credenziali WordPress nelle Impostazioni", "error");
      return false;
    }
    addLog(`📤 Pubblicazione su WordPress: ${cfg.url}`, "info");
    try {
      const creds = btoa(`${cfg.user}:${cfg.password}`);
      const cat = CATEGORIES.find(c => c.id === article.catId);
      const res = await fetch(`${cfg.url}/wp-json/wp/v2/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${creds}`,
        },
        body: JSON.stringify({
          title: article.title,
          content: article.content,
          status: "publish",
          categories: ({
            comunicazione: [14, 11],
            regolamento:   [13, 12],
            news:          [69, 11],
            fiscalita:     [12, 11],
            normative:     [13, 11],
          }[article.catId] || [11]),
          tags: [],
          excerpt: article.content.replace(/<[^>]+>/g, "").slice(0, 160),
          featured_media: article.featuredImageId || 0,
        }),
      });
      if (res.ok) {
        addLog(`✅ Pubblicato su WordPress con successo!`, "success");
        return true;
      } else {
        const err = await res.json();
        addLog(`❌ WP Error: ${err.message || res.status}`, "error");
        return false;
      }
    } catch (e) {
      addLog(`❌ Connessione WordPress fallita: ${e.message}`, "error");
      return false;
    }
  }, [wpConfig, addLog]);

  const approveArticle = useCallback(async (article) => {
    const published = await publishToWordPress(article);
    setArticles(prev => prev.map(a =>
      a.id === article.id ? { ...a, status: STATUS.APPROVED, publishedToWP: published } : a
    ));
    setSelectedArticle(null);
    addLog(`✅ Articolo #${article.id} approvato${published ? " e pubblicato su WP" : " (WP non configurato)"}`, "success");
    if (article.forTarget !== "mysite") {
      setClients(prev => prev.map(c =>
        c.id === Number(article.forTarget) ? { ...c, articlesCount: (c.articlesCount || 0) + 1 } : c
      ));
    }
  }, [publishToWordPress]);

  const rejectArticle = useCallback((article) => {
    setArticles(prev => prev.map(a => a.id === article.id ? { ...a, status: STATUS.REJECTED } : a));
    setSelectedArticle(null);
    addLog(`✗ Articolo #${article.id} rifiutato`, "error");
  }, []);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const pending   = articles.filter(a => a.status === STATUS.PENDING).length;
  const approved  = articles.filter(a => a.status === STATUS.APPROVED).length;
  const total     = articles.length;
  const activeClients = clients.filter(c => c.active).length;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      <style>{CSS}</style>

      {/* SIDEBAR */}
      <aside style={s.sidebar}>
        <div style={s.brand}>
          <span style={s.brandIcon}>⚡</span>
          <div>
            <div style={s.brandName}>SportAI</div>
            <div style={s.brandSub}>Content Platform</div>
          </div>
        </div>

        <nav style={s.nav}>
          {[
            { id: "dashboard", icon: "◈", label: "Dashboard" },
            { id: "generate",  icon: "✦", label: "Genera" },
            { id: "review",    icon: "◉", label: `Revisione${pending > 0 ? ` (${pending})` : ""}` },
            { id: "clients",   icon: "◎", label: "Clienti" },
            { id: "archive",   icon: "▦", label: "Archivio" },
            { id: "settings",  icon: "◌", label: "Impostazioni" },
            { id: "log",       icon: "▤", label: "Log" },
          ].map(item => (
            <button
              key={item.id}
              style={{ ...s.navItem, ...(tab === item.id ? s.navActive : {}) }}
              onClick={() => setTab(item.id)}
            >
              <span style={s.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "review" && pending > 0 && <span style={s.badge}>{pending}</span>}
            </button>
          ))}
        </nav>

        <div style={s.sidebarFooter}>
          <div style={{ ...s.scheduleChip, color: schedule !== "manual" ? "#E8B84B" : "#666" }}>
            {schedule !== "manual" ? "⏱ Auto ON" : "⏸ Auto OFF"}
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={s.main}>

        {/* ── DASHBOARD ── */}
        {tab === "dashboard" && (
          <div style={s.page}>
            <h1 style={s.pageTitle}>Dashboard</h1>
            <p style={s.pageSub}>Panoramica della piattaforma SportAI</p>

            <div style={s.statsGrid}>
              {[
                { label: "Articoli totali",    value: total,         color: "#E8B84B" },
                { label: "In attesa",          value: pending,       color: "#5B8FA8" },
                { label: "Approvati",          value: approved,      color: "#A8C5A0" },
                { label: "Clienti attivi",     value: activeClients, color: "#C9956C" },
              ].map(stat => (
                <div key={stat.label} style={s.statCard}>
                  <div style={{ ...s.statValue, color: stat.color }}>{stat.value}</div>
                  <div style={s.statLabel}>{stat.label}</div>
                </div>
              ))}
            </div>

            <div style={s.twoColGrid}>
              {/* Recent articles */}
              <div style={s.card}>
                <div style={s.cardTitle}>Ultimi articoli generati</div>
                {articles.length === 0 && <div style={s.empty}>Nessun articolo ancora</div>}
                {articles.slice(0, 6).map(a => (
                  <div key={a.id} style={s.miniRow} onClick={() => { setSelectedArticle(a); setTab("review"); }}>
                    <div style={{ flex: 1 }}>
                      <div style={s.miniTitle}>{a.title === "Generazione in corso..." ? "⏳ " + a.topic.slice(0, 40) + "..." : a.title.slice(0, 48)}</div>
                      <div style={s.miniMeta}>{a.clientName} · {CATEGORIES.find(c=>c.id===a.catId)?.icon}</div>
                    </div>
                    <span style={{ color: STATUS_META[a.status].color, fontSize: 11, fontWeight: 700 }}>
                      {STATUS_META[a.status].label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Clients overview */}
              <div style={s.card}>
                <div style={s.cardTitle}>Clienti</div>
                {clients.map(c => (
                  <div key={c.id} style={s.miniRow}>
                    <div style={{ flex: 1 }}>
                      <div style={s.miniTitle}>{c.name}</div>
                      <div style={s.miniMeta}>{c.sport} · Piano {c.plan.toUpperCase()}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <span style={{ ...s.chip, background: c.active ? "#A8C5A020" : "#44444420", color: c.active ? "#A8C5A0" : "#666" }}>
                        {c.active ? "Attivo" : "Inattivo"}
                      </span>
                      <span style={{ fontSize: 10, color: "#555" }}>{c.articlesCount} art.</span>
                    </div>
                  </div>
                ))}
                <button style={s.addBtn} onClick={() => setTab("clients")}>+ Gestisci clienti</button>
              </div>
            </div>

            {/* Scheduler status */}
            <div style={s.card}>
              <div style={s.cardTitle}>Scheduler automatico</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {SCHEDULE_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    style={{ ...s.scheduleBtn, ...(schedule === opt.id ? s.scheduleBtnActive : {}) }}
                    onClick={() => setSchedule(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p style={{ color: "#555", fontSize: 12, marginTop: 12 }}>
                {schedule === "manual"
                  ? "Lo scheduler è disattivato. Genera articoli manualmente dalla sezione Genera."
                  : `✅ L'AI genererà articoli automaticamente (${SCHEDULE_OPTIONS.find(s=>s.id===schedule)?.label}) e li metterà in attesa della tua approvazione.`}
              </p>
            </div>
          </div>
        )}

        {/* ── GENERA ── */}
        {tab === "generate" && (
          <div style={s.page}>
            <h1 style={s.pageTitle}>Genera Contenuto</h1>
            <p style={s.pageSub}>L'AI cercherà online e creerà articolo + post social</p>

            <div style={s.card}>
              {/* Target */}
              <div style={s.fieldGroup}>
                <label style={s.label}>Genera per</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[{ id: "mysite", name: "Il tuo sito (vetrina)" }, ...clients.filter(c=>c.active)].map(t => (
                    <button
                      key={t.id}
                      style={{ ...s.chip, ...s.chipBtn, ...(genFor === String(t.id) ? s.chipActive : {}) }}
                      onClick={() => setGenFor(String(t.id))}
                    >
                      {t.id === "mysite" ? "🌐 " : "🏟 "}{t.name || t.id}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category */}
              <div style={s.fieldGroup}>
                <label style={s.label}>Categoria</label>
                <div style={s.catGrid}>
                  {CATEGORIES.map(c => (
                    <button
                      key={c.id}
                      style={{
                        ...s.catBtn,
                        borderColor: genCategory === c.id ? c.color : "#2a2a2a",
                        background: genCategory === c.id ? c.color + "18" : "transparent",
                      }}
                      onClick={() => setGenCategory(c.id)}
                    >
                      <span style={{ fontSize: 22 }}>{c.icon}</span>
                      <span style={{ fontSize: 11, color: genCategory === c.id ? c.color : "#666", marginTop: 4, textAlign: "center", lineHeight: 1.3 }}>
                        {c.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Topic */}
              <div style={s.fieldGroup}>
                <label style={s.label}>Argomento specifico <span style={{ color: "#444" }}>(opzionale)</span></label>
                <input
                  style={s.input}
                  placeholder="Es. Nuove regole fiscali ASD 2025 · lascia vuoto per scelta automatica"
                  value={genTopic}
                  onChange={e => setGenTopic(e.target.value)}
                />
              </div>

              {/* Socials */}
              <div style={s.fieldGroup}>
                <label style={s.label}>Social network</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {SOCIAL_FORMATS.map(sf => (
                    <button
                      key={sf.id}
                      style={{
                        ...s.socialBtn,
                        borderColor: genSocials.includes(sf.id) ? sf.color : "#2a2a2a",
                        color: genSocials.includes(sf.id) ? sf.color : "#555",
                        background: genSocials.includes(sf.id) ? sf.color + "15" : "transparent",
                      }}
                      onClick={() => setGenSocials(prev =>
                        prev.includes(sf.id) ? prev.filter(x => x !== sf.id) : [...prev, sf.id]
                      )}
                    >
                      {sf.icon} {sf.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                style={{ ...s.generateBtn, opacity: generating ? 0.5 : 1, cursor: generating ? "not-allowed" : "pointer" }}
                onClick={() => generateArticle(genCategory, genTopic, genSocials, genFor)}
                disabled={generating}
              >
                {generating ? "⏳  Generazione in corso..." : "⚡  Genera Articolo + Post Social"}
              </button>
            </div>
          </div>
        )}

        {/* ── REVISIONE ── */}
        {tab === "review" && (
          <div style={{ ...s.page, display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, height: "100%" }}>
            {/* List */}
            <div style={{ overflowY: "auto" }}>
              <h1 style={s.pageTitle}>Revisione</h1>
              <p style={s.pageSub}>Approva o rifiuta ogni contenuto</p>
              {articles.filter(a => a.status === STATUS.PENDING).length === 0 && (
                <div style={s.empty}>Nessun articolo da revisionare</div>
              )}
              {articles.filter(a => a.status === STATUS.PENDING).map(a => (
                <div
                  key={a.id}
                  style={{
                    ...s.listCard,
                    borderColor: selectedArticle?.id === a.id ? "#E8B84B" : "#1e1e1e",
                  }}
                  onClick={() => setSelectedArticle(a)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: CATEGORIES.find(c=>c.id===a.catId)?.color }}>
                      {CATEGORIES.find(c=>c.id===a.catId)?.icon} {CATEGORIES.find(c=>c.id===a.catId)?.label}
                    </span>
                    {a.auto && <span style={s.autoChip}>AUTO</span>}
                  </div>
                  <div style={s.listCardTitle}>{a.title}</div>
                  <div style={s.listCardMeta}>{a.clientName} · {a.createdAt?.toLocaleTimeString("it-IT")}</div>
                </div>
              ))}
            </div>

            {/* Detail */}
            <div style={{ overflowY: "auto" }}>
              {!selectedArticle
                ? <div style={{ ...s.empty, marginTop: 80 }}>Seleziona un articolo dalla lista</div>
                : <ArticleDetail
                    article={selectedArticle}
                    onApprove={(edited) => approveArticle(edited || selectedArticle)}
                    onReject={() => rejectArticle(selectedArticle)}
                    onEdit={(edited) => { setArticles(prev => prev.map(a => a.id === edited.id ? edited : a)); setSelectedArticle(edited); }}
                    wpConfigured={!!(wpConfig.url && wpConfig.user && wpConfig.password)}
                  />
              }
            </div>
          </div>
        )}

        {/* ── CLIENTS ── */}
        {tab === "clients" && (
          <div style={s.page}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h1 style={s.pageTitle}>Gestione Clienti</h1>
                <p style={s.pageSub}>ASD e SSD che segui con il tuo servizio</p>
              </div>
              <button style={s.generateBtn} onClick={() => setShowClientModal(true)}>+ Nuovo Cliente</button>
            </div>

            <div style={s.clientsGrid}>
              {clients.map(c => {
                const plan = PLANS.find(p => p.id === c.plan);
                return (
                  <div key={c.id} style={s.clientCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                      <span style={{ ...s.planChip, background: plan?.color + "20", color: plan?.color }}>
                        {plan?.label} {plan?.price}/mese
                      </span>
                      <span style={{ ...s.chip, background: c.active ? "#A8C5A020" : "#33333350", color: c.active ? "#A8C5A0" : "#555" }}>
                        {c.active ? "Attivo" : "Inattivo"}
                      </span>
                    </div>
                    <div style={s.clientName}>{c.name}</div>
                    <div style={s.clientSport}>{c.sport}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, paddingTop: 12, borderTop: "1px solid #1e1e1e" }}>
                      <span style={{ color: "#555", fontSize: 12 }}>{c.articlesCount} articoli pubblicati</span>
                      <button
                        style={s.miniBtn}
                        onClick={() => {
                          setGenFor(String(c.id));
                          setTab("generate");
                        }}
                      >
                        Genera →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pricing reference */}
            <div style={s.card}>
              <div style={s.cardTitle}>Piani disponibili</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {PLANS.map(plan => (
                  <div key={plan.id} style={{ ...s.planCard, borderColor: plan.color + "60" }}>
                    <div style={{ color: plan.color, fontWeight: 900, fontSize: 18 }}>{plan.label}</div>
                    <div style={{ color: "#fff", fontSize: 24, fontWeight: 900, margin: "8px 0" }}>{plan.price}<span style={{ fontSize: 13, color: "#555" }}>/mese</span></div>
                    <div style={{ color: "#666", fontSize: 13 }}>{plan.articles === 99 ? "Articoli illimitati" : `${plan.articles} articoli/mese`}</div>
                    <div style={{ color: "#555", fontSize: 12, marginTop: 8 }}>+ Post social inclusi</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ARCHIVE ── */}
        {tab === "archive" && (
          <div style={s.page}>
            <h1 style={s.pageTitle}>Archivio</h1>
            <p style={s.pageSub}>Tutti gli articoli generati ({total} totali)</p>

            {articles.length === 0 && <div style={s.empty}>Nessun articolo ancora generato</div>}

            <div style={s.archiveGrid}>
              {articles.map(a => (
                <div
                  key={a.id}
                  style={s.archiveCard}
                  onClick={() => { setSelectedArticle(a); setTab("review"); }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 20 }}>{CATEGORIES.find(c=>c.id===a.catId)?.icon}</span>
                    <span style={{ color: STATUS_META[a.status].color, fontSize: 11, fontWeight: 700 }}>
                      {STATUS_META[a.status].label}
                    </span>
                  </div>
                  <div style={s.archiveTitle}>{a.title.slice(0, 70)}{a.title.length > 70 ? "..." : ""}</div>
                  <div style={s.archiveMeta}>{a.clientName}</div>
                  <div style={s.archiveDate}>{a.createdAt?.toLocaleDateString("it-IT")}</div>
                  {a.status === STATUS.APPROVED && !a.publishedToWP && (
                    <button
                      style={{ ...s.miniBtn, marginTop: 10, width: "100%", textAlign: "center", color: "#E8B84B", borderColor: "#E8B84B40" }}
                      onClick={(e) => { e.stopPropagation(); publishToWordPress(a).then(ok => { if(ok) setArticles(prev => prev.map(x => x.id === a.id ? { ...x, publishedToWP: true } : x)); }); }}
                    >
                      📤 Pubblica su WP
                    </button>
                  )}
                  {a.status === STATUS.APPROVED && a.publishedToWP && (
                    <div style={{ marginTop: 10, fontSize: 10, color: "#A8C5A0", textAlign: "center" }}>✓ Pubblicato su WordPress</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab === "settings" && (
          <div style={s.page}>
            <h1 style={s.pageTitle}>Impostazioni</h1>
            <p style={s.pageSub}>Configura WordPress e lo scheduler</p>

            <div style={s.card}>
              <div style={s.cardTitle}>🔌 Connessione WordPress (il tuo sito)</div>
              <p style={{ color: "#555", fontSize: 13, marginBottom: 20 }}>
                Inserisci le credenziali del tuo WordPress. Vai su <strong style={{ color: "#E8B84B" }}>Utenti → Il tuo profilo → Password applicazione</strong> per generare una password sicura.
              </p>
              {[
                { key: "url",         label: "URL WordPress",        placeholder: "https://tuosito.it" },
                { key: "user",        label: "Nome utente",          placeholder: "admin" },
                { key: "password",    label: "Password applicazione", placeholder: "xxxx xxxx xxxx xxxx" },
                    ].map(field => (
                <div key={field.key} style={s.fieldGroup}>
                  <label style={s.label}>{field.label}</label>
                  <input
                    style={s.input}
                    type={field.key === "password" ? "password" : "text"}
                    placeholder={field.placeholder}
                    value={wpConfig[field.key]}
                    onChange={e => setWpConfig(prev => ({ ...prev, [field.key]: e.target.value }))}
                  />
                </div>
              ))}
              <button
                style={s.generateBtn}
                onClick={() => { setWpSaved(true); addLog("💾 Configurazione WordPress salvata", "success"); }}
              >
                {wpSaved ? "✅ Salvato" : "💾 Salva configurazione"}
              </button>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>⏱ Scheduler automatico</div>
              <p style={{ color: "#555", fontSize: 13, marginBottom: 20 }}>
                Imposta la frequenza di generazione automatica. Gli articoli verranno sempre messi in attesa della tua approvazione prima della pubblicazione.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {SCHEDULE_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    style={{ ...s.scheduleBtn, ...(schedule === opt.id ? s.scheduleBtnActive : {}) }}
                    onClick={() => setSchedule(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── LOG ── */}
        {tab === "log" && (
          <div style={s.page}>
            <h1 style={s.pageTitle}>Log di Sistema</h1>
            <p style={s.pageSub}>Traccia di tutte le operazioni</p>
            <div style={s.logBox} ref={logRef}>
              {log.length === 0 && <div style={{ color: "#333" }}>Nessun evento registrato</div>}
              {log.map((l, i) => (
                <div key={i} style={{
                  fontFamily: "monospace", fontSize: 12, marginBottom: 5,
                  color: l.type === "error" ? "#C97B6C" : l.type === "success" ? "#A8C5A0" : l.type === "highlight" ? "#E8B84B" : "#555"
                }}>
                  <span style={{ color: "#333", marginRight: 10 }}>[{l.ts}]</span>{l.msg}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* CLIENT MODAL */}
      {showClientModal && (
        <ClientModal
          onSave={(client) => {
            setClients(prev => [...prev, { ...client, id: Date.now(), articlesCount: 0 }]);
            setShowClientModal(false);
            addLog(`✅ Nuovo cliente aggiunto: ${client.name}`, "success");
          }}
          onClose={() => setShowClientModal(false)}
        />
      )}
    </div>
  );
}

// ─── ARTICLE DETAIL ───────────────────────────────────────────────────────────
function ArticleDetail({ article, onApprove, onReject, onEdit, wpConfigured }) {
  const [section, setSection] = useState("article");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(article.title);
  const [editContent, setEditContent] = useState(article.content);
  const [editSocials, setEditSocials] = useState({ ...article.socials });
  const cat = CATEGORIES.find(c => c.id === article.catId);

  const handleSave = () => {
    onEdit({ ...article, title: editTitle, content: editContent, socials: editSocials });
    setEditing(false);
  };

  const currentText = section === "article" ? editContent : (editSocials?.[section] || "");
  const setCurrentText = (val) => {
    if (section === "article") setEditContent(val);
    else setEditSocials(p => ({ ...p, [section]: val }));
  };

  return (
    <div style={s.detail}>
      {/* Header */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{cat?.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: cat?.color, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            {cat?.label} · {article.clientName}
          </div>
          {editing ? (
            <input
              style={{ ...s.input, fontSize: 15, fontWeight: 700, color: "#fff" }}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
            />
          ) : (
            <div style={{ color: "#fff", fontSize: 17, fontWeight: 700, lineHeight: 1.4 }}>{editTitle}</div>
          )}
        </div>
        {article.status === STATUS.PENDING && (
          <button
            style={{ ...s.subTab, borderColor: editing ? "#E8B84B" : "#2a2a2a", color: editing ? "#E8B84B" : "#555", flexShrink: 0 }}
            onClick={() => editing ? handleSave() : setEditing(true)}
          >
            {editing ? "💾 Salva" : "✏️ Modifica"}
          </button>
        )}
      </div>

      {/* Sub tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { id: "article", label: "📄 Articolo" },
          ...SOCIAL_FORMATS.filter(sf => article.socials?.[sf.id]).map(sf => ({ id: sf.id, label: `${sf.icon} ${sf.label}` }))
        ].map(t => (
          <button
            key={t.id}
            style={{ ...s.subTab, ...(section === t.id ? s.subTabActive : {}) }}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content — read or edit */}
      {editing ? (
        <div>
          {section === "article" && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {[
                { label: "H1", tag: "h1" },
                { label: "H2", tag: "h2" },
                { label: "P",  tag: "p"  },
              ].map(({ label, tag }) => (
                <button key={tag} style={s.tbBtn} onClick={() => {
                  const sel = window.getSelection();
                  if (sel && sel.toString()) {
                    setCurrentText(currentText.replace(sel.toString(), `<${tag}>${sel.toString()}</${tag}>`));
                  } else {
                    setCurrentText(currentText + `\n<${tag}></${tag}>`);
                  }
                }}>{label}</button>
              ))}
              <div style={{ width: 1, background: "#2a2a2a", margin: "0 4px" }} />
              {[
                { label: "B",  open: "<strong>", close: "</strong>", style: { fontWeight: 900 } },
                { label: "I",  open: "<em>",     close: "</em>",     style: { fontStyle: "italic" } },
                { label: "U",  open: "<u>",      close: "</u>",      style: { textDecoration: "underline" } },
              ].map(({ label, open, close, style: st }) => (
                <button key={label} style={{ ...s.tbBtn, ...st }} onClick={() => {
                  const sel = window.getSelection();
                  const selected = sel?.toString();
                  if (selected) {
                    setCurrentText(currentText.replace(selected, `${open}${selected}${close}`));
                  }
                }}>{label}</button>
              ))}
              <div style={{ width: 1, background: "#2a2a2a", margin: "0 4px" }} />
              <button style={{ ...s.tbBtn, fontSize: 10 }} onClick={() => setCurrentText(currentText.replace(/<[^>]+>/g, ""))}>Rimuovi HTML</button>
              <button style={{ ...s.tbBtn, fontSize: 10, color: "#5B8FA8" }} onClick={() => {
                const preview = document.getElementById("html-preview");
                if (preview) preview.style.display = preview.style.display === "none" ? "block" : "none";
              }}>👁 Anteprima</button>
            </div>
          )}
          <textarea
            style={{ ...s.input, minHeight: 320, lineHeight: 1.75, fontSize: 13, resize: "vertical", fontFamily: "'Courier New', monospace" }}
            value={currentText}
            onChange={e => setCurrentText(e.target.value)}
          />
          {section === "article" && (
            <div id="html-preview" style={{ display: "none", background: "#0A0A0A", border: "1px solid #2a2a2a", borderRadius: 8, padding: 20, marginTop: 8, color: "#ccc", fontSize: 14, lineHeight: 1.75 }}
              dangerouslySetInnerHTML={{ __html: currentText }}
            />
          )}
        </div>
      ) : (
        <div style={s.contentBox}>
          {section === "article"
            ? <div style={{ color: "#ccc", lineHeight: 1.75, fontSize: 14 }} dangerouslySetInnerHTML={{ __html: editContent }} />
            : <p style={{ color: "#ccc", lineHeight: 1.75, fontSize: 14, whiteSpace: "pre-wrap", margin: 0 }}>{editSocials?.[section] || "—"}</p>
          }
        </div>
      )}

      {editing && (
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button style={s.approveBtn} onClick={handleSave}>💾 Salva modifiche</button>
          <button style={s.rejectBtn} onClick={() => { setEditing(false); setEditTitle(article.title); setEditContent(article.content); setEditSocials({ ...article.socials }); }}>Annulla</button>
        </div>
      )}

      {!editing && article.status === STATUS.PENDING && (
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button style={s.approveBtn} onClick={() => onApprove({ ...article, title: editTitle, content: editContent, socials: editSocials })}>
            ✅ Approva{wpConfigured ? " e Pubblica su WP" : ""}
          </button>
          <button style={s.rejectBtn} onClick={onReject}>✗ Rifiuta</button>
        </div>
      )}
      {article.status !== STATUS.PENDING && (
        <div style={{ marginTop: 16, padding: "10px 16px", borderRadius: 8, background: "#111", color: STATUS_META[article.status].color, fontSize: 13 }}>
          {STATUS_META[article.status].label}{article.publishedToWP ? " · Pubblicato su WordPress" : ""}
        </div>
      )}
    </div>
  );
}

// ─── CLIENT MODAL ─────────────────────────────────────────────────────────────
function ClientModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name: "", sport: "", plan: "base", active: true, wpUrl: "" });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={s.modalOverlay}>
      <div style={s.modal}>
        <div style={s.cardTitle}>Nuovo Cliente</div>
        {[
          { key: "name",   label: "Nome ASD/SSD",  placeholder: "ASD Olimpia Calcio Roma" },
          { key: "sport",  label: "Sport",          placeholder: "Calcio, Nuoto, Basket..." },
          { key: "wpUrl",  label: "URL WordPress cliente (opzionale)", placeholder: "https://asd-olimpia.it" },
        ].map(f => (
          <div key={f.key} style={s.fieldGroup}>
            <label style={s.label}>{f.label}</label>
            <input style={s.input} placeholder={f.placeholder} value={form[f.key]} onChange={e => set(f.key, e.target.value)} />
          </div>
        ))}
        <div style={s.fieldGroup}>
          <label style={s.label}>Piano</label>
          <div style={{ display: "flex", gap: 8 }}>
            {PLANS.map(p => (
              <button
                key={p.id}
                style={{ ...s.scheduleBtn, ...(form.plan === p.id ? s.scheduleBtnActive : {}) }}
                onClick={() => set("plan", p.id)}
              >
                {p.label} {p.price}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button style={s.approveBtn} onClick={() => form.name && onSave(form)}>Aggiungi Cliente</button>
          <button style={s.rejectBtn} onClick={onClose}>Annulla</button>
        </div>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  root:        { display: "flex", height: "100vh", background: "#0C0C0C", color: "#fff", fontFamily: "'DM Mono', 'Fira Code', monospace", overflow: "hidden" },
  sidebar:     { width: 220, background: "#0A0A0A", borderRight: "1px solid #161616", display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0 },
  brand:       { display: "flex", alignItems: "center", gap: 12, padding: "0 20px 28px", borderBottom: "1px solid #161616", marginBottom: 16 },
  brandIcon:   { fontSize: 26, filter: "drop-shadow(0 0 6px #E8B84B)" },
  brandName:   { fontSize: 16, fontWeight: 900, color: "#fff", letterSpacing: 2 },
  brandSub:    { fontSize: 9, color: "#E8B84B", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 2 },
  nav:         { flex: 1, padding: "0 12px", display: "flex", flexDirection: "column", gap: 2 },
  navItem:     { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 13, textAlign: "left", transition: "all 0.15s", position: "relative" },
  navActive:   { background: "#161616", color: "#E8B84B" },
  navIcon:     { fontSize: 14, width: 16, textAlign: "center" },
  badge:       { marginLeft: "auto", background: "#E8B84B", color: "#000", borderRadius: 20, fontSize: 10, fontWeight: 900, padding: "1px 6px" },
  sidebarFooter: { padding: "16px 20px", borderTop: "1px solid #161616" },
  scheduleChip: { fontSize: 11, letterSpacing: 1 },
  main:        { flex: 1, overflowY: "auto", padding: 28 },
  page:        { maxWidth: 1000, margin: "0 auto" },
  pageTitle:   { fontSize: 22, fontWeight: 900, color: "#fff", letterSpacing: 1, marginBottom: 4 },
  pageSub:     { color: "#444", fontSize: 13, marginBottom: 28 },
  statsGrid:   { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 },
  statCard:    { background: "#0F0F0F", border: "1px solid #1a1a1a", borderRadius: 12, padding: "20px", textAlign: "center" },
  statValue:   { fontSize: 32, fontWeight: 900 },
  statLabel:   { fontSize: 11, color: "#444", marginTop: 4, textTransform: "uppercase", letterSpacing: 1 },
  twoColGrid:  { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 },
  card:        { background: "#0F0F0F", border: "1px solid #1a1a1a", borderRadius: 12, padding: 20, marginBottom: 20 },
  cardTitle:   { fontSize: 12, color: "#E8B84B", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, fontWeight: 700 },
  miniRow:     { display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #141414", cursor: "pointer" },
  miniTitle:   { fontSize: 13, color: "#ccc", marginBottom: 2 },
  miniMeta:    { fontSize: 11, color: "#444" },
  addBtn:      { marginTop: 12, background: "none", border: "1px solid #1e1e1e", borderRadius: 8, color: "#555", padding: "8px 16px", cursor: "pointer", fontSize: 12, width: "100%" },
  chip:        { fontSize: 11, padding: "2px 8px", borderRadius: 20 },
  chipBtn:     { cursor: "pointer", border: "1px solid #2a2a2a" },
  chipActive:  { borderColor: "#E8B84B", color: "#E8B84B", background: "#E8B84B15" },
  catGrid:     { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 },
  catBtn:      { display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 8px", border: "1px solid #2a2a2a", borderRadius: 10, cursor: "pointer", background: "transparent", transition: "all 0.15s", minHeight: 80 },
  fieldGroup:  { marginBottom: 20 },
  label:       { display: "block", fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 },
  input:       { width: "100%", background: "#0A0A0A", border: "1px solid #1e1e1e", borderRadius: 8, color: "#ddd", padding: "11px 14px", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" },
  socialBtn:   { padding: "10px 18px", border: "1px solid", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "all 0.15s" },
  generateBtn: { width: "100%", padding: "15px", background: "linear-gradient(135deg, #E8B84B, #C9956C)", border: "none", borderRadius: 10, color: "#000", fontSize: 14, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" },
  scheduleBtn: { padding: "9px 16px", background: "none", border: "1px solid #2a2a2a", borderRadius: 8, color: "#555", cursor: "pointer", fontSize: 12 },
  scheduleBtnActive: { borderColor: "#E8B84B", color: "#E8B84B" },
  listCard:    { background: "#0F0F0F", border: "1px solid #1e1e1e", borderRadius: 10, padding: "14px 16px", marginBottom: 10, cursor: "pointer", transition: "all 0.15s" },
  listCardTitle: { fontSize: 13, fontWeight: 700, color: "#ddd", marginBottom: 6, lineHeight: 1.4 },
  listCardMeta: { fontSize: 11, color: "#444" },
  autoChip:    { fontSize: 9, background: "#E8B84B20", color: "#E8B84B", padding: "2px 6px", borderRadius: 20, letterSpacing: 1 },
  detail:      { background: "#0F0F0F", border: "1px solid #1a1a1a", borderRadius: 12, padding: 24 },
  subTab:      { padding: "6px 12px", background: "none", border: "1px solid #2a2a2a", borderRadius: 6, color: "#555", cursor: "pointer", fontSize: 12 },
  subTabActive: { borderColor: "#E8B84B", color: "#E8B84B" },
  contentBox:  { background: "#0A0A0A", border: "1px solid #1a1a1a", borderRadius: 10, padding: 20, minHeight: 200, maxHeight: 400, overflowY: "auto" },
  approveBtn:  { flex: 1, padding: "12px", background: "#A8C5A0", border: "none", borderRadius: 8, color: "#000", fontWeight: 900, cursor: "pointer", fontSize: 13 },
  rejectBtn:   { padding: "12px 20px", background: "none", border: "1px solid #C97B6C", borderRadius: 8, color: "#C97B6C", cursor: "pointer", fontSize: 13 },
  archiveGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 14 },
  archiveCard: { background: "#0F0F0F", border: "1px solid #1a1a1a", borderRadius: 12, padding: 18, cursor: "pointer", transition: "all 0.15s" },
  archiveTitle: { fontSize: 13, fontWeight: 700, color: "#ccc", marginBottom: 8, lineHeight: 1.4 },
  archiveMeta: { fontSize: 11, color: "#E8B84B", marginBottom: 4 },
  archiveDate: { fontSize: 10, color: "#333" },
  clientsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 16, marginBottom: 24 },
  clientCard:  { background: "#0F0F0F", border: "1px solid #1a1a1a", borderRadius: 12, padding: 20 },
  clientName:  { fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4 },
  clientSport: { fontSize: 12, color: "#555" },
  planChip:    { fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 700 },
  planCard:    { border: "1px solid", borderRadius: 10, padding: 16 },
  miniBtn:     { background: "none", border: "1px solid #2a2a2a", borderRadius: 6, color: "#E8B84B", padding: "4px 10px", cursor: "pointer", fontSize: 11 },
  logBox:      { background: "#070707", border: "1px solid #141414", borderRadius: 10, padding: 20, height: 520, overflowY: "auto" },
  modalOverlay: { position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modal:       { background: "#0F0F0F", border: "1px solid #2a2a2a", borderRadius: 16, padding: 32, width: 480, maxWidth: "90vw" },
  empty:       { color: "#2a2a2a", textAlign: "center", padding: "40px 0", fontSize: 14 },
  tbBtn:       { padding: "5px 10px", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #222; border-radius: 4px; }
  button:hover { filter: brightness(1.15); }
`;
