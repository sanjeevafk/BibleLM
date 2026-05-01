export type QueryDomain = 'messianic' | 'covenants' | 'eschatology' | 'typology' | 'general';
export type QueryIntent = 'DIRECT_REFERENCE' | 'VERSE_EXPLANATION' | 'TOPICAL_QUERY';

type DomainRule = {
  domain: QueryDomain;
  keywords: string[];
};

type ExpansionRule = {
  trigger: string;
  additions: string[];
};

export type NegationHint = 'not' | 'without' | 'except' | 'never';

const DOMAIN_RULES: DomainRule[] = [
  {
    domain: 'messianic',
    keywords: ['messiah', 'son of god', 'son of david', 'suffering servant']
  },
  {
    domain: 'covenants',
    keywords: ['covenant', 'law', 'new covenant', 'promise']
  },
  {
    domain: 'eschatology',
    keywords: ['end times', 'beast', 'tribulation', 'revelation', 'last days']
  },
  {
    domain: 'typology',
    keywords: ['typology', 'shadow', 'foreshadow', 'antitype', 'prefigure']
  }
];

const EXPANSION_RULES: Record<QueryDomain, ExpansionRule[]> = {
  messianic: [
    { trigger: 'messiah', additions: ['anointed one', 'christ'] },
    { trigger: 'son of david', additions: ['davidic king'] },
    { trigger: 'suffering servant', additions: ['pierced servant'] },
  ],
  covenants: [
    { trigger: 'covenant', additions: ['promise', 'testament'] },
    { trigger: 'law', additions: ['commandment', 'statute'] },
    { trigger: 'new covenant', additions: ['better covenant'] },
  ],
  eschatology: [
    { trigger: 'end times', additions: ['last days', 'day of the lord'] },
    { trigger: 'tribulation', additions: ['great tribulation'] },
    { trigger: 'resurrection', additions: ['raising of the dead'] },
  ],
  typology: [
    { trigger: 'typology', additions: ['shadow', 'fulfillment'] },
    { trigger: 'antitype', additions: ['fulfillment pattern'] },
    { trigger: 'foreshadow', additions: ['prophetic pattern'] },
  ],
  general: []
};

const LOW_VALUE_TOKENS = new Set([
  'what',
  'does',
  'the',
  'say',
  'about',
  'explain',
  'meaning',
  'bible',
  'please',
  'show',
  'tell',
  'me',
]);

const PRESERVED_PHRASES = [
  'kingdom of heaven',
  'kingdom of god',
  'son of man',
  'son of god',
  'holy spirit',
  'day of the lord',
  'new covenant',
  'suffering servant',
];

const NEGATION_HINTS: NegationHint[] = ['not', 'without', 'except', 'never'];
const FILLER_PREFIXES = [
  'what does the bible say about',
  'what does scripture say about',
  'tell me about',
  'explain',
  'can you explain',
  'help me understand',
];

const BOOK_NORMALIZATION_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bjn\b/gi, replacement: 'John' },
  { pattern: /\bjhn\b/gi, replacement: 'John' },
  { pattern: /\bgen(?=\d|\s)/gi, replacement: 'Genesis ' },
  { pattern: /\bge(?=\d|\s)/gi, replacement: 'Genesis ' },
  { pattern: /\bex(?=\d|\s)/gi, replacement: 'Exodus ' },
  { pattern: /\bexo(?=\d|\s)/gi, replacement: 'Exodus ' },
  { pattern: /\brom(?=\d|\s)/gi, replacement: 'Romans ' },
  { pattern: /\bpsalm(?=\d|\s)/gi, replacement: 'Psalms ' },
  { pattern: /\bps(?=\d|\s)/gi, replacement: 'Psalms ' },
  { pattern: /\bpsa(?=\d|\s)/gi, replacement: 'Psalms ' },
  { pattern: /\b1\s*cor\b/gi, replacement: '1 Corinthians' },
  { pattern: /\b2\s*cor\b/gi, replacement: '2 Corinthians' },
  { pattern: /\b1\s*thess\b/gi, replacement: '1 Thessalonians' },
  { pattern: /\b2\s*thess\b/gi, replacement: '2 Thessalonians' },
];

const DIRECT_REFERENCE_BOOK_PATTERN = Array.from(
  new Set(BOOK_NORMALIZATION_RULES.map((rule) => rule.replacement.trim().toLowerCase()))
)
  .map((book) => book.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const DIRECT_REFERENCE_REGEX = new RegExp(
  `\\b(?:${DIRECT_REFERENCE_BOOK_PATTERN})\\s+\\d+(?::\\d+)?\\b`,
  'i'
);
const EXPLANATION_CUE_REGEX = /\b(?:mean|means|meaning|explain|explains|understand|context)\b/i;

function matchesKeyword(query: string, keyword: string): boolean {
  const normalized = query.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  if (lowerKeyword.includes(' ')) {
    return normalized.includes(lowerKeyword);
  }
  const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(normalized);
}

function normalizeReferenceSpacing(query: string): string {
  let normalized = query;
  for (const rule of BOOK_NORMALIZATION_RULES) {
    normalized = normalized.replace(rule.pattern, rule.replacement);
  }

  return normalized
    .replace(/\b([1-3])\s*([A-Za-z]+)/g, '$1 $2')
    .replace(/\b([A-Za-z]+)\s*(\d+):(\d+)\b/g, '$1 $2:$3')
    .replace(/\b([A-Za-z]+)\s*(\d+)\b/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFillerPrefix(query: string): string {
  const normalized = query.trim();
  for (const prefix of FILLER_PREFIXES) {
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s,:-]*`, 'i');
    if (pattern.test(normalized)) {
      return normalized.replace(pattern, '').trim();
    }
  }
  return normalized;
}

function extractQuotedPhrases(query: string): string[] {
  const matches = query.match(/"([^"]+)"/g) ?? [];
  return matches
    .map((match) => match.replace(/"/g, '').trim().toLowerCase())
    .filter(Boolean);
}

function extractPreservedPhrases(query: string): string[] {
  const normalized = query.toLowerCase();
  return PRESERVED_PHRASES.filter((phrase) => normalized.includes(phrase));
}

function detectNegationHints(query: string): NegationHint[] {
  const normalized = query.toLowerCase();
  return NEGATION_HINTS.filter((hint) => matchesKeyword(normalized, hint));
}

function cleanupLowValueTokens(query: string, preservedPhrases: string[]): string[] {
  const placeholderMap = new Map<string, string>();
  let protectedQuery = query;

  preservedPhrases.forEach((phrase, index) => {
    const placeholder = `phrasetag${index}`;
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    placeholderMap.set(placeholder, phrase);
    protectedQuery = protectedQuery.replace(new RegExp(escapedPhrase, 'ig'), placeholder);
  });

  return protectedQuery
    .toLowerCase()
    .replace(/[^a-z0-9_:\- ]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => placeholderMap.get(token) || token)
    .filter((token) => !LOW_VALUE_TOKENS.has(token));
}

function dedupeParts(parts: string[]): string[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (!part || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isLikelyDirectReference(query: string): boolean {
  return DIRECT_REFERENCE_REGEX.test(query);
}

function classifyIntent(normalizedQuery: string): QueryIntent {
  const hasReference = isLikelyDirectReference(normalizedQuery);
  if (hasReference && EXPLANATION_CUE_REGEX.test(normalizedQuery)) {
    return 'VERSE_EXPLANATION';
  }
  if (hasReference) {
    return 'DIRECT_REFERENCE';
  }
  return 'TOPICAL_QUERY';
}

export function classifyAndExpand(query: string): {
  domain: QueryDomain;
  intent: QueryIntent;
  normalizedQuery: string;
  expandedQuery: string;
  negationHints: NegationHint[];
} {
  const strippedQuery = stripFillerPrefix(query);
  const normalizedQuery = normalizeReferenceSpacing(strippedQuery || query);
  const loweredQuery = normalizedQuery.toLowerCase();
  const intent = classifyIntent(normalizedQuery);
  let domain: QueryDomain = 'general';

  for (const rule of DOMAIN_RULES) {
    if (rule.keywords.some((keyword) => matchesKeyword(loweredQuery, keyword))) {
      domain = rule.domain;
      break;
    }
  }

  const preservedPhrases = dedupeParts([
    ...extractQuotedPhrases(normalizedQuery),
    ...extractPreservedPhrases(loweredQuery),
  ]);
  const negationHints = detectNegationHints(loweredQuery);
  const cleanedTokens = cleanupLowValueTokens(normalizedQuery, preservedPhrases);
  const shouldBypassExpansion = intent === 'DIRECT_REFERENCE';

  const matchedExpansionRules =
    shouldBypassExpansion
      ? []
      : (EXPANSION_RULES[domain] ?? []).filter((rule) => matchesKeyword(loweredQuery, rule.trigger));

  const expansions =
    shouldBypassExpansion
      ? []
      : intent === 'TOPICAL_QUERY'
        ? (matchedExpansionRules[0]?.additions ?? [])
            .slice(0, 2)
            .filter((term) => !loweredQuery.includes(term.toLowerCase()))
        : matchedExpansionRules
            .flatMap((rule) => rule.additions)
            .filter((term) => !loweredQuery.includes(term.toLowerCase()));

  if (shouldBypassExpansion) {
    return {
      domain,
      intent,
      normalizedQuery,
      expandedQuery: normalizedQuery,
      negationHints,
    };
  }

  const cleanedQuery = dedupeParts(
    cleanedTokens.filter((token) => !preservedPhrases.includes(token))
  ).join(' ');
  const quotedPhrases = preservedPhrases.map((phrase) => `"${phrase}"`);
  const baseQuery = cleanedQuery || quotedPhrases.join(' ') || normalizedQuery;

  const expandedParts = dedupeParts([
    baseQuery,
    ...quotedPhrases,
    ...expansions,
  ]);

  return {
    domain,
    intent,
    normalizedQuery,
    expandedQuery: expandedParts.join(' ').trim(),
    negationHints,
  };
}
