/**
 * config/env.ts — Strict environment validation at boot time.
 *
 * Uses Zod to parse and validate `process.env` once on startup.
 * Any missing or malformed required value will throw immediately,
 * preventing silent misconfiguration deep in the execution pipeline.
 *
 * Usage:
 *   import { env } from '@/config/env';
 *   const apiKey = env.GEMINI_API_KEY;
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // ── LLM Providers ─────────────────────────────────────────────────────────
  /** Primary Gemini LLM key. Required for best-experience path. */
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY must not be empty').optional(),

  /** OpenRouter key — used as secondary LLM fallback. */
  OPENROUTER_API_KEY: z.string().min(1).optional(),

  /** Optional OpenRouter model override. Defaults to llama-3.1-8b-instruct. */
  OPENROUTER_MODEL: z.string().optional(),

  /** Groq key — used as tertiary LLM fallback. */
  GROQ_API_KEY: z.string().min(1).optional(),

  /** Hugging Face token — embeddings + HF inference fallback. */
  HF_TOKEN: z.string().min(1).optional(),

  // ── Cache / Rate Limiting ─────────────────────────────────────────────────
  /** Upstash Redis REST endpoint (optional but recommended for caching). */
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url('UPSTASH_REDIS_REST_URL must be a valid URL')
    .optional()
    .or(z.literal('')),

  /** Upstash Redis REST token (required when URL is set). */
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // ── Database ──────────────────────────────────────────────────────────────
  /** PostgreSQL connection string (optional — falls back to local JSON index). */
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid connection string (e.g. postgres://...)')
    .optional()
    .or(z.literal('')),

  // ── Application ───────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  /** Canonical app URL, used for CORS allow-list. */
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('')),
});

// ---------------------------------------------------------------------------
// Cross-field validation
// ---------------------------------------------------------------------------

const refinedSchema = envSchema.superRefine((data, ctx) => {
  // If a Redis URL is provided, a token must also be present.
  if (data.UPSTASH_REDIS_REST_URL && !data.UPSTASH_REDIS_REST_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['UPSTASH_REDIS_REST_TOKEN'],
      message:
        'UPSTASH_REDIS_REST_TOKEN is required when UPSTASH_REDIS_REST_URL is set.',
    });
  }

  // Warn (not throw) if no LLM provider is configured.
  const hasAnyLlm =
    data.GEMINI_API_KEY ||
    data.OPENROUTER_API_KEY ||
    data.GROQ_API_KEY ||
    data.HF_TOKEN;

  if (!hasAnyLlm) {
    // Non-fatal: the context-only fallback path can still respond.
    console.warn(
      '[env] WARNING: No LLM provider API key is configured. ' +
      'Responses will fall back to context-only mode (no generative answer).'
    );
  }
});

// ---------------------------------------------------------------------------
// Parse & freeze
// ---------------------------------------------------------------------------

function parseEnv() {
  const result = refinedSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `[BibleLM] Environment validation failed. Fix the following before starting:\n${issues}`
    );
  }

  return Object.freeze(result.data);
}

/**
 * Validated, strongly-typed environment object.
 * Frozen at module load time — mutating it will throw in strict mode.
 */
export const env = parseEnv();

export type Env = typeof env;
