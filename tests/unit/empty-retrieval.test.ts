/**
 * Empty-retrieval policy: biblical queries with zero verses must fail
 * closed (no parametric Scripture answers). Conversational/off-topic
 * queries may use general knowledge.
 */
import { describe, it, expect } from 'vitest';
import { buildContextPrompt } from '@/lib/prompts';

describe('buildContextPrompt empty retrieval', () => {
  it('fail-closed by default: no general-knowledge Bible answers', () => {
    const prompt = buildContextPrompt('What does John 3:16 say?', [], 'BSB');
    expect(prompt).toContain('No verses were retrieved');
    expect(prompt).toContain('do not invent verses');
    expect(prompt).not.toMatch(/respond conversationally based on general biblical knowledge/i);
  });

  it('allows general reply only when explicitly flagged (conversational)', () => {
    const prompt = buildContextPrompt('hello there', [], 'BSB', { allowGeneralKnowledge: true });
    expect(prompt).toMatch(/general biblical knowledge/i);
  });

  it('non-empty retrieval still builds allowlist', () => {
    const prompt = buildContextPrompt('love', [
      { reference: 'JHN 3:16', text: 'For God so loved the world', translation: 'BSB' } as never,
    ], 'BSB');
    expect(prompt).toContain('ALLOWED CITATIONS');
    expect(prompt).toContain('John 3:16');
  });
});
