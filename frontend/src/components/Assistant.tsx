import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  postExplain,
  postSpeech,
  postTranscribe,
  type AiStatus,
  type PaymentMethod,
  type SimulationRequest,
  type SimulationResult,
} from "../api";
import { EXPLAIN_QUESTION, MAX_QUESTION_CHARS, SUGGESTED_QUESTIONS, extensionFor, pickRecordingType } from "../lib/assistant";
import { interpret } from "../lib/interpretation";

interface Props {
  data: SimulationResult; // for the calculated fallback text
  simRequest: SimulationRequest; // the inputs; the server recalculates from these
  selectedMethod: PaymentMethod;
  cushion: string | null;
  scenarioTag: string; // changes whenever inputs, month, method or cushion change
  aiStatus: AiStatus | null; // null while loading
}

interface Answer {
  question: string;
  text: string;
  tag: string; // the scenario it was answered for
  model: string;
}
type AskState = { status: "idle" } | { status: "loading"; question: string } | { status: "error"; message: string; unavailable: boolean; question: string };
type AudioState = "idle" | "loading" | "playing" | "error";
type MicState = "idle" | "recording" | "transcribing" | "error";

const canRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

/**
 * "Explain my options" + follow-up questions, answered by the server from the
 * current comparison. Nothing here calculates money: when AI is unavailable it
 * shows the app's own calculated summary and says so.
 */
export function Assistant({ data, simRequest, selectedMethod, cushion, scenarioTag, aiStatus }: Props) {
  const [ask, setAsk] = useState<AskState>({ status: "idle" });
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [history, setHistory] = useState<{ question: string; answer: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [audio, setAudio] = useState<AudioState>("idle");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [mic, setMic] = useState<MicState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [focusInput, setFocusInput] = useState(0); // bumped when the transcript is ready to edit

  // Runs after React re-enables the input (it is disabled while transcribing), so focus() works.
  useEffect(() => {
    if (focusInput) input.current?.focus();
  }, [focusInput]);

  const tagRef = useRef(scenarioTag);
  const seq = useRef(0);
  const askAbort = useRef<AbortController | null>(null);
  const audioAbort = useRef<AbortController | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const transcribeAbort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const uid = useId();

  const stopAudio = useCallback(() => {
    audioAbort.current?.abort();
    audioAbort.current = null;
    if (player.current) {
      const a = player.current;
      player.current = null;
      a.onended = null;
      a.onerror = null; // clearing src below fires an error event; it isn't a playback failure
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

  // The scenario changed: old answers no longer describe what's on screen.
  useEffect(() => {
    if (tagRef.current === scenarioTag) return;
    tagRef.current = scenarioTag;
    askAbort.current?.abort();
    stopAudio();
    setAsk({ status: "idle" });
    setHistory([]);
  }, [scenarioTag, stopAudio]);

  // Leaving the panel: release everything.
  useEffect(
    () => () => {
      askAbort.current?.abort();
      transcribeAbort.current?.abort();
      recorder.current?.state === "recording" && recorder.current.stop();
      stopTracks();
      stopAudio();
    },
    [stopAudio, stopTracks],
  );

  const outdated = !!answer && answer.tag !== scenarioTag;

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
      setAsk({ status: "loading", question: text });
      try {
        const res = await postExplain(
          {
            simulation: simRequest,
            selected_method: selectedMethod,
            question: text,
            cushion,
            history: outdated ? [] : history.slice(-3),
            client_tag: clientTag,
          },
          ac.signal,
        );
        // Late reply for an older request or an older scenario: ignore it.
        if (ac.signal.aborted || res.client_tag !== clientTag || tagRef.current !== tag) return;
        setAnswer({ question: text, text: res.answer, tag, model: res.model });
        setHistory((h) => [...h, { question: text, answer: res.answer }].slice(-3));
        setAsk({ status: "idle" });
        setQuestion("");
      } catch (err) {
        if (ac.signal.aborted) return;
        const e = err instanceof ApiError ? err : new ApiError("invalid", "Something unexpected went wrong.");
        setAsk({ status: "error", message: e.message, unavailable: e.kind === "unavailable" || e.kind === "network", question: text });
      }
    },
    [simRequest, selectedMethod, cushion, history, outdated, stopAudio],
  );

  const listen = useCallback(async () => {
    if (!answer) return;
    stopAudio();
    const ac = new AbortController();
    audioAbort.current = ac;
    setAudio("loading");
    setAudioError(null);
    try {
      const blob = await postSpeech(answer.text, `${answer.tag.slice(-80)}#audio`, ac.signal); // reads exactly the shown text
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
  }, [answer, stopAudio]);

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

  // Buttons stay enabled while an answer loads: a newer question aborts and replaces the older request.
  const fallback = interpret(data, cushion);

  if (aiStatus && !aiStatus.explanations) {
    return (
      <section aria-labelledby={`${uid}-t`} className="rounded-2xl bg-surface-soft p-3 text-sm">
        <h3 id={`${uid}-t`} className="font-display font-semibold">
          Ask about these options
        </h3>
        <p className="mt-1 text-navy-soft">
          <strong className="text-navy">Live assistant unavailable:</strong> {aiStatus.missing.includes("ANTHROPIC_API_KEY") ? "no ANTHROPIC_API_KEY is set in backend/.env." : "it isn’t configured on the server."}{" "}
          The summary under “What this means for you” is calculated by the app without AI.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={`${uid}-t`} className="flex flex-col gap-2 rounded-2xl bg-surface-soft p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 id={`${uid}-t`} className="font-display font-semibold">
          Ask about these options
        </h3>
        {aiStatus?.model && <span className="text-xs text-navy-soft">Answers from {aiStatus.model}, based on the numbers above</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!aiStatus}
          onClick={() => void askQuestion(EXPLAIN_QUESTION)}
          className="rounded-full bg-accent px-3 py-1 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          Explain my options
        </button>
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={!aiStatus}
            onClick={() => void askQuestion(q)}
            className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-accent-strong shadow-soft hover:bg-accent-soft disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {ask.status === "loading" && (
          <p role="status" className="rounded-xl bg-white p-2.5 text-navy-soft">
            Thinking about “{ask.question}”…
          </p>
        )}
        {ask.status === "error" && (
          <div role="alert" className={`rounded-xl p-2.5 ${ask.unavailable ? "bg-amber-50 text-amber-950" : "bg-red-50 text-red-900"}`}>
            <p className="font-semibold">{ask.unavailable ? "Live assistant unavailable." : "The assistant couldn’t answer."}</p>
            <p className="mt-0.5">{ask.message}</p>
            {ask.unavailable && (
              <div className="mt-2 border-t border-amber-200 pt-2 text-navy">
                <p className="text-xs font-semibold text-navy-soft">Calculated explanation (no AI):</p>
                <ul className="mt-1 list-disc pl-5">
                  {fallback.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" onClick={() => void askQuestion(ask.question)} className="mt-2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">
              Retry
            </button>
          </div>
        )}
        {answer && ask.status !== "loading" && (
          <div className={`rounded-xl bg-white p-2.5 ${outdated ? "opacity-80" : ""}`}>
            {outdated && (
              <p className="mb-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-950">
                Outdated: the scenario changed since this answer. Ask again.
              </p>
            )}
            <p className="text-xs text-navy-soft">You asked: {answer.question}</p>
            <p className="mt-1 whitespace-pre-line">{answer.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {aiStatus?.speech && !outdated && (
                <>
                  {audio === "playing" ? (
                    <button type="button" onClick={stopAudio} className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white">
                      ■ Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void listen()}
                      disabled={audio === "loading"}
                      className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-strong hover:bg-accent/15 disabled:opacity-60"
                    >
                      {audio === "loading" ? "Preparing audio…" : audio === "error" ? "▶ Retry listen" : "▶ Listen"}
                    </button>
                  )}
                  {audio === "playing" && (
                    <span role="status" className="text-xs text-navy-soft">
                      Playing the answer above
                    </span>
                  )}
                  {audio === "error" && audioError && (
                    <span role="alert" className="text-xs text-red-800">
                      {audioError} The text above is still here.
                    </span>
                  )}
                </>
              )}
              <span className="text-xs text-navy-soft">Explains the app’s calculations; it can still be imperfect.</span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${uid}-q`} className="text-xs font-semibold">
            Ask a follow-up
          </label>
          <input
            id={`${uid}-q`}
            ref={input}
            value={question}
            maxLength={MAX_QUESTION_CHARS}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={mic === "transcribing" ? "Turning your recording into text…" : "e.g. Is paying later cheaper?"}
            disabled={mic === "recording" || mic === "transcribing"}
            className="mt-1 w-full rounded-xl bg-white px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          />
        </div>
        <button type="submit" disabled={!aiStatus || !question.trim()} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Ask
        </button>
        {aiStatus?.transcription && canRecord() && (
          <button
            type="button"
            aria-pressed={mic === "recording"}
            disabled={mic === "transcribing"}
            onClick={() => (mic === "recording" ? stopRecording() : void startRecording())}
            className={`rounded-full px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
              mic === "recording" ? "bg-red-600 text-white" : "bg-white text-accent-strong shadow-soft hover:bg-accent-soft"
            }`}
          >
            {mic === "recording" ? "■ Stop recording" : "🎤 Record question"}
          </button>
        )}
      </form>
      {mic === "recording" && (
        <p role="status" className="flex items-center gap-2 text-xs font-semibold text-red-700">
          <span aria-hidden="true" className="inline-block size-2 animate-pulse rounded-full bg-red-600" />
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
    </section>
  );
}
