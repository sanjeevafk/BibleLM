export type QueryDomain = 'messianic' | 'covenants' | 'eschatology' | 'typology' | 'general';

type DomainRule = {
  domain: QueryDomain;
  keywords: string[];
};

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

const EXPANSION_MAP: Record<QueryDomain, string[]> = {
  messianic: ['anointed one', 'branch', 'servant', 'pierced', 'davidic king'],
  covenants: ['mosaic law', 'abrahamic promise', 'new covenant', 'blood covenant'],
  eschatology: ['judgment day', 'second coming', 'resurrection', 'tribulation'],
  typology: ['shadow', 'fulfillment', 'pattern', 'prefigure'],
  general: []
};

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

export function classifyAndExpand(query: string): { domain: QueryDomain; expandedQuery: string } {
  const normalized = query.toLowerCase();
  let domain: QueryDomain = 'general';

  for (const rule of DOMAIN_RULES) {
    if (rule.keywords.some((keyword) => matchesKeyword(normalized, keyword))) {
      domain = rule.domain;
      break;
    }
  }

  const expansions = EXPANSION_MAP[domain] ?? [];
  const additions = expansions.filter((term) => !normalized.includes(term.toLowerCase()));
  const expandedQuery = additions.length > 0 ? `${query} ${additions.join(' ')}`.trim() : query;

  return { domain, expandedQuery };
}
