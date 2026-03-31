/**
 * High-performance BM25 Implementation for Bible Retrieval.
 * 
 * Tuning Parameters:
 * k1 = 1.2 (Standard for short/medium documents)
 * b = 0.65 (Adjusted for verse-length documents)
 * 
 * IDF Smoothing: log((N - df + 0.5) / (df + 0.5) + 1)
 */

export interface BM25Doc {
  id: string;
  text: string;
  [key: string]: any;
}

export interface BM25Config {
  k1?: number;
  b?: number;
  phraseBoost?: number;
}

export class BM25Engine {
  private k1: number;
  private b: number;
  private phraseBoost: number;

  private totalDocs: number = 0;
  private avgDocLength: number = 0;
  private docLengths: Map<string, number> = new Map();
  private termFreqs: Map<string, Map<string, number>> = new Map(); // term -> docId -> count
  private docFreqs: Map<string, number> = new Map(); // term -> docCount
  
  private docs: Map<string, BM25Doc> = new Map();

  constructor(config: BM25Config = {}) {
    this.k1 = config.k1 ?? 1.2;
    this.b = config.b ?? 0.65;
    this.phraseBoost = config.phraseBoost ?? 1.5;
  }

  /**
   * Conservative tokenizer: preserves apostrophes, removes most other punctuation.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s']/g, ' ') // Preserve apostrophes, but strip other punctuation
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  /**
   * Indexes a collection of documents.
   */
  public async index(docs: BM25Doc[]) {
    this.totalDocs = docs.length;
    let totalLength = 0;

    for (const doc of docs) {
      this.docs.set(doc.id, doc);
      const tokens = this.tokenize(doc.text);
      const length = tokens.length;
      this.docLengths.set(doc.id, length);
      totalLength += length;

      const counts: Record<string, number> = {};
      for (const token of tokens) {
        counts[token] = (counts[token] || 0) + 1;
      }

      for (const [term, count] of Object.entries(counts)) {
        if (!this.termFreqs.has(term)) {
          this.termFreqs.set(term, new Map());
        }
        this.termFreqs.get(term)!.set(doc.id, count);
        this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
      }
    }

    this.avgDocLength = totalLength / this.totalDocs;
  }

  /**
   * Calculates the BM25 score for a query against all indexed documents.
   */
  public search(query: string, limit: number = 10): Array<{ doc: BM25Doc; score: number }> {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores: Map<string, number> = new Map();

    for (const term of queryTokens) {
      if (!this.docFreqs.has(term)) continue;

      const df = this.docFreqs.get(term)!;
      // Smoothed IDF
      const idf = Math.log(((this.totalDocs - df + 0.5) / (df + 0.5)) + 1);

      const docFreqMap = this.termFreqs.get(term)!;
      for (const [docId, tf] of docFreqMap.entries()) {
        const dl = this.docLengths.get(docId)!;
        
        // BM25 Score formula
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (dl / this.avgDocLength));
        
        const termScore = idf * (numerator / denominator);
        scores.set(docId, (scores.get(docId) || 0) + termScore);
      }
    }

    // Apply Phrase Boost
    const normalizedQuery = query.toLowerCase().trim();
    if (normalizedQuery.length > 5) { // Only boost longer queries
      for (const [docId, score] of scores.entries()) {
        const doc = this.docs.get(docId)!;
        if (doc.text.toLowerCase().includes(normalizedQuery)) {
          scores.set(docId, score * this.phraseBoost);
        }
      }
    }

    // Sort and return
    return Array.from(scores.entries())
      .map(([docId, score]) => ({
        doc: this.docs.get(docId)!,
        score
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Static factory for quick initialization
   */
  public static async createFromIndex(indexData: Record<string, { text: string }>, config?: BM25Config): Promise<BM25Engine> {
    const engine = new BM25Engine(config);
    const docs: BM25Doc[] = Object.entries(indexData).map(([id, val]) => ({
      id,
      text: val.text
    }));
    await engine.index(docs);
    return engine;
  }
}
