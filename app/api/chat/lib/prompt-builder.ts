/**
 * Prompt engineering for the chat pipeline.
 *
 * Constructs the final prompt sent to the LLM by composing the system
 * prompt, retrieved context, and conversation history.  Pure functions —
 * no I/O, no side-effects, fully testable.
 */

import { buildContextPrompt, SYSTEM_PROMPT } from '@/lib/prompts';
import type { VerseContext } from '@/lib/bible-fetch';

export type HistoryMessage = {
  role: 'system' | 'assistant' | 'user';
  content: string;
};

/**
 * Builds the retrieval-grounded context prompt and separates out the raw
 * context portion (used for cache storage).
 *
 * @returns `{ finalPrompt, context }` where `context` is the prompt
 *   without the system prefix — stored alongside cache entries.
 */
export function buildRetrievalPrompt(
  query: string,
  verses: VerseContext[],
  translation: string,
  options?: { allowGeneralKnowledge?: boolean }
): { finalPrompt: string; context: string } {
  const finalPrompt = buildContextPrompt(query, verses, translation, options);
  const context = finalPrompt.startsWith(SYSTEM_PROMPT)
    ? finalPrompt.slice(SYSTEM_PROMPT.length).trim()
    : finalPrompt;
  return { finalPrompt, context };
}

/**
 * Appends the conversation history to the final prompt.
 * System messages are excluded from the history block.
 */
export function appendConversationHistory(
  finalPrompt: string,
  history: HistoryMessage[]
): string {
  const historyLines = history
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${sanitizeHistoryContent(m.content)}`)
    .join('\n');

  return historyLines.trim()
    ? `${finalPrompt}\n\nCONVERSATION HISTORY\n<conversation_history>\n${historyLines}\n</conversation_history>`
    : finalPrompt;
}

/**
 * Strips prompt-injection carriers from conversation history.
 * History is client-controlled: remove tag closings, SYSTEM INSTRUCTION
 * smuggling, and control chars before interpolating into the prompt.
 */
export function sanitizeHistoryContent(content: string): string {
  let out = content.replace(/\0/g, '');
  // Remove any tag resembling <user_query>, <conversation_history>,
  // <system_instruction>, <reference>, <text>, etc. (case-insensitive,
  // optional slash/whitespace) to prevent closing the history block.
  out = out.replace(/<\/?\s*[a-z_][a-z0-9_]*\s*\/?\s*>/gi, '');
  // Neutralize "SYSTEM INSTRUCTION:" smuggling anywhere in user content
  // (line-start or inline) so it cannot pose as a directive block.
  out = out.replace(/system\s+instruction\s*:/gi, 'system-instruction:');
  return out;
}
