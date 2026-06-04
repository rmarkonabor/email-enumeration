import { NextRequest, NextResponse } from 'next/server';

const SYSTEM = `You are a Chinese teacher creating LISTENING practice for a beginner (about one month in).
You are given the student's known vocabulary and phrases, gathered from all their lessons.
Generate 12 short, natural Mandarin sentences that reuse THIS vocabulary so the student can practice hearing it in context.
Rules: prefer words/characters from the provided list; keep sentences short and beginner-level; vary the patterns (statements, 吗/吧 questions, 喜欢, 是, time with 点, etc.); each sentence should be genuinely useful and grammatical.
For each sentence give the Chinese characters, accurate Hanyu Pinyin with tone marks, and a natural English translation.
Respond with ONLY a minified JSON array, no markdown, no commentary. Schema: [{"h":"汉字","p":"pinyin","e":"English"}]`;

export async function POST(req: NextRequest) {
  const { vocab } = await req.json();
  if (!vocab) return NextResponse.json({ error: 'No vocab' }, { status: 400 });

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
      max_tokens: 3072,
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Known vocabulary:\n' + vocab }],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return NextResponse.json({ error: `API error ${res.status}`, details: t.slice(0, 200) }, { status: res.status });
  }

  const data = await res.json();
  if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 });

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
  return NextResponse.json(
    (Array.isArray(arr) ? arr : [])
      .map((c: { h?: string; p?: string; e?: string }) => ({
        h: String(c.h ?? '').trim(),
        p: String(c.p ?? '').trim(),
        e: String(c.e ?? '').trim(),
      }))
      .filter((c: { h: string }) => c.h)
  );
}
