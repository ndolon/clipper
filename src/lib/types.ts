export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  language: string;
  duration: number;
}

export interface SuggestedClip {
  start: number;
  end: number;
  hook: string;
  reason: string;
}

export interface ProcessedClip {
  url: string;
  blob: Blob;
  start: number;
  end: number;
  duration: number;
}
