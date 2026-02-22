import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { Pool } from 'pg';
import { fetchVerseHelloAO, fetchVerseFallback, fetchStrongsDefinition, VerseContext } from './bible-fetch';
import { ensureDbReady, getDbPool } from './db';
import bibleIndexData from '../data/bible-index.json';
import strongsDictData from '../data/strongs-dict.json';

import { redis } from './redis';

const BIBLE_INDEX = bibleIndexData as Record<string, VerseContext>;
const STRONGS_DICT = strongsDictData as Record<string, Record<string, string>>;

const HF_EMBEDDING_MODEL = process.env.HF_EMBEDDING_MODEL || 'intfloat/multilingual-e5-small';
const HF_ENDPOINT = `https://router.huggingface.co/hf-inference/models/${HF_EMBEDDING_MODEL}/pipeline/feature-extraction`;
const VECTOR_LIMIT = 6;
const CACHE_TTL_SECONDS = 3600; // 1 hour persistent cache
const CONTEXT_CACHE_VERSION = 'v2';

/**
 * Interface for Topic Guard configuration to ensure high-signal retrieval
 * for sensitive or nuanced biblical topics.
 */
interface TopicGuard {
  keywords: string[];
  priority: VerseContext[];
  excludePatterns: string[];
  conditionalPriority?: (query: string) => VerseContext[];
}

/**
 * Scalable configuration for topic-specific retrieval guards.
 * Each block ensures core commandments/passages are prioritized while
 * filtering out distracting or diluting context.
 */
const TOPIC_GUARDS: Record<string, TopicGuard> = {
  murder: {
    keywords: ['murder', 'kill', 'slay', 'take life', 'shed blood', 'homicide', 'killing'],
    priority: [
      { reference: 'EXO 20:13', text: 'You shall not murder.', translation: 'BSB', original: [] },
      { reference: 'GEN 9:6', text: 'Whoever sheds the blood of man, by man shall his blood be shed; for in the image of God has He made man.', translation: 'BSB', original: [] },
      { reference: 'NUM 35:16', text: 'But if anyone strikes another with an iron object so that death results, he is a murderer; the murderer must be put to death.', translation: 'BSB', original: [] },
      { reference: 'NUM 35:17', text: 'Or if anyone strikes another with a stone in his hand that could cause death, and death results, he is a murderer; the murderer must be put to death.', translation: 'BSB', original: [] },
      { reference: 'NUM 35:30', text: 'If anyone kills a person, the murderer must be put to death on the evidence of witnesses; but no one shall be put to death on the testimony of only one witness.', translation: 'BSB', original: [] }
    ],
    excludePatterns: ['refuge', 'cities of refuge', 'unintentional', 'accidentally', 'without premeditation', 'manslaughter', 'avenger of blood', 'flees']
  },
  lying: {
    keywords: ['lying', 'false witness', 'lie', 'deceive', 'deception', 'deceit', 'liar', 'falsehood', 'perjury'],
    priority: [
      { reference: 'EXO 20:16', text: 'You shall not bear false witness against your neighbor.', translation: 'BSB', original: [] },
      { reference: 'PRO 6:16-19', text: 'There are six things that the LORD hates, seven that are detestable to Him: haughty eyes, a lying tongue, hands that shed innocent blood, a heart that devises wicked schemes, feet that run swiftly to evil, a false witness who gives false testimony, and one who stirs up discord among brothers.', translation: 'BSB', original: [] },
      { reference: 'EPH 4:25', text: 'Therefore each of you must put off falsehood and speak truthfully to his neighbor, for we are all members of one another.', translation: 'BSB', original: [] },
      { reference: 'PRO 12:22', text: 'Lying lips are detestable to the LORD, but those who deal faithfully are His delight.', translation: 'BSB', original: [] }
    ],
    excludePatterns: ['rahab', 'midwives', 'shipphrah', 'puah', 'lying in wait']
  },
  theft: {
    keywords: ['theft', 'steal', 'stealing', 'rob', 'robbery', 'thief', 'restitution'],
    priority: [
      { reference: 'EXO 20:15', text: 'You shall not steal.', translation: 'BSB', original: [] },
      { reference: 'LEV 19:11', text: 'You must not steal. You must not lie or deceive one another.', translation: 'BSB', original: [] },
      { reference: 'EXO 22:1', text: 'If a man steals an ox or a sheep and slaughters or sells it, he must repay five oxen for an ox and four sheep for a sheep.', translation: 'BSB', original: [] },
      { reference: 'EXO 22:4', text: 'If what was stolen is actually found alive in his possession—whether ox or donkey or sheep—he must pay back double.', translation: 'BSB', original: [] }
    ],
    excludePatterns: ['property laws', 'boundary marker', 'restoring']
  },
  adultery: {
    // Both adultery and idolatry are explicit sins with clear commandments in the Decalogue.
    keywords: ['adultery', 'adulterous', 'adulterer', 'cheating', 'infidelity', 'lustful', 'unfaithful'],
    priority: [
      { reference: 'EXO 20:14', text: 'You shall not commit adultery.', translation: 'BSB', original: [] },
      { reference: 'LEV 20:10', text: 'If a man commits adultery with another man’s wife—with the wife of his neighbor—both the adulterer and the adulteress must surely be put to death.', translation: 'BSB', original: [] },
      { reference: 'MAT 5:27-28', text: 'You have heard that it was said, ‘Do not commit adultery.’ But I tell you that anyone who looks at a woman to lust after her has already committed adultery with her in his heart.', translation: 'BSB', original: [] },
      { reference: 'HEB 13:4', text: 'Marriage should be honored by all and the marriage bed kept undefiled, for God will judge the sexually immoral and adulterers.', translation: 'BSB', original: [] },
      { reference: 'PRO 6:32-33', text: 'He who commits adultery lacks judgment; whoever does so destroys himself. Wounds and dishonor will befall him, and his reproach will never be wiped away.', translation: 'BSB', original: [] }
    ],
    excludePatterns: ['except for sexual immorality', 'forgiven', 'restored', 'woman caught in adultery']
  },
  idolatry: {
    // Commandment to worship God alone and avoid graven images.
    keywords: ['idolatry', 'idols', 'idolater', 'graven image', 'false gods', 'worshiping gods', 'pagan worship'],
    priority: [
      { reference: 'EXO 20:3-5', text: 'You shall have no other gods before Me. You shall not make for yourself an idol in the form of anything in the heavens above, on the earth below, or in the waters beneath. You shall not bow down to them or worship them; for I, the LORD your God, am a jealous God, visiting the iniquity of the fathers on their children to the third and fourth generations of those who hate Me,', translation: 'BSB', original: [] },
      { reference: 'DEU 5:7-9', text: 'You shall have no other gods before Me. You shall not make for yourself an idol in the form of anything in the heavens above, or on the earth beneath, or in the water under the earth. You shall not bow down to them or worship them; for I, the LORD your God, am a jealous God, visiting the iniquity of the fathers on their children to the third and fourth generations of those who hate Me,', translation: 'BSB', original: [] },
      { reference: '1CO 10:14', text: 'Therefore, my beloved, flee from idolatry.', translation: 'BSB', original: [] },
      { reference: 'EPH 5:5', text: 'For of this you can be sure: No immoral, impure, or greedy person (that is, an idolater), has any inheritance in the kingdom of Christ and of God.', translation: 'BSB', original: [] },
      { reference: 'COL 3:5', text: 'Put to death, therefore, the components of your earthly nature: sexual immorality, impurity, lust, evil desires, and greed, which is idolatry.', translation: 'BSB', original: [] },
      { reference: 'REV 21:8', text: 'But to the cowardly and unbelieving and abominable and murderers and sexually immoral and sorcerers and idolaters and all liars, their place will be in the lake that burns with fire and sulfur. This is the second death.', translation: 'BSB', original: [] }
    ],
    excludePatterns: ['metaphorical', 'judgment tool', 'using nations']
  },
  divorce: {
    keywords: ['divorce', 'remarriage', 'separate', 'marital faithfulness', 'adultery'],
    priority: [
      { reference: 'MAL 2:16', text: '“For I hate divorce,” says the LORD, the God of Israel. “He who divorces his wife covers his garment with violence,” says the LORD of Hosts.', translation: 'BSB', original: [] },
      { reference: 'MAT 19:6', text: 'So they are no longer two, but one flesh. Therefore what God has joined together, let man not separate.', translation: 'BSB', original: [] },
      { reference: 'GEN 2:24', text: 'For this reason a man will leave his father and mother and be united to his wife, and they will become one flesh.', translation: 'BSB', original: [] }
    ],
    excludePatterns: ['hardness of heart'],
    conditionalPriority: (query: string) => {
      const q = query.toLowerCase();
      if (q.includes('except for immorality') || q.includes('except for sexual immorality')) {
        return [{ reference: 'MAT 19:9', text: 'And I say to you, whoever divorces his wife, except for sexual immorality, and marries another woman commits adultery.', translation: 'BSB', original: [] }];
      }
      return [];
    }
  },
  feminism: {
    // Covers gender roles, strong women, and equality
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
      { reference: 'PRO 31:10', text: 'A wife of noble character, who can find? She is far more precious than rubies.', translation: 'BSB', original: [] }
    ],
    excludePatterns: [] // Stick to the biblical text, filtering of commentary is handled by source data trust
  },
  homosexuality: {
    // Direct prohibition topic — forces core verses and strong conclusion
    // Excludes unrelated hypocrisy / genealogy / eunuch verses that previously polluted responses
    keywords: ['homosexual', 'homosexuality', 'same sex', 'same-sex', 'gay', 'lesbian', 'men who have sex with men', 'arsenokoit', 'malakoi', 'lie with a man'],
    priority: [
      { reference: 'LEV 18:22', text: 'You must not lie with a man as with a woman; that is an abomination.', translation: 'BSB', original: [] },
      { reference: 'LEV 20:13', text: 'If a man lies with a man as with a woman, they have both committed an abomination. They must surely be put to death; their blood is upon them.', translation: 'BSB', original: [] },
      { reference: 'ROM 1:26-27', text: 'For this reason God gave them over to dishonorable passions. Even their women exchanged natural relations for unnatural ones. In the same way the men also abandoned natural relations with women and were inflamed with lust for one another. Men committed shameful acts with other men, and received in themselves the due penalty for their error.', translation: 'BSB', original: [] },
      { reference: '1CO 6:9-11', text: 'Do you not know that the wicked will not inherit the kingdom of God? Do not be deceived: Neither the sexually immoral, nor idolaters, nor adulterers, nor men who have sex with men, nor thieves, nor the greedy, nor drunkards, nor slanderers, nor swindlers will inherit the kingdom of God. And that is what some of you were. But you were washed, you were sanctified, you were justified in the name of the Lord Jesus Christ and by the Spirit of our God.', translation: 'BSB', original: [] },
      { reference: '1TI 1:9-10', text: 'We also know that the law is made not for the righteous but for lawbreakers and rebels, the ungodly and sinful, the unholy and irreligious, for those who kill their fathers or mothers, for murderers, for the sexually immoral, for those practicing homosexuality, for slave traders and liars and perjurers—and for whatever else is contrary to the sound doctrine.', translation: 'BSB', original: [] }
    ],
    excludePatterns: [
      'pharisee', 'hypocrit', 'woe to you', 
      'eunuch', 'genealogy', '1ch 6', 'scribe',
      'daughter of zion', 'babylon', 'jer 50', 'mic 4'
    ]
  },
  blasphemy: {
    // Topic: Blasphemy - Ensures core prohibitions on misusing God's name and blasphemy against the Spirit are prioritized.
    // This addresses the second commandment and the New Testament warning regarding the unforgivable sin.
    // Excludes generic praise/worship context to remain focused on the direct violation.
    keywords: ['blasphemy', 'blaspheme', 'take lords name in vain', 'curse god', 'speak against holy spirit', 'unforgivable sin'],
    priority: [
      { reference: 'EXO 20:7', text: 'You shall not take the name of the LORD your God in vain, for the LORD will not hold anyone guiltless who misuses his name.', translation: 'BSB', original: [] },
      { reference: 'LEV 24:16', text: 'Anyone who blasphemes the name of the LORD is to be put to death. The entire assembly must stone them. Whether foreigner or native-born, when they blaspheme the Name they are to be put to death.', translation: 'BSB', original: [] },
      { reference: 'MAT 12:31-32', text: 'And so I tell you, every kind of sin and slander can be forgiven, but blasphemy against the Spirit will not be forgiven. Anyone who speaks a word against the Son of Man will be forgiven, but anyone who speaks against the Holy Spirit will not be forgiven, either in this age or in the age to come.', translation: 'BSB', original: [] },
      { reference: 'MAR 3:28-29', text: 'Truly I tell you, people can be forgiven all their sins and every slander they utter, but whoever blasphemes against the Holy Spirit will never be forgiven; they are guilty of an eternal sin.', translation: 'BSB', original: [] }
    ],
    excludePatterns: ['praise', 'worship', 'glorify']
  },
  sexual_immorality: {
    // Topic: Porn / Sexual Immorality - Prioritizes direct prohibitions on lust, fornication, and illicit sexual behavior (porneia).
    // Specifically triggers for "porn" and "lust" to provide the full biblical weight on the "adultery in the heart" concept.
    // Excludes romantic or marital context (like Song of Solomon) to avoid diluting the prohibitive message.
    keywords: ['porn', 'pornography', 'lust', 'fornication', 'sexual immorality', 'sexually immoral', 'porneia', 'masturbation', 'adultery in heart'],
    priority: [
      { reference: 'MAT 5:27-28', text: 'You have heard that it was said, ‘You shall not commit adultery.’ But I tell you that anyone who looks at a woman lustfully has already committed adultery with her in his heart.', translation: 'BSB', original: [] },
      { reference: '1CO 6:18', text: 'Flee from sexual immorality. All other sins a person commits are outside the body, but whoever sins sexually, sins against their own body.', translation: 'BSB', original: [] },
      { reference: 'EPH 5:3', text: 'But among you there must not be even a hint of sexual immorality, or of any kind of impurity, or of greed, because these are improper for God’s holy people.', translation: 'BSB', original: [] },
      { reference: 'GAL 5:19', text: 'The acts of the flesh are obvious: sexual immorality, impurity and debauchery;', translation: 'BSB', original: [] },
      { reference: 'COL 3:5', text: 'Put to death, therefore, whatever belongs to your earthly nature: sexual immorality, impurity, lust, evil desires and greed, which is idolatry.', translation: 'BSB', original: [] },
      { reference: '1TH 4:3', text: 'It is God’s will that you should be sanctified: that you should avoid sexual immorality;', translation: 'BSB', original: [] },
      { reference: 'HEB 13:4', text: 'Marriage should be honored by all, and the marriage bed kept pure, for God will judge the adulterer and all the sexually immoral.', translation: 'BSB', original: [] }
    ],
    excludePatterns: ['song of solomon', 'song of songs', 'romantic', 'marriage bed']
  }
};

/**
 * Curated topical lists for broad queries like "women in the bible".
 * These provide a comprehensive, high-quality set of verses that 
 * provide a structured "curated" experience for major themes.
 */
interface CuratedTopicalList {
  keywords: string[];
  verses: VerseContext[];
}

/**
 * Scalable configuration for broad topical curated lists.
 * To extend, simply add new keys like "men", "prophets", "kings", etc.
 */
const CURATED_TOPICAL_LISTS: Record<string, CuratedTopicalList> = {
  women: {
    keywords: ['women in bible', 'women in the bible', 'biblical women', 'heroic women', 'women of the bible', 'strong women bible'],
    verses: [
      { reference: 'LUK 1:26-28', text: 'In the sixth month, God sent the angel Gabriel to a town in Galilee called Nazareth, to a virgin pledged in marriage to a man named Joseph, of the house of David. The virgin’s name was Mary. The angel went to her and said, “Greetings, you who are highly favored! The Lord is with you.”', translation: 'BSB', original: [] },
      { reference: 'LUK 1:46-49', text: 'Then Mary said: “My soul magnifies the Lord, and my spirit rejoices in God my Savior! For He has looked with favor on the humble state of His servant. From now on all generations will call me blessed. For the Mighty One has done great things for me. Holy is His name."', translation: 'BSB', original: [] },
      { reference: 'JDG 4:4', text: 'Now Deborah, a prophetess, the wife of Lappidoth, was judging Israel at that time.', translation: 'BSB', original: [] },
      { reference: 'JDG 5:7', text: 'Life in the villages ceased; it ended in Israel, until I, Deborah, arose, a mother in Israel.', translation: 'BSB', original: [] },
      { reference: 'JDG 4:21', text: 'But as he lay sleeping from exhaustion, Heber’s wife Jael took a tent peg, grabbed a hammer, and went silently to Sisera. She drove the peg through his temple and into the ground, and he died.', translation: 'BSB', original: [] },
      { reference: 'RUT 1:16-17', text: 'But Ruth replied: “Do not urge me to leave you or to turn from following you. For wherever you go, I will go, and wherever you live, I will live; your people will be my people, and your God will be my God. Where you die, I will die, and there I will be buried. May the LORD punish me, and ever so severely, if anything but death separates you and me.”', translation: 'BSB', original: [] },
      { reference: 'EST 4:14', text: 'For if you remain silent at this time, relief and deliverance for the Jews will arise from another place, but you and your father’s house will perish. And who knows if perhaps you have come to the kingdom for such a time as this?”', translation: 'BSB', original: [] },
      { reference: 'EST 4:16', text: '“Go and assemble all the Jews who can be found in Susa, and fast for me. Do not eat or drink for three days, night or day, and I and my maidens will fast as you do. After that, I will go to the king, even though it is against the law. And if I perish, I perish!”', translation: 'BSB', original: [] },
      { reference: 'PRO 31:10', text: 'A wife of noble character, who can find? She is far more precious than rubies.', translation: 'BSB', original: [] },
      { reference: 'PRO 31:25-26', text: 'Strength and honor are her clothing, and she can laugh at the days to come. She opens her mouth with wisdom, and faithful instruction is on her tongue.', translation: 'BSB', original: [] },
      { reference: 'PRO 31:30', text: 'Charm is deceptive and beauty is fleeting, but a woman who fears the LORD is to be praised.', translation: 'BSB', original: [] },
      { reference: 'HEB 11:11', text: 'By faith even Sarah herself received ability to conceive, even beyond the proper time of life, since she regarded Him faithful who had promised.', translation: 'BSB', original: [] },
      { reference: '1SA 1:27-28', text: 'I prayed for this boy, and since the LORD has granted me what I asked of Him, I now dedicate the boy to the LORD. For as long as he lives, he is dedicated to the LORD.”', translation: 'BSB', original: [] },
      { reference: '1SA 2:1-2', text: 'At that time Hannah prayed: “My heart rejoices in the LORD, in whom my horn is exalted. My mouth speaks boldly against my enemies, for I rejoice in Your salvation. There is no one holy like the LORD. Indeed, there is no one besides You! And there is no Rock like our God.', translation: 'BSB', original: [] },
      { reference: 'GAL 3:28', text: 'There is neither Jew nor Greek, slave nor free, male nor female, for you are all one in Christ Jesus.', translation: 'BSB', original: [] },
      { reference: 'EPH 5:22-25', text: 'Wives, submit to your husbands as to the Lord. For the husband is the head of the wife as Christ is the head of the church, His body, of which He is the Savior. Now as the church submits to Christ, so also wives should submit to their husbands in everything. Husbands, love your wives, just as Christ loved the church and gave Himself up for her', translation: 'BSB', original: [] },
      { reference: 'EPH 5:33', text: 'Nevertheless, each one of you also must love his wife as he loves himself, and the wife must respect her husband.', translation: 'BSB', original: [] },
      { reference: 'COL 3:18-19', text: 'Wives, submit to your husbands, as is fitting in the Lord. Husbands, love your wives and do not be harsh with them.', translation: 'BSB', original: [] }
    ]
  },
  canaanite_conquest: {
    keywords: [
      'canaanite', 'amorite', 'hittite', 'perizzite', 'hivite', 'jebusite', 'amalekite', 'girgashite',
      'conquest of canaan', 'destroy the canaanites', 'utterly destroy', 'devote to destruction', 'herem', 
      'genocide', 'why did god kill the canaanites', 'why did god command to kill', 'god commanded genocide', 
      'is the conquest genocide', 'god evil for killing canaanites', 'justify the destruction of canaan'
    ],
    verses: [
      { reference: 'GEN 15:16', text: 'In the fourth generation your descendants will return here, for the iniquity of the Amorites is not yet complete.', translation: 'BSB', original: [] },
      { reference: 'GEN 15:18-21', text: 'On that day the LORD made a covenant with Abram, saying, “To your descendants I have given this land—from the river of Egypt to the great River Euphrates— the land of the Kenites, Kenizzites, Kadmonites, Hittites, Perizzites, Rephaites, Amorites, Canaanites, Girgashites, and Jebusites.”', translation: 'BSB', original: [] },
      { reference: 'LEV 18:24-30', text: 'Do not defile yourselves by any of these practices, for by all these things the nations I am driving out before you have defiled themselves. Even the land has become defiled, so I am punishing it for its sin, and the land will vomit out its inhabitants... For the men who were in the land before you committed all these abominations, and the land has become defiled. So if you defile the land, it will vomit you out as it spewed out the nations before you... You must keep My charge not to practice any of the abominable customs that were practiced before you...', translation: 'BSB', original: [] },
      { reference: 'DEU 12:31', text: 'You must not worship the LORD your God in this way, because they practice for their gods every abomination which the LORD hates. They even burn their sons and daughters in the fire as sacrifices to their gods.', translation: 'BSB', original: [] },
      { reference: 'DEU 18:9-12', text: 'When you enter the land that the LORD your God is giving you, do not imitate the detestable ways of the nations there. Let no one be found among you who sacrifices his son or daughter in the fire, practices divination or conjury, interprets omens, practices sorcery, casts spells, consults a medium or spiritist, or inquires of the dead. For whoever does these things is detestable to the LORD. And because of these detestable things, the LORD your God is driving out the nations before you.', translation: 'BSB', original: [] },
      { reference: 'DEU 7:1-5', text: 'When the LORD your God brings you into the land that you are entering to possess, and He drives out before you many nations... then you must devote them to complete destruction. Make no treaty with them and show them no mercy. Do not intermarry with them... properly: tear down their altars, smash their sacred pillars, cut down their Asherah poles, and burn their idols in the fire.', translation: 'BSB', original: [] },
      { reference: 'DEU 9:4-5', text: 'When the LORD your God has driven them out before you, do not say in your heart, “Because of my righteousness the LORD has brought me in to possess this land.” Rather, the LORD is driving out these nations before you because of their wickedness. It is not because of your righteousness or uprightness of heart... but it is because of their wickedness that the LORD your God is driving out these nations before you, to keep the promise He swore to your fathers, to Abraham, Isaac, and Jacob.', translation: 'BSB', original: [] },
      { reference: 'DEU 20:16-18', text: 'However, in the cities of the nations that the LORD your God is giving you as an inheritance, you must not leave alive anything that breathes. For you must devote them to complete destruction... as the LORD your God has commanded you, so that they cannot teach you to do all the detestable things they do for their gods, and so cause you to sin against the LORD your God.', translation: 'BSB', original: [] },
      { reference: 'JOS 6:17-21', text: 'Now the city and everything in it must be devoted to the LORD for destruction... So the people shouted, and the trumpets were blown... and the wall fell down flat, so that the people went up into the city... and they captured the city. Then they devoted to destruction everything in the city—man and woman, young and old, oxen, sheep, and donkeys—with the edge of the sword.', translation: 'BSB', original: [] },
      { reference: '1SA 15:2-3', text: 'This is what the LORD of Hosts says: ‘I witnessed what the Amalekites did to the Israelites when they opposed them on their way up from Egypt. Now go and attack the Amalekites and devote to destruction all that belongs to them. Do not spare them, but put to death men and women, children and infants, oxen and sheep, camels and donkeys.’', translation: 'BSB', original: [] },
      { reference: 'MAT 26:52', text: '“Put your sword back in its place,” Jesus said to him. “For all who draw the sword will die by the sword."', translation: 'BSB', original: [] }
    ]
  }
};

/**
 * Checks if the query matches a curated topical list and returns it if so.
 */
function applyCuratedTopicalLists(query: string, verses: VerseContext[]): VerseContext[] {
  const normalizedQuery = query.toLowerCase();
  for (const [key, list] of Object.entries(CURATED_TOPICAL_LISTS)) {
    if (list.keywords.some(k => normalizedQuery.includes(k))) {
      // For curated lists, we often want to prioritize these above all else.
      // Special logic for canaanite_conquest: replace or strongly prepend.
      if (key === 'canaanite_conquest') {
        return list.verses;
      }
      
      const curatedRefs = list.verses.map(v => v.reference);
      const filteredRetrieved = verses.filter(v => !curatedRefs.includes(v.reference));
      return [...list.verses, ...filteredRetrieved];
    }
  }
  return verses;
}

/**
 * Applies topic guard logic across all configured topics.
 * 1. Detects matching topics via keywords.
 * 2. Collects priority verses to prepend (avoiding duplicates).
 * 3. Filters out excluded patterns from the retrieved verses.
 */
function applyTopicGuards(query: string, verses: VerseContext[]): VerseContext[] {
  const normalizedQuery = query.toLowerCase();
  let priorityToPrepend: VerseContext[] = [];
  let combinedExclusions: string[] = [];

  for (const guard of Object.values(TOPIC_GUARDS)) {
    if (guard.keywords.some(k => normalizedQuery.includes(k))) {
      // Add regular priority verses
      guard.priority.forEach(pv => {
        if (!priorityToPrepend.some(v => v.reference === pv.reference)) {
          priorityToPrepend.push(pv);
        }
      });

      // Add conditional priority verses if applicable
      if (guard.conditionalPriority) {
        guard.conditionalPriority(query).forEach(pv => {
          if (!priorityToPrepend.some(v => v.reference === pv.reference)) {
            priorityToPrepend.push(pv);
          }
        });
      }

      // Collect exclusion patterns
      combinedExclusions.push(...guard.excludePatterns);
    }
  }

  if (priorityToPrepend.length === 0 && combinedExclusions.length === 0) {
    return verses;
  }

  const priorityRefs = priorityToPrepend.map(p => p.reference);

  // Filter out existing versions of priority refs and verses matching exclusion patterns
  const filteredRetrieved = verses.filter(v => {
    const isAlreadyPriority = priorityRefs.includes(v.reference);
    const lowerText = v.text.toLowerCase();
    const isExcluded = combinedExclusions.some(pattern => lowerText.includes(pattern));
    return !isAlreadyPriority && !isExcluded;
  });

  return [...priorityToPrepend, ...filteredRetrieved];
}


async function getCached<T>(key: string): Promise<T | null> {
  try {
    return await redis.get<T>(key);
  } catch (error) {
    console.warn(`Redis get failed for key ${key}:`, error);
    return null;
  }
}

async function setCached<T>(key: string, value: T, ttlSeconds: number = CACHE_TTL_SECONDS): Promise<void> {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    console.warn(`Redis set failed for key ${key}:`, error);
  }
}

function cloneVerses(verses: VerseContext[]): VerseContext[] {
  return verses.map((verse) => ({
    ...verse,
    original: verse.original ? verse.original.map((orig) => ({ ...orig })) : []
  }));
}

function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const size = vectors[0].length;
  const sums = new Array<number>(size).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < size; i += 1) {
      sums[i] += vec[i];
    }
  }
  return sums.map((value) => value / vectors.length);
}

function normalizeEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
    return raw as number[];
  }
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    return meanPool(raw as number[][]);
  }
  throw new Error('Unexpected embedding response shape');
}

async function embedQuery(query: string): Promise<number[]> {
  const cacheKey = `embed:${HF_EMBEDDING_MODEL}:${query.trim().toLowerCase()}`;
  const cached = await getCached<number[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    throw new Error('HF_TOKEN is not set');
  }

  const response = await fetch(HF_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: [`query: ${query}`],
      options: { wait_for_model: true }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF embeddings failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as unknown;
  if (Array.isArray(data) && data.length > 0) {
    const embedding = normalizeEmbedding(data[0]);
    if (embedding.length !== 384) {
      throw new Error(`Embedding dimension mismatch; expected 384, got ${embedding.length}`);
    }
    await setCached(cacheKey, embedding);
    return embedding;
  }

  throw new Error('HF embeddings response was not an array');
}

function toVectorString(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function fetchVersesByRefs(
  pool: Pool,
  refs: Array<{ book: string; chapter: number; verse: number }>,
  translation: string
): Promise<VerseContext[]> {
  if (refs.length === 0) return [];

  const values: Array<string | number> = [translation];
  const tuples: string[] = [];
  refs.forEach((ref, index) => {
    const base = index * 3;
    tuples.push(`($${base + 2}::text, $${base + 3}::int, $${base + 4}::int)`);
    values.push(ref.book, ref.chapter, ref.verse);
  });

  const result = await pool.query<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
    translation: string;
  }>(
    `WITH refs(book, chapter, verse) AS (VALUES ${tuples.join(', ')})
     SELECT v.book, v.chapter, v.verse, v.text, v.translation
     FROM verses v
     JOIN refs r ON v.book = r.book AND v.chapter = r.chapter AND v.verse = r.verse
     WHERE v.translation = $1;`,
    values,
  );

  return result.rows.map((row) => ({
    reference: `${row.book} ${row.chapter}:${row.verse}`,
    translation: row.translation,
    text: row.text,
    original: []
  }));
}

async function vectorSearchVerses(
  pool: Pool,
  embedding: number[],
  translation: string,
  limit: number
): Promise<VerseContext[]> {
  const result = await pool.query<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
    translation: string;
  }>(
    `SELECT book, chapter, verse, text, translation
     FROM verses
     WHERE translation = $1 AND embedding IS NOT NULL
     ORDER BY embedding <-> $2::vector
     LIMIT $3;`,
    [translation, toVectorString(embedding), limit],
  );

  return result.rows.map((row) => ({
    reference: `${row.book} ${row.chapter}:${row.verse}`,
    translation: row.translation,
    text: row.text,
    original: []
  }));
}

/**
 * Retrieves highly-voted cross-references (TSK) for the given primary verses.
 * Limits to 3 total unique cross-references with more than 10 votes.
 */
async function getTskCrossReferences(
  pool: Pool,
  primaryVerses: VerseContext[],
  translation: string
): Promise<VerseContext[]> {
  if (primaryVerses.length === 0) return [];

  const parseReferenceKey = (reference: string) => {
    const match = reference.trim().match(/^([A-Z0-9]{3})\s+(\d+):(\d+)/i);
    if (!match) return null;
    return {
      book: match[1].toUpperCase(),
      chapter: Number.parseInt(match[2], 10),
      verse: Number.parseInt(match[3], 10)
    };
  };

  // 1. Extract book, chapter, verse from primary verses
  const refs = primaryVerses
    .map((v) => parseReferenceKey(v.reference))
    .filter((r): r is { book: string; chapter: number; verse: number } =>
      Boolean(r && !isNaN(r.chapter) && !isNaN(r.verse))
    );

  if (refs.length === 0) return [];

  // 2. Query cross_references for matches where votes > 10
  const values: Array<string | number> = [];
  const tuples: string[] = [];
  refs.forEach((ref, index) => {
    const base = index * 3;
    tuples.push(`($${base + 1}::text, $${base + 2}::int, $${base + 3}::int)`);
    values.push(ref.book, ref.chapter, ref.verse);
  });

  const query = `
    SELECT target_book, target_chapter, target_verse, votes
    FROM cross_references
    WHERE (source_book, source_chapter, source_verse) IN (VALUES ${tuples.join(', ')})
    AND votes > 10
    ORDER BY COALESCE(votes, 0) DESC
    LIMIT 3;
  `;

  const result = await pool.query<{
    target_book: string;
    target_chapter: number;
    target_verse: number;
    votes: number;
  }>(query, values);

  if (result.rows.length === 0) return [];

  // 3. Deduplication: Skip if already in primaryVerses
  const primaryRefs = new Set(refs.map((ref) => `${ref.book} ${ref.chapter}:${ref.verse}`));
  const seenTargets = new Set<string>();

  const targetRefs = result.rows
    .map((row) => ({
      book: row.target_book,
      chapter: row.target_chapter,
      verse: row.target_verse
    }))
    .filter((ref) => {
      const refStr = `${ref.book} ${ref.chapter}:${ref.verse}`;
      if (primaryRefs.has(refStr) || seenTargets.has(refStr)) {
        return false;
      }
      seenTargets.add(refStr);
      return true;
    });

  if (targetRefs.length === 0) return [];

  // 4. Fetch the actual text for these target verses
  const crossRefVerses = await fetchVersesByRefs(pool, targetRefs, translation);
  
  // Mark as cross-references
  return crossRefVerses.map((v) => ({ ...v, isCrossReference: true }));
}

export async function retrieveContextForQuery(
  query: string,
  translation: string,
  apiKey?: string
): Promise<VerseContext[]> {
  const cacheKey = `context:${CONTEXT_CACHE_VERSION}:${translation}:${query.trim().toLowerCase()}`;
  const cached = await getCached<VerseContext[]>(cacheKey);
  if (cached) {
    return cloneVerses(cached);
  }

  let verses: VerseContext[] = [];
  let usedDb = false;
  let dbError: unknown;

  try {
    verses = await retrieveContextFromDb(query, translation);
    usedDb = true;
  } catch (error) {
    console.error('DB Context Retrieval CRITICAL ERROR:', error);
    dbError = error;
  }

  if (!usedDb) {
    if (dbError) {
      console.warn('DB retrieval failed, falling back to API retrieval', dbError);
    } else if (!usedDb) {
      console.warn('DB retrieval unavailable, falling back to API retrieval');
    }
    const apiVerses = await retrieveContextViaApis(query, translation, apiKey);
    await setCached(cacheKey, apiVerses);
    return cloneVerses(apiVerses);
  }

  const enriched = await enrichOriginalLanguages(verses);
  await setCached(cacheKey, enriched);
  return cloneVerses(enriched);
}

async function retrieveContextFromDb(
  query: string,
  translation: string
): Promise<VerseContext[]> {
  await ensureDbReady();
  const pool = getDbPool();
  const verses: VerseContext[] = [];
  const normalizedQuery = query.toLowerCase();
  const directRefs = extractDirectReferences(query);

  const tenCommandmentRefs = [
    { reference: 'EXO 20:3', keywords: ['other gods', 'idolatry', 'idol', 'false gods', 'worship other'] },
    { reference: 'EXO 20:4', keywords: ['graven image', 'carved image', 'image worship', 'idols'] },
    { reference: 'EXO 20:7', keywords: ['take the lord\'s name', 'blaspheme', 'blasphemy', 'curse god', 'vain name'] },
    { reference: 'EXO 20:8', keywords: ['sabbath', 'rest day'] },
    { reference: 'EXO 20:12', keywords: ['honor father', 'honour father', 'honor mother', 'honour mother', 'disobey parents'] },
    { reference: 'EXO 20:13', keywords: ['murder', 'kill', 'killing', 'homicide'] },
    { reference: 'EXO 20:14', keywords: ['adultery', 'unfaithful spouse', 'cheat on spouse'] },
    { reference: 'EXO 20:15', keywords: ['theft', 'steal', 'stealing', 'rob', 'robbery'] },
    { reference: 'EXO 20:16', keywords: ['false witness', 'perjury', 'lie in court', 'slander'] },
    { reference: 'EXO 20:17', keywords: ['covet', 'coveting', 'envy your neighbor', 'envy thy neighbor'] }
  ];

  const freedomRefs = ['GAL 3:28', 'GAL 4:7', 'ROM 6:6', '1CO 7:22', 'PHM 1:16'];

  const prioritizedRefs = tenCommandmentRefs
    .filter((item) => item.keywords.some((k) => normalizedQuery.includes(k)))
    .map((item) => item.reference);

  const freedomKeywords = ['slav', 'slave', 'servant', 'bondservant', 'bond servant', 'bond', 'doulos', 'freedom', 'free'];
  if (freedomKeywords.some((k) => normalizedQuery.includes(k))) {
    prioritizedRefs.push(...freedomRefs);
  }

  const prioritizedParsed = prioritizedRefs.map((ref) => {
    const [book, cv] = ref.split(' ');
    const [chapter, verse] = cv.split(':').map((part) => Number.parseInt(part, 10));
    return { book, chapter, verse };
  });

  const directRows = await fetchVersesByRefs(pool, directRefs, translation);
  const priorityRows = await fetchVersesByRefs(pool, prioritizedParsed, translation);

  const addUnique = (row: VerseContext) => {
    const norm = row.reference.toUpperCase().trim();
    const hasRef = verses.some((v) => v.reference.toUpperCase().trim() === norm);
    const hasText = verses.some((v) => v.text.trim() === row.text.trim());
    
    if (!hasRef && !hasText) {
      verses.push(row);
    }
  };

  priorityRows.forEach(addUnique);
  directRows.forEach(addUnique);

  // If we have enough verses or it's a very short direct query, skip vector search
  const skipVector = (verses.length >= VECTOR_LIMIT) || (verses.length > 0 && normalizedQuery.length <= 12);

  if (!skipVector) {
    let embedding: number[] | null = null;
    try {
      embedding = await embedQuery(query);
    } catch (error) {
      console.warn('Query embedding failed; skipping vector search', error);
    }

    if (!embedding && verses.length === 0) {
      throw new Error('Vector retrieval unavailable and no direct references found.');
    }

    if (embedding) {
      const limit = Math.max(VECTOR_LIMIT - verses.length, 0);
      if (limit > 0) {
        const vectorRows = await vectorSearchVerses(pool, embedding, translation, limit);
        vectorRows.forEach(addUnique);
      }
    }
  }

  const guarded = applyTopicGuards(query, verses);
  const coreVerses = applyCuratedTopicalLists(query, guarded);
  
  // TSK Cross-References (Anchor Retrieval)
  let finalVerses = coreVerses;
  try {
    const tskVerses = await getTskCrossReferences(pool, coreVerses, translation);
    finalVerses = [...coreVerses, ...tskVerses];
  } catch (error) {
    console.warn('TSK retrieval failed', error);
  }

  attachIndexedOriginals(finalVerses);

  return finalVerses;
}

function attachIndexedOriginals(verses: VerseContext[]): void {
  for (const verse of verses) {
    const indexed = BIBLE_INDEX[verse.reference];
    if (indexed?.original && indexed.original.length > 0) {
      verse.original = indexed.original.map((orig) => ({ ...orig }));
    }
  }
}

async function retrieveContextViaApis(
  query: string,
  translation: string,
  apiKey?: string
): Promise<VerseContext[]> {
  const verses: VerseContext[] = [];
  const normalizedQuery = query.toLowerCase();

  const tenCommandments: VerseContext[] = [
    { reference: 'EXO 20:3', text: 'Thou shalt have no other gods before me.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:4', text: 'Thou shalt not make unto thee a graven image, nor any likeness of anything that is in heaven above, or that is in the earth beneath, or that is in the water under the earth.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:7', text: 'Thou shalt not take the name of Jehovah thy God in vain; for Jehovah will not hold him guiltless that taketh his name in vain.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:8', text: 'Remember the sabbath day, to keep it holy.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:12', text: 'Honor thy father and thy mother, that thy days may be long in the land which Jehovah thy God giveth thee.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:13', text: 'Thou shalt not kill.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:14', text: 'Thou shalt not commit adultery.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:15', text: 'Thou shalt not steal.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:16', text: 'Thou shalt not bear false witness against thy neighbor.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:17', text: 'Thou shalt not covet thy neighbor\'s house, thou shalt not covet thy neighbor\'s wife, nor his man-servant, nor his maid-servant, nor his ox, nor his ass, nor anything that is thy neighbor\'s.', translation: 'ASV', original: [] }
  ];

  const freedomFromSlaveryVerses: VerseContext[] = [
    {
      reference: 'GAL 3:28',
      text: 'There can be neither Jew nor Greek, there can be neither bond nor free, there can be no male and female; for ye all are one in Christ Jesus.',
      translation: 'WEB',
      original: []
    },
    {
      reference: 'GAL 4:7',
      text: 'So that thou art no longer a bondservant, but a son; and if a son, then an heir through God.',
      translation: 'WEB',
      original: []
    },
    {
      reference: 'ROM 6:6',
      text: 'knowing this, that our old man was crucified with him, that the body of sin might be done away, that so we should no longer be in bondage to sin;',
      translation: 'WEB',
      original: []
    },
    {
      reference: '1CO 7:22',
      text: 'For he that was called in the Lord being a bondservant, is the Lord\'s freedman: likewise he that was called being free, is Christ\'s bondservant.',
      translation: 'WEB',
      original: []
    },
    {
      reference: 'PHM 1:16',
      text: 'no longer as a bondservant, but more than a bondservant, a beloved brother, especially to me, but how much rather to thee, both in the flesh and in the Lord.',
      translation: 'WEB',
      original: []
    }
  ];

  const prioritized: VerseContext[] = [];
  const addPriority = (index: number, keywords: string[]) => {
    if (keywords.some((k) => normalizedQuery.includes(k))) {
      const verse = tenCommandments[index];
      if (!verses.some((v) => v.reference === verse.reference) && !prioritized.some((v) => v.reference === verse.reference)) {
        prioritized.push(verse);
      }
    }
  };

  addPriority(0, ['other gods', 'idolatry', 'idol', 'false gods', 'worship other']);
  addPriority(1, ['graven image', 'carved image', 'image worship', 'idols']);
  addPriority(2, ['take the lord\'s name', 'blaspheme', 'blasphemy', 'curse god', 'vain name']);
  addPriority(3, ['sabbath', 'rest day']);
  addPriority(4, ['honor father', 'honour father', 'honor mother', 'honour mother', 'disobey parents']);
  addPriority(5, ['murder', 'kill', 'killing', 'homicide']);
  addPriority(6, ['adultery', 'unfaithful spouse', 'cheat on spouse']);
  addPriority(7, ['theft', 'steal', 'stealing', 'rob', 'robbery']);
  addPriority(8, ['false witness', 'perjury', 'lie in court', 'slander']);
  addPriority(9, ['covet', 'coveting', 'envy your neighbor', 'envy thy neighbor']);

  for (const verse of prioritized.reverse()) {
    verses.unshift(verse);
  }

  const freedomKeywords = ['slav', 'slave', 'servant', 'bondservant', 'bond servant', 'bond', 'doulos', 'freedom', 'free'];
  if (freedomKeywords.some((k) => normalizedQuery.includes(k))) {
    for (const verse of freedomFromSlaveryVerses.slice().reverse()) {
      if (!verses.some((v) => v.reference === verse.reference)) {
        verses.unshift(verse);
      }
    }
  }

  // 1. Direct Reference Parsing (e.g., "John 3:16")
  const directRefs = extractDirectReferences(query);
  
  if (directRefs.length > 0) {
    // Attempt rapid direct fetch for parsed references
    for (const ref of directRefs) {
      const refKey = `${ref.book} ${ref.chapter}:${ref.verse}`;
      if (verses.some((v) => v.reference.startsWith(refKey))) {
        continue;
      }
      const dbMatch = BIBLE_INDEX[`${ref.book} ${ref.chapter}:${ref.verse}`];
      if (dbMatch) {
         verses.push(dbMatch);
         continue;
      }
      
      const vText = await fetchVerseHelloAO(translation, ref.book, ref.chapter, ref.verse, ref.endVerse) 
                    || await fetchVerseFallback(`${ref.book} ${ref.chapter}:${ref.verse}${ref.endVerse ? '-' + ref.endVerse : ''}`, translation);
      
      if (vText) {
        verses.push({
          reference: `${ref.book} ${ref.chapter}:${ref.verse}${ref.endVerse ? '-' + ref.endVerse : ''}`,
          translation: translation,
          text: vText,
          original: [] // Filled in enrichment phase
        });
      }
    }
  }

  // 2. Semantic Hint via Groq (only if direct parsing yields few results)
  if (verses.length < 2) {
    const groqApiKey = apiKey || process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      console.warn('Semantic retrieval skipped: GROQ_API_KEY is missing.');
      return enrichOriginalLanguages(verses);
    }
    const groq = createGroq({
      apiKey: groqApiKey,
    });
    const isMurder = TOPIC_GUARDS.murder.keywords.some(k => query.toLowerCase().includes(k));
    const murderContext = isMurder 
      ? " Extract only direct verses about intentional murder or killing. Exclude anything about unintentional killing, accidental death, manslaughter, cities of refuge, or protection from avenger of blood." 
      : "";

    const modelCandidates = ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'llama3-8b-8192', 'llama3-70b-8192'];
    let lastModelError: unknown;
    let text = '';
    for (const modelName of modelCandidates) {
      try {
        const result = await generateText({
          model: groq(modelName),
          prompt:
            'Return up to 3 Bible references as lines in the format BOOK CH:VS (e.g., GEN 1:1). ' +
            'Use 3-letter book codes. If none apply, return NONE.' + murderContext + '\nQuery: ' +
            JSON.stringify(query),
          temperature: 0.1,
        });
        text = result.text;
        break;
      } catch (error) {
        lastModelError = error;
        console.warn(`Semantic retrieval model failed: ${modelName}`, error);
      }
    }

    if (!text) {
      console.warn('Semantic retrieval failed', lastModelError);
      return enrichOriginalLanguages(verses);
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line.toUpperCase() !== 'NONE');

    for (const line of lines) {
      const match = line.match(/^([A-Z0-9]{3})\s+(\d+):(\d+)$/i);
      if (!match) continue;
      const book = match[1].toUpperCase();
      const chapter = Number.parseInt(match[2], 10);
      const verse = Number.parseInt(match[3], 10);
      const refStr = `${book} ${chapter}:${verse}`;
      
      // Skip if we already got it
      if (verses.some(v => v.reference.startsWith(refStr))) continue;

      // Try bundled index first
      if (BIBLE_INDEX[refStr]) {
        verses.push({...BIBLE_INDEX[refStr], translation: 'WEB'}); // Index text is WEB
        continue;
      }

      // Fallback to fetch
      const vText = await fetchVerseHelloAO(translation, book, chapter, verse)
                    || await fetchVerseFallback(refStr, translation);
                    
      if (vText) {
        verses.push({
          reference: refStr,
          translation,
          text: vText,
          original: []
        });
      }
    }
  }

  // 3. Enrichment Phase (add Strong's dictionary data)
  const guarded = applyTopicGuards(query, verses);
  const finalVerses = applyCuratedTopicalLists(query, guarded);
  return enrichOriginalLanguages(finalVerses);
}

// Enrich verses with Strongs info from the bundled dict or API
async function enrichOriginalLanguages(verses: VerseContext[]): Promise<VerseContext[]> {
  for (const verse of verses) {
    if (verse.original && verse.original.length > 0) {
      // It came from the static index so it has { word, strongs }. Need to add gloss.
      for (const orig of verse.original) {
        const dictEntry = STRONGS_DICT[orig.strongs];
        if (dictEntry) {
          orig.gloss = dictEntry.short_definition || dictEntry.definition;
          (orig as {transliteration?: string}).transliteration = dictEntry.transliteration;
        } else {
          // rare occurence, try API fetch
          const fetched = await fetchStrongsDefinition(orig.strongs);
          if (fetched) {
            orig.gloss = String(fetched.short_definition || fetched.definition || '');
            (orig as {transliteration?: string}).transliteration = String(fetched.transliteration || '');
          }
        }
      }
    } else {
      // We don't have the bolls tagged index for this verse. 
      // Because we didn't bundle it and it's fetched raw from HelloAO.
      // In this case, we would either hit bolls.life /get-chapter to get the tagged text
      // OR fallback gracefully. For MVP speed, we'll try to extract key english words and fuzzy match our dict.
      // However, that is extremely inaccurate. 
      // Correct approach: hit bolls.life for the tagged verse if missing!
      try {
        const isOT = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'].includes(verse.reference.split(' ')[0]);
        const trans = isOT ? 'WLC' : 'TR';
        const [book, cv] = verse.reference.split(' ');
        const [chapter, vNumStr] = cv.split(':');
        
        const bollsRef = bkbToBollsPath(book, parseInt(chapter, 10));
        const res = await fetch(`https://bolls.life/get-chapter/${trans}/${bollsRef}/`);
        
        if (res.ok) {
           const chapterData = await res.json();
           const matchV = chapterData.find((v: { verse: number, text: string }) => v.verse === parseInt(vNumStr, 10));
           if (matchV) {
             const tags = parseOriginalTags(matchV.text);
             for (const tag of tags) {
               const dictEntry = STRONGS_DICT[tag.strongs] || await fetchStrongsDefinition(tag.strongs);
               if (dictEntry) {
                 tag.gloss = String(dictEntry.short_definition || dictEntry.definition || '');
                 (tag as {transliteration?: string}).transliteration = String(dictEntry.transliteration || '');
               }
             }
             verse.original = tags;
           }
        }
      } catch (err) {
        console.warn('Failed to fetch tagged fallback for', verse.reference, err);
      }
    }
  }
  return verses;
}


function extractDirectReferences(query: string) {
  const results: Array<{book: string, chapter: number, verse: number, endVerse?: number}> = [];
  
  // Very simplistic parser for Genesis 1:1 or Gen 1:1-3
  // Covers top few books. In a real app we'd use a massive RegExp or a library.
  const regex = /\b(Gen|Exo|Lev|Num|Deu|Jos|Jdg|Rut|Sa|Ki|Ch|Ezr|Neh|Est|Job|Ps|Pro|Ecc|Song|Isa|Jer|Lam|Ezk|Dan|Hos|Joel|Amos|Obad|Jonah|Mic|Nahum|Hab|Zeph|Hag|Zech|Mal|Matt|Mark|Luke|John|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Titus|Philemon|Heb|James|Pet|John|Jude|Rev)[a-z]*\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\b/gi;
  
  let match;
  while ((match = regex.exec(query)) !== null) {
      const bookRaw = match[1].substring(0, 3).toUpperCase();
      // Translate to 3-letter codes used by HelloAO
      const bookMap: Record<string, string> = {
        'GEN':'GEN', 'EXO':'EXO', 'LEV':'LEV', 'NUM':'NUM', 'DEU':'DEU',
        'JOS':'JOS', 'JDG':'JDG', 'RUT':'RUT', 'SA':'1SA', 'KI':'1KI', 'CH':'1CH',
        'Psa':'PSA', 'PSA':'PSA', 'PRO':'PRO', 'ISA':'ISA', 'MAT':'MAT', 'MAR':'MRK',
        'LUK':'LUK', 'JOH':'JHN', 'ROM':'ROM', 'COR':'1CO', 'GAL':'GAL', 'EPH':'EPH',
        'PHI':'PHP', 'COL':'COL', 'THE':'1TH', 'TIM':'1TI', 'HEB':'HEB', 'JAM':'JAS',
        'PET':'1PE', 'REV':'REV'
      };
      const bookCode = bookMap[bookRaw] || bookRaw;
      
      results.push({
        book: bookCode,
        chapter: parseInt(match[2], 10),
        verse: parseInt(match[3], 10),
        endVerse: match[4] ? parseInt(match[4], 10) : undefined
      });
  }
  
  return results;
}

// Utility copied over from script
function bkbToBollsPath(bookCode: string, chapter: number): string {
  const map: Record<string, number> = {
    'GEN': 1, 'EXO': 2, 'LEV': 3, 'NUM': 4, 'DEU': 5,
    'JOS': 6, 'JDG': 7, 'RUT': 8, '1SA': 9, '2SA': 10,
    '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14, 'EZR': 15,
    'NEH': 16, 'EST': 17, 'JOB': 18, 'PSA': 19, 'PRO': 20,
    'ECC': 21, 'SNG': 22, 'ISA': 23, 'JER': 24, 'LAM': 25,
    'EZK': 26, 'DAN': 27, 'HOS': 28, 'JOL': 29, 'AMO': 30,
    'OBA': 31, 'JON': 32, 'MIC': 33, 'NAM': 34, 'HAB': 35,
    'ZEP': 36, 'HAG': 37, 'ZEC': 38, 'MAL': 39,
    'MAT': 40, 'MRK': 41, 'LUK': 42, 'JHN': 43, 'ACT': 44,
    'ROM': 45, '1CO': 46, '2CO': 47, 'GAL': 48, 'EPH': 49,
    'PHP': 50, 'COL': 51, '1TH': 52, '2TH': 53, '1TI': 54,
    '2TI': 55, 'TIT': 56, 'PHM': 57, 'HEB': 58, 'JAS': 59,
    '1PE': 60, '2PE': 61, '1JN': 62, '2JN': 63, '3JN': 64,
    'JUD': 65, 'REV': 66
  };
  return `${map[bookCode]}/${chapter}`;
}

function parseOriginalTags(text: string) {
  const words: Array<{word: string, strongs: string, gloss?: string}> = [];
  const cleanLine = text.replace(/<span.*?>/g, '').replace(/<\/\span>/g, '');
  const parts = cleanLine.split('<S>');
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) continue; 
    
    const endStrongsIdx = part.indexOf('</S>');
    if (endStrongsIdx !== -1) {
      const strongs = part.substring(0, endStrongsIdx);
      const wordPart = parts[i-1].replace(/<\/\S>/g, '').trim();
      const lastSpace = wordPart.lastIndexOf(' ');
      const word = lastSpace === -1 ? wordPart : wordPart.substring(lastSpace + 1);
      
      const cleanWord = word.replace(/[,.;:!?]/g, '');
      if (cleanWord && strongs) {
        words.push({ word: cleanWord, strongs });
      }
    }
  }
  return words;
}
