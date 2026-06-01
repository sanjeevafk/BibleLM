/**
 * Unit tests for the chat route's extracted service modules.
 * Tests validation, translation normalisation, and prompt construction.
 * No I/O — all HTTP Request objects are constructed inline.
 */

import { describe, it, expect } from 'vitest';
import { normalizeTranslation, parseChatRequest } from '@/app/api/chat/lib/validation';
import { buildRetrievalPrompt, appendConversationHistory } from '@/app/api/chat/lib/prompt-builder';

// ---------------------------------------------------------------------------
// normalizeTranslation
// ---------------------------------------------------------------------------

describe('normalizeTranslation', () => {
  it('returns BSB for undefined input', () => {
    expect(normalizeTranslation(undefined)).toBe('BSB');
  });

  it('returns BSB for null input', () => {
    expect(normalizeTranslation(null)).toBe('BSB');
  });

  it('returns BSB for an unrecognized translation', () => {
    expect(normalizeTranslation('NIV')).toBe('BSB');
  });

  it('normalizes lowercase to uppercase supported translation', () => {
    expect(normalizeTranslation('kjv')).toBe('KJV');
  });

  it('accepts all supported translations', () => {
    for (const t of ['BSB', 'KJV', 'WEB', 'ASV', 'NHEB']) {
      expect(normalizeTranslation(t)).toBe(t);
    }
  });
});

// ---------------------------------------------------------------------------
// parseChatRequest
// ---------------------------------------------------------------------------

function makeRequest(url = 'http://localhost/api/chat', headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe('parseChatRequest', () => {
  it('returns error for missing messages', () => {
    const result = parseChatRequest({}, makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('bad_body');
  });

  it('returns error when no user message present', () => {
    const body = {
      messages: [{ role: 'assistant', content: 'Hello' }],
    };
    const result = parseChatRequest(body, makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('missing_query');
  });

  it('extracts the last user message as the query', () => {
    const body = {
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'Answer' },
        { role: 'user', content: 'Second question' },
      ],
    };
    const result = parseChatRequest(body, makeRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.query).toBe('Second question');
      expect(result.value.modelHistory).toHaveLength(2); // first user + assistant
    }
  });

  it('picks up translation from request body', () => {
    const body = { messages: [{ role: 'user', content: 'Test' }], translation: 'KJV' };
    const result = parseChatRequest(body, makeRequest());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requestedTranslation).toBe('KJV');
  });

  it('picks up translation from query string', () => {
    const body = { messages: [{ role: 'user', content: 'Test' }] };
    const result = parseChatRequest(body, makeRequest('http://localhost/api/chat?translation=WEB'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requestedTranslation).toBe('WEB');
  });

  it('falls back to BSB for unrecognized translation', () => {
    const body = { messages: [{ role: 'user', content: 'Test' }], translation: 'NIV' };
    const result = parseChatRequest(body, makeRequest());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requestedTranslation).toBe('BSB');
  });

  it('handles content arrays (multipart messages)', () => {
    const body = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'What is grace?' }] },
      ],
    };
    const result = parseChatRequest(body, makeRequest());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.query).toBe('What is grace?');
  });
});

// ---------------------------------------------------------------------------
// appendConversationHistory
// ---------------------------------------------------------------------------

describe('appendConversationHistory', () => {
  it('returns the prompt unchanged when history is empty', () => {
    const result = appendConversationHistory('Base prompt', []);
    expect(result).toBe('Base prompt');
  });

  it('appends history block when present', () => {
    const history = [
      { role: 'user' as const, content: 'Hi' },
      { role: 'assistant' as const, content: 'Hello!' },
    ];
    const result = appendConversationHistory('Base prompt', history);
    expect(result).toContain('CONVERSATION HISTORY');
    expect(result).toContain('User: Hi');
    expect(result).toContain('Assistant: Hello!');
  });

  it('excludes system messages from history block', () => {
    const history = [
      { role: 'system' as const, content: 'You are a bible assistant' },
      { role: 'user' as const, content: 'Tell me about faith' },
    ];
    const result = appendConversationHistory('Base prompt', history);
    expect(result).not.toContain('You are a bible assistant');
    expect(result).toContain('User: Tell me about faith');
  });
});
