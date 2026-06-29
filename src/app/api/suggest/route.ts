import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface SuggestedClip {
  start: number;
  end: number;
  hook: string;
  reason: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const segments: Segment[] = body.segments;
    const clientKey = req.headers.get("x-groq-key");

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: "No segments provided" },
        { status: 400 }
      );
    }

    const apiKey = clientKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "No Groq API key configured" },
        { status: 401 }
      );
    }

    const groq = new Groq({ apiKey });

    // Build a compact transcript for the LLM
    const transcriptText = segments
      .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
      .join("\n");

    // Truncate if too long (keep within token budget)
    const maxChars = 12000;
    const truncated =
      transcriptText.length > maxChars
        ? transcriptText.slice(0, maxChars) + "\n...[truncated]"
        : transcriptText;

    const prompt = `You are a viral short-form video clipper (TikTok/Reels/Shorts). Analyze this transcript with timestamps and identify the ${body.count || 5} best segments that would make viral clips.

For each segment, return:
- start: start timestamp in seconds (must match a timestamp in the transcript)
- end: end timestamp in seconds (clip should be 15-60 seconds long)
- hook: a punchy 3-8 word text hook/caption for the clip (in the same language as the content)
- reason: one sentence explaining why this segment is clip-worthy

Prioritize: strong statements, emotional moments, surprising facts, punchlines, controversial takes, actionable advice. Avoid: filler, greetings, rambling.

Transcript:
${truncated}

Return ONLY a JSON array, no markdown, no explanation. Format:
[{"start": 12.5, "end": 45.0, "hook": "...", "reason": "..."}]`;

    const completion = await groq.chat.completions.create({
      model: body.model || "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are an expert viral content clipper. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content || "{}";

    // Parse — model may return {"clips": [...]} or just [...]
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract JSON array from the text
      const match = content.match(/\[[\s\S]*\]/);
      parsed = match ? JSON.parse(match[0]) : { clips: [] };
    }

    const clips: SuggestedClip[] = Array.isArray(parsed)
      ? parsed
      : parsed.clips || parsed.segments || [];

    // Validate and sanitize
    const valid = clips
      .filter(
        (c) =>
          typeof c.start === "number" &&
          typeof c.end === "number" &&
          c.start >= 0 &&
          c.end > c.start
      )
      .map((c) => ({
        start: Math.round(c.start * 10) / 10,
        end: Math.round(c.end * 10) / 10,
        hook: String(c.hook || "").slice(0, 120),
        reason: String(c.reason || "").slice(0, 300),
      }))
      .slice(0, body.count || 5);

    return NextResponse.json({ clips: valid });
  } catch (err: any) {
    console.error("[suggest] error:", err);
    const status = err?.status || 500;
    const message =
      err?.error?.error?.message || err?.message || "Suggestion failed";
    return NextResponse.json({ error: message }, { status });
  }
}
