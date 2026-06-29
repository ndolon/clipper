// Cobalt API helper — resolves platform URLs (YouTube, TikTok, etc) to direct stream URLs
// Docs: https://github.com/imputnet/cobalt

const COBALT_API = "https://api.cobalt.tools";

export interface CobaltResponse {
  status: "stream" | "redirect" | "picker" | "error";
  url?: string;
  audio?: string;
  filename?: string;
  error?: { code: string; message?: string };
}

// Platform detection
export function isPlatformUrl(url: string): boolean {
  const platforms = [
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "facebook.com",
    "fb.watch",
    "vimeo.com",
    "dailymotion.com",
    "soundcloud.com",
    "pinterest.com",
    "reddit.com",
    "bilibili.com",
    "twitch.tv",
    "snapchat.com",
  ];
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return platforms.some((p) => hostname.includes(p));
  } catch {
    return false;
  }
}

// Resolve video URL via cobalt
export async function resolveVideo(
  url: string,
  quality = "720"
): Promise<string> {
  const res = await fetch(COBALT_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      url,
      videoQuality: quality,
    }),
  });

  const data: CobaltResponse = await res.json();

  if (data.status === "error" || !data.url) {
    throw new Error(
      data.error?.message || data.error?.code || "Cobalt failed to resolve URL"
    );
  }

  return data.url;
}

// Resolve audio-only URL via cobalt (small file, for Groq transcription)
export async function resolveAudio(
  url: string,
  format = "mp3",
  bitrate = "128"
): Promise<string> {
  const res = await fetch(COBALT_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      url,
      audioFormat: format,
      audioBitrate: bitrate,
    }),
  });

  const data: CobaltResponse = await res.json();

  if (data.status === "error" || !data.url) {
    throw new Error(
      data.error?.message || data.error?.code || "Cobalt failed to resolve audio"
    );
  }

  return data.url;
}
