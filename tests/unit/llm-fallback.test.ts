/**
 * Unit tests for generateWithFallback — the LLM failover logic.
 * Groq API calls are mocked; only control-flow and result shapes are tested.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FallbackResult } from '@/lib/llm-fallback';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTextStream = async function* (chunks: string[]) {
  for (const chunk of chunks) yield chunk;
};

const mockStreamText = vi.fn();
const mockGroq = vi.fn();

vi.mock('@ai-sdk/groq', () => ({
  createGroq: () => mockGroq,
}));

vi.mock('ai', () => ({
  streamText: mockStreamText,
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function callFallback(overrides: Partial<Parameters<typeof import('@/lib/llm-fallback').generateWithFallback>[1]> = {}): Promise<FallbackResult> {
  // Re-import each time so mocks are fresh.
  const { generateWithFallback } = await import('@/lib/llm-fallback');
  return generateWithFallback('Test prompt', {
    maxTokens: 100,
    temperature: 0,
    apiKey: 'test-key',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns content from the primary Groq model on success', async () => {
    mockStreamText.mockResolvedValueOnce({
      textStream: mockTextStream(['Hello', ' world']),
    });

    const result = await callFallback();
    expect(result.modelUsed).toContain('llama-3.1-8b-instant');
    expect(result.content).toBe('Hello world');
    expect((result as any).finalFallback).toBeFalsy();
  });

  it('falls back to the secondary model on quota error from primary', async () => {
    // First call (primary) throws 429.
    mockStreamText
      .mockRejectedValueOnce(Object.assign(new Error('Rate limit'), { status: 429 }))
      .mockResolvedValueOnce({ textStream: mockTextStream(['Secondary response']) });

    const result = await callFallback();
    expect(result.modelUsed).toContain('llama-3.3-70b-versatile');
    expect(result.content).toBe('Secondary response');
  });

  it('returns context-only content when both models fail', async () => {
    mockStreamText
      .mockRejectedValueOnce(Object.assign(new Error('Rate limit'), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('Rate limit'), { status: 429 }));

    const result = await callFallback();
    expect(result.modelUsed).toBe('context-only');
    expect(result.finalFallback).toBe(true);
    expect(result.content).toContain('AI inference unavailable');
  });

  it('returns context-only content when GROQ_API_KEY is missing', async () => {
    delete process.env.GROQ_API_KEY;
    const result = await callFallback({ apiKey: undefined });
    expect(result.modelUsed).toBe('context-only');
    expect(result.finalFallback).toBe(true);
  });

  it('calls onTiming callback with elapsed duration', async () => {
    mockStreamText.mockResolvedValueOnce({
      textStream: mockTextStream(['Done']),
    });

    const onTiming = vi.fn();
    await callFallback({ onTiming });
    expect(onTiming).toHaveBeenCalledOnce();
    expect(typeof onTiming.mock.calls[0][0]).toBe('number');
  });
});
