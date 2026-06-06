import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Storage ──────────────────────────────────────────────────────────────────
const KEY = 'paspasanchrist_v1';
function loadState() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function saveState(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }

// ─── Date Helpers ─────────────────────────────────────────────────────────────
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayLabel() {
  return new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
function isFirstOfMonth() { return new Date().getDate() === 1; }

// 1er du mois : page illustration (index pair) + page contenu (index impair) = 2 pages
// Autres jours : 1 page contenu
function getPagesForDay(history, totalPages, startPage) {
  const start = (startPage || 1) - 1;
  const consumed = history.reduce((s, h) => s + h.pagesRead, 0);
  const count = isFirstOfMonth() ? 2 : 1;
  const pages = [];
  for (let i = 0; i < count; i++) {
    const idx = start + consumed + i;
    if (idx < totalPages) {
      // Sur le 1er du mois : première page = illustration, seconde = contenu
      pages.push({ index: idx, isIllustration: isFirstOfMonth() && i === 0 });
    }
  }
  return pages;
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function callClaude(body) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function extractPage(base64PDF, pageIndex, isIllustration) {
  const prompt = isIllustration
    ? `Page ${pageIndex + 1} de ce PDF est une page d'ouverture de mois avec un titre, une image et un verset biblique. Extrais uniquement : le titre du mois (ex: "Janvier — Poser les fondements de l'Esprit"), le verset biblique et sa référence. Retourne ces éléments clairement séparés, sans commentaire.`
    : `Extrais le texte de la page ${pageIndex + 1} uniquement. Retourne UNIQUEMENT le texte, en conservant les paragraphes et les sections (méditation, intercession, prière personnelle, pensées). Sans commentaire. Si vide, écris "(Page vide)".`;

  const data = await callClaude({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64PDF } },
        { type: 'text', text: prompt }
      ]
    }]
  });
  return data.content?.map(b => b.text || '').join('\n').trim() || '(Erreur)';
}

async function countPages(base64PDF) {
  const data = await callClaude({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 20,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64PDF } },
        { type: 'text', text: 'How many pages does this PDF have? Reply with ONLY a number.' }
      ]
    }]
  });
  const n = parseInt(data.content?.map(b => b.text || '').join('').trim());
  return isNaN(n) ? 1 : n;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [screen, setScreen] = useState('init');
  const [appState, setAppState] = useState(null);
  const [pdfB64, setPdfB64] = useState(null);
  const [startInput, setStartInput] = useState('1');
  const [pendingB64, setPendingB64] = useState(null);
  const [pendingTotal, setPendingTotal] = useState(null);
  const [todayPages, setTodayPages] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState('today');
  const fileRef = useRef();

  useEffect(() => {
    const saved = loadState();
    if (saved?.totalPages) { setAppState(saved); setScreen('upload'); }
    else setScreen('upload');
  }, []);

  useEffect(() => {
    if (!pdfB64 || !appState || screen !== 'reading') return;
    const key = todayKey();
    const existing = appState.history.find(h => h.date === key);
    const pageDescs = existing
      ? existing.pageDescs
      : getPagesForDay(appState.history, appState.totalPages, appState.startPage);
    if (!pageDescs?.length) { setScreen('finished'); return; }
    if (existing) setChecked(existing.checked);
    else setChecked(false);
    loadPages(pdfB64, pageDescs);
  }, [pdfB64, appState, screen]);

  const loadPages = useCallback(async (b64, pageDescs) => {
    setExtracting(true);
    const pages = await Promise.all(pageDescs.map(async p => ({
      ...p,
      text: await extractPage(b64, p.index, p.isIllustration)
    })));
    setTodayPages(pages);
    setExtracting(false);
  }, []);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/pdf') return;
    if (appState?.totalPages) {
      const b64 = await toBase64(file);
      setPdfB64(b64);
      setScreen('reading');
      return;
    }
    setScreen('processing');
    const b64 = await toBase64(file);
    const total = await countPages(b64);
    setPendingB64(b64); setPendingTotal(total);
    setScreen('configure');
  };

  const toBase64 = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  const handleConfigure = () => {
    const sp = Math.max(1, Math.min(parseInt(startInput) || 1, pendingTotal));
    const state = { totalPages: pendingTotal, startPage: sp, history: [] };
    saveState(state); setAppState(state);
    setPdfB64(pendingB64); setPendingB64(null);
    setScreen('reading');
  };

  const toggleCheck = () => {
    const key = todayKey();
    const pageDescs = todayPages.map(({ index, isIllustration }) => ({ index, isIllustration }));
    const next = !checked;
    setChecked(next);
    const existing = appState.history.find(h => h.date === key);
    const newHistory = existing
      ? appState.history.map(h => h.date === key ? { ...h, checked: next } : h)
      : [...appState.history, { date: key, pagesRead: pageDescs.length, pageDescs, checked: next }];
    const updated = { ...appState, history: newHistory };
    setAppState(updated); saveState(updated);
  };

  const handleReset = () => {
    if (!confirm('Réinitialiser entièrement ?')) return;
    localStorage.removeItem(KEY);
    setAppState(null); setPdfB64(null); setTodayPages([]); setChecked(false);
    setScreen('upload');
  };

  const consumed = appState?.history.reduce((s, h) => s + h.pagesRead, 0) ?? 0;
  const total = appState?.totalPages ?? 0;
  const sp = appState?.startPage ?? 1;
  const daysRead = appState?.history.filter(h => h.checked).length ?? 0;
  const pct = total > 0 ? Math.min(100, (consumed / (total - sp + 1)) * 100) : 0;
  const streak = (() => {
    if (!appState?.history.length) return 0;
    let s = 0, prev = null;
    for (const h of [...appState.history].sort((a, b) => b.date.localeCompare(a.date))) {
      if (!h.checked) break;
      if (prev && (new Date(prev) - new Date(h.date)) / 86400000 !== 1) break;
      prev = h.date; s++;
    }
    return s;
  })();

  return (
    <div style={S.root}>
      <div style={S.orb1} /><div style={S.orb2} />

      {/* UPLOAD */}
      {screen === 'upload' && (
        <div style={S.center}>
          <div style={S.cross}>✝</div>
          <h1 style={S.title}>Pas un pas<br/>sans Christ</h1>
          {appState?.totalPages ? (
            <p style={S.sub}>
              Rechargez votre PDF pour continuer.<br/>
              <span style={{ color: C.gold, fontSize: 13 }}>
                Page de départ&nbsp;: {appState.startPage} · {appState.totalPages} pages
              </span>
            </p>
          ) : (
            <p style={S.sub}>Chargez votre PDF pour commencer votre lecture quotidienne.</p>
          )}
          <div style={S.drop}
            onClick={() => fileRef.current.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile({ target: { files: e.dataTransfer.files } }); }}>
            <span style={{ fontSize: 32, color: C.gold }}>⬆</span>
            <p style={{ color: C.text, fontSize: 16, margin: 0, fontWeight: 600 }}>Déposez votre PDF ici</p>
            <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>ou cliquez pour choisir</p>
            <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handleFile} />
          </div>
          <p style={{ color: C.muted, fontSize: 11, maxWidth: 300, textAlign: 'center', lineHeight: 1.6 }}>
            Le PDF est analysé via l'IA mais jamais stocké sur nos serveurs.
          </p>
        </div>
      )}

      {/* PROCESSING */}
      {screen === 'processing' && (
        <div style={S.center}>
          <div style={S.spinner} />
          <p style={{ color: C.text, fontSize: 16 }}>Analyse du PDF…</p>
          <p style={{ color: C.muted, fontSize: 13 }}>Décompte des pages</p>
        </div>
      )}

      {/* CONFIGURE */}
      {screen === 'configure' && (
        <div style={S.center}>
          <div style={S.cross}>✝</div>
          <h2 style={S.title}>Configuration</h2>
          <p style={S.sub}><strong style={{ color: C.gold }}>{pendingTotal} pages</strong> détectées</p>
          <div style={S.card}>
            <label style={S.label}>Page de départ</label>
            <input style={S.numInput} type="number" min={1} max={pendingTotal}
              value={startInput} onChange={e => setStartInput(e.target.value)} />
            <p style={{ color: C.muted, fontSize: 13 }}>
              Soit <strong style={{ color: C.gold }}>
                {Math.max(0, pendingTotal - (parseInt(startInput) || 1) + 1)} jours
              </strong> de lecture
            </p>
            <button style={S.btn} onClick={handleConfigure}>Commencer →</button>
          </div>
        </div>
      )}

      {/* FINISHED */}
      {screen === 'finished' && (
        <div style={S.center}>
          <div style={{ fontSize: 56, color: C.gold }}>✝</div>
          <h2 style={S.title}>Terminé !</h2>
          <p style={S.sub}>Vous avez parcouru tout le document.<br/>Que Dieu bénisse cette lecture.</p>
          <button style={S.btn} onClick={handleReset}>Charger un nouveau PDF</button>
        </div>
      )}

      {/* READING */}
      {screen === 'reading' && (
        <div style={S.layout}>
          <header style={S.header}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.appName}>✝ Pas un pas sans Christ</div>
              <div style={S.dateStr}>{todayLabel()}</div>
              <div style={S.dateSub}>
                {isFirstOfMonth()
                  ? '✨ Début de mois — ouverture + lecture'
                  : `Page ${sp + consumed} / ${total}`}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Pill icon="🔥" v={streak} l="jours" />
              <Pill icon="✅" v={daysRead} l="lus" />
              <button style={S.gear} onClick={handleReset} title="Réinitialiser">⚙</button>
            </div>
          </header>

          <div style={S.track}><div style={{ ...S.fill, width: `${pct}%` }} /></div>

          <div style={S.tabs}>
            {['today', 'history'].map(t => (
              <button key={t} style={{ ...S.tabBtn, ...(tab === t ? S.tabOn : {}) }} onClick={() => setTab(t)}>
                {t === 'today' ? 'Lecture du jour' : `Historique (${appState?.history.length ?? 0})`}
              </button>
            ))}
          </div>

          {tab === 'today' && (
            <div style={S.content}>
              {extracting ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '60px 0' }}>
                  <div style={S.spinner} />
                  <p style={{ color: C.muted, fontSize: 14 }}>Extraction du texte…</p>
                </div>
              ) : (
                <>
                  {todayPages.map((p) => (
                    p.isIllustration
                      ? <IllustrationCard key={p.index} page={p} />
                      : <ContentCard key={p.index} page={p} />
                  ))}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 8 }}>
                    <button style={{ ...S.checkBtn, ...(checked ? S.checkOn : {}) }} onClick={toggleCheck}>
                      {checked ? '✓ Lu aujourd\'hui !' : 'Marquer comme lu'}
                    </button>
                    {checked && <p style={{ color: C.green, fontSize: 14 }}>Que cette lecture porte du fruit 🌿</p>}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div style={S.content}>
              {!appState?.history.length
                ? <p style={{ color: C.muted, textAlign: 'center', padding: '40px 0' }}>Aucun jour enregistré.</p>
                : [...appState.history].sort((a, b) => b.date.localeCompare(a.date)).map(h => {
                    const hasIllus = h.pageDescs?.some(p => p.isIllustration);
                    return (
                      <div key={h.date} style={S.hRow}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: h.checked ? C.green : C.border, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 15, color: C.text, textTransform: 'capitalize' }}>
                            {new Date(h.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })}
                          </div>
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                            {hasIllus ? '✝ Ouverture de mois' : '📖 Lecture'} · {h.checked ? '✅ Lu' : '⬜ Non lu'}
                          </div>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page Cards ───────────────────────────────────────────────────────────────

function IllustrationCard({ page }) {
  // Parse title and verse from extracted text
  const lines = page.text.split('\n').filter(l => l.trim());
  const titleLine = lines[0] || '';
  const rest = lines.slice(1).join('\n');
  return (
    <div style={S.illustCard}>
      {/* Decorative top border */}
      <div style={S.illustBorder} />
      <div style={S.illustInner}>
        <div style={S.illustLabel}>✦ Ouverture du mois ✦</div>
        <div style={S.illustTitle}>{titleLine}</div>
        {rest && <div style={S.illustVerse}>{rest}</div>}
        <div style={S.doveWrap}>
          <span style={S.dove}>🕊</span>
        </div>
      </div>
    </div>
  );
}

function ContentCard({ page }) {
  // Split text into sections for nicer rendering
  const text = page.text;
  const sections = [];
  const sectionRegex = /^(INTERCESSION\s*:|PRIÈRE PERSONNELLE\s*:|PENSÉES\s*:)/im;
  const parts = text.split(sectionRegex);

  let mainText = parts[0];
  // Extract day title (first line usually "1er Janvier — ...")
  const mainLines = mainText.split('\n');
  const dayTitle = mainLines[0]?.trim();
  const bodyText = mainLines.slice(1).join('\n').trim();

  return (
    <div style={S.pageCard}>
      {dayTitle && <div style={S.dayTitle}>{dayTitle}</div>}
      {bodyText && <div style={S.pageText}>{bodyText}</div>}
      {parts.slice(1).map((part, i) => {
        if (i % 2 === 0) {
          const sectionName = part.trim();
          const sectionBody = parts[i + 2] || '';
          return (
            <div key={i} style={S.section}>
              <div style={S.sectionTitle}>{sectionName}</div>
              <div style={S.sectionBody}>{sectionBody.trim()}</div>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function Pill({ icon, v, l }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: '4px 10px', fontSize: 13 }}>
      <span>{icon}</span>
      <span style={{ fontWeight: 700, color: C.gold }}>{v}</span>
      <span style={{ color: C.muted, fontSize: 11 }}>{l}</span>
    </div>
  );
}

// ─── Design ───────────────────────────────────────────────────────────────────
const C = {
  bg: '#0d0c18', surface: '#151423', card: '#1b1a2e', cardAlt: '#12111e',
  gold: '#c9a84c', goldLight: '#e8c96a', accent2: '#8b6f47',
  green: '#5db87a', text: '#f0ede6', muted: '#8a8898',
  border: 'rgba(201,168,76,0.12)', borderLight: 'rgba(201,168,76,0.25)',
};

const S = {
  root: { minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Georgia','Times New Roman',serif", position: 'relative', overflow: 'hidden' },
  orb1: { position: 'fixed', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle,rgba(201,168,76,0.08) 0%,transparent 70%)', top: -150, right: -150, pointerEvents: 'none' },
  orb2: { position: 'fixed', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle,rgba(139,111,71,0.06) 0%,transparent 70%)', bottom: -100, left: -100, pointerEvents: 'none' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 32, textAlign: 'center', gap: 20, animation: 'fadeIn 0.4s ease' },
  cross: { fontSize: 48, color: C.gold, textShadow: `0 0 30px ${C.gold}44` },
  title: { fontFamily: "'Palatino Linotype','Palatino','Book Antiqua',serif", fontSize: 32, fontWeight: 700, color: C.gold, margin: 0, lineHeight: 1.2 },
  sub: { color: C.muted, fontSize: 15, margin: 0, maxWidth: 340, lineHeight: 1.7 },
  drop: { border: `2px dashed ${C.gold}44`, borderRadius: 16, padding: '40px 36px', cursor: 'pointer', background: 'rgba(201,168,76,0.03)', maxWidth: 360, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  spinner: { width: 34, height: 34, border: `3px solid rgba(201,168,76,0.15)`, borderTop: `3px solid ${C.gold}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '28px 32px', maxWidth: 340, width: '100%', display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' },
  label: { color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' },
  numInput: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.gold, fontSize: 28, fontWeight: 700, padding: '10px 16px', fontFamily: 'inherit', width: '100%', outline: 'none' },
  btn: { background: `linear-gradient(135deg,${C.gold},${C.accent2})`, border: 'none', color: '#0d0c18', padding: '13px 32px', borderRadius: 30, cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', alignSelf: 'center' },
  layout: { maxWidth: 680, margin: '0 auto', padding: '0 0 80px', minHeight: '100vh', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.3s ease' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 20px 14px', borderBottom: `1px solid ${C.border}`, gap: 12 },
  appName: { fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: C.gold, marginBottom: 5, opacity: 0.6 },
  dateStr: { fontFamily: "'Palatino Linotype','Palatino','Book Antiqua',serif", fontSize: 18, fontWeight: 700, color: C.text, textTransform: 'capitalize' },
  dateSub: { color: C.muted, fontSize: 12, marginTop: 3 },
  gear: { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', borderRadius: 8, padding: '4px 10px', fontSize: 15 },
  track: { height: 2, background: 'rgba(201,168,76,0.1)', margin: '0 20px' },
  fill: { height: '100%', background: `linear-gradient(90deg,${C.gold},${C.accent2})`, transition: 'width 0.6s ease' },
  tabs: { display: 'flex', borderBottom: `1px solid ${C.border}`, margin: '0 20px' },
  tabBtn: { flex: 1, background: 'transparent', border: 'none', color: C.muted, padding: '13px 0', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', borderBottom: '2px solid transparent', transition: 'all 0.2s' },
  tabOn: { color: C.gold, borderBottom: `2px solid ${C.gold}` },
  content: { flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 },

  // Illustration card
  illustCard: { background: `linear-gradient(160deg, ${C.cardAlt}, ${C.card})`, borderRadius: 16, border: `1px solid ${C.borderLight}`, overflow: 'hidden', boxShadow: `0 0 40px rgba(201,168,76,0.08)` },
  illustBorder: { height: 3, background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)` },
  illustInner: { padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 },
  illustLabel: { fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: C.gold, opacity: 0.7 },
  illustTitle: { fontFamily: "'Palatino Linotype','Palatino','Book Antiqua',serif", fontSize: 22, fontWeight: 700, color: C.gold, lineHeight: 1.3 },
  illustVerse: { fontSize: 15, lineHeight: 1.8, color: '#c8c4bc', fontStyle: 'italic', maxWidth: 420 },
  doveWrap: { marginTop: 4 },
  dove: { fontSize: 28, opacity: 0.5 },

  // Content card
  pageCard: { background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, padding: '22px 26px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' },
  dayTitle: { fontFamily: "'Palatino Linotype','Palatino','Book Antiqua',serif", fontSize: 17, fontWeight: 700, color: C.goldLight, marginBottom: 14, lineHeight: 1.4 },
  pageText: { fontSize: 15, lineHeight: 1.9, color: '#dedad2', fontFamily: "'Palatino Linotype','Palatino','Book Antiqua',serif", whiteSpace: 'pre-wrap', marginBottom: 8 },
  section: { marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: C.gold, marginBottom: 10 },
  sectionBody: { fontSize: 14, lineHeight: 1.85, color: '#c8c4bc', whiteSpace: 'pre-wrap' },

  checkBtn: { background: 'rgba(201,168,76,0.05)', border: `2px solid ${C.border}`, color: C.text, padding: '13px 38px', borderRadius: 30, cursor: 'pointer', fontSize: 15, fontFamily: 'inherit', transition: 'all 0.25s' },
  checkOn: { background: 'rgba(93,184,122,0.1)', border: `2px solid ${C.green}`, color: C.green },
  hRow: { display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: C.card, borderRadius: 10, border: `1px solid ${C.border}` },
};
