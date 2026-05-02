import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';

type FallbackOptions = {
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  fallbackContent?: string;
  onChunk?: (chunk: string) => void | Promise<void>;
  onTiming?: (durationMs: number) => void;
};

export type FallbackResult =
  | { type: 'content'; content: string; modelUsed: string; finalFallback?: boolean; chunks?: string[] };

const GROQ_PRIMARY_MODEL = 'llama-3.1-8b-instant';
const GROQ_SECONDARY_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.1;

function roundDurationMs(durationMs: number): number {
  return Number(durationMs.toFixed(2));
}

function isQuotaError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '').toUpperCase();
  const status = (error as { status?: number })?.status;

  return (
    status === 429 ||
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('RATE LIMIT') ||
    message.includes('QUOTA')
  );
}

function extractTranslation(prompt: string): string | undefined {
  const match = prompt.match(/Requested translation:\s*([A-Z0-9-]+)/i);
  return match?.[1]?.trim();
}

type ParsedVerse = {
  reference: string;
  translation: string;
  text: string;
  original: string[];
};

function parseVersesFromPrompt(prompt: string): ParsedVerse[] {
  const lines = prompt.split(/\r?\n/);
  const verses: ParsedVerse[] = [];
  let current: ParsedVerse | null = null;
  let inOriginal = false;

  for (const line of lines) {
    const refMatch = line.match(/^Reference:\s*(.+)$/);
    if (refMatch) {
      current = {
        reference: refMatch[1].trim(),
        translation: '',
        text: '',
        original: [],
      };
      verses.push(current);
      inOriginal = false;
      continue;
    }

    const textMatch = line.match(/^Text\s*\(([^)]+)\):\s*(.+)$/);
    if (textMatch && current) {
      current.translation = textMatch[1].trim();
      current.text = textMatch[2].trim();
      continue;
    }

    if (/^Original language data/i.test(line)) {
      inOriginal = true;
      continue;
    }

    if (inOriginal && line.trim().startsWith('- ') && current) {
      current.original.push(line.trim().replace(/^- /, ''));
      continue;
    }

    if (/^No original-language tagging available/i.test(line) && current) {
      current.original.push('No original-language tagging available for this verse.');
      inOriginal = false;
      continue;
    }

    if (line.trim() === '') {
      inOriginal = false;
    }
  }

  return verses;
}

function buildContextOnlyContent(prompt: string): string {
  const translation = extractTranslation(prompt);
  const verses = parseVersesFromPrompt(prompt);
  const lines: string[] = [];

  lines.push('AI inference unavailable – showing Scripture context only.');
  lines.push('');

  if (verses.length === 0) {
    lines.push('No supporting passages found in the authoritative sources.');
    return lines.join('\n');
  }

  for (const verse of verses) {
    if (verse.text) {
      lines.push(`- "${verse.text}"`);
    } else {
      lines.push('- (Verse text unavailable)');
    }

    const translationLabel = verse.translation || translation || 'Translation';
    if (verse.reference) {
      lines.push(`  - ${verse.reference} (${translationLabel})`);
    }

    if (verse.original.length > 0) {
      lines.push('  - **Original key words:**');
      for (const word of verse.original) {
        lines.push(`    - ${word}`);
      }
    }

    lines.push('');
  }

  if (translation) {
    lines.push(`All quotes from ${translation}. Original languages from OSHB / SBLGNT. Read full chapters for context.`);
  } else {
    lines.push('All quotes from the requested translation. Original languages from OSHB / SBLGNT. Read full chapters for context.');
  }

  return lines.join('\n');
}

/**
 * Generates text using Groq with an optional fail-safe to context-only output.
 */
export async function generateWithFallback(
  prompt: string,
  options: FallbackOptions
): Promise<FallbackResult> {
  const startedAt = performance.now();

  try {
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    const groqApiKey = options.apiKey || process.env.GROQ_API_KEY;

    if (!groqApiKey) {
      throw new Error('GROQ_API_KEY missing');
    }

    const groq = createGroq({ apiKey: groqApiKey });
    const groqModels = [GROQ_PRIMARY_MODEL, GROQ_SECONDARY_MODEL];

    for (const modelName of groqModels) {
      try {
        const groqStream = streamText({
          model: groq(modelName),
          prompt,
          temperature,
          maxTokens: maxTokens as any,
        } as any);

        const chunks: string[] = [];
        for await (const chunk of (await groqStream).textStream) {
          chunks.push(chunk);
          options.onChunk?.(chunk);
        }

        const text = chunks.join('');
        if (text) {
          console.log(`[llm] Using Groq: ${modelName}`);
          return { type: 'content', content: text, modelUsed: `groq:${modelName}`, chunks };
        }
      } catch (error) {
        console.warn(`[llm] Groq error (${modelName}):`, error);
        if (isQuotaError(error)) {
          // If the first model hits quota, try the secondary one.
          continue;
        }
        // For other errors, break and hit the fail-safe.
        break;
      }
    }

    // If we reach here, both Groq models failed or were unavailable.
    return {
      type: 'content',
      content: options.fallbackContent ?? buildContextOnlyContent(prompt),
      modelUsed: 'context-only',
      finalFallback: true,
    };
  } catch (error) {
    console.error('[llm] Unexpected error:', error);
    return {
      type: 'content',
      content: options.fallbackContent ?? buildContextOnlyContent(prompt),
      modelUsed: 'context-only',
      finalFallback: true,
    };
  } finally {
    options.onTiming?.(roundDurationMs(performance.now() - startedAt));
  }
}

