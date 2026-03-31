/**
 * Theological synonym mapping to improve BM25 recall for conceptual queries.
 * Format: { "standard_term": ["shorthand", "theological_alias", "related_concept"] }
 */

export const THEOLOGICAL_SYNONYMS: Record<string, string[]> = {
  "messiah": ["christ", "anointed", "shiloh", "son of david"],
  "christ": ["messiah", "jesus", "anointed"],
  "holy spirit": ["comforter", "paraclete", "spirit of truth", "holy ghost"],
  "salvation": ["redeemed", "saved", "deliverance", "justification"],
  "eternal life": ["everlasting life", "immortality", "world to come"],
  "covenant": ["testament", "promise", "agreement"],
  "commandments": ["laws", "statutes", "decrees", "precepts", "torah"],
  "gospel": ["good news", "evangel", "kerygma"],
  "trinity": ["godhead", "father son spirit"],
  "sin": ["iniquity", "transgression", "trespass", "wickedness"],
  "grace": ["favor", "lovingkindness", "mercy"],
  "faith": ["belief", "trust", "assurance"],
  "heaven": ["paradise", "kingdom of god", "glory"],
  "hell": ["sheol", "hades", "gehenna", "lake of fire"],
  "end times": ["last days", "eschaton", "revelation", "day of the lord"],
};

/**
 * Expands a query string by injecting synonyms for recognized theological terms.
 * Example: "messiah promise" -> "messiah christ anointed shiloh son of david promise"
 */
export function expandTheologicalQuery(query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  const expanded: string[] = [];

  for (const word of words) {
    expanded.push(word);
    
    // Check for exact matches in the synonym map
    if (THEOLOGICAL_SYNONYMS[word]) {
      expanded.push(...THEOLOGICAL_SYNONYMS[word]);
    }

    // Check for "holy spirit" etc. (two-word phrases)
    // NOTE: Simple greedy check for now
  }

  // Handle common two-word phrases
  if (query.toLowerCase().includes("holy spirit") && !expanded.includes("comforter")) {
    expanded.push(...THEOLOGICAL_SYNONYMS["holy spirit"]);
  }
  if (query.toLowerCase().includes("eternal life") && !expanded.includes("immortality")) {
    expanded.push(...THEOLOGICAL_SYNONYMS["eternal life"]);
  }
   if (query.toLowerCase().includes("end times") && !expanded.includes("eschaton")) {
    expanded.push(...THEOLOGICAL_SYNONYMS["end times"]);
  }

  return Array.from(new Set(expanded)).join(' ');
}
