import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { GoogleGenAI } from '@google/genai';
import { InferenceClient } from '@huggingface/inference';

type FallbackOptions = {
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  fallbackContent?: string;
  onChunk?: (chunk: string) => void | Promise<void>;
};

export type FallbackResult =
  | { type: 'content'; content: string; modelUsed: string; finalFallback?: boolean; chunks?: string[] };

const GEMINI_PRIMARY_MODEL = 'gemini-2.5-flash';
const GEMINI_COMPAT_MODEL = 'gemini-1.5-flash';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';
const GROQ_PRIMARY_MODEL = 'llama-3.1-8b-instant';
const GROQ_SECONDARY_MODEL = 'llama-3.3-70b-versatile';
const HF_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.1;

function logModelFailure(model: string, error: unknown) {
  const message = String((error as { message?: string })?.message || error || '');
  const label = /429|rate limit/i.test(message)
    ? 'rate-limit'
    : /timeout|timed out|etimedout|abort/i.test(message)
      ? 'timeout'
      : 'error';
  console.warn(`[llm-fallback] ${label}: ${model}`, error);
}

function extractOpenRouterDelta(payload: unknown): string {
  const json = payload as {
    choices?: Array<{
      delta?: { content?: string | Array<{ text?: string }> };
      message?: { content?: string | Array<{ text?: string }> };
    }>;
  };
  const choice = json?.choices?.[0];
  if (!choice) return '';

  const value = choice.delta?.content ?? choice.message?.content;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

async function streamGeminiContent(
  modelName: string,
  prompt: string,
  apiKey: string,
  temperature: number,
  maxTokens: number,
  onChunk?: (chunk: string) => void | Promise<void>
): Promise<{ text: string; chunks: string[] }> {
  const ai = new GoogleGenAI({ apiKey });
  const stream = await ai.models.generateContentStream({
    model: modelName,
    contents: prompt,
    config: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  });

  const chunks: string[] = [];
  let text = '';

  for await (const chunk of stream) {
    const delta = chunk.text || '';
    if (!delta) continue;
    chunks.push(delta);
    text += delta;
    if (onChunk) {
      await onChunk(delta);
    }
  }

  return { text: text.trim(), chunks };
}

async function streamOpenRouterContent(
  prompt: string,
  apiKey: string,
  temperature: number,
  maxTokens: number,
  onChunk?: (chunk: string) => void | Promise<void>
): Promise<{ text: string; chunks: string[] }> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'BibleLM',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      stream: true,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenRouter returned ${response.status}: ${body.slice(0, 240)}`);
  }

  if (!response.body) {
    const fallback = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    const text = extractOpenRouterDelta(fallback).trim();
    return { text, chunks: text ? [text] : [] };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let text = '';
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const delta = extractOpenRouterDelta(JSON.parse(payload));
        if (!delta) continue;
        chunks.push(delta);
        text += delta;
        if (onChunk) {
          await onChunk(delta);
        }
      } catch (error) {
        console.warn('[llm-fallback] OpenRouter stream parse issue', error);
      }
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const payload = tail.slice('data:'.length).trim();
    if (payload && payload !== '[DONE]') {
      try {
        const delta = extractOpenRouterDelta(JSON.parse(payload));
        if (delta) {
          chunks.push(delta);
          text += delta;
          if (onChunk) {
            await onChunk(delta);
          }
        }
      } catch (error) {
        console.warn('[llm-fallback] OpenRouter tail parse issue', error);
      }
    }
  }

  return { text: text.trim(), chunks };
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
  const groqApiKey = options.apiKey || process.env.GROQ_API_KEY;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const geminiModels = [GEMINI_PRIMARY_MODEL, GEMINI_COMPAT_MODEL];
    for (const modelName of geminiModels) {
      try {
        const result = await streamGeminiContent(
          modelName,
          prompt,
          geminiKey,
          temperature,
          maxTokens,
          options.onChunk
        );
        const text = result.text;
        if (text) {
          console.log(`[llm-fallback] Using primary provider: gemini:${modelName}`);
          return { type: 'content', content: text, modelUsed: `gemini:${modelName}`, chunks: result.chunks };
        }
        throw new Error('Gemini returned empty output');
      } catch (error) {
        logModelFailure(`gemini:${modelName}`, error);
      }
    }
  } else {
    console.warn('[llm-fallback] GEMINI_API_KEY missing; skipping Gemini primary provider.');
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const result = await streamOpenRouterContent(
        prompt,
        openRouterKey,
        temperature,
        maxTokens,
        options.onChunk
      );
      const text = result.text;
      if (text) {
        console.log(`[llm-fallback] Using fallback provider: openrouter:${OPENROUTER_MODEL}`);
        return { type: 'content', content: text, modelUsed: `openrouter:${OPENROUTER_MODEL}`, chunks: result.chunks };
      }
      throw new Error('OpenRouter returned empty output');
    } catch (error) {
      logModelFailure(`openrouter:${OPENROUTER_MODEL}`, error);
    }
  } else {
    console.warn('[llm-fallback] OPENROUTER_API_KEY missing; skipping OpenRouter fallback.');
  }

  if (groqApiKey) {
    const groq = createGroq({ apiKey: groqApiKey });
    const groqModels = [GROQ_PRIMARY_MODEL, GROQ_SECONDARY_MODEL];

    for (const modelName of groqModels) {
      try {
        const result = await generateText({
          model: groq(modelName) as any,
          prompt,
          temperature,
          maxTokens,
        });
        const text = result.text?.trim();
        if (text) {
          console.log(`[llm-fallback] Using fallback provider: groq:${modelName}`);
          return { type: 'content', content: text, modelUsed: `groq:${modelName}` };
        }
        throw new Error('Groq returned empty output');
      } catch (error) {
        logModelFailure(`groq:${modelName}`, error);
      }
    }
  } else {
    console.warn('[llm-fallback] GROQ_API_KEY missing; skipping Groq fallback.');
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
        console.log(`[llm-fallback] Using fallback provider: hf:${HF_MODEL}`);
        return { type: 'content', content: hfText.trim(), modelUsed: `hf:${HF_MODEL}` };
      }
      throw new Error('HF inference returned empty output');
    } catch (error) {
      logModelFailure(`hf:${HF_MODEL}`, error);
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
