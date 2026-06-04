// Client-side only — relies on pdf.js and mammoth loaded via CDN <Script> tags in layout.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Card } from './types';

declare global {
  interface Window {
    pdfjsLib: any;
    mammoth: any;
  }
}

export async function extractPages(file: File): Promise<string[]> {
  const lib = window.pdfjsLib;
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines: Record<number, string[]> = {};
    const order: number[] = [];
    (tc.items as any[]).forEach((it: any) => {
      const y = Math.round(it.transform[5]);
      if (!(y in lines)) { lines[y] = []; order.push(y); }
      lines[y].push(it.str);
    });
    order.sort((a, b) => b - a);
    pages.push(order.map(y => lines[y].join('')).join('\n'));
  }
  return pages;
}

export async function extractDocx(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return (r.value || '').split(/\n{2,}/).map((s: string) => s.trim()).filter(Boolean);
}

export async function extractFile(file: File): Promise<string[]> {
  if (file.name.toLowerCase().endsWith('.docx')) return extractDocx(file);
  return extractPages(file);
}

export function chunkPages(pages: string[]): string[] {
  const BUD = 2400;
  const chunks: string[] = [];
  let cur = '';
  const push = (t: string) => {
    if (cur.length + t.length > BUD && cur) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + t;
  };
  pages.forEach(pg => {
    const t = (pg || '').trim();
    if (!t) return;
    if (t.length > BUD) t.split(/\n/).forEach(l => push(l));
    else push(t);
  });
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

export function fallbackParse(pages: string[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  pages.join('\n').split(/\n+/).forEach(line => {
    const m = line.match(/[一-鿿][一-鿿。！？，、]*/g);
    if (m) m.forEach(seg => {
      const h = seg.replace(/[。！？，、]+$/, '');
      if (h.length >= 1 && !seen.has(h)) { seen.add(h); out.push({ h, p: '', e: '' }); }
    });
  });
  return out;
}
