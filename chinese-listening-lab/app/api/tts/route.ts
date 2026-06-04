import { NextRequest, NextResponse } from 'next/server';

// ElevenLabs TTS — returns audio/mpeg stream.
// Returns 503 when ELEVENLABS_API_KEY is not set so the client falls back
// to browser SpeechSynthesis gracefully.
//
// Recommended Mandarin-capable voice: "Lily" — pFZP5JQG7iQjIQuC4Bku
// Set ELEVENLABS_VOICE_ID in .env.local to override.

const FALLBACK_VOICE_ID = 'pFZP5JQG7iQjIQuC4Bku';

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ElevenLabs not configured' }, { status: 503 });
  }

  const { text } = await req.json();
  if (!text) return NextResponse.json({ error: 'No text' }, { status: 400 });

  const voiceId = process.env.ELEVENLABS_VOICE_ID || FALLBACK_VOICE_ID;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return NextResponse.json({ error: `ElevenLabs error ${res.status}`, details: err.slice(0, 200) }, { status: res.status });
  }

  const audio = await res.arrayBuffer();
  return new NextResponse(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
