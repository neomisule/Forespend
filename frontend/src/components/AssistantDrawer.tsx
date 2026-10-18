import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, postExplain, postSpeech, postTranscribe, type AiStatus } from "../api";
import {
  contextIntro,
  contextTitle,
  extensionFor,
  MAX_QUESTION_CHARS,
  pickRecordingType,
  suggestedQuestions,
  type AssistantContext,
} from "../lib/assistant";
import { interpret } from "../lib/interpretation";
import { formatMoney } from "../lib/money";

interface Props {
  open: boolean;
  onClose: () => void;
  context: AssistantContext;
  aiStatus: AiStatus | null; // null while loading
}

interface Answer {
  id: number;
  question: string;
  text: string;
  tag: string; // the scenario it was answered for
}
type AskState =
  | { status: "idle" }
  | { status: "loading"; question: string }
  | { status: "error"; message: string; unavailable: boolean; question: string };
type AudioState = "idle" | "loading" | "playing" | "error";
type MicState = "idle" | "recording" | "transcribing" | "error";

const canRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

/**
 * The one assistant for the whole app, in a side drawer (a full-width sheet on
 * phones). It stays mounted, so answers survive closing and reopening. Opening it
 * never records, plays audio, or calls a paid service: every one of those is a
 * button press. Money is never calculated here; the server recalculates the
 * context from the inputs and the model only explains.
 */
export function AssistantDrawer({ open, onClose, context, aiStatus }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const uid = useId();

  const [ask, setAsk] = useState<AskState>({ status: "idle" });
  const [answers, setAnswers] = useState<Answer[]>([]); // newest first
  const [question, setQuestion] = useState("");
  const [audio, setAudio] = useState<AudioState>("idle");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [mic, setMic] = useState<MicState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [focusInput, setFocusInput] = useState(0);

  const tagRef = useRef(context.tag);
  const seq = useRef(0);
  const askAbort = useRef<AbortController | null>(null);
  const audioAbort = useRef<AbortController | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const transcribeAbort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // ---- resource teardown -------------------------------------------------------
  const stopAudio = useCallback(() => {
    audioAbort.current?.abort();
    audioAbort.current = null;
    if (player.current) {
      const a = player.current;
      player.current = null;
      a.onended = null;
      a.onerror = null; // clearing src fires an error event; it isn't a playback failure
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    setAudio("idle");
  }, []);

  const stopTracks = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const cancelRecording = useCallback(() => {
    const r = recorder.current;
    if (r && r.state === "recording") {
      r.onstop = null; // cancelled: don't transcribe
      r.stop();
    }
    recorder.current = null;
    stopTracks();
    transcribeAbort.current?.abort();
    setMic((m) => (m === "error" ? m : "idle"));
  }, [stopTracks]);

  // ---- open / close --------------------------------------------------------------
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      setFocusInput((n) => n + 1);
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    if (focusInput) input.current?.focus();
  }, [focusInput]);

  const handleNativeClose = () => {
    stopAudio();
    cancelRecording();
    onClose();
    const el = opener.current;
    requestAnimationFrame(() => el?.isConnected && el.focus());
  };

  // The scenario changed: old answers no longer describe what's on screen.
  useEffect(() => {
    if (tagRef.current === context.tag) return;
    tagRef.current = context.tag;
    askAbort.current?.abort();
    stopAudio();
    setAsk({ status: "idle" });
  }, [context.tag, stopAudio]);

  useEffect(
    () => () => {
      askAbort.current?.abort();
      cancelRecording();
      stopAudio();
    },
    [cancelRecording, stopAudio],
  );

  // ---- asking ----------------------------------------------------------------------
  const latest = answers[0];

  const askQuestion = useCallback(
    async (q: string) => {
      const text = q.trim().slice(0, MAX_QUESTION_CHARS);
      if (!text) return;
      askAbort.current?.abort();
      const ac = new AbortController();
      askAbort.current = ac;
      stopAudio();
      const tag = tagRef.current;
      const clientTag = `${tag.slice(-80)}#${++seq.current}`;
      const history = answers
        .filter((a) => a.tag === tag)
        .slice(0, 3)
        .reverse()
        .map((a) => ({ question: a.question, answer: a.text }));
      setAsk({ status: "loading", question: text });
      try {
        const res = await postExplain(
          {
            ...(context.kind === "purchase"
              ? { simulation: context.simRequest, selected_method: context.selectedMethod, cushion: context.cushion }
              : context.kind === "investment"
                ? { investment: context.request, cushion: null }
                : { cushion: null }),
            question: text,
            history,
            client_tag: clientTag,
          },
          ac.signal,
        );
        // Late reply for an older request or an older scenario: ignore it.
        if (ac.signal.aborted || res.client_tag !== clientTag || tagRef.current !== tag) return;
        setAnswers((list) => [{ id: seq.current, question: text, text: res.answer, tag }, ...list].slice(0, 12));
        setAsk({ status: "idle" });
        setQuestion("");
      } catch (err) {
        if (ac.signal.aborted) return;
        const e = err instanceof ApiError ? err : new ApiError("invalid", "Something unexpected went wrong.");
        setAsk({
          status: "error",
          message: e.message,
          unavailable: e.kind === "unavailable" || e.kind === "network",
          question: text,
        });
      }
    },
    [answers, context, stopAudio],
  );

  // ---- listening --------------------------------------------------------------------
  const listen = useCallback(async () => {
    if (!latest) return;
    stopAudio();
    const ac = new AbortController();
    audioAbort.current = ac;
    setAudio("loading");
    setAudioError(null);
    try {
      const blob = await postSpeech(latest.text, `${latest.tag.slice(-80)}#audio${latest.id}`, ac.signal); // reads exactly the shown text
      if (ac.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      const a = new Audio(url);
      player.current = a;
      a.onended = () => stopAudio();
      a.onerror = () => {
        setAudio("error");
        setAudioError("The audio couldn’t be played.");
      };
      await a.play();
      setAudio("playing");
    } catch (err) {
      if (ac.signal.aborted) return;
      setAudio("error");
      setAudioError(err instanceof ApiError ? err.message : "The audio couldn’t be played.");
    }
  }, [latest, stopAudio]);

  // ---- recording ---------------------------------------------------------------------
  const startRecording = useCallback(async () => {
    setMicError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const type = pickRecordingType((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      r.onstop = async () => {
        stopTracks();
        recorder.current = null;
        const mime = r.mimeType || chunks[0]?.type || "audio/webm";
        const blob = new Blob(chunks, { type: mime });
        setMic("transcribing");
        const ac = new AbortController();
        transcribeAbort.current = ac;
        try {
          const text = await postTranscribe(blob, `question.${extensionFor(mime)}`, `${tagRef.current.slice(-80)}#mic`, ac.signal);
          if (ac.signal.aborted) return;
          setQuestion(text.slice(0, MAX_QUESTION_CHARS)); // editable before sending
          setMic("idle");
          setFocusInput((n) => n + 1);
        } catch (err) {
          if (ac.signal.aborted) return;
          setMic("error");
          setMicError(err instanceof ApiError ? err.message : "Transcription failed.");
        }
      };
      recorder.current = r;
      r.start();
      setMic("recording");
    } catch (err) {
      stopTracks();
      setMic("error");
      const name = (err as { name?: string })?.name;
      setMicError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was denied. You can allow it in your browser’s site settings, or type your question."
          : name === "NotFoundError"
            ? "No microphone was found. You can type your question instead."
            : "The microphone couldn’t be started. You can type your question instead.",
      );
    }
  }, [stopTracks]);

  const stopRecording = useCallback(() => {
    const r = recorder.current;
    if (r && r.state === "recording") r.stop();
    else stopTracks();
  }, [stopTracks]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void askQuestion(question);
  };

  const unavailable = !!aiStatus && !aiStatus.explanations;
  const fallback = context.kind === "purchase" ? interpret(context.data, context.cushion) : null;
  const chips = suggestedQuestions(context);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${uid}-title`}
      onClose={handleNativeClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      className="m-0 ms-auto h-dvh max-h-dvh w-full max-w-lg bg-transparent p-0 text-navy backdrop:bg-navy/40"
    >
      <div className="flex h-full flex-col bg-white shadow-card">
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b-2 border-line px-5 py-4">
          <div>
            <h2 id={`${uid}-title`} className="font-display text-xl font-bold">
              Ask about my money
            </h2>
            <p className="lab-overline mt-1">Context</p>
            <p className="text-sm font-semibold">{contextTitle(context, formatMoney)}</p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} className="lab-button-quiet shrink-0">
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <p className="text-sm text-navy-soft">{contextIntro(context)}</p>

          {unavailable ? (
            <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">Live assistant unavailable.</p>
              <p className="mt-0.5">
                {aiStatus!.missing.includes("ANTHROPIC_API_KEY") ? "No ANTHROPIC_API_KEY is set in backend/.env." : "It isn’t configured on the server."}
                {fallback ? " The calculated summary below comes from the app itself." : ""}
              </p>
              {fallback && (
                <ul className="mt-2 list-disc pl-5 text-navy">
                  {fallback.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              {/* composer: always at the top, never behind old answers */}
              <form onSubmit={submit} className="flex flex-col gap-2">
                <label htmlFor={`${uid}-q`} className="text-sm font-bold">
                  Your question
                </label>
                <input
                  id={`${uid}-q`}
                  ref={input}
                  value={question}
                  maxLength={MAX_QUESTION_CHARS}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={mic === "transcribing" ? "Turning your recording into text…" : "e.g. Is paying later cheaper?"}
                  disabled={mic === "recording" || mic === "transcribing"}
                  className="w-full rounded-xl border-2 border-line bg-white px-3.5 py-2.5 text-base outline-none focus-visible:border-accent disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="submit" disabled={!aiStatus || !question.trim()} className="lab-button">
                    Send
                  </button>
                  {aiStatus?.transcription && canRecord() && (
                    <button
                      type="button"
                      aria-pressed={mic === "recording"}
                      disabled={mic === "transcribing"}
                      onClick={() => (mic === "recording" ? stopRecording() : void startRecording())}
                      className={mic === "recording" ? "lab-button !bg-red-600 !shadow-none" : "lab-button-quiet"}
                    >
                      <span aria-hidden="true">{mic === "recording" ? "■" : "🎤"}</span>
                      {mic === "recording" ? "Stop recording" : "Record question"}
                    </button>
                  )}
                </div>
                {mic === "recording" && (
                  <p role="status" className="flex items-center gap-2 text-xs font-semibold text-red-700">
                    <span aria-hidden="true" className="inline-block size-2 rounded-full bg-red-600 motion-safe:animate-pulse" />
                    Recording… press Stop recording when you’re done. You can edit the text before sending.
                  </p>
                )}
                {mic === "transcribing" && (
                  <p role="status" className="text-xs text-navy-soft">
                    Turning your recording into text…
                  </p>
                )}
                {mic === "error" && micError && (
                  <p role="alert" className="text-xs text-red-800">
                    {micError}
                  </p>
                )}
              </form>

              <div className="flex flex-wrap gap-1.5" aria-label="Suggested questions">
                {chips.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={!aiStatus}
                    onClick={() => void askQuestion(q)}
                    className="rounded-full border-2 border-line bg-white px-3 py-1 text-xs font-bold text-accent hover:bg-accent-soft disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* answers, newest first */}
              <div aria-live="polite" className="flex flex-col gap-2">
                {ask.status === "loading" && (
                  <p role="status" className="rounded-2xl bg-surface-soft p-3 text-sm text-navy-soft">
                    Thinking about “{ask.question}”…
                  </p>
                )}
                {ask.status === "error" && (
                  <div role="alert" className={`rounded-2xl p-3 text-sm ${ask.unavailable ? "bg-amber-50 text-amber-950" : "bg-red-50 text-red-900"}`}>
                    <p className="font-semibold">{ask.unavailable ? "Live assistant unavailable." : "The assistant couldn’t answer."}</p>
                    <p className="mt-0.5">{ask.message}</p>
                    {ask.unavailable && fallback && (
                      <div className="mt-2 border-t border-amber-200 pt-2 text-navy">
                        <p className="text-xs font-semibold text-navy-soft">Calculated explanation (no AI):</p>
                        <ul className="mt-1 list-disc pl-5">
                          {fallback.points.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <button type="button" onClick={() => void askQuestion(ask.question)} className="lab-button-quiet mt-2 !py-1 text-xs">
                      Retry
                    </button>
                  </div>
                )}
                {answers.map((a, i) => {
                  const outdated = a.tag !== context.tag;
                  const isLatest = i === 0;
                  return (
                    <article key={a.id} className={`rounded-2xl border-2 border-line p-3 text-sm ${outdated ? "opacity-75" : ""}`}>
                      {outdated && (
                        <p className="mb-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-950">
                          Outdated: the scenario changed since this answer. Ask again.
                        </p>
                      )}
                      <p className="text-xs text-navy-soft">You asked: {a.question}</p>
                      <p className="mt-1 whitespace-pre-line">{a.text}</p>
                      {isLatest && !outdated && aiStatus?.speech && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {audio === "playing" ? (
                            <button type="button" onClick={stopAudio} className="lab-button !bg-navy !py-1 text-xs">
                              <span aria-hidden="true">■</span> Stop
                            </button>
                          ) : (
                            <button type="button" onClick={() => void listen()} disabled={audio === "loading"} className="lab-button-quiet !py-1 text-xs">
                              <span aria-hidden="true">▶</span>
                              {audio === "loading" ? "Preparing audio…" : audio === "error" ? "Retry listen" : "Listen"}
                            </button>
                          )}
                          {audio === "playing" && (
                            <span role="status" className="text-xs text-navy-soft">
                              Playing this answer
                            </span>
                          )}
                          {audio === "error" && audioError && (
                            <span role="alert" className="text-xs text-red-800">
                              {audioError} The text is still here.
                            </span>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <p className="border-t-2 border-line px-5 py-2.5 text-xs text-navy-soft">
          {context.kind === "investment"
            ? "Answers are based on your current investing illustration."
            : context.kind === "purchase"
              ? "Answers are based on your current purchase comparison."
              : "Answers are general until you start a test run."}{" "}
          They explain the app’s calculations and can be imperfect.
        </p>
      </div>
    </dialog>
  );
}
