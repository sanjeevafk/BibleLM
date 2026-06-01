/**
 * Request validation for POST /api/chat.
 *
 * Parses the raw request body, normalises messages, and extracts the query,
 * translation, and conversation history. All errors are returned as typed
 * results so the route handler can produce well-formed HTTP responses.
 */

const VALID_TRANSLATIONS = ['BSB', 'KJV', 'WEB', 'ASV', 'NHEB'] as const;
export type SupportedTranslation = (typeof VALID_TRANSLATIONS)[number];

export type NormalizedMessage = {
  role: 'system' | 'assistant' | 'user';
  content: string;
};

export type ParsedChatRequest = {
  query: string;
  requestedTranslation: string;
  modelHistory: NormalizedMessage[];
  historyHash?: string;
  lastUserIndex: number;
};

export type ChatRequestValidationError =
  | { type: 'missing_query' }
  | { type: 'bad_body' };

export type ChatRequestValidationResult =
  | { ok: true; value: ParsedChatRequest }
  | { ok: false; error: ChatRequestValidationError };

/** Normalises a translation string to one of the supported values, defaulting to BSB. */
export function normalizeTranslation(input: string | null | undefined): string {
  if (!input) return 'BSB';
  const upper = String(input).trim().toUpperCase();
  return (VALID_TRANSLATIONS as readonly string[]).includes(upper) ? upper : 'BSB';
}

/** Extracts a plain text string from a single raw message object. */
function extractMessageContent(
  message: { role?: string; content?: unknown; parts?: Array<{ type?: string; text?: string }> }
): { role: 'system' | 'assistant' | 'user'; content: string } | null {
  const role = message?.role;
  if (role !== 'system' && role !== 'assistant' && role !== 'user') return null;

  if (typeof message.content === 'string') {
    return message.content.trim() ? { role, content: message.content } : null;
  }

  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text || '' : ''))
      .join('');
    return text.trim() ? { role, content: text } : null;
  }

  if (Array.isArray(message.parts)) {
    const text = (message.parts as Array<{ type?: string; text?: string }>)
      .map((part) => (part?.type === 'text' ? part.text || '' : ''))
      .join('');
    return text.trim() ? { role, content: text } : null;
  }

  return null;
}

/**
 * Parses and validates a raw chat API request body.
 * Returns a typed result — no exceptions thrown.
 */
export function parseChatRequest(
  body: unknown,
  req: Request
): ChatRequestValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: { type: 'bad_body' } };
  }

  const { messages, translation } = body as Record<string, unknown>;

  // Derive the base URL for query-string translation parsing.
  const baseUrl =
    req.headers.get('origin') ||
    (() => {
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
      if (host) {
        const proto = req.headers.get('x-forwarded-proto') || 'http';
        return `${proto}://${host}`;
      }
      return 'http://localhost';
    })();

  const url = new URL(req.url, baseUrl);
  const queryTranslation = url.searchParams.get('translation') || url.searchParams.get('trans');
  const headerTranslation = req.headers.get('x-translation') || req.headers.get('x-bible-translation');

  if (!Array.isArray(messages)) {
    return { ok: false, error: { type: 'bad_body' } };
  }
  const rawMessages = messages;
  const normalizedMessages = rawMessages
    .map(extractMessageContent)
    .filter((m): m is NormalizedMessage => m !== null);

  let lastUserIndex = -1;
  let lastUserMessage: NormalizedMessage | undefined;
  for (let i = normalizedMessages.length - 1; i >= 0; i -= 1) {
    if (normalizedMessages[i].role === 'user') {
      lastUserIndex = i;
      lastUserMessage = normalizedMessages[i];
      break;
    }
  }

  if (!lastUserMessage) return { ok: false, error: { type: 'missing_query' } };

  const query = lastUserMessage.content.trim();
  if (!query) return { ok: false, error: { type: 'missing_query' } };

  const rawTranslation =
    typeof translation === 'string' && translation.trim()
      ? translation
      : queryTranslation || headerTranslation;

  const requestedTranslation = normalizeTranslation(rawTranslation);
  const modelHistory = lastUserIndex > 0 ? normalizedMessages.slice(0, lastUserIndex) : [];

  return {
    ok: true,
    value: { query, requestedTranslation, modelHistory, lastUserIndex },
  };
}
