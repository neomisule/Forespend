// Small pure helpers for the assistant panel, kept separate so they can be unit-tested.

/** One id per "exact scenario": inputs + month + selected method + cushion. */
export function scenarioTag(simKey: string, selectedMethod: string, cushion: string | null): string {
  return `${simKey}|${selectedMethod}|${cushion ?? ""}`;
}

/** Audio formats browsers commonly record in, most widely supported first. */
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

/** Picks the first format this browser's recorder supports, or "" to let the browser choose. */
export function pickRecordingType(isSupported: (type: string) => boolean): string {
  return RECORDING_TYPES.find((t) => isSupported(t)) ?? "";
}

/** File extension for a recorder's real mime type, so the server (and ElevenLabs) see the right format. */
export function extensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav", "audio/mpeg": "mp3" }[base] ?? "bin";
}

export const SUGGESTED_QUESTIONS = [
  "Why does credit leave more cash?",
  "What does the extra cost mean?",
  "Which options stay above my cushion?",
  "What will I still owe?",
];

export const EXPLAIN_QUESTION = "Explain my options: what is the trade-off between these ways to pay?";
export const MAX_QUESTION_CHARS = 500;
