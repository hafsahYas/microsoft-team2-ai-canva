import { describe, expect, it } from "vitest";
import {
  buildChatSystemPrompt,
  buildConversationTurn,
  chatbotName,
  DEFAULT_PERSONALITY,
  greetingMessage,
  MAX_PROMPT_MESSAGES,
  trimChatMessages,
} from "./chatbot.js";
import type { ChatMessage } from "../types.js";

function msg(role: "user" | "bot", text: string, by?: string): ChatMessage {
  return { id: Math.random().toString(36).slice(2), role, text, at: 1, by };
}

describe("chatbotName", () => {
  it("falls back to Chat Pal for blank titles", () => {
    expect(chatbotName(undefined)).toBe("Chat Pal");
    expect(chatbotName("   ")).toBe("Chat Pal");
  });

  it("uses the node title as the name", () => {
    expect(chatbotName("Professor Benchy")).toBe("Professor Benchy");
    expect(chatbotName(" Benchy ")).toBe("Benchy");
  });
});

describe("greetingMessage", () => {
  it("mentions the name and is from the bot", () => {
    const g = greetingMessage("Benchy");
    expect(g.role).toBe("bot");
    expect(g.text).toContain("Benchy");
  });
});

describe("trimChatMessages", () => {
  it("keeps the newest messages and preserves order", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => msg("user", `m${i}`));
    const trimmed = trimChatMessages(msgs, 4);
    expect(trimmed.map((m) => m.text)).toEqual(["m6", "m7", "m8", "m9"]);
  });

  it("drops broken/empty messages", () => {
    const msgs = [msg("user", "hello"), msg("bot", "   "), msg("bot", "ok")];
    expect(trimChatMessages(msgs).map((m) => m.text)).toEqual(["hello", "ok"]);
  });

  it("returns [] for empty input", () => {
    expect(trimChatMessages([])).toEqual([]);
  });
});

describe("buildChatSystemPrompt", () => {
  it("includes the name, the user's personality and the board inventory", () => {
    const p = buildChatSystemPrompt(
      "Benchy",
      "Grumpy sailor",
      '- "Research Box" [research] status=done — out: findings'
    );
    expect(p).toContain('"Benchy"');
    expect(p).toContain("Grumpy sailor");
    expect(p).toContain("Live snapshot of the board");
    expect(p).toContain("Research Box");
  });

  it("falls back to the default personality when none is set", () => {
    const p = buildChatSystemPrompt("Chat Pal", "   ", "");
    expect(p).toContain(DEFAULT_PERSONALITY);
    expect(p).toContain("(the board is empty)");
  });
});

describe("buildConversationTurn", () => {
  it("renders the transcript with attribution and a reply instruction", () => {
    const turn = buildConversationTurn(
      [msg("user", "Idea for a pitch?", "Alessio"), msg("bot", "Sure!")],
      "Chat Pal"
    );
    expect(turn).toContain('User "Alessio": Idea for a pitch?');
    expect(turn).toContain("Chat Pal: Sure!");
    expect(turn).toContain("Reply as Chat Pal");
  });

  it("attributes unattributed users and handles an empty history", () => {
    const turn = buildConversationTurn([msg("user", "hi")], "Chat Pal");
    expect(turn).toContain("User: hi");
    const empty = buildConversationTurn([], "Chat Pal");
    expect(empty).toContain("(the conversation just started)");
    expect(empty).toContain("Reply as Chat Pal");
    expect(empty).not.toContain("(from");
  });

  it("caps the replayed history at MAX_PROMPT_MESSAGES", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => msg("user", `m${i}`));
    const turn = buildConversationTurn(msgs, "Chat Pal");
    expect(turn).not.toContain("m0");
    expect(turn).toContain("User: m29");
    expect(msgs.length).toBeGreaterThan(MAX_PROMPT_MESSAGES);
  });
});