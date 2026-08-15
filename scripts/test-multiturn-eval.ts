import { retrieveContextForQuery } from '../lib/retrieval';
import { buildContextPrompt } from '../lib/prompts';
import { classifyAndRewriteQuery } from '../app/api/chat/lib/query-classifier';
import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const groqApiKey = process.env.GROQ_API_KEY;
if (!groqApiKey) {
  console.error("GROQ_API_KEY missing from environment");
  process.exit(1);
}
const groq = createGroq({ apiKey: groqApiKey });

interface ConversationTurn {
  userQuery: string;
  expectedPassage: string;
  category: string;
}

interface ConversationThread {
  threadId: string;
  title: string;
  turns: ConversationTurn[];
}

const EVAL_THREADS: ConversationThread[] = [
  {
    threadId: "prodigal-son-multiturn",
    title: "Multi-Turn: Parable of the Prodigal Son & The Older Brother",
    turns: [
      {
        userQuery: "Tell me about the Parable of the Prodigal Son.",
        expectedPassage: "LUK 15:11",
        category: "Multi-Turn Story Setup"
      },
      {
        userQuery: "What did the older brother complain about when he returned from the field?",
        expectedPassage: "LUK 15:25",
        category: "Multi-Turn Anaphora & Detail"
      },
      {
        userQuery: "What was the father's exact response to him?",
        expectedPassage: "LUK 15:31",
        category: "Multi-Turn Pronoun Resolution"
      }
    ]
  },
  {
    threadId: "elijah-carmel-multiturn",
    title: "Multi-Turn: Elijah at Mount Carmel to Mount Horeb",
    turns: [
      {
        userQuery: "What happened at Mount Carmel between Elijah and the prophets of Baal?",
        expectedPassage: "1KI 18:20",
        category: "Multi-Turn Historical Event"
      },
      {
        userQuery: "Why did he run away to the wilderness right after that victory?",
        expectedPassage: "1KI 19:1",
        category: "Multi-Turn Narrative Flow"
      }
    ]
  },
  {
    threadId: "standalone-diverse",
    title: "Diverse Single-Turn Canonical & Thematic Queries",
    turns: [
      {
        userQuery: "What did Jesus say about the temple being destroyed and rebuilt in three days?",
        expectedPassage: "JHN 2:19",
        category: "Gospel Sayings / Prophecy"
      },
      {
        userQuery: "Explain the priesthood of Melchizedek in Hebrews 7",
        expectedPassage: "HEB 7:1",
        category: "High Theology / Epistles"
      },
      {
        userQuery: "What does Psalm 23 mean by the valley of the shadow of death?",
        expectedPassage: "PSA 23:1",
        category: "Poetry & Comfort"
      },
      {
        userQuery: "Where does Paul describe the full Armor of God and what are its pieces?",
        expectedPassage: "EPH 6:10",
        category: "Christian Warfare / Pericope"
      },
      {
        userQuery: "What is the ritual for the scapegoat on the Day of Atonement in Leviticus 16?",
        expectedPassage: "LEV 16:1",
        category: "OT Law & Ritual"
      }
    ]
  }
];

const BOOK_NAME_TO_CODE: Record<string, string> = {
  GENESIS: 'GEN', GEN: 'GEN', EXODUS: 'EXO', EXO: 'EXO', LEVITICUS: 'LEV', LEV: 'LEV',
  NUMBERS: 'NUM', NUM: 'NUM', DEUTERONOMY: 'DEU', DEU: 'DEU', JOSHUA: 'JOS', JOS: 'JOS',
  JUDGES: 'JDG', JDG: 'JDG', RUTH: 'RUT', RUT: 'RUT', '1 SAMUEL': '1SA', '1SA': '1SA',
  '2 SAMUEL': '2SA', '2SA': '2SA', '1 KINGS': '1KI', '1KI': '1KI', '2 KINGS': '2KI', '2KI': '2KI',
  KINGS: '1KI', '1 CHRONICLES': '1CH', '1CH': '1CH', '2 CHRONICLES': '2CH', '2CH': '2CH',
  EZRA: 'EZR', NEHEMIAH: 'NEH', ESTHER: 'EST', JOB: 'JOB', PSALMS: 'PSA', PSALM: 'PSA', PSA: 'PSA',
  PROVERBS: 'PRO', ECCLESIASTES: 'ECC', 'SONG OF SONGS': 'SNG', ISAIAH: 'ISA', ISA: 'ISA',
  JEREMIAH: 'JER', LAMENTATIONS: 'LAM', EZEKIEL: 'EZK', DANIEL: 'DAN', HOSEA: 'HOS',
  JOEL: 'JOL', AMOS: 'AMO', OBADIAH: 'OBA', JONAH: 'JON', MICAH: 'MIC', NAHUM: 'NAM',
  HABAKKUK: 'HAB', ZEPHANIAH: 'ZEP', HAGGAI: 'HAG', ZECHARIAH: 'ZEC', MALACHI: 'MAL',
  MATTHEW: 'MAT', MAT: 'MAT', MARK: 'MRK', MRK: 'MRK', LUKE: 'LUK', LUK: 'LUK', JOHN: 'JHN', JHN: 'JHN',
  ACTS: 'ACT', ACT: 'ACT', ROMANS: 'ROM', ROM: 'ROM', '1 CORINTHIANS': '1CO', '1CO': '1CO',
  '2 CORINTHIANS': '2CO', '2CO': '2CO', GALATIANS: 'GAL', GAL: 'GAL', EPHESIANS: 'EPH', EPH: 'EPH',
  PHILIPPIANS: 'PHP', PHP: 'PHP', COLOSSIANS: 'COL', COL: 'COL', '1 THESSALONIANS': '1TH', '1TH': '1TH',
  '2 THESSALONIANS': '2TH', '2TH': '2TH', '1 TIMOTHY': '1TI', '1TI': '1TI', '2 TIMOTHY': '2TI', '2TI': '2TI',
  TITUS: 'TIT', TIT: 'TIT', PHILEMON: 'PHM', PHM: 'PHM', HEBREWS: 'HEB', HEB: 'HEB', JAMES: 'JAS', JAS: 'JAS',
  '1 PETER': '1PE', '1PE': '1PE', '2 PETER': '2PE', '2PE': '2PE', '1 JOHN': '1JN', '1JN': '1JN',
  '2 JOHN': '2JN', '2JN': '2JN', '3 JOHN': '3JN', '3JN': '3JN', JUDE: 'JUD', JUD: 'JUD', REVELATION: 'REV', REV: 'REV'
};

function normalizeRef(ref: string): { book: string; chapter: number; verse?: number } {
  const match = ref.trim().match(/^([1-3]?[A-Za-z\s]+?)\s+(\d+)(?::(\d+))?/i);
  if (!match) return { book: ref.trim().toUpperCase(), chapter: 1 };
  const rawBook = match[1].trim().toUpperCase();
  const bookCode = BOOK_NAME_TO_CODE[rawBook] || rawBook;
  return {
    book: bookCode,
    chapter: parseInt(match[2], 10),
    verse: match[3] ? parseInt(match[3], 10) : undefined
  };
}

function doesVerseMatchExpected(retrievedRef: string, expectedRef: string): boolean {
  const r = normalizeRef(retrievedRef);
  const e = normalizeRef(expectedRef);

  if (r.book !== e.book) return false;
  if (r.chapter !== e.chapter) return false;
  if (e.verse === undefined) return true;

  const rangeMatch = retrievedRef.match(/:(\d+)(?:[-–](\d+))?/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : start;
    return e.verse >= start && e.verse <= end;
  }
  return r.verse === e.verse;
}

function extractCitations(text: string): string[] {
  const regex = /\b([1-3]?[A-Z][a-z]+|[1-3]?[A-Z]{2,3})\s+(\d+:\d+(?:[-–]\d+)?)\b/g;
  const citations: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    citations.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return Array.from(new Set(citations));
}

async function runMultiTurnEval() {
  console.log("================================================================================");
  console.log("       BIBLELM MULTI-TURN CONVERSATION & DIVERSE BENCHMARK EVALUATION           ");
  console.log("================================================================================\n");

  let totalQueries = 0;
  let hitAt1Count = 0;
  let hitAt5Count = 0;
  let reciprocalRankSum = 0;
  let precisionSum = 0;
  let totalRetrievalLatency = 0;
  let totalGenerationLatency = 0;
  let totalValidCitations = 0;
  let totalGeneratedCitations = 0;

  for (const thread of EVAL_THREADS) {
    console.log(`\n################################################################################`);
    console.log(`THREAD: ${thread.title}`);
    console.log(`################################################################################`);

    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (let turnIdx = 0; turnIdx < thread.turns.length; turnIdx++) {
      const turn = thread.turns[turnIdx];
      totalQueries++;
      console.log(`\n--------------------------------------------------------------------------------`);
      console.log(`[Turn ${turnIdx + 1}/${thread.turns.length}] Category: ${turn.category}`);
      console.log(`User Question: "${turn.userQuery}"`);
      console.log(`Expected Reference: "${turn.expectedPassage}"`);
      console.log(`--------------------------------------------------------------------------------`);

      // 1. Rewrite query if multi-turn history exists
      let searchQuery = turn.userQuery;
      if (conversationHistory.length > 0) {
        const rewriteStart = Date.now();
        const classification = await classifyAndRewriteQuery(turn.userQuery, conversationHistory);
        searchQuery = classification.searchQuery;
        console.log(`• Context Rewritten Query (${Date.now() - rewriteStart}ms): "${searchQuery}"`);
      }

      // 2. Retrieval
      const retStart = Date.now();
      const verses = await retrieveContextForQuery(searchQuery, 'BSB');
      const retLatency = Date.now() - retStart;
      totalRetrievalLatency += retLatency;

      const hit1 = verses.length > 0 && doesVerseMatchExpected(verses[0].reference, turn.expectedPassage);
      let hit5 = false;
      let rank = 0;

      for (let i = 0; i < Math.min(5, verses.length); i++) {
        if (doesVerseMatchExpected(verses[i].reference, turn.expectedPassage)) {
          hit5 = true;
          rank = i + 1;
          break;
        }
      }

      if (hit1) hitAt1Count++;
      if (hit5) {
        hitAt5Count++;
        reciprocalRankSum += 1 / rank;
      }
      const top5Verses = verses.slice(0, 5);
      const matchingVersesInTop5 = top5Verses.filter((v) => doesVerseMatchExpected(v.reference, turn.expectedPassage)).length;
      const precisionAt5 = top5Verses.length > 0 ? (matchingVersesInTop5 / top5Verses.length) * 100 : 0;
      precisionSum += precisionAt5;

      console.log(`--- 1. Retrieval Metrics ---`);
      console.log(`• Latency: ${retLatency}ms`);
      console.log(`• Hit@1: ${hit1 ? 'YES' : 'NO'} (${verses[0]?.reference || 'none'})`);
      console.log(`• Hit@5: ${hit5 ? 'YES' : 'NO'} (Rank: ${rank || 'N/A'})`);
      console.log(`• Verses Retrieved (${verses.length} total):`);
      top5Verses.forEach((v, idx) => {
        console.log(`   [${idx + 1}] ${v.reference} - "${v.text.slice(0, 75)}..."`);
      });

      // 3. Prompt Construction & Generation
      const prompt = buildContextPrompt(turn.userQuery, verses, 'BSB');
      const genStart = Date.now();
      let assistantText = "";

      try {
        const result = await (generateText as any)({
          model: groq('llama-3.1-8b-instant'),
          prompt: prompt,
          temperature: 0.1,
          maxTokens: 400,
        });
        assistantText = result.text;
      } catch (err: any) {
        console.error(`LLM Generation Error:`, err.message);
        assistantText = `ERROR: ${err.message}`;
      }
      const genLatency = Date.now() - genStart;
      totalGenerationLatency += genLatency;

      console.log(`\n--- 2. Generation Output (${genLatency}ms) ---`);
      console.log(assistantText.trim());

      // 4. Citation Audit
      const citations = extractCitations(assistantText);
      const retrievedSet = new Set(verses.map(v => v.reference));
      const grounded = citations.filter(c => {
        return Array.from(retrievedSet).some(r => doesVerseMatchExpected(r, c));
      });

      totalGeneratedCitations += citations.length;
      totalValidCitations += grounded.length;
      const groundingScore = citations.length > 0 ? Math.round((grounded.length / citations.length) * 100) : 100;

      console.log(`\n--- 3. Citation Audit ---`);
      console.log(`• Citations in Text: ${citations.join(', ') || 'None'}`);
      console.log(`• Grounded Citations: ${grounded.join(', ') || 'None'}`);
      console.log(`• Grounding Score: ${groundingScore}%`);

      // Append to conversational history for subsequent turns
      conversationHistory.push({ role: 'user', content: turn.userQuery });
      conversationHistory.push({ role: 'assistant', content: assistantText });

      // Groq rate limit pause
      await new Promise(r => setTimeout(r, 2500));
    }
  }

  console.log("\n================================================================================");
  console.log("            MULTI-TURN & DIVERSE BENCHMARK AGGREGATE SUMMARY                    ");
  console.log("================================================================================");
  console.log(`Total Queries Evaluated     : ${totalQueries}`);
  console.log(`Average Retrieval Latency   : ${(totalRetrievalLatency / totalQueries).toFixed(1)} ms`);
  console.log(`Average Generation Latency  : ${(totalGenerationLatency / totalQueries).toFixed(1)} ms`);
  console.log(`Average End-to-End Latency  : ${((totalRetrievalLatency + totalGenerationLatency) / totalQueries).toFixed(1)} ms`);
  console.log(`Hit @ 1                     : ${((hitAt1Count / totalQueries) * 100).toFixed(1)}%`);
  console.log(`Hit @ 5                     : ${((hitAt5Count / totalQueries) * 100).toFixed(1)}%`);
  console.log(`Mean Reciprocal Rank (MRR)  : ${(reciprocalRankSum / totalQueries).toFixed(3)}`);
  console.log(`Precision @ 5               : ${(precisionSum / totalQueries).toFixed(1)}%`);
  const citationRate = totalGeneratedCitations > 0 ? ((totalValidCitations / totalGeneratedCitations) * 100).toFixed(1) : "100.0";
  console.log(`Citation Validity Rate      : ${citationRate}%`);
  console.log("================================================================================\n");
}

runMultiTurnEval().catch(console.error);
