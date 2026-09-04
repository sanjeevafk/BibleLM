/**
 * LLM fallback must try the secondary model on all retryable errors
 * (5xx, timeout, network) — not only quota/429 — and must not retry
 * on auth errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FallbackResult } from '@/lib/llm-fallback';

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

async function callFallback(overrides = {}): Promise<FallbackResult> {
  const { generateWithFallback } = await import('@/lib/llm-fallback');
  return generateWithFallback('Test prompt', {
    maxTokens: 100,
    temperature: 0,
    apiKey: 'test-key',
    ...overrides,
  });
}

describe('generateWithFallback retryable errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('retries secondary model on 500 from primary', async () => {
    mockStreamText
      .mockRejectedValueOnce(Object.assign(new Error('Internal Server Error'), { status: 500 }))
      .mockResolvedValueOnce({ textStream: mockTextStream(['recovered']) });
    const result = await callFallback();
    expect(result.modelUsed).toContain('llama-3.3-70b-versatile');
    expect(result.content).toBe('recovered');
  });

  it('retries secondary model on timeout/network error', async () => {
    mockStreamText
      .mockRejectedValueOnce(new Error('fetch failed: ETIMEDOUT'))
      .mockResolvedValueOnce({ textStream: mockTextStream(['recovered']) });
    const result = await callFallback();
    expect(result.content).toBe('recovered');
  });

  it('retries secondary model on empty primary output', async () => {
    mockStreamText
      .mockResolvedValueOnce({ textStream: mockTextStream([]) })
      .mockResolvedValueOnce({ textStream: mockTextStream(['second']) });
    const result = await callFallback();
    expect(result.content).toBe('second');
  });

  it('does NOT retry on auth error (fails fast to context-only)', async () => {
    mockStreamText.mockRejectedValueOnce(Object.assign(new Error('Invalid API key'), { status: 401 }));
    const result = await callFallback();
    expect(result.modelUsed).toBe('context-only');
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });
});
