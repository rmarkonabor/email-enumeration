'use client';

import { useEffect } from 'react';
import type { Card } from '@/lib/types';

interface Props {
  card: Card;
  pos: number;
  total: number;
  revealed: boolean;
  showPinyin: boolean;
  isSpeaking: boolean;
  canGoPrev: boolean;
  onReveal: () => void;
  onGot: () => void;
  onAgain: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSpeak: (text: string) => void;
}

export default function FlashCard({
  card, pos, total, revealed, showPinyin, isSpeaking, canGoPrev,
  onReveal, onGot, onAgain, onNext, onPrev, onSpeak,
}: Props) {
  // Auto-play whenever the card changes
  useEffect(() => {
    if (card.h) onSpeak(card.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.h]);

  return (
    <>
      <div className="progress">{pos + 1} / {total}</div>
      <div className="flash">
        <button
          className={`speakbtn${isSpeaking ? ' playing' : ''}`}
          title="Play audio"
          onClick={() => onSpeak(card.h)}
        >🔊</button>
        <div className="hanzi">{card.h}</div>
        <div className={`pinyin${showPinyin ? '' : ' hidden'}`}>{card.p || ''}</div>
        <div className="divider" />
        <div className={`english${revealed ? ' show' : ' placeholder'}`}>{card.e || ''}</div>
      </div>

      <div className="row">
        {revealed ? (
          <>
            <button className="btn btn-ghost" onClick={onAgain}>Review again</button>
            <button className="btn btn-jade" onClick={onGot}>Got it →</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onReveal}>Show meaning</button>
        )}
      </div>

      <div className="nav">
        <button title="Previous" onClick={onPrev} disabled={!canGoPrev}>‹</button>
        <span>tap 🔊 to replay</span>
        <button title="Skip" onClick={onNext}>›</button>
      </div>
    </>
  );
}
