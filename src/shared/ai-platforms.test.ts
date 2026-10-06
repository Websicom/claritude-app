import { describe, expect, it } from "vitest";
import { AI_PLATFORMS, aiPlatformPromptUrl, identifyAiPlatform } from "./ai-platforms";

describe("AI platform registry", () => {
  it("matches only validated hosts or exact campaign aliases", () => {
    expect(identifyAiPlatform({ referrer: "https://chatgpt.com/c/abc" })?.id).toBe("chatgpt");
    expect(identifyAiPlatform({ referrer: "https://news.gemini.google.com/answer" })).toBeNull();
    expect(identifyAiPlatform({ referrer: "https://google.com/search?q=gemini" })).toBeNull();
    expect(identifyAiPlatform({ referrer: "https://chatgpt.com.evil.example/" })).toBeNull();
    expect(identifyAiPlatform({ campaign: "perplexity", referrer: "https://claude.ai/" })?.id).toBe("perplexity");
  });

  it("encodes punctuation and non-ASCII text without changing the visible phrase", () => {
    const phrase = "Who designs cafés in Zürich?";
    const chatgpt = AI_PLATFORMS.find((platform) => platform.id === "chatgpt")!;
    const url = new URL(aiPlatformPromptUrl(chatgpt, phrase));
    expect(url.origin).toBe("https://chatgpt.com");
    expect(url.searchParams.get("q")).toBe(phrase);
    const copilot = AI_PLATFORMS.find((platform) => platform.id === "copilot")!;
    expect(aiPlatformPromptUrl(copilot, phrase)).toBe("https://copilot.com/");
  });
});
