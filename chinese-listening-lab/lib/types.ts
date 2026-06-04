export interface Card {
  h: string;
  p: string;
  e: string;
}

export interface Lesson {
  id: string;
  title: string;
  createdAt: number;
  cards: Card[];
}

export type Mode = 'flash' | 'quiz' | 'edit';

export const GEN_ID = 'GEN_PRACTICE';
export const COMBINED_ID = 'COMBINED_ALL';
