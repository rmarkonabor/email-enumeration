'use client';

import { useEffect } from 'react';
import type { Card } from '@/lib/types';

interface Props {
  card: Card;
  pos: number;
  total: number;
  score: number;
  answered: boolean;
  chosenAnswer: string | null;
  options: string[];
  showPinyin: boolean;
  isSpeaking: boolean;
  onAnswer: (chosen: string) => void;
  onNext: () => void;
  onSpeak: (text: string) => void;
}

export default function Quiz({
  card, pos, total, score, answered, chosenAnswer, options, showPinyin, isSpeaking,
  onAnswer, onNext, onSpeak,
}: Props) {
  useEffect(() => {
    if (card.h) onSpeak(card.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.h]);

  const correct = card.e || '(?)';
  const wasCorrect = chosenAnswer === correct;

  return (
    <div className="quiz">
      <div className="progress">{pos + 1} / {total} &nbsp;·&nbsp; score {score}</div>

      <div className="prompt">
        <button
          className={`speakbtn${isSpeaking ? ' playing' : ''}`}
          title="Play audio"
          onClick={() => onSpeak(card.h)}
        >🔊</button>
        <div className="hanzi">{card.h}</div>
        <div className={`pinyin${showPinyin ? '' : ' hidden'}`}>{card.p || ''}</div>
      </div>

      <div className="opts">
        {options.map((opt, i) => {
          let cls = 'opt';
          if (answered) {
            cls += ' locked';
            if (opt === correct) cls += ' correct';
            else if (opt === chosenAnswer) cls += ' wrong';
          }
          return (
            <button key={i} className={cls} onClick={() => !answered && onAnswer(opt)}>
              {opt}
            </button>
          );
        })}
      </div>

      <div className="score" style={{ marginTop: 18 }}>
        {answered ? (
          <>
            {wasCorrect ? '✓ Correct! ' : `✗ It means "${correct}". `}
            <button
              className="btn btn-primary"
              style={{ fontSize: 14, padding: '8px 18px', marginLeft: 8 }}
              onClick={onNext}
            >Next →</button>
          </>
        ) : (
          'Listen, then choose the meaning.'
        )}
      </div>
    </div>
  );
}
