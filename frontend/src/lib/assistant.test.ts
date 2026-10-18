import { describe, expect, it } from "vitest";
import { extensionFor, pickRecordingType, scenarioTag, SUGGESTED_QUESTIONS } from "./assistant";

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

  it("offers the four suggested questions", () => {
    expect(SUGGESTED_QUESTIONS).toEqual([
      "Why does credit leave more cash?",
      "What does the extra cost mean?",
      "Which options stay above my cushion?",
      "What will I still owe?",
    ]);
  });
});
