/**
 * Topic guards and curated topical lists.
 *
 * Topic Guards: Ensure core commandment/passage verses are always prioritized
 * and noise verses are filtered for sensitive biblical topics.
 *
 * Curated Topical Lists: Provide a hand-curated ordered set of verses for
 * broad thematic queries (e.g. "women in the bible").
 *
 * Both are pure functions — no I/O, no external calls.
 */

import type { VerseContext } from '../bible-fetch';
import { cloneVerses } from './verse-utils';
import type { RetrievalDebugState } from './types';

// ---------------------------------------------------------------------------
// Internal helpers (imported by pipeline, not exported to callers)
// ---------------------------------------------------------------------------

function addDecisionTrace(
  debugState: RetrievalDebugState | undefined,
  reference: string,
  trace: string
): void {
  if (!debugState) return;
  const traces = debugState.decisionTraceByReference.get(reference) || [];
  traces.push(trace);
  debugState.decisionTraceByReference.set(reference, traces);
}

function addRetrievalStageTrace(
  debugState: RetrievalDebugState | undefined,
  trace: Record<string, unknown>
): void {
  if (!debugState) return;
  debugState.stageTraces.push(trace);
}

// ---------------------------------------------------------------------------
// Topic Guard interface
// ---------------------------------------------------------------------------

interface TopicGuard {
  keywords: string[];
  priority: VerseContext[];
  excludePatterns: string[];
  conditionalPriority?: (query: string) => VerseContext[];
}

// ---------------------------------------------------------------------------
// Topic Guard definitions
// ---------------------------------------------------------------------------

const TOPIC_GUARDS: Record<string, TopicGuard> = {
  murder: {
    keywords: ['murder', 'kill', 'slay', 'take life', 'shed blood', 'homicide', 'killing'],
    priority: [
      { reference: 'EXO 20:13', text: 'You shall not murder.', translation: 'BSB', original: [] },
      { reference: 'GEN 9:6', text: 'Whoever sheds the blood of man, by man shall his blood be shed; for in the image of God has He made man.', translation: 'BSB', original: [] },
      { reference: 'NUM 35:16', text: 'But if anyone strikes another with an iron object so that death results, he is a murderer; the murderer must be put to death.', translation: 'BSB', original: [] },
      { reference: 'NUM 35:17', text: 'Or if anyone strikes another with a stone in his hand that could cause death, and death results, he is a murderer; the murderer must be put to death.', translation: 'BSB', original: [] },
      { reference: 'NUM 35:30', text: 'If anyone kills a person, the murderer must be put to death on the evidence of witnesses; but no one shall be put to death on the testimony of only one witness.', translation: 'BSB', original: [] },
    ],
    excludePatterns: ['refuge', 'cities of refuge', 'unintentional', 'accidentally', 'without premeditation', 'manslaughter', 'avenger of blood', 'flees'],
  },
  lying: {
    keywords: ['lying', 'false witness', 'lie', 'deceive', 'deception', 'deceit', 'liar', 'falsehood', 'perjury'],
    priority: [
      { reference: 'EXO 20:16', text: 'You shall not bear false witness against your neighbor.', translation: 'BSB', original: [] },
      { reference: 'PRO 6:16-19', text: 'There are six things that the LORD hates, seven that are detestable to Him: haughty eyes, a lying tongue, hands that shed innocent blood, a heart that devises wicked schemes, feet that run swiftly to evil, a false witness who gives false testimony, and one who stirs up discord among brothers.', translation: 'BSB', original: [] },
      { reference: 'EPH 4:25', text: 'Therefore each of you must put off falsehood and speak truthfully to his neighbor, for we are all members of one another.', translation: 'BSB', original: [] },
      { reference: 'PRO 12:22', text: 'Lying lips are detestable to the LORD, but those who deal faithfully are His delight.', translation: 'BSB', original: [] },
    ],
    excludePatterns: ['rahab', 'midwives', 'shipphrah', 'puah', 'lying in wait'],
  },
  theft: {
    keywords: ['theft', 'steal', 'stealing', 'rob', 'robbery', 'thief', 'restitution'],
    priority: [
      { reference: 'EXO 20:15', text: 'You shall not steal.', translation: 'BSB', original: [] },
      { reference: 'LEV 19:11', text: 'You must not steal. You must not lie or deceive one another.', translation: 'BSB', original: [] },
      { reference: 'EXO 22:1', text: 'If a man steals an ox or a sheep and slaughters or sells it, he must repay five oxen for an ox and four sheep for a sheep.', translation: 'BSB', original: [] },
      { reference: 'EXO 22:4', text: 'If what was stolen is actually found alive in his possession—whether ox or donkey or sheep—he must pay back double.', translation: 'BSB', original: [] },
    ],
    excludePatterns: ['property laws', 'boundary marker', 'restoring'],
  },
  adultery: {
    keywords: ['adultery', 'adulterous', 'adulterer', 'cheating', 'infidelity', 'lustful', 'unfaithful'],
    priority: [
      { reference: 'EXO 20:14', text: 'You shall not commit adultery.', translation: 'BSB', original: [] },
      { reference: 'LEV 20:10', text: 'If a man commits adultery with another man\u2019s wife\u2014with the wife of his neighbor\u2014both the adulterer and the adulteress must surely be put to death.', translation: 'BSB', original: [] },
      { reference: 'MAT 5:27-28', text: 'You have heard that it was said, \u2018Do not commit adultery.\u2019 But I tell you that anyone who looks at a woman to lust after her has already committed adultery with her in his heart.', translation: 'BSB', original: [] },
      { reference: 'HEB 13:4', text: 'Marriage should be honored by all and the marriage bed kept undefiled, for God will judge the sexually immoral and adulterers.', translation: 'BSB', original: [] },
      { reference: 'PRO 6:32-33', text: 'He who commits adultery lacks judgment; whoever does so destroys himself. Wounds and dishonor will befall him, and his reproach will never be wiped away.', translation: 'BSB', original: [] },
    ],
    excludePatterns: ['except for sexual immorality', 'forgiven', 'restored', 'woman caught in adultery'],
  },
  idolatry: {
    keywords: ['idolatry', 'idols', 'idolater', 'graven image', 'false gods', 'worshiping gods', 'pagan worship'],
    priority: [
      { reference: 'EXO 20:3-5', text: 'You shall have no other gods before Me. You shall not make for yourself an idol in the form of anything in the heavens above, on the earth below, or in the waters beneath. You shall not bow down to them or worship them; for I, the LORD your God, am a jealous God, visiting the iniquity of the fathers on their children to the third and fourth generations of those who hate Me,', translation: 'BSB', original: [] },
      { reference: 'DEU 5:7-9', text: 'You shall have no other gods before Me. You shall not make for yourself an idol in the form of anything in the heavens above, or on the earth beneath, or in the water under the earth. You shall not bow down to them or worship them; for I, the LORD your God, am a jealous God, visiting the iniquity of the fathers on their children to the third and fourth generations of those who hate Me,', translation: 'BSB', original: [] },
      { reference: '1CO 10:14', text: 'Therefore, my beloved, flee from idolatry.', translation: 'BSB', original: [] },
      { reference: 'EPH 5:5', text: 'For of this you can be sure: No immoral, impure, or greedy person (that is, an idolater), has any inheritance in the kingdom of Christ and of God.', translation: 'BSB', original: [] },
      { reference: 'COL 3:5', text: 'Put to death, therefore, the components of your earthly nature: sexual immorality, impurity, lust, evil desires, and greed, which is idolatry.', translation: 'BSB', original: [] },
      { reference: 'REV 21:8', text: 'But to the cowardly and unbelieving and abominable and murderers and sexually immoral and sorcerers and idolaters and all liars, their place will be in the lake that burns with fire and sulfur. This is the second death.', translation: 'BSB', original: [] },
    ],
    excludePatterns: ['metaphorical', 'judgment tool', 'using nations'],
  },
  divorce: {
    keywords: ['divorce', 'remarriage', 'separate', 'marital faithfulness', 'adultery'],
    priority: [
      { reference: 'MAL 2:16', text: '\u201cFor I hate divorce,\u201d says the LORD, the God of Israel. \u201cHe who divorces his wife covers his garment with violence,\u201d says the LORD of Hosts.', translation: 'BSB', original: [] },
      { reference: 'MAT 19:6', text: 'So they are no longer two, but one flesh. Therefore what God has joined together, let man not separate.', translation: 'BSB', original: [] },
      { reference: 'GEN 2:24', text: 'For this reason a man will leave his father and mother and be united to his wife, and they will become one flesh.', translation: 'BSB', original: [] },
    ],
    excludePatterns: ['hardness of heart'],
    conditionalPriority: (query: string) => {
      const q = query.toLowerCase();
      if (q.includes('except for immorality') || q.includes('except for sexual immorality')) {
        return [{ reference: 'MAT 19:9', text: 'And I say to you, whoever divorces his wife, except for sexual immorality, and marries another woman commits adultery.', translation: 'BSB', original: [] }];
      }
      return [];
    },
  },
  feminism: {
    keywords: ['feminism', 'gender roles', 'women in ministry', 'women in bible', 'strong women', 'submission', 'headship', 'equality', 'female', 'wife', 'husbands', 'wives'],
    priority: [
      { reference: 'GAL 3:28', text: 'There is neither Jew nor Greek, slave nor free, male nor female, for you are all one in Christ Jesus.', translation: 'BSB', original: [] },
      { reference: 'EPH 5:22', text: 'Wives, submit to your husbands as to the Lord.', translation: 'BSB', original: [] },
      { reference: 'EPH 5:25', text: 'Husbands, love your wives, just as Christ loved the church and gave Himself up for her.', translation: 'BSB', original: [] },
      { reference: 'COL 3:18', text: 'Wives, submit to your husbands, as is fitting in the Lord.', translation: 'BSB', original: [] },
      { reference: 'COL 3:19', text: 'Husbands, love your wives and do not be harsh with them.', translation: 'BSB', original: [] },
      { reference: 'GEN 2:24', text: 'For this reason a man will leave his father and mother and be united to his wife, and they will become one flesh.', translation: 'BSB', original: [] },
      { reference: 'JDG 4:4', text: 'Now Deborah, a prophetess, the wife of Lappidoth, was judging Israel at that time.', translation: 'BSB', original: [] },
      { reference: 'JDG 4:21', text: 'But as he lay sleeping from exhaustion, Heber\'s wife Jael took a tent peg, grabbed a hammer, and went silently to Sisera. She drove the peg through his temple and into the ground, and he died.', translation: 'BSB', original: [] },
      { reference: 'RUT 3:11', text: 'And now do not be afraid, my daughter. I will do for you whatever you request, since all my fellow townspeople know that you are a woman of noble character.', translation: 'BSB', original: [] },
      { reference: 'PRO 31:10', text: 'A wife of noble character, who can find? She is far more precious than rubies.', translation: 'BSB', original: [] },
    ],
    excludePatterns: [],
  },
  homosexuality: {
    keywords: ['homosexual', 'homosexuality', 'same sex', 'same-sex', 'gay', 'lesbian', 'men who have sex with men', 'arsenokoit', 'malakoi', 'lie with a man'],
    priority: [
      { reference: 'LEV 18:22', text: 'You must not lie with a man as with a woman; that is an abomination.', translation: 'BSB', original: [] },
      { reference: 'LEV 20:13', text: 'If a man lies with a man as with a woman, they have both committed an abomination. They must surely be put to death; their blood is upon them.', translation: 'BSB', original: [] },
      { reference: 'ROM 1:26-27', text: 'For this reason God gave them over to dishonorable passions. Even their women exchanged natural relations for unnatural ones. In the same way the men also abandoned natural relations with women and were inflamed with lust for one another. Men committed shameful acts with other men, and received in themselves the due penalty for their error.', translation: 'BSB', original: [] },
      { reference: '1CO 6:9-11', text: 'Do you not know that the wicked will not inherit the kingdom of God? Do not be deceived: Neither the sexually immoral, nor idolaters, nor adulterers, nor men who have sex with men, nor thieves, nor the greedy, nor drunkards, nor slanderers, nor swindlers will inherit the kingdom of God. And that is what some of you were. But you were washed, you were sanctified, you were justified in the name of the Lord Jesus Christ and by the Spirit of our God.', translation: 'BSB', original: [] },
      { reference: '1TI 1:9-10', text: 'We also know that the law is made not for the righteous but for lawbreakers and rebels, the ungodly and sinful, the unholy and irreligious, for those who kill their fathers or mothers, for murderers, for the sexually immoral, for those practicing homosexuality, for slave traders and liars and perjurers\u2014and for whatever else is contrary to the sound doctrine.', translation: 'BSB', original: [] },
    ],
    excludePatterns: [
      'pharisee', 'hypocrit', 'woe to you',
      'eunuch', 'genealogy', '1ch 6', 'scribe',
      'daughter of zion', 'babylon', 'jer 50', 'mic 4',
    ],
  },
  blasphemy: {
    keywords: ['blasphemy', 'blaspheme', 'take lords name in vain', 'curse god', 'speak against holy spirit', 'unforgivable sin'],
    priority: [
      { reference: 'EXO 20:7', text: 'You shall not take the name of the LORD your God in vain, for the LORD will not hold anyone guiltless who misuses his name.', translation: 'BSB', original: [] },
      { reference: 'LEV 24:16', text: 'Anyone who blasphemes the name of the LORD is to be put to death. The entire assembly must stone them. Whether foreigner or native-born, when they blaspheme the Name they are to be put to death.', translation: 'BSB', original: [] },
      { reference: 'MAT 12:31-32', text: 'And so I tell you, every kind of sin and slander can be forgiven, but blasphemy against the Spirit will not be forgiven. Anyone who speaks a word against the Son of Man will be forgiven, but anyone who speaks against the Holy Spirit will not be forgiven, either in this age or in the age to come.', translation: 'BSB', original: [] },
      { reference: 'MAR 3:28-29', text: 'Truly I tell you, people can be forgiven all their sins and every slander they utter, but whoever blasphemes against the Holy Spirit will never be forgiven; they are guilty of an eternal sin.', translation: 'BSB', original: [] },
    ],
    excludePatterns: ['praise', 'worship', 'glorify'],
  },
  sexual_immorality: {
    keywords: ['porn', 'pornography', 'lust', 'fornication', 'sexual immorality', 'sexually immoral', 'porneia', 'masturbation', 'adultery in heart'],
    priority: [
      { reference: 'MAT 5:27-28', text: 'You have heard that it was said, \u2018You shall not commit adultery.\u2019 But I tell you that anyone who looks at a woman lustfully has already committed adultery with her in his heart.', translation: 'BSB', original: [] },
      { reference: '1CO 6:18', text: 'Flee from sexual immorality. All other sins a person commits are outside the body, but whoever sins sexually, sins against their own body.', translation: 'BSB', original: [] },
      { reference: 'EPH 5:3', text: 'But among you there must not be even a hint of sexual immorality, or of any kind of impurity, or of greed, because these are improper for God\u2019s holy people.', translation: 'BSB', original: [] },
      { reference: 'GAL 5:19', text: 'The acts of the flesh are obvious: sexual immorality, impurity and debauchery;', translation: 'BSB', original: [] },
      { reference: 'COL 3:5', text: 'Put to death, therefore, whatever belongs to your earthly nature: sexual immorality, impurity, lust, evil desires and greed, which is idolatry.', translation: 'BSB', original: [] },
      { reference: '1TH 4:3', text: 'It is God\u2019s will that you should be sanctified: that you should avoid sexual immorality;', translation: 'BSB', original: [] },
      { reference: 'HEB 13:4', text: 'Marriage should be honored by all, and the marriage bed kept pure, for God will judge the adulterer and all the sexually immoral.', translation: 'BSB', original: [] },
    ],
    excludePatterns: ['song of solomon', 'song of songs', 'romantic', 'marriage bed'],
  },
};

// ---------------------------------------------------------------------------
// Curated topical list definitions
// ---------------------------------------------------------------------------

interface CuratedTopicalList {
  keywords: string[];
  verses: VerseContext[];
}

const CURATED_TOPICAL_LISTS: Record<string, CuratedTopicalList> = {
  women: {
    keywords: ['women in bible', 'women in the bible', 'biblical women', 'heroic women', 'women of the bible', 'strong women bible'],
    verses: [
      { reference: 'LUK 1:26-28', text: 'In the sixth month, God sent the angel Gabriel to a town in Galilee called Nazareth, to a virgin pledged in marriage to a man named Joseph, of the house of David. The virgin\u2019s name was Mary. The angel went to her and said, \u201cGreetings, you who are highly favored! The Lord is with you.\u201d', translation: 'BSB', original: [] },
      { reference: 'LUK 1:46-49', text: 'Then Mary said: \u201cMy soul magnifies the Lord, and my spirit rejoices in God my Savior! For He has looked with favor on the humble state of His servant. From now on all generations will call me blessed. For the Mighty One has done great things for me. Holy is His name.\u201d', translation: 'BSB', original: [] },
      { reference: 'JDG 4:4', text: 'Now Deborah, a prophetess, the wife of Lappidoth, was judging Israel at that time.', translation: 'BSB', original: [] },
      { reference: 'JDG 5:7', text: 'Life in the villages ceased; it ended in Israel, until I, Deborah, arose, a mother in Israel.', translation: 'BSB', original: [] },
      { reference: 'JDG 4:21', text: 'But as he lay sleeping from exhaustion, Heber\u2019s wife Jael took a tent peg, grabbed a hammer, and went silently to Sisera. She drove the peg through his temple and into the ground, and he died.', translation: 'BSB', original: [] },
      { reference: 'RUT 1:16-17', text: 'But Ruth replied: \u201cDo not urge me to leave you or to turn from following you. For wherever you go, I will go, and wherever you live, I will live; your people will be my people, and your God will be my God. Where you die, I will die, and there I will be buried. May the LORD punish me, and ever so severely, if anything but death separates you and me.\u201d', translation: 'BSB', original: [] },
      { reference: 'EST 4:14', text: 'For if you remain silent at this time, relief and deliverance for the Jews will arise from another place, but you and your father\u2019s house will perish. And who knows if perhaps you have come to the kingdom for such a time as this?\u201d', translation: 'BSB', original: [] },
      { reference: 'EST 4:16', text: '\u201cGo and assemble all the Jews who can be found in Susa, and fast for me. Do not eat or drink for three days, night or day, and I and my maidens will fast as you do. After that, I will go to the king, even though it is against the law. And if I perish, I perish!\u201d', translation: 'BSB', original: [] },
      { reference: 'PRO 31:10', text: 'A wife of noble character, who can find? She is far more precious than rubies.', translation: 'BSB', original: [] },
      { reference: 'PRO 31:25-26', text: 'Strength and honor are her clothing, and she can laugh at the days to come. She opens her mouth with wisdom, and faithful instruction is on her tongue.', translation: 'BSB', original: [] },
      { reference: 'PRO 31:30', text: 'Charm is deceptive and beauty is fleeting, but a woman who fears the LORD is to be praised.', translation: 'BSB', original: [] },
      { reference: 'HEB 11:11', text: 'By faith even Sarah herself received ability to conceive, even beyond the proper time of life, since she regarded Him faithful who had promised.', translation: 'BSB', original: [] },
      { reference: '1SA 1:27-28', text: 'I prayed for this boy, and since the LORD has granted me what I asked of Him, I now dedicate the boy to the LORD. For as long as he lives, he is dedicated to the LORD.\u201d', translation: 'BSB', original: [] },
      { reference: '1SA 2:1-2', text: 'At that time Hannah prayed: \u201cMy heart rejoices in the LORD, in whom my horn is exalted. My mouth speaks boldly against my enemies, for I rejoice in Your salvation. There is no one holy like the LORD. Indeed, there is no one besides You! And there is no Rock like our God.', translation: 'BSB', original: [] },
      { reference: 'GAL 3:28', text: 'There is neither Jew nor Greek, slave nor free, male nor female, for you are all one in Christ Jesus.', translation: 'BSB', original: [] },
      { reference: 'EPH 5:22-25', text: 'Wives, submit to your husbands as to the Lord. For the husband is the head of the wife as Christ is the head of the church, His body, of which He is the Savior. Now as the church submits to Christ, so also wives should submit to their husbands in everything. Husbands, love your wives, just as Christ loved the church and gave Himself up for her', translation: 'BSB', original: [] },
      { reference: 'EPH 5:33', text: 'Nevertheless, each one of you also must love his wife as he loves himself, and the wife must respect her husband.', translation: 'BSB', original: [] },
      { reference: 'COL 3:18-19', text: 'Wives, submit to your husbands, as is fitting in the Lord. Husbands, love your wives and do not be harsh with them.', translation: 'BSB', original: [] },
    ],
  },
  canaanite_conquest: {
    keywords: [
      'canaanite', 'amorite', 'hittite', 'perizzite', 'hivite', 'jebusite', 'amalekite', 'girgashite',
      'conquest of canaan', 'destroy canaan', 'destroy the canaanites', 'destroy canaanites', 'utterly destroy', 'devote to destruction', 'herem',
      'genocide', 'why did god kill the canaanites', 'why did god command to kill', 'god commanded genocide',
      'is the conquest genocide', 'god evil for killing canaanites', 'justify the destruction of canaan',
      'why did god destroy canaan',
    ],
    verses: [
      { reference: 'GEN 15:16', text: 'In the fourth generation your descendants will return here, for the iniquity of the Amorites is not yet complete.', translation: 'BSB', original: [] },
      { reference: 'GEN 15:18-21', text: 'On that day the LORD made a covenant with Abram, saying, \u201cTo your descendants I have given this land\u2014from the river of Egypt to the great River Euphrates\u2014 the land of the Kenites, Kenizzites, Kadmonites, Hittites, Perizzites, Rephaites, Amorites, Canaanites, Girgashites, and Jebusites.\u201d', translation: 'BSB', original: [] },
      { reference: 'LEV 18:24-30', text: 'Do not defile yourselves by any of these practices, for by all these things the nations I am driving out before you have defiled themselves...', translation: 'BSB', original: [] },
      { reference: 'DEU 12:31', text: 'You must not worship the LORD your God in this way, because they practice for their gods every abomination which the LORD hates. They even burn their sons and daughters in the fire as sacrifices to their gods.', translation: 'BSB', original: [] },
      { reference: 'DEU 18:9-12', text: 'When you enter the land that the LORD your God is giving you, do not imitate the detestable ways of the nations there...', translation: 'BSB', original: [] },
      { reference: 'DEU 7:1-5', text: 'When the LORD your God brings you into the land that you are entering to possess, and He drives out before you many nations...', translation: 'BSB', original: [] },
      { reference: 'DEU 9:4-5', text: 'When the LORD your God has driven them out before you, do not say in your heart, "Because of my righteousness the LORD has brought me in to possess this land."...', translation: 'BSB', original: [] },
      { reference: 'DEU 20:16-18', text: 'However, in the cities of the nations that the LORD your God is giving you as an inheritance, you must not leave alive anything that breathes...', translation: 'BSB', original: [] },
      { reference: 'JOS 6:17-21', text: 'Now the city and everything in it must be devoted to the LORD for destruction...', translation: 'BSB', original: [] },
      { reference: '1SA 15:2-3', text: 'This is what the LORD of Hosts says: \u2018I witnessed what the Amalekites did to the Israelites when they opposed them on their way up from Egypt...', translation: 'BSB', original: [] },
      { reference: 'MAT 26:52', text: '\u201cPut your sword back in its place,\u201d Jesus said to him. \u201cFor all who draw the sword will die by the sword.\u201d', translation: 'BSB', original: [] },
    ],
  },
};

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Applies topic guard logic — prepends priority verses and filters excluded patterns.
 */
export function applyTopicGuards(
  query: string,
  verses: VerseContext[],
  debugState?: RetrievalDebugState,
  source: 'api_fallback' | 'db' = 'api_fallback'
): VerseContext[] {
  const normalizedQuery = query.toLowerCase();
  let priorityToPrepend: VerseContext[] = [];
  let combinedExclusions: string[] = [];
  const matchedGuards: Array<{
    guard: string;
    priority_refs: string[];
    conditional_priority_refs: string[];
    exclusion_patterns: string[];
  }> = [];

  for (const [guardKey, guard] of Object.entries(TOPIC_GUARDS)) {
    if (guard.keywords.some((k) => normalizedQuery.includes(k))) {
      const guardPriorityRefs: string[] = [];

      guard.priority.forEach((pv) => {
        if (!priorityToPrepend.some((v) => v.reference === pv.reference)) {
          priorityToPrepend.push(cloneVerses([pv])[0]);
          guardPriorityRefs.push(pv.reference);
        }
      });

      const conditionalPriorityRefs: string[] = [];
      if (guard.conditionalPriority) {
        guard.conditionalPriority(query).forEach((pv) => {
          if (!priorityToPrepend.some((v) => v.reference === pv.reference)) {
            priorityToPrepend.push(cloneVerses([pv])[0]);
            conditionalPriorityRefs.push(pv.reference);
          }
        });
      }

      combinedExclusions.push(...guard.excludePatterns);
      matchedGuards.push({
        guard: guardKey,
        priority_refs: guardPriorityRefs,
        conditional_priority_refs: conditionalPriorityRefs,
        exclusion_patterns: guard.excludePatterns,
      });
    }
  }

  if (debugState) {
    debugState.topicGuardStageLogged = true;
  }

  if (priorityToPrepend.length === 0 && combinedExclusions.length === 0) {
    if (debugState) {
      addRetrievalStageTrace(debugState, { stage: 'topic_guard', action: 'no_match', source });
    }
    return verses;
  }

  const priorityRefs = priorityToPrepend.map((p) => p.reference);
  const duplicatePriorityRefs: string[] = [];
  const excludedRefs: string[] = [];

  const filteredRetrieved = verses.filter((v) => {
    const isAlreadyPriority = priorityRefs.includes(v.reference);
    const lowerText = v.text.toLowerCase();
    const exclusionPatterns = combinedExclusions.filter((pattern) => lowerText.includes(pattern));
    const isExcluded = exclusionPatterns.length > 0;

    if (debugState) {
      if (isAlreadyPriority) {
        duplicatePriorityRefs.push(v.reference);
        addDecisionTrace(debugState, v.reference, 'topic_guard:replaced_by_priority');
      }
      if (isExcluded) {
        excludedRefs.push(v.reference);
        addDecisionTrace(debugState, v.reference, `topic_guard:excluded:${exclusionPatterns.join('|')}`);
      }
    }

    return !isAlreadyPriority && !isExcluded;
  });

  if (debugState) {
    addRetrievalStageTrace(debugState, {
      stage: 'topic_guard',
      action: 'applied',
      source,
      guards: matchedGuards,
      prepended_refs: priorityRefs,
      duplicate_priority_refs: duplicatePriorityRefs,
      excluded_refs: excludedRefs,
    });
    priorityToPrepend.forEach((verse) => {
      addDecisionTrace(debugState, verse.reference, 'topic_guard:prepended_priority');
    });
  }

  return [...priorityToPrepend, ...filteredRetrieved];
}

/**
 * Applies curated topical list overrides — replaces or prepends curated verses for known broad topics.
 */
export function applyCuratedTopicalLists(
  query: string,
  verses: VerseContext[],
  debugState?: RetrievalDebugState,
  source: 'api_fallback' | 'db' = 'api_fallback'
): VerseContext[] {
  const normalizedQuery = query.toLowerCase();

  for (const [key, list] of Object.entries(CURATED_TOPICAL_LISTS)) {
    if (list.keywords.some((k) => normalizedQuery.includes(k))) {
      const clonedCuratedVerses = cloneVerses(list.verses);
      const curatedRefs = list.verses.map((verse) => verse.reference);

      if (key === 'canaanite_conquest') {
        if (debugState) {
          debugState.curationStageLogged = true;
          addRetrievalStageTrace(debugState, {
            stage: 'curation', action: 'applied', source, list: key, mode: 'replace',
            curated_refs: curatedRefs,
            displaced_refs: verses.map((v) => v.reference).filter((r) => !curatedRefs.includes(r)),
          });
          clonedCuratedVerses.forEach((verse) => {
            addDecisionTrace(debugState, verse.reference, `curation:selected_replace:${key}`);
          });
        }
        return clonedCuratedVerses;
      }

      const filteredRetrieved = verses.filter((v) => !curatedRefs.includes(v.reference));
      if (debugState) {
        debugState.curationStageLogged = true;
        addRetrievalStageTrace(debugState, {
          stage: 'curation', action: 'applied', source, list: key, mode: 'prepend',
          curated_refs: curatedRefs,
          displaced_refs: verses.map((v) => v.reference).filter((r) => curatedRefs.includes(r)),
        });
        clonedCuratedVerses.forEach((verse) => {
          addDecisionTrace(debugState, verse.reference, `curation:prepended:${key}`);
        });
      }
      return [...clonedCuratedVerses, ...filteredRetrieved];
    }
  }

  if (debugState) {
    debugState.curationStageLogged = true;
    addRetrievalStageTrace(debugState, { stage: 'curation', action: 'no_match', source });
  }
  return verses;
}
