import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { GoogleGenAI } from '@google/genai';
import { InferenceClient } from '@huggingface/inference';

type FallbackOptions = {
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  fallbackContent?: string;
};

export type FallbackResult =
  | { type: 'content'; content: string; modelUsed: string; finalFallback?: boolean };

const GROQ_PRIMARY_MODEL = 'llama-3.1-8b-instant';
const GROQ_FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const HF_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct';
const GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_FREQUENCY_PENALTY = 0.5;

function logModelFailure(model: string, error: unknown) {
  console.warn(`[llm-fallback] model failed: ${model}`, error);
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

  lines.push('AI inference temporarily limited – showing Scripture context only.');
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

export async function generateWithFallback(
  prompt: string,
  options: FallbackOptions
): Promise<FallbackResult> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const apiKey = options.apiKey || process.env.GROQ_API_KEY;

  if (apiKey) {
    const groq = createGroq({ apiKey });
    const groqModels = [GROQ_PRIMARY_MODEL, GROQ_FALLBACK_MODEL];

    for (const modelName of groqModels) {
      try {
        const result = await generateText({
          model: groq(modelName) as any,
          prompt,
          temperature,
          maxTokens,
          frequencyPenalty: DEFAULT_FREQUENCY_PENALTY,
        });
        const text = result.text?.trim();
        if (text) {
          return { type: 'content', content: text, modelUsed: `groq:${modelName}` };
        }
        throw new Error('Groq returned empty output');
      } catch (error) {
        logModelFailure(`groq:${modelName}`, error);
      }
    }
  }

  const hfToken = process.env.HF_TOKEN;
  if (hfToken) {
    try {
      const hf = new InferenceClient(hfToken);
      const hfResult = await hf.textGeneration({
        model: HF_MODEL,
        provider: 'hf-inference',
        inputs: prompt,
        parameters: {
          max_new_tokens: maxTokens,
          temperature,
          return_full_text: false,
        },
        options: { wait_for_model: true },
      });

      const hfText =
        typeof hfResult === 'string'
          ? hfResult
          : Array.isArray(hfResult)
            ? hfResult[0]?.generated_text
            : hfResult.generated_text;

      if (hfText && hfText.trim()) {
        return { type: 'content', content: hfText.trim(), modelUsed: `hf:${HF_MODEL}` };
      }
      throw new Error('HF inference returned empty output');
    } catch (error) {
      logModelFailure(`hf:${HF_MODEL}`, error);
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      });
      const geminiText = result.text?.trim();
      if (geminiText) {
        return { type: 'content', content: geminiText, modelUsed: `gemini:${GEMINI_MODEL}` };
      }
      throw new Error('Gemini returned empty output');
    } catch (error) {
      logModelFailure(`gemini:${GEMINI_MODEL}`, error);
    }
  }

  const fallbackContent =
    options.fallbackContent ?? buildContextOnlyContent(prompt);

  return {
    type: 'content',
    content: fallbackContent,
    modelUsed: 'context-only',
    finalFallback: true,
  };
}
