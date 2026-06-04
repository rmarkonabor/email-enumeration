import type { Lesson } from './types';

const LESSONS_KEY = 'cll_lessons_v2';
const SETTINGS_KEY = 'cll_settings';

export function getLessons(): Lesson[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LESSONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveLessons(lessons: Lesson[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LESSONS_KEY, JSON.stringify(lessons)); } catch {}
}

export function getSettings(): { rate: number } {
  if (typeof window === 'undefined') return { rate: 0.7 };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.rate === 'number') return { rate: s.rate };
    }
  } catch {}
  return { rate: 0.7 };
}

export function saveSettings(s: { rate: number }): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
