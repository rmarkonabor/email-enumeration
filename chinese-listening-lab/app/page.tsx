'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Sidebar from '@/components/Sidebar';
import ControlsBar from '@/components/ControlsBar';
import FlashCard from '@/components/FlashCard';
import Quiz from '@/components/Quiz';
import Editor from '@/components/Editor';
import { getLessons, saveLessons, getSettings, saveSettings } from '@/lib/storage';
import { extractFile, chunkPages, fallbackParse } from '@/lib/pdfExtract';
import type { Card, Lesson, Mode } from '@/lib/types';
import { GEN_ID, COMBINED_ID } from '@/lib/types';

/* ── helpers ── */
function shuffle<T>(a: T[]): T[] {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isZhVoice(v: SpeechSynthesisVoice) {
  const lang = v.lang.toLowerCase().replace(/_/g, '-');
  const name = v.name.toLowerCase();
  return (
    lang.startsWith('zh') || lang.startsWith('cmn') || lang.startsWith('yue') ||
    /chinese|mandarin|putonghua|普通话|国语|中文|cantonese/.test(name)
  );
}

/* ── component ── */
export default function Home() {
  /* persisted */
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [rate, setRate] = useState(0.7);

  /* navigation */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('flash');
  const [showPinyin, setShowPinyin] = useState(true);

  /* voices */
  const [allVoices, setAllVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [zhVoices, setZhVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [chosenVoiceURI, setChosenVoiceURI] = useState<string | null>(null);

  /* flashcard */
  const [fQueue, setFQueue] = useState<number[]>([]);
  const [fPos, setFPos] = useState(0);
  const [fRevealed, setFRevealed] = useState(false);

  /* quiz */
  const [qQueue, setQQueue] = useState<number[]>([]);
  const [qPos, setQPos] = useState(0);
  const [qScore, setQScore] = useState(0);
  const [qAnswered, setQAnswered] = useState(false);
  const [qChosenAnswer, setQChosenAnswer] = useState<string | null>(null);
  const [qOptions, setQOptions] = useState<string[]>([]);

  /* ui */
  const [toast, setToast] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [loadingSubMsg, setLoadingSubMsg] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);

  /* token cost tracking — $3/1M input, $15/1M output (claude-sonnet-4) */
  const [sessionTokens, setSessionTokens] = useState({ input: 0, output: 0 });
  function addUsage(u: { input_tokens: number; output_tokens: number }) {
    setSessionTokens(prev => ({ input: prev.input + u.input_tokens, output: prev.output + u.output_tokens }));
  }
  const sessionCostUSD = (sessionTokens.input * 3 + sessionTokens.output * 15) / 1_000_000;

  /* stable refs so speak() doesn't need deps */
  const rateRef = useRef(rate);
  const allVoicesRef = useRef(allVoices);
  const chosenVoiceURIRef = useRef(chosenVoiceURI);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { allVoicesRef.current = allVoices; }, [allVoices]);
  useEffect(() => { chosenVoiceURIRef.current = chosenVoiceURI; }, [chosenVoiceURI]);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* derived */
  const cards = useMemo(
    () => lessons.find(l => l.id === currentId)?.cards ?? [],
    [lessons, currentId],
  );

  /* ── boot ── */
  useEffect(() => {
    const s = getSettings();
    setRate(s.rate);
    const ls = getLessons();
    if (ls.length) {
      setLessons(ls);
      const last = ls[ls.length - 1];
      setCurrentId(last.id);
      setFQueue(shuffle(last.cards.map((_, i) => i)));
      setFPos(0);
      setFRevealed(false);
    }
    // poll for pdf.js CDN script to finish loading
    const iv = setInterval(() => {
      if (typeof window !== 'undefined' && window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        clearInterval(iv);
      }
    }, 300);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── voice loading ── */
  useEffect(() => {
    function refresh() {
      const voices = window.speechSynthesis.getVoices();
      const zh = voices.filter(isZhVoice);
      setAllVoices(voices);
      setZhVoices(zh);
      if (zh.length) setChosenVoiceURI(prev => prev ?? zh[0].voiceURI);
    }
    window.speechSynthesis.onvoiceschanged = refresh;
    refresh();
    let polls = 0;
    const iv = setInterval(() => { refresh(); if (++polls > 14) clearInterval(iv); }, 400);
    return () => {
      clearInterval(iv);
      window.speechSynthesis.cancel();
    };
  }, []);

  /* ── toast ── */
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  /* ── speak ── */
  const speak = useCallback((text: string) => {
    if (!text) return;
    setIsSpeaking(true);
    const done = () => setIsSpeaking(false);
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = rateRef.current;
    const v = allVoicesRef.current.find(v => v.voiceURI === chosenVoiceURIRef.current);
    if (v) u.voice = v;
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }, []);

  /* ── lesson utils ── */
  function buildCombinedCards(ls: Lesson[]): Card[] {
    const seen = new Set<string>();
    const out: Card[] = [];
    ls.filter(l => l.id !== GEN_ID && l.id !== COMBINED_ID).forEach(L =>
      L.cards.forEach(c => {
        const h = c.h.trim();
        if (h && !seen.has(h)) { seen.add(h); out.push({ h, p: c.p.trim(), e: c.e.trim() }); }
      })
    );
    return out;
  }

  function refreshCombined(ls: Lesson[]): Lesson[] {
    const idx = ls.findIndex(l => l.id === COMBINED_ID);
    if (idx === -1) return ls;
    const next = [...ls];
    next[idx] = { ...next[idx], cards: buildCombinedCards(ls), createdAt: Date.now() };
    return next;
  }

  /* ── flash / quiz init ── */
  function startFlash(cardList: Card[]) {
    setFQueue(shuffle(cardList.map((_, i) => i)));
    setFPos(0);
    setFRevealed(false);
  }

  function makeQOptions(cardList: Card[], qi: number, queue: number[]): string[] {
    if (qi >= queue.length) return [];
    const ci = queue[qi];
    const correct = cardList[ci]?.e || '(?)';
    const pool = cardList.filter((_, i) => i !== ci).map(c => c.e).filter(e => e && e !== correct);
    return shuffle([correct, ...shuffle([...new Set(pool)]).slice(0, 3)]);
  }

  function startQuiz(cardList: Card[]) {
    const quizable = cardList.map((_, i) => i).filter(i => cardList[i].e?.trim());
    const queue = shuffle(quizable.length >= 2 ? quizable : cardList.map((_, i) => i));
    setQQueue(queue);
    setQPos(0);
    setQScore(0);
    setQAnswered(false);
    setQChosenAnswer(null);
    setQOptions(makeQOptions(cardList, 0, queue));
  }

  function openLesson(id: string, ls?: Lesson[]) {
    window.speechSynthesis?.cancel();
    const list = ls ?? lessons;
    const L = list.find(l => l.id === id);
    if (!L) return;
    setCurrentId(id);
    setMode('flash');
    startFlash(L.cards);
  }

  /* ── upload ── */
  async function handleUpload(files: FileList) {
    setIsUploading(true);
    const fileArr = Array.from(files);
    const newLessons: Lesson[] = [];
    let anyApprox = false;

    for (let f = 0; f < fileArr.length; f++) {
      const file = fileArr[f];
      setLoadingMsg(`Reading "${file.name}"…`);
      setLoadingSubMsg(
        fileArr.length > 1
          ? `File ${f + 1} of ${fileArr.length}. Extracting text and parsing into study cards.`
          : 'Extracting text and parsing into study cards.'
      );

      try {
        if (!window.pdfjsLib || !window.mammoth) {
          throw new Error('PDF library still loading — try again in a moment');
        }
        const pages = await extractFile(file);
        if (!/[一-鿿]/.test(pages.join(''))) {
          showToast(file.name + ': No Chinese text found');
          continue;
        }
        const chunks = chunkPages(pages);
        let all: Card[] = [];
        let approx = false;

        try {
          for (let i = 0; i < chunks.length; i++) {
            setLoadingMsg(`Parsing cards… (${i + 1}/${chunks.length})`);
            const res = await fetch('/api/parse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: chunks[i] }),
            });
            if (!res.ok) throw new Error('parse ' + res.status);
            const d = await res.json();
            const c: Card[] = d.cards ?? d; // backward compat
            if (d.usage) addUsage(d.usage);
            all = all.concat(Array.isArray(c) ? c : []);
          }
        } catch {
          all = fallbackParse(pages);
          approx = true;
        }

        const seen = new Set<string>();
        const parsed: Card[] = [];
        all.forEach(c => {
          const h = (c.h || '').trim();
          if (h && !seen.has(h)) { seen.add(h); parsed.push({ h, p: (c.p || '').trim(), e: (c.e || '').trim() }); }
        });

        newLessons.push({
          id: 'L' + Date.now() + '_' + f,
          title: file.name.replace(/\.(pdf|docx)$/i, '').slice(0, 60) || 'Lesson',
          createdAt: Date.now(),
          cards: parsed,
        });
        if (approx) anyApprox = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        showToast("Couldn't process " + file.name + ': ' + msg);
      }
    }

    setIsUploading(false);

    if (newLessons.length > 0) {
      setLessons(prev => {
        const next = refreshCombined([...prev, ...newLessons]);
        saveLessons(next);
        return next;
      });
      const last = newLessons[newLessons.length - 1];
      setCurrentId(last.id);
      setMode('flash');
      startFlash(last.cards);
      showToast(`Added ${newLessons.length} lesson${newLessons.length > 1 ? 's' : ''}${anyApprox ? ' (some rough — review in Edit)' : ''}`);
    }
  }

  /* ── generate practice sentences ── */
  async function handleGenerate() {
    const seen = new Set<string>();
    const pool: Card[] = [];
    lessons.forEach(L => {
      if (L.id === GEN_ID || L.id === COMBINED_ID) return;
      L.cards.forEach(c => {
        const h = c.h.trim();
        if (h && !seen.has(h)) { seen.add(h); pool.push(c); }
      });
    });

    if (pool.length < 3) {
      showToast(`Need at least 3 words — found ${pool.length}. Upload lesson PDFs first.`);
      return;
    }

    setIsGenerating(true);
    setLoadingMsg('Writing practice sentences…');
    setLoadingSubMsg(`Building from ${pool.length} words across your lessons.`);

    try {
      const vocab = pool.map(c => c.h + (c.e ? ` (${c.e})` : '')).join('、');
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocab }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      const gen: Card[] = d.cards ?? d;
      if (d.usage) addUsage(d.usage);
      if (!gen.length) throw new Error('No sentences returned. Try again.');

      const L: Lesson = { id: GEN_ID, title: '✦ Practice sentences', createdAt: Date.now(), cards: gen };
      setLessons(prev => {
        const idx = prev.findIndex(l => l.id === GEN_ID);
        const next = idx >= 0 ? prev.map((l, i) => i === idx ? L : l) : [...prev, L];
        saveLessons(next);
        return next;
      });
      setCurrentId(GEN_ID);
      setMode('flash');
      startFlash(gen);
      showToast(`Generated ${gen.length} sentences`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      showToast('Generate failed: ' + msg);
    } finally {
      setIsGenerating(false);
    }
  }

  /* ── combine ── */
  function handleCombine() {
    const sources = lessons.filter(l => l.id !== GEN_ID && l.id !== COMBINED_ID);
    if (!sources.length) { showToast('Upload some lessons first'); return; }
    const combined = buildCombinedCards(lessons);
    const L: Lesson = { id: COMBINED_ID, title: '⊕ All lessons combined', createdAt: Date.now(), cards: combined };
    setLessons(prev => {
      const idx = prev.findIndex(l => l.id === COMBINED_ID);
      const next = idx >= 0 ? prev.map((l, i) => i === idx ? L : l) : [...prev, L];
      saveLessons(next);
      return next;
    });
    setCurrentId(COMBINED_ID);
    setMode('flash');
    startFlash(combined);
    showToast(`${combined.length} cards from ${sources.length} lesson${sources.length > 1 ? 's' : ''}`);
  }

  /* ── delete ── */
  function handleDeleteLesson(id: string) {
    if (!confirm('Delete this lesson?')) return;
    setLessons(prev => {
      const next = refreshCombined(prev.filter(l => l.id !== id));
      saveLessons(next);
      return next;
    });
    if (currentId === id) {
      setCurrentId(null);
      window.speechSynthesis?.cancel();
    }
  }

  /* ── rename ── */
  function handleRename() {
    const L = lessons.find(l => l.id === currentId);
    if (!L) return;
    const n = prompt('Lesson name:', L.title);
    if (n?.trim()) {
      setLessons(prev => {
        const next = prev.map(l => l.id === currentId ? { ...l, title: n.trim() } : l);
        saveLessons(next);
        return next;
      });
    }
  }

  /* ── save from editor ── */
  function handleSaveCards(updated: Card[]) {
    setLessons(prev => {
      let next = prev.map(l => l.id === currentId ? { ...l, cards: updated } : l);
      if (currentId !== COMBINED_ID) next = refreshCombined(next);
      saveLessons(next);
      return next;
    });
    setMode('flash');
    startFlash(updated);
    showToast('Saved');
  }

  /* ── mode switch ── */
  function switchMode(m: Mode) {
    setMode(m);
    if (m === 'flash') startFlash(cards);
    if (m === 'quiz') startQuiz(cards);
  }

  /* ── rate change ── */
  function handleRateChange(v: number) {
    setRate(v);
    saveSettings({ rate: v });
  }

  /* ── quiz ── */
  function handleAnswer(chosen: string) {
    if (qAnswered) return;
    setQAnswered(true);
    setQChosenAnswer(chosen);
    const correct = cards[qQueue[qPos]]?.e || '(?)';
    if (chosen === correct) setQScore(s => s + 1);
  }

  function handleQuizNext() {
    const next = qPos + 1;
    setQPos(next);
    setQAnswered(false);
    setQChosenAnswer(null);
    setQOptions(makeQOptions(cards, next, qQueue));
  }

  /* ── flashcard nav ── */
  function flashGot() { setFPos(p => p + 1); setFRevealed(false); }
  function flashAgain() {
    setFQueue(q => { const n = [...q]; const x = n.splice(fPos, 1)[0]; n.push(x); return n; });
    setFRevealed(false);
  }

  /* ── render ── */
  const currentLesson = lessons.find(l => l.id === currentId);

  function renderStage() {
    if (!currentLesson) return null;

    if (!cards.length) {
      return <div className="center-msg"><p>This lesson has no cards yet. Use &ldquo;Edit cards&rdquo; to add some.</p></div>;
    }

    if (mode === 'edit') {
      return (
        <Editor
          initialCards={cards}
          onSave={handleSaveCards}
          onCancel={() => { setMode('flash'); startFlash(cards); }}
          onUsage={addUsage}
        />
      );
    }

    if (mode === 'flash') {
      if (fPos >= fQueue.length) {
        return (
          <div className="center-msg">
            <div className="han-watermark">好</div>
            <div className="big">Deck complete!</div>
            <p>You went through all {cards.length} cards.</p>
            <div className="row">
              <button className="btn btn-primary" onClick={() => startFlash(cards)}>Go again</button>
            </div>
          </div>
        );
      }
      const card = cards[fQueue[fPos]];
      if (!card) return null;
      return (
        <FlashCard
          card={card}
          pos={fPos}
          total={fQueue.length}
          revealed={fRevealed}
          showPinyin={showPinyin}
          isSpeaking={isSpeaking}
          canGoPrev={fPos > 0}
          onReveal={() => setFRevealed(true)}
          onGot={flashGot}
          onAgain={flashAgain}
          onNext={() => { setFPos(p => p + 1); setFRevealed(false); }}
          onPrev={() => { setFPos(p => Math.max(0, p - 1)); setFRevealed(false); }}
          onSpeak={speak}
        />
      );
    }

    if (mode === 'quiz') {
      if (cards.length < 2 || !cards.some(c => c.e?.trim())) {
        return (
          <div className="center-msg">
            <p>The quiz needs at least 2 cards with English meanings. Open <b>Edit cards</b> and tap <b>✦ Fill pinyin/English (AI)</b> to add them.</p>
          </div>
        );
      }
      if (qPos >= qQueue.length) {
        const pct = qQueue.length ? Math.round(100 * qScore / qQueue.length) : 0;
        return (
          <div className="center-msg">
            <div className="han-watermark">{pct >= 80 ? '优' : pct >= 50 ? '良' : '练'}</div>
            <div className="big">{qScore} / {qQueue.length} correct</div>
            <p>{pct >= 80 ? 'Excellent listening!' : pct >= 50 ? 'Good — keep training your ear.' : 'Keep going, it builds fast.'}</p>
            <div className="row">
              <button className="btn btn-primary" onClick={() => startQuiz(cards)}>Try again</button>
            </div>
          </div>
        );
      }
      const qCard = cards[qQueue[qPos]];
      if (!qCard) return null;
      return (
        <Quiz
          card={qCard}
          pos={qPos}
          total={qQueue.length}
          score={qScore}
          answered={qAnswered}
          chosenAnswer={qChosenAnswer}
          options={qOptions}
          showPinyin={showPinyin}
          isSpeaking={isSpeaking}
          onAnswer={handleAnswer}
          onNext={handleQuizNext}
          onSpeak={speak}
        />
      );
    }

    return null;
  }

  function renderMain() {
    if (isUploading || isGenerating) {
      return (
        <div className="stage">
          <div className="center-msg">
            <div className="spinner" />
            <div className="big">{loadingMsg}</div>
            <p>{loadingSubMsg}</p>
          </div>
        </div>
      );
    }

    if (!currentLesson) {
      return (
        <div className="stage">
          <div className="center-msg">
            <div className="han-watermark">听</div>
            <div className="big">Train your ear</div>
            <p>Upload lesson PDFs or Word docs from your teacher — several at once is fine. Each gets parsed into clean cards (Chinese · pinyin · English) and saved here.</p>
            <p style={{ color: 'var(--jade-deep)' }}>
              Practice with flashcards or the listening quiz — and once you have a few lessons, tap <b>✦ Make practice sentences</b> to have new sentences written from everything you&apos;ve learned.
            </p>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="topbar">
          <div>
            <h2>{currentLesson.title}</h2>
            <div className="sub">{currentLesson.cards.length} cards · added {fmtDate(currentLesson.createdAt)}</div>
          </div>
          {mode !== 'edit' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="mini" onClick={handleRename}>Rename</button>
              <button className="mini" onClick={() => setMode('edit')}>Edit cards</button>
            </div>
          )}
        </div>

        {mode !== 'edit' && (
          <div className="tabs">
            {(['flash', 'quiz'] as Mode[]).map(m => (
              <button key={m} className={`tab${mode === m ? ' active' : ''}`} onClick={() => switchMode(m)}>
                {m === 'flash' ? 'Flashcards' : 'Listening quiz'}
              </button>
            ))}
          </div>
        )}

        {mode !== 'edit' && (
          <ControlsBar
            rate={rate}
            onRateChange={handleRateChange}
            showPinyin={showPinyin}
            onTogglePinyin={() => setShowPinyin(p => !p)}
            allVoices={allVoices}
            zhVoices={zhVoices}
            chosenVoiceURI={chosenVoiceURI}
            onVoiceChange={setChosenVoiceURI}
          />
        )}

        {mode !== 'edit' && !zhVoices.length && (
          <div className="banner">
            No Mandarin voice detected. Install one in your system settings (Language &amp; Speech → add Chinese), then reload.
            <button className="mini" style={{ marginLeft: 6 }} onClick={() => speak('你好')}>
              Test sound 🔊
            </button>
          </div>
        )}

        <div className="stage">
          {renderStage()}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="app">
        {sessionTokens.input + sessionTokens.output > 0 && (
          <div className="cost-badge" title={`${sessionTokens.input.toLocaleString()} input + ${sessionTokens.output.toLocaleString()} output tokens`}>
            API cost: ${sessionCostUSD < 0.001 ? sessionCostUSD.toFixed(5) : sessionCostUSD.toFixed(4)}
          </div>
        )}
        <Sidebar
          lessons={lessons}
          currentId={currentId}
          isUploading={isUploading}
          isGenerating={isGenerating}
          onUpload={handleUpload}
          onGenerate={handleGenerate}
          onCombine={handleCombine}
          onSelectLesson={id => openLesson(id)}
          onDeleteLesson={handleDeleteLesson}
        />
        <main className="main">
          {renderMain()}
        </main>
      </div>
      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}
