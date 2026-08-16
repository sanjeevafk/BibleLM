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
  'says',
  'said',
  'about',
  'explain',
  'meaning',
  'bible',
  'scripture',
  'please',
  'show',
  'tell',
  'me',
  'how',
  'should',
  'can',
  'could',
  'would',
  'is',
  'are',
  'was',
  'were',
  'do',
  'did',
  'give',
  'given',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'a',
  'an',
  'and',
  'or',
  'according',
  'accordingly',
  'christian',
  'christians',
  'teaching',
  'teachings',
  'perspective',
  'view',
  'views',
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
  'ten commandments',
  'peace of mind',
  'love your enemies',
  'faith and works',
  'faith alone',
];

const NEGATION_HINTS: NegationHint[] = ['not', 'without', 'except', 'never'];
const FILLER_PREFIXES = [
  'what does the bible say about',
  'what does scripture say about',
  'what does jesus say about',
  'what does god say about',
  'what does the bible teach about',
  'what does scripture teach about',
  'how should a christian',
  'how should christians',
  'how does a christian',
  'how can a christian',
  'how to',
  'tell me about',
  'tell me what the bible says about',
  'explain to me',
  'explain',
  'can you explain',
  'help me understand',
  'where in the bible does it say',
  'where does the bible say',
  'what are the',
  'what is the',
  'what is',
  'what are',
  'list the',
  'show me',
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
  const index = normalized.indexOf(lowerKeyword);
  if (index === -1) return false;

  // Check word boundaries (equivalent to \b)
  const beforeChar = index > 0 ? normalized[index - 1] : ' ';
  const afterChar = index + lowerKeyword.length < normalized.length ? normalized[index + lowerKeyword.length] : ' ';

  const isWordChar = (char: string) => /[a-z0-9_]/.test(char);
  return !isWordChar(beforeChar) && !isWordChar(afterChar);
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

function safeReplaceAllCaseInsensitive(str: string, search: string, replacement: string): string {
  if (!search) return str;
  let result = '';
  const searchLower = search.toLowerCase();
  let i = 0;
  while (true) {
    const nextIdx = str.toLowerCase().indexOf(searchLower, i);
    if (nextIdx === -1) {
      result += str.slice(i);
      break;
    }
    result += str.slice(i, nextIdx) + replacement;
    i = nextIdx + search.length;
  }
  return result;
}

function cleanupLowValueTokens(query: string, preservedPhrases: string[]): string[] {
  const placeholderMap = new Map<string, string>();
  let protectedQuery = query;

  preservedPhrases.forEach((phrase, index) => {
    const placeholder = `phrasetag${index}`;
    placeholderMap.set(placeholder, phrase);
    protectedQuery = safeReplaceAllCaseInsensitive(protectedQuery, phrase, placeholder);
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

/**
 * Detects whether a query is a comparative or compound question,
 * and decomposes it into distinct parallel sub-queries.
 */
export function decomposeQuery(query: string): string[] {
  const normalized = query.trim();
  const lower = normalized.toLowerCase();

  let target = normalized;
  if (lower.startsWith('compare ')) {
    target = normalized.slice(8).trim();
  } else if (lower.startsWith('what is the difference between ')) {
    target = normalized.slice(31).trim();
  } else if (lower.startsWith('difference between ')) {
    target = normalized.slice(19).trim();
  }

  const targetLower = target.toLowerCase();
  const delimiters = [' versus ', ' vs ', ' and ', ' with ', ' to '];

  for (const delim of delimiters) {
    const idx = targetLower.indexOf(delim);
    if (idx !== -1) {
      const part1 = target.slice(0, idx).trim().replace(/^the\s+/i, '');
      const part2 = target.slice(idx + delim.length).trim().replace(/^the\s+/i, '').replace(/\?+$/, '');
      if (part1.length > 2 && part2.length > 2) {
        return [part1, part2];
      }
    }
  }

  return [normalized];
}

