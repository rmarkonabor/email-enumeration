import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { items } = await req.json();
  if (!items?.length) return NextResponse.json({ error: 'No items' }, { status: 400 });

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
      max_tokens: 4096,
      system:
        'For each Chinese word or sentence in the list, give accurate Hanyu Pinyin (with tone marks) and a concise, natural English meaning. Keep the SAME items in the SAME order; do not add, merge, or drop any. Respond with ONLY a minified JSON array, schema [{"h":"汉字","p":"pinyin","e":"English"}].',
      messages: [{ role: 'user', content: (items as string[]).join('\n') }],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return NextResponse.json({ error: `API error ${res.status}`, details: t.slice(0, 200) }, { status: res.status });
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

  const map: Record<string, { h: string; p: string; e: string }> = {};
  (Array.isArray(arr) ? arr : []).forEach((c: { h?: string; p?: string; e?: string }) => {
    if (c?.h) map[String(c.h).trim()] = { h: String(c.h).trim(), p: String(c.p ?? '').trim(), e: String(c.e ?? '').trim() };
  });
  return NextResponse.json({
    map,
    usage: { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 },
  });
}
