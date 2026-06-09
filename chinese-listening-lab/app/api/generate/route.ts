import { NextRequest, NextResponse } from 'next/server';

const SYSTEM = `You are a Chinese teacher creating LISTENING practice for a beginner (about one month in).
You are given the student's EXACT known vocabulary — every word they have studied.
Generate 12 short Mandarin sentences using ONLY the characters from that vocabulary list.
STRICT RULES:
- Use ONLY the Chinese characters that appear in the provided vocabulary list.
- You may also freely use these essential grammar words even if not in the list: 的 了 吗 吧 呢 啊 呀 哦 嗯 嘛 哈 不 没 很 太 也 都 还 就 才 和 跟 或 在 有 是 个 们 这 那 什么 哪 谁 怎么 为什么 一 两
- Do NOT introduce any other vocabulary not in the list.
- Keep sentences short and beginner-level; vary patterns (statements, 吗/吧 questions, negation with 不/没, degree with 很/太, etc.)
- Each sentence must be grammatical and natural.
For each sentence give the Chinese characters, accurate Hanyu Pinyin with tone marks, and a natural English translation.
Respond with ONLY a minified JSON array, no markdown, no commentary. Schema: [{"h":"汉字","p":"pinyin","e":"English"}]`;

// Characters always allowed regardless of vocab list — grammar particles + essential function words
const ALWAYS_ALLOWED = new Set([
  // sentence-final / modal particles
  '的','了','吗','吧','呢','啊','呀','哦','嗯','嘛','哈',
  // negation
  '不','没',
  // degree adverbs
  '很','太','真','非',
  // common adverbs
  '也','都','还','就','才','再','又',
  // conjunctions
  '和','跟','或',
  // verbs needed for structure
  '在','有','是',
  // demonstratives & question words
  '这','那','什','么','哪','谁','怎','为',
  // grammatical suffixes / measure words
  '个','们','子','儿',
  // small numbers often used structurally
  '一','两',
  // punctuation
  '，','。','？','！','、','：','…',' ','　','\n',
]);

function buildVocabCharSet(vocab: string): Set<string> {
  const s = new Set<string>();
  for (const ch of vocab) {
    if (/[一-鿿㐀-䶿豈-﫿]/.test(ch)) s.add(ch);
  }
  return s;
}

function onlyKnownChars(hanzi: string, known: Set<string>): boolean {
  for (const ch of hanzi) {
    if (ALWAYS_ALLOWED.has(ch)) continue;
    if (/[一-鿿㐀-䶿豈-﫿]/.test(ch) && !known.has(ch)) return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  const { vocab } = await req.json();
  if (!vocab) return NextResponse.json({ error: 'No vocab' }, { status: 400 });
  const vocabChars = buildVocabCharSet(vocab);

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
  const cards = (Array.isArray(arr) ? arr : [])
    .map((c: { h?: string; p?: string; e?: string }) => ({
      h: String(c.h ?? '').trim(),
      p: String(c.p ?? '').trim(),
      e: String(c.e ?? '').trim(),
    }))
    .filter((c: { h: string }) => c.h && onlyKnownChars(c.h, vocabChars));
  return NextResponse.json({
    cards,
    usage: { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 },
  });
}
