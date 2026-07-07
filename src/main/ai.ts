import fetch from "cross-fetch";
import { AiMessage, AiReply } from "../shared/types";
import { store } from "./settings";

/**
 * Veil AI — answers questions and chats. Works out of the box for everyone via
 * a free, keyless backend (Pollinations). If the user supplies their own
 * Anthropic key in Settings, we use that instead for higher quality. Runs in the
 * main process so no key/prompt ever touches page content and there's no CORS.
 */

const SYSTEM =
  "Du bist Veil AI, ein hilfreicher, knapper Assistent in einem Privatsphäre-Browser. " +
  "Antworte klar und direkt auf Deutsch, außer der Nutzer schreibt in einer anderen Sprache. " +
  "Fasse dich kurz (2–5 Sätze), außer es wird ausdrücklich mehr verlangt.";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36";

export async function veilAiChat(messages: AiMessage[]): Promise<AiReply> {
  const { aiApiKey, aiModel } = store.getSettings();
  return aiApiKey ? anthropic(messages, aiApiKey, aiModel) : pollinations(messages);
}

/** Free, keyless backend (OpenAI-compatible). */
async function pollinations(messages: AiMessage[]): Promise<AiReply> {
  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({
        model: "openai",
        messages: [{ role: "system", content: SYSTEM }, ...messages],
      }),
    });
    if (!res.ok) return { error: `KI-Fehler (${res.status})` };
    const j: any = await res.json();
    const text = j?.choices?.[0]?.message?.content?.trim();
    return { text: text || "(keine Antwort)" };
  } catch (err: any) {
    return { error: `Verbindungsfehler: ${err?.message ?? err}` };
  }
}

/** Optional higher-quality backend when the user brings their own key. */
async function anthropic(messages: AiMessage[], key: string, model: string): Promise<AiReply> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      if (res.status === 401) return { error: "Ungültiger API-Key." };
      return { error: `KI-Fehler (${res.status})` };
    }
    const j: any = await res.json();
    const text = (j.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    return { text: text || "(keine Antwort)" };
  } catch (err: any) {
    return { error: `Verbindungsfehler: ${err?.message ?? err}` };
  }
}
