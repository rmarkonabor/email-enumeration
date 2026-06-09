'use client';

import { useState } from 'react';
import type { Card } from '@/lib/types';

interface Props {
  initialCards: Card[];
  onSave: (cards: Card[]) => void;
  onCancel: () => void;
  onUsage?: (u: { input_tokens: number; output_tokens: number }) => void;
}

export default function Editor({ initialCards, onSave, onCancel }: Props) {
  const [rows, setRows] = useState<Card[]>(initialCards.map(c => ({ ...c })));
  const [filling, setFilling] = useState(false);
  const [fillMsg, setFillMsg] = useState<string | null>(null);

  const addRow = () => setRows(r => [...r, { h: '', p: '', e: '' }]);

  const delRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));

  const updateRow = (i: number, field: keyof Card, value: string) =>
    setRows(r => r.map((row, j) => j === i ? { ...row, [field]: value } : row));

  const handleSave = () => onSave(rows.filter(r => r.h.trim()));

  const handleFill = async () => {
    const items = rows.map(r => r.h.trim()).filter(Boolean);
    if (!items.length) { setFillMsg('No Chinese text to work from'); return; }
    setFilling(true);
    setFillMsg(null);
    try {
      const res = await fetch('/api/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      const map: Record<string, Card> = d.map ?? d;
      if (d.usage) onUsage?.(d.usage);
      let filled = 0;
      setRows(prev => prev.map(row => {
        const h = row.h.trim();
        const c = map[h];
        if (!c) return row;
        const next = { ...row };
        if (!row.p.trim() && c.p) { next.p = c.p; filled++; }
        if (!row.e.trim() && c.e) { next.e = c.e; filled++; }
        return next;
      }));
      setFillMsg(filled ? `Filled ${filled} fields — review, then Save` : 'Nothing was missing');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFillMsg('Fill failed: ' + msg);
    } finally {
      setFilling(false);
    }
  };

  return (
    <div className="editor">
      <p style={{ color: 'var(--ink-faint)', fontSize: 13.5, margin: '0 0 14px' }}>
        Fix anything the parser got wrong, then save. Cards with an English meaning can be used in the quiz.
      </p>
      {fillMsg && (
        <p style={{ color: 'var(--jade-deep)', fontSize: 13.5, margin: '0 0 10px' }}>{fillMsg}</p>
      )}
      <div className="ehead">
        <span>Chinese</span><span>Pinyin</span><span>English</span><span />
      </div>
      <div>
        {rows.map((row, i) => (
          <div className="erow" key={i}>
            <input className="h" value={row.h} onChange={e => updateRow(i, 'h', e.target.value)} placeholder="汉字" />
            <input className="p" value={row.p} onChange={e => updateRow(i, 'p', e.target.value)} placeholder="pinyin" />
            <input className="e" value={row.e} onChange={e => updateRow(i, 'e', e.target.value)} placeholder="English" />
            <button className="del" title="Remove" onClick={() => delRow(i)}>×</button>
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={addRow}>+ Add card</button>
        <button className="btn btn-primary" disabled={filling} onClick={handleFill}>
          {filling ? '…' : '✦ Fill pinyin/English (AI)'}
        </button>
        <button className="btn btn-jade" onClick={handleSave}>Save</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
