import { describe, expect, it } from "vitest";
import { parseSimulation } from "../api";
import { contextIntro, contextTitle, extensionFor, NO_CONTEXT, pickRecordingType, scenarioTag, suggestedQuestions, type AssistantContext } from "./assistant";
import { formatMoney } from "./money";
import simSample from "./simulation-sample-november.json";

describe("assistant helpers", () => {
  it("scenario tag changes with inputs, method, or cushion, and only those", () => {
    const base = scenarioTag("sim-A", "cash", null);
    expect(scenarioTag("sim-A", "cash", null)).toBe(base);
    expect(scenarioTag("sim-B", "cash", null)).not.toBe(base);
    expect(scenarioTag("sim-A", "credit", null)).not.toBe(base);
    expect(scenarioTag("sim-A", "cash", "500.00")).not.toBe(base);
  });

  it("picks the browser's first supported recording format, else lets the browser choose", () => {
    expect(pickRecordingType((t) => t === "audio/mp4")).toBe("audio/mp4"); // Safari
    expect(pickRecordingType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus"); // Chrome/Edge/Firefox
    expect(pickRecordingType(() => false)).toBe("");
  });

  it("names the upload after the real mime type", () => {
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/ogg; codecs=opus")).toBe("ogg");
    expect(extensionFor("video/x-unknown")).toBe("bin");
  });

  it("offers at most three suggested questions that fit the context", () => {
    const data = parseSimulation(simSample);
    const purchase: AssistantContext = {
      kind: "purchase", label: "Laptop", amount: "600.00", simRequest: { label: "Laptop", amount: "600.00", purchase_date: "2026-10-24", payment: "cash", start_date: "2026-11-01", end_date: "2026-11-30" },
      selectedMethod: "cash", cushion: null, data, tag: "t1",
    };
    expect(suggestedQuestions(purchase)).toEqual(["Why does credit leave more cash?", "What does the extra cost mean?", "What will I still owe?"]);
    expect(suggestedQuestions({ ...purchase, cushion: "500.00" })[2]).toBe("Which options stay above my cushion?");
    expect(suggestedQuestions(NO_CONTEXT)).toHaveLength(3);
    expect(contextTitle(purchase, formatMoney)).toBe("Your $600.00 laptop comparison");
    expect(contextTitle(NO_CONTEXT, formatMoney)).toBe("No experiment yet");
    const investing: AssistantContext = {
      kind: "investment",
      request: { contribution: "25.00", frequency: "biweekly", start_date: "2026-10-30", years: 5, gross_return_pct: "6.00", adverse_return_pct: "-4.00", fee_a_pct: "0.15", fee_b_pct: "1.25" },
      result: {} as never,
      tag: "invest-1",
    };
    // An investing context is never titled or introduced as a purchase comparison, and vice versa.
    expect(contextTitle(investing, formatMoney)).toBe("Your $25.00 every 2 weeks investing illustration (5 yr)");
    expect(contextIntro(investing)).toContain("fees");
    expect(contextIntro(investing)).not.toContain("purchase");
    expect(contextIntro(purchase)).not.toContain("fund");
    expect(suggestedQuestions(investing)).toEqual(["Why do the two funds end up different?", "What is lost growth?", "What does the adverse scenario show?"]);
    expect(contextIntro(NO_CONTEXT)).toContain("Try a purchase");
  });
});
