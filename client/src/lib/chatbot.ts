import type { ChatMessage } from "../types.js";
import { CHATBOT_BASE_PROMPT } from "../types.js";

/**
 * Pure helpers for the Chatbot companion box (the conversation loop lives in
 * client/src/store/boardStore.ts — sendChatMessage). Everything here is
 * deterministic so it can be unit-tested.
 */

/** Used when the user has not typed a personality. */
export const DEFAULT_PERSONALITY =
  "Friendly, upbeat brainstorm buddy with a light sense of humor. Direct and concrete — never vague.";

/** Stored messages per chatbot (Firestore 1MB safety ceiling). */
export const MAX_CHAT_MESSAGES = 60;
/** How many recent messages are replayed to the model each turn. */
export const MAX_PROMPT_MESSAGES = 16;

/** The companion's display name, with a fallback. */
export function chatbotName(nodeTitle: string | undefined): string {
  const t = (nodeTitle || "").trim();
  return t || "Chat Pal";
}

/** First bot message seeded when a companion is created. */
export function greetingMessage(name: string): ChatMessage {
  return {
    id: "greeting",
    role: "bot",
    text: `Hi! I'm ${name} 🧍 — I live down here on your board, and I can see all the boxes up there. Give me a personality in ⚙ if you like, then just say hi!`,
    at: 0,
  };
}

/**
 * Caps stored history to the newest `max` messages, preserving order.
 */
export function trimChatMessages(
  messages: ChatMessage[],
  max: number = MAX_CHAT_MESSAGES
): ChatMessage[] {
  const clean = messages.filter(
    (m) => m && typeof m.text === "string" && m.text.trim().length > 0
  );
  return clean.length > max ? clean.slice(clean.length - max) : clean;
}

/** One-line rendering of a sender label for the transcript. */
function senderLabel(role: string, by: string | undefined, name: string): string {
  if (role === "bot") return name;
  return `User${by && by.trim() ? ` "${by.trim()}"` : ""}`;
}

/**
 * Compiles the system prompt for one chatbot reply: identity + base rules,
 * the user's personality (or the default), and a live snapshot of the board.
 */
export function buildChatSystemPrompt(
  name: string,
  personality: string | undefined,
  inventory: string
): string {
  const persona = (personality || "").trim() || DEFAULT_PERSONALITY;
  return [
    `You are "${name}", an AI companion on a collaborative whiteboard. People chat with you in a panel.`,
    `## Your personality (written by the team)\n${persona}`,
    CHATBOT_BASE_PROMPT,
    `## Live snapshot of the board around you\n${inventory || "(the board is empty)"}`,
  ].join("\n\n");
}

/**
 * Builds the user prompt for one reply: a transcript of the recent
 * conversation plus the instruction to answer as the companion.
 */
export function buildConversationTurn(
  messages: ChatMessage[],
  name: string,
  max: number = MAX_PROMPT_MESSAGES
): string {
  const recent = messages.slice(Math.max(0, messages.length - max));
  const transcript = recent
    .map((m) => `${senderLabel(m.role, m.by, name)}: ${m.text}`)
    .join("\n");
  const latest = recent[recent.length - 1];
  const latestLabel =
    latest && latest.role === "user"
      ? ` (from ${senderLabel("user", latest.by, name)})`
      : "";
  return [
    "## Conversation so far",
    transcript || "(the conversation just started)",
    "",
    `Reply as ${name} to the latest message${latestLabel}. Answer with just the next spoken line — plain conversational text, no headings, no JSON.`,
  ].join("\n");
}