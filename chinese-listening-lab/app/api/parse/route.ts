import { NextRequest, NextResponse } from 'next/server';

const SYSTEM = `You convert raw text extracted from a Chinese-language lesson PDF (usually messy slide text, often out of order) into clean study cards for a beginner.
Each card is ONE item to learn: a vocabulary word, a set phrase, or a short useful example sentence, written in Chinese.
For each card output: the Chinese characters, accurate Hanyu Pinyin WITH tone marks, and a concise English meaning.
INCLUDE: real vocabulary words, set phrases (你好, 对不起, 没关系...), and whole example sentences (我叫菲凡。, 你要喝水吗？...).
EXCLUDE: pronunciation guides like "Like 'b' in boy", section titles (声母, 韵母, Daily expressions, About Me), pinyin letter drills (b-ā-bā, the tone tables a/o/e), lone pinyin syllables with no characters, page numbers, English-only meta text, and decorative words.
If pinyin is missing, wrong, or split awkwardly, supply the correct standard pinyin yourself. Keep example sentences as single cards (do not split them).
Deduplicate. Respond with ONLY a minified JSON array, no markdown fences, no commentary.
Schema: [{"h":"汉字","p":"pinyin","e":"English meaning"}]`;

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text) return NextResponse.json({ error: 'No text' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Lesson text:\n\n' + text }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return NextResponse.json({ error: `API error ${res.status}`, details: err.slice(0, 200) }, { status: res.status });
  }

  const data = await res.json();
  let out = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim()
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const s = out.indexOf('['), e = out.lastIndexOf(']');
  if (s >= 0 && e >= 0) out = out.slice(s, e + 1);
  const arr = JSON.parse(out);
  return NextResponse.json({
    cards: Array.isArray(arr) ? arr : [],
    usage: { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 },
  });
}
