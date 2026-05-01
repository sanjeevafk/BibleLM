import fs from 'fs';
import path from 'path';
import { buildDatasetMetadata } from './dataset-utils';

type TopicItem = {
  id: string;
  label: string;
  synonyms: string[];
  parentId: string | null;
};
type VerseTopicAssignment = {
  id: string;
  confidence: number;
  provenance: 'metadata_tag' | 'tsk' | 'heuristic';
};
type VerseTopicsRecord = {
  verseId: string;
  topics: VerseTopicAssignment[];
};

const ROOT = process.cwd();
const OUTPUT_TOPICS = path.join(ROOT, 'data', 'topics.json');
const OUTPUT_VERSE_TOPICS = path.join(ROOT, 'data', 'verse-topics.json');
const OUTPUT_TOPIC_VERSE_INDEX = path.join(ROOT, 'data', 'topic-verse-index.json');
const VERSE_METADATA_PATH = path.join(ROOT, 'data', 'verse-metadata.json');
const BIBLE_INDEX_PATH = path.join(ROOT, 'data', 'bible-full-index.json');
const BENCHMARK_SCENARIOS_PATH = path.join(ROOT, 'tests', 'benchmark', 'fixtures', 'scenarios.json');
const TOPIC_GUARDS_PATH = path.join(ROOT, 'lib', 'retrieval', 'topic-guards.ts');

const CANONICAL_TOPICS: Array<{ label: string; synonyms?: string[]; parentId?: string | null }> = [
  { label: 'Atonement', synonyms: ['propitiation', 'reconciliation', 'blood sacrifice'] },
  { label: 'Adoption', synonyms: ['sons of God', 'heirs', 'child of God'] },
  { label: 'Adultery', synonyms: ['unfaithfulness', 'infidelity'] },
  { label: 'Angels', synonyms: ['heavenly hosts', 'messengers'] },
  { label: 'Anointing', synonyms: ['chrism', 'consecration'] },
  { label: 'Antichrist', synonyms: ['man of lawlessness', 'beast'] },
  { label: 'Apostles', synonyms: ['disciples', 'sent ones'] },
  { label: 'Armor of God', synonyms: ['spiritual warfare', 'shield of faith'] },
  { label: 'Ascension', synonyms: ['taken up', 'exalted'] },
  { label: 'Assurance', synonyms: ['confidence', 'certainty'] },
  { label: 'Baptism', synonyms: ['immersion', 'washing'] },
  { label: 'Beatitudes', synonyms: ['blessed are', 'sermon blessings'] },
  { label: 'Blessing', synonyms: ['favor', 'prosperity'] },
  { label: 'Body of Christ', synonyms: ['church unity', 'members'] },
  { label: 'Calling', synonyms: ['vocation', 'summoned'] },
  { label: 'Canaanite Conquest', synonyms: ['herem', 'devoted to destruction'] },
  { label: 'Charity', synonyms: ['almsgiving', 'generosity'] },
  { label: 'Children', synonyms: ['little ones', 'offspring'] },
  { label: 'Church', synonyms: ['assembly', 'ekklesia'] },
  { label: 'Comfort', synonyms: ['consolation', 'encouragement'] },
  { label: 'Communion', synonyms: ['lord\'s supper', 'breaking bread'] },
  { label: 'Compassion', synonyms: ['mercy', 'pity'] },
  { label: 'Confession', synonyms: ['repentant speech', 'acknowledgement'] },
  { label: 'Contentment', synonyms: ['sufficiency', 'satisfaction'] },
  { label: 'Covenant', synonyms: ['testament', 'promise'] },
  { label: 'Creation', synonyms: ['genesis', 'maker'] },
  { label: 'Cross', synonyms: ['crucifixion', 'calvary'] },
  { label: 'Death', synonyms: ['grave', 'sheol'] },
  { label: 'Demons', synonyms: ['unclean spirits', 'evil spirits'] },
  { label: 'Depression', synonyms: ['downcast', 'discouragement'] },
  { label: 'Devotion', synonyms: ['piety', 'dedication'] },
  { label: 'Discipleship', synonyms: ['follow me', 'learn from Christ'] },
  { label: 'Discernment', synonyms: ['wisdom judgment', 'spiritual insight'] },
  { label: 'Divorce', synonyms: ['remarriage', 'separation'] },
  { label: 'Election', synonyms: ['chosen', 'foreknown'] },
  { label: 'Encouragement', synonyms: ['edification', 'strengthening'] },
  { label: 'End Times', synonyms: ['eschatology', 'last days'] },
  { label: 'Eternal Life', synonyms: ['everlasting life', 'life forever'] },
  { label: 'Evangelism', synonyms: ['gospel witness', 'great commission'] },
  { label: 'Faith', synonyms: ['belief', 'trust'] },
  { label: 'Family', synonyms: ['household', 'kinship'] },
  { label: 'Fasting', synonyms: ['abstinence', 'humbling oneself'] },
  { label: 'Fear', synonyms: ['anxiety', 'dread'] },
  { label: 'Fellowship', synonyms: ['koinonia', 'communion'] },
  { label: 'Forgiveness', synonyms: ['pardon', 'mercy', 'remission'] },
  { label: 'Freedom', synonyms: ['liberty', 'release'] },
  { label: 'Friendship', synonyms: ['companionship', 'brotherhood'] },
  { label: 'Fruit of the Spirit', synonyms: ['love joy peace', 'spiritual fruit'] },
  { label: 'Generosity', synonyms: ['giving', 'charity'] },
  { label: 'Gentleness', synonyms: ['meekness', 'soft answer'] },
  { label: 'Glory', synonyms: ['majesty', 'radiance'] },
  { label: 'God the Father', synonyms: ['heavenly father', 'abba'] },
  { label: 'Gospel', synonyms: ['good news', 'euangelion'] },
  { label: 'Grace', synonyms: ['unmerited favor', 'kindness'] },
  { label: 'Gratitude', synonyms: ['thanksgiving', 'thankfulness'] },
  { label: 'Greed', synonyms: ['covetousness', 'avarice'] },
  { label: 'Guidance', synonyms: ['direction', 'led by God'] },
  { label: 'Healing', synonyms: ['restoration', 'wholeness'] },
  { label: 'Heaven', synonyms: ['paradise', 'kingdom above'] },
  { label: 'Hell', synonyms: ['gehenna', 'lake of fire'] },
  { label: 'Holiness', synonyms: ['sanctity', 'set apart'] },
  { label: 'Homosexuality', synonyms: ['same sex', 'men with men'] },
  { label: 'Hope', synonyms: ['expectation', 'confident waiting'] },
  { label: 'Hospitality', synonyms: ['welcome strangers', 'table fellowship'] },
  { label: 'Humility', synonyms: ['lowliness', 'meekness'] },
  { label: 'Idolatry', synonyms: ['idols', 'false worship'] },
  { label: 'Imago Dei', synonyms: ['image of God', 'human dignity'] },
  { label: 'Incarnation', synonyms: ['word made flesh', 'God with us'] },
  { label: 'Inheritance', synonyms: ['heir', 'portion'] },
  { label: 'Intercession', synonyms: ['prayer for others', 'mediating prayer'] },
  { label: 'Israel', synonyms: ['chosen nation', 'jacob'] },
  { label: 'Jealousy', synonyms: ['envy', 'coveting others'] },
  { label: 'Jesus Christ', synonyms: ['messiah', 'son of God'] },
  { label: 'Joy', synonyms: ['rejoicing', 'gladness'] },
  { label: 'Judgment', synonyms: ['justice day', 'accountability'] },
  { label: 'Justice', synonyms: ['righteous judgment', 'equity'] },
  { label: 'Kingdom of God', synonyms: ['kingdom of heaven', 'reign of God'] },
  { label: 'Law', synonyms: ['torah', 'commandments'] },
  { label: 'Leadership', synonyms: ['elders', 'shepherding'] },
  { label: 'Lent', synonyms: ['fasting season', 'penitence'] },
  { label: 'Life', synonyms: ['abundant life', 'living water'] },
  { label: 'Light', synonyms: ['illumination', 'lamp'] },
  { label: 'Love', synonyms: ['agape', 'charity'] },
  { label: 'Lust', synonyms: ['desire', 'sexual craving'] },
  { label: 'Marriage', synonyms: ['husband and wife', 'one flesh'] },
  { label: 'Mercy', synonyms: ['compassion', 'clemency'] },
  { label: 'Messiah', synonyms: ['christ', 'anointed one'] },
  { label: 'Missions', synonyms: ['sent out', 'nations'] },
  { label: 'Murder', synonyms: ['kill', 'shed blood'] },
  { label: 'New Birth', synonyms: ['born again', 'regeneration'] },
  { label: 'Obedience', synonyms: ['keep commandments', 'submission'] },
  { label: 'Parables', synonyms: ['kingdom stories', 'earthly stories'] },
  { label: 'Patience', synonyms: ['longsuffering', 'endurance'] },
  { label: 'Peace', synonyms: ['shalom', 'reconciliation'] },
  { label: 'Persecution', synonyms: ['suffering for Christ', 'opposition'] },
  { label: 'Perseverance', synonyms: ['steadfastness', 'endurance'] },
  { label: 'Power', synonyms: ['might', 'strength'] },
  { label: 'Praise', synonyms: ['worship song', 'blessing God'] },
  { label: 'Predestination', synonyms: ['foreordained', 'elect purpose'] },
  { label: 'Prayer', synonyms: ['supplication', 'intercession'] },
  { label: 'Priesthood', synonyms: ['high priest', 'levitical'] },
  { label: 'Prophecy', synonyms: ['oracle', 'foretelling'] },
  { label: 'Purity', synonyms: ['clean heart', 'undefiled'] },
  { label: 'Redemption', synonyms: ['ransom', 'bought back'] },
  { label: 'Regeneration', synonyms: ['new creation', 'new heart'] },
  { label: 'Repentance', synonyms: ['turn back', 'metanoia'] },
  { label: 'Resurrection', synonyms: ['raised from the dead', 'new body'] },
  { label: 'Rest', synonyms: ['sabbath rest', 'peaceful trust'] },
  { label: 'Righteousness', synonyms: ['uprightness', 'just standing'] },
  { label: 'Sacrifice', synonyms: ['offering', 'altar'] },
  { label: 'Salvation', synonyms: ['deliverance', 'saved'] },
  { label: 'Sanctification', synonyms: ['made holy', 'holy living'] },
  { label: 'Satan', synonyms: ['devil', 'adversary'] },
  { label: 'Scripture', synonyms: ['word of God', 'written word'] },
  { label: 'Second Coming', synonyms: ['return of Christ', 'parousia'] },
  { label: 'Servanthood', synonyms: ['humble service', 'washing feet'] },
  { label: 'Sexual Immorality', synonyms: ['fornication', 'porneia'] },
  { label: 'Shepherd', synonyms: ['pastor', 'flock'] },
  { label: 'Sin', synonyms: ['transgression', 'iniquity'] },
  { label: 'Sovereignty', synonyms: ['God reigns', 'divine rule'] },
  { label: 'Spiritual Gifts', synonyms: ['charismata', 'gifted service'] },
  { label: 'Stewardship', synonyms: ['management', 'faithful trustee'] },
  { label: 'Suffering', synonyms: ['tribulation', 'affliction'] },
  { label: 'Temptation', synonyms: ['testing', 'enticement'] },
  { label: 'Thanksgiving', synonyms: ['gratitude', 'thankfulness'] },
  { label: 'Theft', synonyms: ['stealing', 'robbery'] },
  { label: 'Tongue', synonyms: ['speech', 'words'] },
  { label: 'Transformation', synonyms: ['renewed mind', 'changed life'] },
  { label: 'Trinity', synonyms: ['godhead', 'father son spirit'] },
  { label: 'Truth', synonyms: ['veracity', 'faithfulness'] },
  { label: 'Unity', synonyms: ['one body', 'harmony'] },
  { label: 'Virgin Birth', synonyms: ['born of a virgin', 'incarnate birth'] },
  { label: 'Watchfulness', synonyms: ['be alert', 'stay awake'] },
  { label: 'Wisdom', synonyms: ['understanding', 'discernment'] },
  { label: 'Women', synonyms: ['biblical women', 'women in ministry'] },
  { label: 'Worship', synonyms: ['adoration', 'praise'] },
  { label: 'Worldliness', synonyms: ['fleshly desires', 'conformity to world'] },
  { label: 'Wrath', synonyms: ['anger of God', 'judgment fire'] },
];

function toKebab(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function toTitle(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function extractScenarioTopics(): string[] {
  const scenarios = JSON.parse(fs.readFileSync(BENCHMARK_SCENARIOS_PATH, 'utf8')) as Array<{ query: string }>;
  return scenarios
    .map((s) => (s.query.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(-2).join(' '))
    .map((t) => t.trim())
    .filter(Boolean);
}

function extractMetadataTopics(): string[] {
  const rows = JSON.parse(fs.readFileSync(VERSE_METADATA_PATH, 'utf8')) as Array<{ themeTags?: string[] }>;
  const tags = new Set<string>();
  for (const row of rows) {
    for (const tag of row.themeTags ?? []) tags.add(String(tag).toLowerCase());
  }
  return Array.from(tags);
}

function extractTopicGuardKeywords(): string[] {
  const source = fs.readFileSync(TOPIC_GUARDS_PATH, 'utf8');
  const matches = source.match(/keywords:\s*\[([^\]]+)\]/g) ?? [];
  const output: string[] = [];
  for (const block of matches) {
    const literals = block.match(/'([^']+)'/g) ?? [];
    for (const literal of literals) {
      const value = literal.slice(1, -1).trim().toLowerCase();
      if (value.split(/\s+/).length <= 3) output.push(value);
    }
  }
  return output;
}

function buildTopics(): TopicItem[] {
  const fromMetadata = extractMetadataTopics();
  const fromGuards = extractTopicGuardKeywords();
  const fromScenarios = extractScenarioTopics();
  const combinedLabels = uniqueSorted([
    ...CANONICAL_TOPICS.map((t) => t.label),
    ...fromMetadata,
    ...fromGuards,
    ...fromScenarios,
  ]).slice(0, 150);

  const canonicalById = new Map(CANONICAL_TOPICS.map((topic) => [toKebab(topic.label), topic]));

  const topics = combinedLabels
    .map((rawLabel) => {
      const id = toKebab(rawLabel);
      const canonical = canonicalById.get(id);
      const label = canonical?.label ?? toTitle(rawLabel.replace(/[-_]/g, ' '));
      const synonyms = uniqueSorted([
        ...(canonical?.synonyms ?? []),
        ...rawLabel.split(/\s+/).filter((t) => t.length > 4),
      ]).slice(0, 8);
      return {
        id,
        label,
        synonyms,
        parentId: canonical?.parentId ?? null,
      } as TopicItem;
    })
    .filter((item) => item.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const deduped = new Map<string, TopicItem>();
  for (const topic of topics) {
    if (!deduped.has(topic.id)) {
      deduped.set(topic.id, topic);
      continue;
    }
    const existing = deduped.get(topic.id)!;
    if ((topic.synonyms?.length ?? 0) > (existing.synonyms?.length ?? 0)) {
      deduped.set(topic.id, topic);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function main(): void {
  const items = buildTopics();
  if (items.length < 100 || items.length > 150) {
    throw new Error(`Topic count must be between 100 and 150; got ${items.length}.`);
  }

  const idSet = new Set(items.map((item) => item.id));
  if (idSet.size !== items.length) {
    throw new Error('Topic IDs must be unique.');
  }

  const payload = {
    ...buildDatasetMetadata('scripts/build-topic-datasets.ts'),
    items,
  };

  fs.writeFileSync(OUTPUT_TOPICS, JSON.stringify(payload, null, 2));
  const { verseTopics, topicVerseIndex } = buildVerseTopicIndexes(items);
  fs.writeFileSync(
    OUTPUT_VERSE_TOPICS,
    JSON.stringify({ ...buildDatasetMetadata('scripts/build-topic-datasets.ts'), items: verseTopics }, null, 2)
  );
  fs.writeFileSync(
    OUTPUT_TOPIC_VERSE_INDEX,
    JSON.stringify({ ...buildDatasetMetadata('scripts/build-topic-datasets.ts'), items: topicVerseIndex }, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        output_topics: OUTPUT_TOPICS,
        output_verse_topics: OUTPUT_VERSE_TOPICS,
        output_topic_verse_index: OUTPUT_TOPIC_VERSE_INDEX,
        topic_count: items.length,
        verse_topic_count: verseTopics.length,
        topic_index_count: Object.keys(topicVerseIndex).length,
      },
      null,
      2
    )
  );
}

main();

function normalizeVerseId(verseId: string): string {
  return verseId.trim().toUpperCase();
}

function includesToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function buildVerseTopicIndexes(topics: TopicItem[]): {
  verseTopics: VerseTopicsRecord[];
  topicVerseIndex: Record<string, string[]>;
} {
  const metadataRows = JSON.parse(fs.readFileSync(VERSE_METADATA_PATH, 'utf8')) as Array<{
    verseId?: string;
    themeTags?: string[];
  }>;
  const bibleIndex = JSON.parse(fs.readFileSync(BIBLE_INDEX_PATH, 'utf8')) as Record<string, { text?: string }>;
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const topicVerseIndex = new Map<string, Set<string>>();
  const verseTopics: VerseTopicsRecord[] = [];

  const byVerseMetadata = new Map<string, string[]>();
  for (const row of metadataRows) {
    const verseId = row.verseId ? normalizeVerseId(row.verseId) : '';
    if (!verseId) continue;
    const tags = (row.themeTags ?? []).map((tag) => toKebab(String(tag)));
    if (tags.length === 0) continue;
    byVerseMetadata.set(verseId, tags);
  }

  const forgivenessTskAnchors = new Set(['MAT 6:14', 'COL 3:13', 'EPH 4:32']);

  const verseIds = Object.keys(bibleIndex).sort((a, b) => a.localeCompare(b));
  for (const rawVerseId of verseIds) {
    const verseId = normalizeVerseId(rawVerseId);
    const text = String(bibleIndex[rawVerseId]?.text || '').toLowerCase();
    const assignments: VerseTopicAssignment[] = [];

    for (const tag of byVerseMetadata.get(verseId) ?? []) {
      if (!topicById.has(tag)) continue;
      assignments.push({ id: tag, confidence: 0.9, provenance: 'metadata_tag' });
    }

    if (forgivenessTskAnchors.has(verseId)) {
      assignments.push({ id: 'forgiveness', confidence: 0.85, provenance: 'tsk' });
    }

    const heuristicCandidates: Array<{ id: string; confidence: number }> = [];
    for (const topic of topics) {
      if (topic.id === 'forgiveness' && /forgiv|pardon|mercy/.test(text)) {
        heuristicCandidates.push({ id: topic.id, confidence: 0.75 });
        continue;
      }
      if (topic.id === 'prayer' && /pray|prayer|supplication/.test(text)) {
        heuristicCandidates.push({ id: topic.id, confidence: 0.72 });
        continue;
      }
      if (topic.id === 'love' && /love|charity|beloved/.test(text)) {
        heuristicCandidates.push({ id: topic.id, confidence: 0.7 });
        continue;
      }
      if (topic.id === 'faith' && /faith|believe|trust/.test(text)) {
        heuristicCandidates.push({ id: topic.id, confidence: 0.68 });
        continue;
      }

      for (const synonym of topic.synonyms.slice(0, 4)) {
        const token = synonym.toLowerCase();
        if (token.length < 4) continue;
        if (includesToken(text, token)) {
          heuristicCandidates.push({ id: topic.id, confidence: 0.5 });
          break;
        }
      }
    }

    for (const candidate of heuristicCandidates) {
      assignments.push({ id: candidate.id, confidence: candidate.confidence, provenance: 'heuristic' });
    }

    const merged = new Map<string, VerseTopicAssignment>();
    for (const assignment of assignments) {
      if (assignment.confidence < 0.4) continue;
      const existing = merged.get(assignment.id);
      if (!existing || assignment.confidence > existing.confidence) {
        merged.set(assignment.id, assignment);
      }
    }

    const limited = Array.from(merged.values())
      .sort((a, b) => (b.confidence - a.confidence) || a.id.localeCompare(b.id))
      .slice(0, 3);

    if (limited.length === 0) continue;

    verseTopics.push({ verseId, topics: limited });
    for (const assignment of limited) {
      if (!topicVerseIndex.has(assignment.id)) topicVerseIndex.set(assignment.id, new Set());
      topicVerseIndex.get(assignment.id)!.add(verseId);
    }
  }

  const topicIndexObject: Record<string, string[]> = {};
  for (const [topicId, refs] of Array.from(topicVerseIndex.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    topicIndexObject[topicId] = Array.from(refs).sort((a, b) => a.localeCompare(b));
  }

  return {
    verseTopics: verseTopics.sort((a, b) => a.verseId.localeCompare(b.verseId)),
    topicVerseIndex: topicIndexObject,
  };
}
