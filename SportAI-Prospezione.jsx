import { useState, useRef, useCallback } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const REGIONI = [
  "Tutte","Abruzzo","Basilicata","Calabria","Campania","Emilia-Romagna",
  "Friuli-Venezia Giulia","Lazio","Liguria","Lombardia","Marche","Molise",
  "Piemonte","Puglia","Sardegna","Sicilia","Toscana","Trentino-Alto Adige",
  "Umbria","Valle d'Aosta","Veneto"
];

const SPORT_LIST = [
  "Calcio","Basket","Nuoto","Pallavolo","Tennis","Rugby","Atletica",
  "Ginnastica","Ciclismo","Boxe","Judo","Karate","Scherma","Padel",
  "Beach Volley","Handball","Hockey","Canottaggio","Vela","Equitazione"
];

const LEAD_STATUS = {
  NEW: "new",
  ANALYZING: "analyzing",
  READY: "ready",
  WRITING: "writing",
  PENDING: "pending",
  SENT: "sent",
  REJECTED: "rejected",
};

const STATUS_META = {
  new:       { label: "Trovato",        color: "#888" },
  analyzing: { label: "Analisi...",     color: "#E8B84B" },
  ready:     { label: "Analizzato",     color: "#5B8FA8" },
  writing:   { label: "Scrittura...",   color: "#E8B84B" },
  pending:   { label: "Da approvare",   color: "#C9956C" },
  sent:      { label: "Inviata ✓",      color: "#7AAF6E" },
  rejected:  { label: "Scartato",       color: "#C97B6C" },
};

const NEED_SCORE = { 1: "Basso", 2: "Medio", 3: "Alto", 4: "Urgente" };
const NEED_COLOR = { 1: "#555", 2: "#5B8FA8", 3: "#C9956C", 4: "#C97B6C" };

let _lid = 1;
const newLid = () => _lid++;

// ─── API ─────────────────────────────────────────────────────────────────────

async function callClaude(messages, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  return res.json();
}

function extractText(data) {
  return (data?.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

async function sendViaBrevo(apiKey, to, subject, html) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      sender: { name: "SportAI", email: "info@sportai.it" },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  return res.ok;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

export default function Prospezione() {
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState("search"); // search | pipeline | settings
  const [log, setLog] = useState([]);
  const [brevoKey, setBrevoKey] = useState("");
  const [brevoSaved, setBrevoSaved] = useState(false);
  const [senderName, setSenderName] = useState("SportAI");
  const [senderEmail, setSenderEmail] = useState("info@sportai.it");

  // Search params
  const [regione, setRegione] = useState("Tutte");
  const [sport, setSport] = useState("Tutti gli sport");
  const [numResults, setNumResults] = useState(5);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [autoWrite, setAutoWrite] = useState(true);

  const logRef = useRef(null);

  const addLog = useCallback((msg, type = "info") => {
    const ts = new Date().toLocaleTimeString("it-IT");
    setLog(p => [...p.slice(-100), { msg, type, ts }]);
    setTimeout(() => logRef.current?.scrollTo(0, 99999), 50);
  }, []);

  const updateLead = useCallback((id, patch) => {
    setLeads(p => p.map(l => l.id === id ? { ...l, ...patch } : l));
    setSelected(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  }, []);

  // ── PHASE 1: Search ───────────────────────────────────────────────────────
  const searchLeads = useCallback(async () => {
    if (searching) return;
    setSearching(true);
    const areaStr = regione === "Tutte" ? "Italia" : regione;
    const sportStr = sport === "Tutti gli sport" ? "qualsiasi disciplina sportiva" : sport;

    addLog(`🔍 Ricerca ASD/SSD: ${sportStr} · ${areaStr}`, "highlight");

    const system = `Sei un ricercatore esperto di associazioni sportive italiane.
Cerca online ASD e SSD italiane reali nella zona e sport indicati.
Per ogni società trovata fornisci in formato JSON array:
[
  {
    "name": "Nome completo ASD/SSD",
    "sport": "disciplina",
    "city": "città",
    "region": "regione",
    "email": "email se trovata o null",
    "website": "url sito se trovato o null",
    "facebook": "url pagina facebook se trovata o null",
    "instagram": "handle instagram se trovato o null",
    "phone": "telefono se trovato o null",
    "lastWebUpdate": "data ultimo aggiornamento sito stimata o 'sconosciuta'",
    "socialActivity": "alta/media/bassa/assente"
  }
]
Restituisci SOLO il JSON array, nessun altro testo. Trova esattamente ${numResults} società reali.`;

    try {
      const data = await callClaude(
        [{ role: "user", content: `Cerca ${numResults} ASD/SSD reali di ${sportStr} in ${areaStr}. Cerca email e contatti reali online.` }],
        system
      );
      const text = extractText(data);
      const clean = text.replace(/```json|```/g, "").trim();
      const found = JSON.parse(clean);

      const newLeads = found.map(f => ({
        id: newLid(),
        ...f,
        status: LEAD_STATUS.NEW,
        needScore: null,
        analysis: null,
        emailSubject: null,
        emailBody: null,
        createdAt: new Date(),
      }));

      setLeads(p => [...newLeads, ...p]);
      addLog(`✅ Trovate ${newLeads.length} società`, "success");

      if (autoAnalyze) {
        for (const lead of newLeads) {
          await analyzeLead(lead, updateLead, addLog, autoWrite);
        }
      }
    } catch (e) {
      addLog(`❌ Errore ricerca: ${e.message}`, "error");
    }
    setSearching(false);
  }, [searching, regione, sport, numResults, autoAnalyze, autoWrite, addLog, updateLead]);

  // ── PHASE 2: Analyze ─────────────────────────────────────────────────────
  const analyzeLead = useCallback(async (lead, updFn, logFn, doWrite = true) => {
    const upd = updFn || updateLead;
    const log = logFn || addLog;
    upd(lead.id, { status: LEAD_STATUS.ANALYZING });
    log(`🔎 Analisi: ${lead.name}`, "info");

    const system = `Sei un analista di marketing sportivo. Analizza la presenza online di questa società sportiva italiana.
Cerca il loro sito web e social media. Valuta quanto comunicano bene o male.
Rispondi SOLO con JSON:
{
  "needScore": 1-4 (1=bassa necessità, 4=urgente necessità di comunicazione),
  "needReason": "frase breve che spiega perché hanno bisogno del servizio",
  "siteStatus": "aggiornato/datato/assente",
  "socialStatus": "attivo/scarso/assente",
  "lastPost": "data ultimo post o 'sconosciuta'",
  "notes": "osservazione chiave per personalizzare la proposta"
}`;

    try {
      const data = await callClaude(
        [{ role: "user", content: `Analizza la presenza online di: ${lead.name}, ${lead.sport}, ${lead.city}. ${lead.website ? `Sito: ${lead.website}` : ""} ${lead.facebook ? `Facebook: ${lead.facebook}` : ""}` }],
        system
      );
      const text = extractText(data);
      const clean = text.replace(/```json|```/g, "").trim();
      const analysis = JSON.parse(clean);
      upd(lead.id, { status: LEAD_STATUS.READY, needScore: analysis.needScore, analysis });
      log(`✅ Analizzata: ${lead.name} · Bisogno ${NEED_SCORE[analysis.needScore]}`, "success");

      if (doWrite) {
        const updatedLead = { ...lead, analysis, needScore: analysis.needScore };
        await writeEmail(updatedLead, upd, log);
      }
    } catch (e) {
      log(`⚠️ Analisi fallita per ${lead.name}: ${e.message}`, "error");
      upd(lead.id, { status: LEAD_STATUS.READY, needScore: 2, analysis: { needReason: "Analisi non disponibile", notes: "" } });
    }
  }, [updateLead, addLog]);

  // ── PHASE 3: Write email ──────────────────────────────────────────────────
  const writeEmail = useCallback(async (lead, updFn, logFn) => {
    const upd = updFn || updateLead;
    const log = logFn || addLog;
    upd(lead.id, { status: LEAD_STATUS.WRITING });
    log(`✍️ Scrittura email per: ${lead.name}`, "info");

    const system = `Sei un esperto di sales copywriting per servizi B2B nel settore sportivo italiano.
Scrivi un'email commerciale personalizzata e convincente per proporre il servizio SportAI a questa ASD/SSD.
L'email deve:
- Essere in italiano, tono professionale ma diretto
- Dimostrare che hai guardato la loro realtà specifica (usa i dati dell'analisi)
- NON parlare di AI o tecnologia — parla di risultati concreti
- Essere breve (max 180 parole nel body)
- Finire con una call to action chiara per una chiamata gratuita di 20 minuti

Rispondi SOLO con JSON:
{
  "subject": "oggetto email accattivante",
  "body": "testo email in HTML semplice con <p> e <strong> tags"
}`;

    const analysis = lead.analysis || {};
    try {
      const data = await callClaude(
        [{ role: "user", content: `Scrivi email per: ${lead.name} (${lead.sport}, ${lead.city}).
Analisi: ${analysis.needReason || "comunicazione scarsa"}.
Note: ${analysis.notes || ""}.
Stato sito: ${analysis.siteStatus || "non verificato"}.
Stato social: ${analysis.socialStatus || "non verificato"}.
Contatto: ${lead.email || "email non trovata"}.` }],
        system
      );
      const text = extractText(data);
      const clean = text.replace(/```json|```/g, "").trim();
      const email = JSON.parse(clean);
      upd(lead.id, { status: LEAD_STATUS.PENDING, emailSubject: email.subject, emailBody: email.body });
      log(`📧 Email pronta per: ${lead.name}`, "highlight");
    } catch (e) {
      log(`⚠️ Scrittura email fallita per ${lead.name}`, "error");
      upd(lead.id, { status: LEAD_STATUS.READY });
    }
  }, [updateLead, addLog]);

  // ── Send email ────────────────────────────────────────────────────────────
  const sendEmail = useCallback(async (lead) => {
    if (!brevoKey) { addLog("⚠️ Inserisci la chiave API Brevo nelle Impostazioni", "error"); return; }
    if (!lead.email) { addLog(`⚠️ Nessuna email per ${lead.name}`, "error"); return; }

    addLog(`📤 Invio email a ${lead.email}...`, "info");
    const ok = await sendViaBrevo(brevoKey, lead.email, lead.emailSubject, lead.emailBody);
    if (ok) {
      updateLead(lead.id, { status: LEAD_STATUS.SENT });
      addLog(`✅ Email inviata a ${lead.name}`, "success");
    } else {
      addLog(`❌ Invio fallito per ${lead.name}`, "error");
    }
  }, [brevoKey, addLog, updateLead]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total:   leads.length,
    pending: leads.filter(l => l.status === LEAD_STATUS.PENDING).length,
    sent:    leads.filter(l => l.status === LEAD_STATUS.SENT).length,
    urgent:  leads.filter(l => l.needScore >= 3).length,
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      <style>{CSS}</style>

      {/* HEADER */}
      <header style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.headerIcon}>🎯</span>
          <div>
            <div style={s.headerTitle}>SportAI · Prospezione</div>
            <div style={s.headerSub}>Ricerca automatica contatti + invio proposta</div>
          </div>
        </div>
        <div style={s.headerStats}>
          {[
            { v: stats.total,   l: "Lead trovati",    c: "#fff" },
            { v: stats.urgent,  l: "Alta priorità",   c: "#C9956C" },
            { v: stats.pending, l: "Da approvare",    c: "#E8B84B" },
            { v: stats.sent,    l: "Email inviate",   c: "#7AAF6E" },
          ].map(st => (
            <div key={st.l} style={s.statBox}>
              <div style={{ ...s.statNum, color: st.c }}>{st.v}</div>
              <div style={s.statLbl}>{st.l}</div>
            </div>
          ))}
        </div>
      </header>

      {/* TABS */}
      <div style={s.tabs}>
        {[
          { id: "search",   label: "🔍 Ricerca" },
          { id: "pipeline", label: `📋 Pipeline${stats.pending > 0 ? ` (${stats.pending})` : ""}` },
          { id: "settings", label: "⚙️ Impostazioni" },
          { id: "log",      label: "📊 Log" },
        ].map(t => (
          <button key={t.id} style={{ ...s.tab, ...(tab === t.id ? s.tabActive : {}) }} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={s.body}>

        {/* ── RICERCA ── */}
        {tab === "search" && (
          <div style={s.twoCol}>
            <div style={s.leftCol}>
              <div style={s.card}>
                <div style={s.cardTitle}>Parametri di ricerca</div>

                <div style={s.field}>
                  <label style={s.label}>Regione</label>
                  <select style={s.select} value={regione} onChange={e => setRegione(e.target.value)}>
                    {REGIONI.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                <div style={s.field}>
                  <label style={s.label}>Sport</label>
                  <select style={s.select} value={sport} onChange={e => setSport(e.target.value)}>
                    <option value="Tutti gli sport">Tutti gli sport</option>
                    {SPORT_LIST.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                  </select>
                </div>

                <div style={s.field}>
                  <label style={s.label}>Numero di società da trovare</label>
                  <div style={s.numRow}>
                    {[3, 5, 10, 15].map(n => (
                      <button key={n} style={{ ...s.numBtn, ...(numResults === n ? s.numBtnActive : {}) }} onClick={() => setNumResults(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={s.field}>
                  <label style={s.label}>Automazione</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <ToggleRow
                      label="Analisi automatica"
                      sub="Analizza sito e social subito dopo la ricerca"
                      value={autoAnalyze}
                      onChange={setAutoAnalyze}
                    />
                    <ToggleRow
                      label="Scrittura email automatica"
                      sub="Scrive la proposta personalizzata dopo l'analisi"
                      value={autoWrite}
                      onChange={setAutoWrite}
                    />
                  </div>
                </div>

                <button
                  style={{ ...s.searchBtn, opacity: searching ? 0.5 : 1, cursor: searching ? "not-allowed" : "pointer" }}
                  onClick={searchLeads}
                  disabled={searching}
                >
                  {searching ? "⏳  Ricerca in corso..." : "🔍  Avvia Ricerca"}
                </button>
              </div>

              {/* Flow diagram */}
              <div style={s.card}>
                <div style={s.cardTitle}>Come funziona</div>
                {[
                  ["🔍", "Ricerca", "L'AI cerca online ASD/SSD reali con contatti"],
                  ["📊", "Analisi", "Valuta sito e social, assegna punteggio di bisogno"],
                  ["✍️", "Proposta", "Scrive email personalizzata per ogni società"],
                  ["✅", "Approvi", "Tu leggi e decidi se inviare"],
                  ["📤", "Invio", "Brevo invia e traccia aperture e click"],
                ].map(([icon, title, desc]) => (
                  <div key={title} style={s.flowRow}>
                    <span style={s.flowIcon}>{icon}</span>
                    <div>
                      <div style={s.flowTitle}>{title}</div>
                      <div style={s.flowDesc}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Lead list */}
            <div style={s.rightCol}>
              <div style={s.cardTitle}>Lead trovati ({leads.length})</div>
              {leads.length === 0 && (
                <div style={s.empty}>Avvia una ricerca per trovare le prime ASD/SSD</div>
              )}
              {leads.map(lead => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  selected={selected?.id === lead.id}
                  onClick={() => { setSelected(lead); setTab("pipeline"); }}
                  onAnalyze={() => analyzeLead(lead)}
                  onWrite={() => writeEmail(lead)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── PIPELINE ── */}
        {tab === "pipeline" && (
          <div style={s.twoCol}>
            <div style={s.leftCol}>
              <div style={s.cardTitle}>In attesa di approvazione ({stats.pending})</div>
              {leads.filter(l => l.status === LEAD_STATUS.PENDING).length === 0 && (
                <div style={s.empty}>Nessuna email in attesa</div>
              )}
              {leads.filter(l => l.status === LEAD_STATUS.PENDING).map(lead => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  selected={selected?.id === lead.id}
                  onClick={() => setSelected(lead)}
                  compact
                />
              ))}

              {leads.filter(l => l.status === LEAD_STATUS.SENT).length > 0 && (
                <>
                  <div style={{ ...s.cardTitle, marginTop: 24 }}>Inviate ({stats.sent})</div>
                  {leads.filter(l => l.status === LEAD_STATUS.SENT).map(lead => (
                    <LeadCard key={lead.id} lead={lead} selected={selected?.id === lead.id} onClick={() => setSelected(lead)} compact />
                  ))}
                </>
              )}
            </div>

            <div style={s.rightCol}>
              {!selected
                ? <div style={s.empty}>Seleziona un lead dalla lista</div>
                : <LeadDetail
                    lead={selected}
                    onAnalyze={() => analyzeLead(selected)}
                    onWrite={() => writeEmail(selected)}
                    onSend={() => sendEmail(selected)}
                    onReject={() => { updateLead(selected.id, { status: LEAD_STATUS.REJECTED }); setSelected(null); addLog(`✗ Scartato: ${selected.name}`, "error"); }}
                    brevoConfigured={!!brevoKey}
                  />
              }
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab === "settings" && (
          <div style={{ maxWidth: 600 }}>
            <div style={s.card}>
              <div style={s.cardTitle}>📧 Configurazione Brevo</div>
              <p style={{ color: "#555", fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
                Crea un account gratuito su <strong style={{ color: "#E8B84B" }}>brevo.com</strong>, poi vai su<br />
                <strong style={{ color: "#aaa" }}>Impostazioni → API Keys → Crea nuova chiave</strong>
              </p>
              {[
                { key: "brevoKey", label: "API Key Brevo", placeholder: "xkeysib-...", val: brevoKey, set: setBrevoKey, type: "password" },
                { key: "senderName", label: "Nome mittente", placeholder: "SportAI", val: senderName, set: setSenderName },
                { key: "senderEmail", label: "Email mittente", placeholder: "info@sportai.it", val: senderEmail, set: setSenderEmail },
              ].map(f => (
                <div key={f.key} style={s.field}>
                  <label style={s.label}>{f.label}</label>
                  <input
                    style={s.input}
                    type={f.type || "text"}
                    placeholder={f.placeholder}
                    value={f.val}
                    onChange={e => f.set(e.target.value)}
                  />
                </div>
              ))}
              <button style={s.searchBtn} onClick={() => setBrevoSaved(true)}>
                {brevoSaved ? "✅ Salvato" : "💾 Salva configurazione"}
              </button>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>📋 Piano di invio consigliato</div>
              <p style={{ color: "#666", fontSize: 13, lineHeight: 1.7 }}>
                Brevo gratuito permette <strong style={{ color: "#E8B84B" }}>300 email/giorno</strong>. Per non finire in spam:
              </p>
              <br />
              {[
                ["Max 50-80 email/giorno", "Anche se il piano lo permette, inizia con volumi bassi"],
                ["Personalizza sempre", "L'AI lo fa già — email generiche finiscono in spam"],
                ["Attendi 3-5 giorni", "Prima di un follow-up manuale via telefono o WhatsApp"],
                ["Tasso apertura target", "Un buon tasso è 30-40% — monitora da Brevo"],
              ].map(([t, d]) => (
                <div key={t} style={s.flowRow}>
                  <span style={{ color: "#E8B84B", fontSize: 16 }}>›</span>
                  <div><div style={s.flowTitle}>{t}</div><div style={s.flowDesc}>{d}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── LOG ── */}
        {tab === "log" && (
          <div>
            <div style={s.cardTitle}>Log operazioni</div>
            <div style={s.logBox} ref={logRef}>
              {log.length === 0 && <div style={{ color: "#333" }}>Nessun evento</div>}
              {log.map((l, i) => (
                <div key={i} style={{
                  fontFamily: "monospace", fontSize: 12, marginBottom: 5,
                  color: l.type === "error" ? "#C97B6C" : l.type === "success" ? "#7AAF6E" : l.type === "highlight" ? "#E8B84B" : "#555"
                }}>
                  <span style={{ color: "#333", marginRight: 10 }}>[{l.ts}]</span>{l.msg}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LEAD CARD ────────────────────────────────────────────────────────────────
function LeadCard({ lead, selected, onClick, onAnalyze, onWrite, compact }) {
  const sm = STATUS_META[lead.status];
  return (
    <div style={{ ...s.leadCard, borderColor: selected ? "#E8B84B" : "#1e1e1e" }} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={s.leadName}>{lead.name}</div>
        <span style={{ color: sm.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{sm.label}</span>
      </div>
      <div style={s.leadMeta}>{lead.sport} · {lead.city}, {lead.region}</div>
      {lead.needScore && (
        <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
          <NeedBar score={lead.needScore} />
          <span style={{ color: NEED_COLOR[lead.needScore], fontSize: 11 }}>
            Bisogno {NEED_SCORE[lead.needScore]}
          </span>
        </div>
      )}
      {!compact && lead.status === LEAD_STATUS.NEW && (
        <button style={s.miniActionBtn} onClick={e => { e.stopPropagation(); onAnalyze(); }}>
          Analizza →
        </button>
      )}
      {!compact && lead.status === LEAD_STATUS.READY && (
        <button style={s.miniActionBtn} onClick={e => { e.stopPropagation(); onWrite(); }}>
          Scrivi email →
        </button>
      )}
    </div>
  );
}

// ─── LEAD DETAIL ──────────────────────────────────────────────────────────────
function LeadDetail({ lead, onAnalyze, onWrite, onSend, onReject, brevoConfigured }) {
  const [emailTab, setEmailTab] = useState("preview");
  const sm = STATUS_META[lead.status];

  return (
    <div style={s.detail}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ color: "#E8B84B", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
            {lead.sport} · {lead.city}, {lead.region}
          </div>
          <div style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>{lead.name}</div>
        </div>
        <span style={{ color: sm.color, fontSize: 12, fontWeight: 700 }}>{sm.label}</span>
      </div>

      {/* Contact info */}
      <div style={s.infoGrid}>
        {[
          ["Email", lead.email || "—"],
          ["Telefono", lead.phone || "—"],
          ["Sito web", lead.website || "—"],
          ["Instagram", lead.instagram || "—"],
        ].map(([k, v]) => (
          <div key={k} style={s.infoRow}>
            <span style={s.infoKey}>{k}</span>
            <span style={s.infoVal}>{v}</span>
          </div>
        ))}
      </div>

      {/* Analysis */}
      {lead.analysis && (
        <div style={s.analysisBox}>
          <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
            <div>
              <div style={s.infoKey}>Punteggio bisogno</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <NeedBar score={lead.needScore} large />
                <span style={{ color: NEED_COLOR[lead.needScore], fontWeight: 700 }}>{NEED_SCORE[lead.needScore]}</span>
              </div>
            </div>
            <div>
              <div style={s.infoKey}>Sito web</div>
              <div style={{ color: "#ccc", fontSize: 12, marginTop: 4 }}>{lead.analysis.siteStatus || "—"}</div>
            </div>
            <div>
              <div style={s.infoKey}>Social</div>
              <div style={{ color: "#ccc", fontSize: 12, marginTop: 4 }}>{lead.analysis.socialStatus || "—"}</div>
            </div>
          </div>
          <div style={s.infoKey}>Motivo</div>
          <div style={{ color: "#bbb", fontSize: 13, marginTop: 4 }}>{lead.analysis.needReason}</div>
          {lead.analysis.notes && (
            <>
              <div style={{ ...s.infoKey, marginTop: 8 }}>Note personalizzazione</div>
              <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>{lead.analysis.notes}</div>
            </>
          )}
        </div>
      )}

      {/* Email preview */}
      {lead.emailSubject && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {["preview", "html"].map(t => (
              <button key={t} style={{ ...s.subTab, ...(emailTab === t ? s.subTabActive : {}) }} onClick={() => setEmailTab(t)}>
                {t === "preview" ? "📧 Anteprima" : "🔧 HTML"}
              </button>
            ))}
          </div>
          <div style={s.infoKey}>Oggetto: <span style={{ color: "#ccc", fontWeight: 400 }}>{lead.emailSubject}</span></div>
          <div style={s.emailBox}>
            {emailTab === "preview"
              ? <div style={{ color: "#ccc", fontSize: 13, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: lead.emailBody }} />
              : <pre style={{ color: "#888", fontSize: 11, whiteSpace: "pre-wrap", margin: 0 }}>{lead.emailBody}</pre>
            }
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        {lead.status === LEAD_STATUS.NEW && (
          <button style={s.actionBtn} onClick={onAnalyze}>📊 Analizza</button>
        )}
        {lead.status === LEAD_STATUS.READY && (
          <button style={s.actionBtn} onClick={onWrite}>✍️ Scrivi email</button>
        )}
        {lead.status === LEAD_STATUS.PENDING && (
          <>
            <button
              style={{ ...s.actionBtn, background: "#7AAF6E", flex: 1 }}
              onClick={onSend}
            >
              {brevoConfigured ? "📤 Approva e Invia" : "📤 Approva (configura Brevo per inviare)"}
            </button>
            <button style={s.rejectBtn} onClick={onReject}>✗ Scarta</button>
          </>
        )}
        {lead.status === LEAD_STATUS.SENT && (
          <div style={{ color: "#7AAF6E", fontSize: 13 }}>✅ Email inviata — attendi risposta 3-5 giorni poi chiama</div>
        )}
      </div>
    </div>
  );
}

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function NeedBar({ score, large }) {
  const w = large ? 60 : 40;
  const h = large ? 8 : 5;
  return (
    <div style={{ width: w, height: h, background: "#1e1e1e", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${(score / 4) * 100}%`, height: "100%", background: NEED_COLOR[score], borderRadius: 3 }} />
    </div>
  );
}

function ToggleRow({ label, sub, value, onChange }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#0A0A0A", borderRadius: 8, border: "1px solid #1e1e1e" }}>
      <div>
        <div style={{ color: "#ccc", fontSize: 13 }}>{label}</div>
        <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>{sub}</div>
      </div>
      <div
        style={{ width: 40, height: 22, borderRadius: 11, background: value ? "#E8B84B" : "#2a2a2a", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}
        onClick={() => onChange(!value)}
      >
        <div style={{ position: "absolute", top: 3, left: value ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  root:      { minHeight: "100vh", background: "#0A0A0A", color: "#fff", fontFamily: "'DM Mono', 'Courier New', monospace", display: "flex", flexDirection: "column" },
  header:    { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #161616", background: "#0D0D0D", flexWrap: "wrap", gap: 12 },
  headerLeft: { display: "flex", alignItems: "center", gap: 14 },
  headerIcon: { fontSize: 28, filter: "drop-shadow(0 0 6px #E8B84B)" },
  headerTitle: { fontSize: 17, fontWeight: 900, color: "#fff", letterSpacing: 1 },
  headerSub:  { fontSize: 10, color: "#E8B84B", letterSpacing: 1, marginTop: 2 },
  headerStats: { display: "flex", gap: 12 },
  statBox:   { display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 14px", border: "1px solid #1e1e1e", borderRadius: 8 },
  statNum:   { fontSize: 20, fontWeight: 900 },
  statLbl:   { fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginTop: 2 },
  tabs:      { display: "flex", borderBottom: "1px solid #161616", background: "#0D0D0D", padding: "0 16px" },
  tab:       { background: "none", border: "none", color: "#555", padding: "13px 18px", cursor: "pointer", fontSize: 13, borderBottom: "2px solid transparent", transition: "all 0.15s" },
  tabActive:  { color: "#E8B84B", borderBottomColor: "#E8B84B" },
  body:      { flex: 1, padding: 20, overflowY: "auto" },
  twoCol:    { display: "grid", gridTemplateColumns: "340px 1fr", gap: 20, height: "100%" },
  leftCol:   { overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 },
  rightCol:  { overflowY: "auto" },
  card:      { background: "#0F0F0F", border: "1px solid #1a1a1a", borderRadius: 12, padding: 18 },
  cardTitle: { fontSize: 11, color: "#E8B84B", textTransform: "uppercase", letterSpacing: 2, marginBottom: 14, fontWeight: 700 },
  field:     { marginBottom: 18 },
  label:     { display: "block", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 7 },
  select:    { width: "100%", background: "#0A0A0A", border: "1px solid #1e1e1e", borderRadius: 7, color: "#ddd", padding: "10px 12px", fontSize: 13, outline: "none", fontFamily: "inherit" },
  input:     { width: "100%", background: "#0A0A0A", border: "1px solid #1e1e1e", borderRadius: 7, color: "#ddd", padding: "10px 12px", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" },
  numRow:    { display: "flex", gap: 8 },
  numBtn:    { padding: "8px 16px", background: "none", border: "1px solid #2a2a2a", borderRadius: 7, color: "#555", cursor: "pointer", fontSize: 14, fontWeight: 700 },
  numBtnActive: { borderColor: "#E8B84B", color: "#E8B84B" },
  searchBtn: { width: "100%", padding: "14px", background: "linear-gradient(135deg, #E8B84B, #C9956C)", border: "none", borderRadius: 9, color: "#000", fontSize: 13, fontWeight: 900, cursor: "pointer", letterSpacing: 2, textTransform: "uppercase" },
  flowRow:   { display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #141414" },
  flowIcon:  { fontSize: 18, flexShrink: 0, marginTop: 2 },
  flowTitle: { fontSize: 13, color: "#ccc", fontWeight: 700 },
  flowDesc:  { fontSize: 11, color: "#555", marginTop: 2 },
  leadCard:  { background: "#0F0F0F", border: "1px solid #1e1e1e", borderRadius: 10, padding: "12px 14px", marginBottom: 10, cursor: "pointer", transition: "all 0.15s" },
  leadName:  { fontSize: 13, fontWeight: 700, color: "#ddd", lineHeight: 1.3 },
  leadMeta:  { fontSize: 11, color: "#555", marginTop: 3 },
  miniActionBtn: { marginTop: 8, background: "none", border: "1px solid #2a2a2a", borderRadius: 6, color: "#E8B84B", padding: "4px 10px", cursor: "pointer", fontSize: 11 },
  detail:    { background: "#0F0F0F", border: "1px solid #1a1a1a", borderRadius: 12, padding: 22 },
  infoGrid:  { background: "#0A0A0A", borderRadius: 8, padding: "10px 14px", marginBottom: 14 },
  infoRow:   { display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #141414" },
  infoKey:   { fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1 },
  infoVal:   { fontSize: 12, color: "#aaa" },
  analysisBox: { background: "#0A0A0A", borderRadius: 8, padding: "12px 14px", marginBottom: 14, border: "1px solid #1e1e1e" },
  emailBox:  { background: "#0A0A0A", border: "1px solid #1e1e1e", borderRadius: 8, padding: 16, maxHeight: 280, overflowY: "auto", marginTop: 8 },
  subTab:    { padding: "5px 12px", background: "none", border: "1px solid #2a2a2a", borderRadius: 6, color: "#555", cursor: "pointer", fontSize: 11 },
  subTabActive: { borderColor: "#E8B84B", color: "#E8B84B" },
  actionBtn: { padding: "11px 18px", background: "#1e1e1e", border: "1px solid #2a2a2a", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 },
  rejectBtn: { padding: "11px 16px", background: "none", border: "1px solid #C97B6C", borderRadius: 8, color: "#C97B6C", cursor: "pointer", fontSize: 13 },
  logBox:    { background: "#070707", border: "1px solid #141414", borderRadius: 10, padding: 18, height: 480, overflowY: "auto" },
  empty:     { color: "#2a2a2a", textAlign: "center", padding: "40px 0", fontSize: 13 },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  select option { background: #111; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #222; border-radius: 4px; }
  button:hover { filter: brightness(1.12); }
`;
