'use client';

import { useRef } from 'react';
import type { Lesson } from '@/lib/types';

interface Props {
  lessons: Lesson[];
  currentId: string | null;
  isUploading: boolean;
  isGenerating: boolean;
  onUpload: (files: FileList) => void;
  onGenerate: () => void;
  onCombine: () => void;
  onSelectLesson: (id: string) => void;
  onDeleteLesson: (id: string) => void;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Sidebar({
  lessons, currentId, isUploading, isGenerating,
  onUpload, onGenerate, onCombine, onSelectLesson, onDeleteLesson,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="side">
      <div className="brand">
        <div className="seal">听</div>
        <div>
          <h1>Listening Lab</h1>
          <p>听力练习 · hear your lessons</p>
        </div>
      </div>

      <button
        className="add-btn"
        disabled={isUploading}
        onClick={() => fileRef.current?.click()}
      >
        {isUploading
          ? <><span className="spinner sm" /> Working…</>
          : '＋ Upload lesson PDFs / DOCX'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          if (e.target.files?.length) {
            onUpload(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <button className="gen-btn" disabled={isGenerating} onClick={onGenerate}>
        {isGenerating
          ? <><span className="spinner sm" /> Generating…</>
          : '✦ Make practice sentences'}
      </button>

      <button className="comb-btn" onClick={onCombine}>
        ⊕ Combine all lessons
      </button>

      <div className="lib-label">Your lessons</div>

      <div className="lib">
        {lessons.length === 0 ? (
          <div className="lib-empty">
            No lessons yet. Upload a PDF from your teacher — it gets parsed into cards and saved here for next time.
          </div>
        ) : (
          [...lessons].reverse().map(L => (
            <div
              key={L.id}
              className={`card-item${L.id === currentId ? ' active' : ''}`}
              onClick={() => onSelectLesson(L.id)}
            >
              <div className="t">{L.title}</div>
              <div className="m">{L.cards.length} cards · {fmtDate(L.createdAt)}</div>
              <button
                className="x"
                title="Delete"
                onClick={e => { e.stopPropagation(); onDeleteLesson(L.id); }}
              >×</button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
