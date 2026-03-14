export type VerseContext = {
  reference: string;
  translation: string;
  text: string;
  original: Array<{ word: string; strongs: string; gloss?: string; morph?: string; transliteration?: string }>;
  isCrossReference?: boolean;
  openHebrew?: string;
  openGnt?: string;
};

const EXTERNAL_VERSE_FETCH_TIMEOUT_MS = 1500;
const EXTERNAL_VERSE_FETCH_TOTAL_BUDGET_MS = 2000;
const EXTERNAL_VERSE_FETCH_MAX_RETRIES = 1;
const EXTERNAL_VERSE_FETCH_BACKOFF_MS = 150;
const EXTERNAL_FETCH_SOURCES = {
  helloao: 'https://bible.helloao.org',
  bibleApi: 'https://bible-api.com',
  bolls: 'https://bolls.life',
} as const;

type ExternalFetchBudgetOptions = {
  source: keyof typeof EXTERNAL_FETCH_SOURCES;
  timeoutMs?: number;
  totalBudgetMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
};

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildExternalUrl(
  source: keyof typeof EXTERNAL_FETCH_SOURCES,
  pathname: string,
  query?: Record<string, string>
): URL {
  const url = new URL(EXTERNAL_FETCH_SOURCES[source]);
  url.pathname = pathname.startsWith('/') ? pathname : `/${pathname}`;

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

function isAllowedExternalUrl(url: URL, source: keyof typeof EXTERNAL_FETCH_SOURCES): boolean {
  return url.protocol === 'https:' && url.origin === EXTERNAL_FETCH_SOURCES[source];
}

function logExternalFetchWarning(payload: Record<string, unknown>): void {
  console.warn(JSON.stringify({ event: 'external_fetch_warning', ...payload }));
}

export async function fetchExternalWithTimeoutBudget(
  url: URL,
  init: RequestInit = {},
  options: ExternalFetchBudgetOptions
): Promise<Response | null> {
  if (!isAllowedExternalUrl(url, options.source)) {
    logExternalFetchWarning({
      source: options.source,
      reason: 'blocked_disallowed_url',
    });
    return null;
  }

  const timeoutMs = options.timeoutMs ?? EXTERNAL_VERSE_FETCH_TIMEOUT_MS;
  const totalBudgetMs = options.totalBudgetMs ?? EXTERNAL_VERSE_FETCH_TOTAL_BUDGET_MS;
  const maxRetries = options.maxRetries ?? EXTERNAL_VERSE_FETCH_MAX_RETRIES;
  const retryBackoffMs = options.retryBackoffMs ?? EXTERNAL_VERSE_FETCH_BACKOFF_MS;
  const startedAt = Date.now();
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const elapsedMs = Date.now() - startedAt;
    const remainingBudgetMs = totalBudgetMs - elapsedMs;
    if (remainingBudgetMs <= 0) {
      break;
    }

    const controller = new AbortController();
    const perAttemptTimeoutMs = Math.max(1, Math.min(timeoutMs, remainingBudgetMs));
    const timeoutId = setTimeout(() => controller.abort(), perAttemptTimeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal
      });

      if (response.ok || !isRetryableStatus(response.status) || attempt === maxRetries) {
        return response;
      }

      lastResponse = response;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt === maxRetries) {
      break;
    }

    const remainingAfterAttemptMs = totalBudgetMs - (Date.now() - startedAt);
    const backoffMs = Math.min(retryBackoffMs * (2 ** attempt), remainingAfterAttemptMs);
    if (backoffMs <= 0) {
      break;
    }

    await sleep(backoffMs);
  }

  const elapsedMs = Date.now() - startedAt;
  if (lastError) {
    logExternalFetchWarning({
      source: options.source,
      reason: 'request_failed',
      elapsed_ms: elapsedMs,
      error_name: lastError instanceof Error ? lastError.name : 'unknown',
    });
    return null;
  }

  if (lastResponse && !lastResponse.ok && isRetryableStatus(lastResponse.status)) {
    logExternalFetchWarning({
      source: options.source,
      reason: 'retry_budget_exhausted',
      elapsed_ms: elapsedMs,
      status: lastResponse.status,
    });
  }

  return lastResponse;
}

// HelloAO gives us books by these long codes or short abbreviations usually matching.
export async function fetchTranslations() {
  return [
    { shortName: 'BSB', name: 'Berean Study Bible' },
    { shortName: 'KJV', name: 'King James Version' },
    { shortName: 'WEB', name: 'World English Bible' },
    { shortName: 'ASV', name: 'American Standard Version' }
  ];
}

// Format: /api/{translation}/{book}/{chapter}.json
export async function fetchVerseHelloAO(
  translation: string,
  book: string,
  chapter: number,
  startVerse: number,
  endVerse?: number
): Promise<string | null> {
  try {
    const res = await fetchExternalWithTimeoutBudget(
      buildExternalUrl(
        'helloao',
        `/api/${encodeURIComponent(translation)}/${encodeURIComponent(book)}/${encodeURIComponent(`${chapter}.json`)}`
      ),
      {},
      {
        source: 'helloao'
      }
    );
    if (!res?.ok) return null;
    
    const data = await res.json();
    if (!data?.chapter?.content) return null;
    
    let text = '';
    const end = endVerse || startVerse;
    
    for (const item of data.chapter.content) {
      if (item.type === 'verse' && item.number >= startVerse && item.number <= end) {
        const verseText = item.content.map((c: unknown) => typeof c === 'string' ? c : '').join('').trim();
        text += verseText + ' ';
      }
    }
    
    return text.trim() || null;
  } catch (error) {
    console.error('HelloAO fetch error:', error);
    return null;
  }
}

// Fallback to fetch from bible-api.com
export async function fetchVerseFallback(reference: string, translation: string = 'web'): Promise<string | null> {
  try {
    // bible-api.com expects 'john 3:16'
    const res = await fetchExternalWithTimeoutBudget(
      buildExternalUrl('bibleApi', `/${encodeURIComponent(reference)}`, {
        translation: translation.toLowerCase(),
      }),
      {},
      {
        source: 'bibleApi'
      }
    );
    if (!res?.ok) return null;
    const data = await res.json();
    return data.text ? data.text.trim().replace(/\n/g, ' ') : null;
  } catch (error) {
    console.error('Fallback fetch error:', error);
    return null;
  }
}

type FetchVerseTextWithFallbackInput = {
  translation: string;
  reference: string;
  book: string;
  chapter: number;
  startVerse: number;
  endVerse?: number;
};

export async function fetchVerseTextWithFallback(
  input: FetchVerseTextWithFallbackInput
): Promise<string | null> {
  const { translation, reference, book, chapter, startVerse, endVerse } = input;
  return (
    await fetchVerseHelloAO(translation, book, chapter, startVerse, endVerse)
  ) || (
    await fetchVerseFallback(reference, translation)
  );
}

export async function fetchStrongsDefinition(strongs: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://bolls.life/dictionary-definition/BDBT/${strongs}/`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Bolls diff fetch error:', error);
    return null;
  }
}
