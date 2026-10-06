/**
 * Unit tests for paced word-level streaming playback.
 * Verifies streamTextFromContent round-trips content exactly through the
 * word-delta path (cache playback and live-chunk replay alike).
 */
import { describe, it, expect } from 'vitest';
import { streamTextFromContent } from '@/worker/lib/response-normalizer';

const MESSAGES = [{ role: 'user', content: 'What does John 3:16 say?' }];

describe('streamTextFromContent', () => {
  it('round-trips synthesized full text through word deltas', async () => {
    const text = 'For God so loved the world that He gave His only Son. — JHN 3:16 (BSB)';
    const result = await streamTextFromContent(text, MESSAGES);
    await expect(result.text).resolves.toBe(text);
  });

  it('round-trips live LLM chunk replay without loss', async () => {
    const chunks = ['For God so ', 'loved the world ', 'that He gave.'];
    const result = await streamTextFromContent(chunks.join(''), MESSAGES, chunks);
    await expect(result.text).resolves.toBe(chunks.join(''));
  });

  it('handles empty text', async () => {
    const result = await streamTextFromContent('', MESSAGES);
    await expect(result.text).resolves.toBe('');
  });
});
