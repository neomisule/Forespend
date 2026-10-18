// Small pure helpers for the assistant drawer, kept separate so they can be unit-tested.
import type { InvestmentRequest, InvestmentResult, PaymentMethod, SimulationRequest, SimulationResult } from "../api";

/** What the assistant knows about right now. The server recalculates from the inputs; nothing else is trusted. */
export type AssistantContext =
  | {
      kind: "purchase";
      label: string;
      amount: string; // "600.00"
      simRequest: SimulationRequest;
      selectedMethod: PaymentMethod;
      cushion: string | null;
      data: SimulationResult; // for the calculated fallback text
      tag: string; // changes whenever inputs, month, method or cushion change
    }
  | {
      kind: "investment";
      request: InvestmentRequest; // the inputs; the server recalculates
      result: InvestmentResult;
      tag: string; // the plan key: changes whenever any input changes
    }
  | { kind: "none"; tag: "none" };

export const NO_CONTEXT: AssistantContext = { kind: "none", tag: "none" };

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

/** At most three short questions that fit the current context. */
export function suggestedQuestions(ctx: AssistantContext): string[] {
  if (ctx.kind === "purchase") {
    return [
      "Why does credit leave more cash?",
      "What does the extra cost mean?",
      ctx.cushion !== null ? "Which options stay above my cushion?" : "What will I still owe?",
    ];
  }
  if (ctx.kind === "investment") {
    return ["Why do the two funds end up different?", "What is lost growth?", "What does the adverse scenario show?"];
  }
  return ["What is APR?", "Interest vs. a fixed fee?", "What is a cash cushion?"];
}

const FREQ_WORDS: Record<string, string> = { weekly: "every week", biweekly: "every 2 weeks", monthly: "every month" };

export function contextTitle(ctx: AssistantContext, formatMoney: (v: string) => string): string {
  if (ctx.kind === "purchase") return `Your ${formatMoney(ctx.amount)} ${ctx.label.toLowerCase()} comparison`;
  if (ctx.kind === "investment") {
    return `Your ${formatMoney(ctx.request.contribution)} ${FREQ_WORDS[ctx.request.frequency]} investing illustration (${ctx.request.years} yr)`;
  }
  return "No experiment yet";
}

export function contextIntro(ctx: AssistantContext): string {
  if (ctx.kind === "purchase") {
    return "Ask about cash, installments or credit for this purchase. Answers are based on your current comparison.";
  }
  if (ctx.kind === "investment") {
    return "Ask about fees, lost growth or the adverse scenario in this illustration. The returns are your own assumptions, not a forecast.";
  }
  return "Start a purchase test run in Calendar (“Try a purchase”) to ask about your own numbers. Until then I can explain terms like APR, fees or a cash cushion.";
}

export const EXPLAIN_QUESTION = "Explain my options: what is the trade-off between these ways to pay?";
export const MAX_QUESTION_CHARS = 500;
