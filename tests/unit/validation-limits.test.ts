/**
 * Input caps: validation must bound query / message / history sizes
 * to prevent cost-DoS via oversized payloads.
 */
import { describe, it, expect } from 'vitest';
import {
  parseChatRequest,
  MAX_QUERY_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_CHARS,
} from '@/app/api/chat/lib/validation';

function req(url = 'http://localhost/api/chat'): Request {
  return new Request(url, { method: 'POST' });
}

describe('validation input caps', () => {
  it('rejects queries exceeding MAX_QUERY_CHARS with too_large', () => {
    const body = { messages: [{ role: 'user', content: 'a'.repeat(MAX_QUERY_CHARS + 1) }] };
    const parsed = parseChatRequest(body, req());
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.type).toBe('too_large');
  });

  it('accepts queries at exactly MAX_QUERY_CHARS', () => {
    const body = { messages: [{ role: 'user', content: 'a'.repeat(MAX_QUERY_CHARS) }] };
    const parsed = parseChatRequest(body, req());
    expect(parsed.ok).toBe(true);
  });

  it('truncates oversized single messages to MAX_MESSAGE_CHARS', () => {
    const body = {
      messages: [
        { role: 'user', content: 'context '.repeat(1000) },
        { role: 'user', content: 'short query' },
      ],
    };
    const parsed = parseChatRequest(body, req());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      for (const m of parsed.value.modelHistory) {
        expect(m.content.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
      }
    }
  });

  it('caps history message count and total chars', () => {
    const messages = [];
    for (let i = 0; i < 30; i += 1) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `message ${i} `.repeat(200) });
    }
    messages.push({ role: 'user', content: 'final query' });
    const parsed = parseChatRequest({ messages }, req());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.modelHistory.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
      const total = parsed.value.modelHistory.reduce((s, m) => s + m.content.length, 0);
      expect(total).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    }
  });
});
