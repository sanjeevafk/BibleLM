import fs from 'fs';
import path from 'path';

export interface PericopeItem {
  id: string;
  title: string;
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
  reference: string;
  aliases: string[];
  category: 'parable' | 'discourse' | 'narrative' | 'prophecy' | 'hymn' | 'law' | 'epistle';
}

const PERICOPES: PericopeItem[] = [
  // --- GOSPEL PARABLES ---
  {
    id: "parable-good-samaritan",
    title: "The Parable of the Good Samaritan",
    book: "LUK",
    chapter: 10,
    startVerse: 25,
    endVerse: 37,
    reference: "LUK 10:25-37",
    aliases: ["good samaritan", "parable of the good samaritan", "the good samaritan", "who is my neighbor samaritan"],
    category: "parable"
  },
  {
    id: "parable-prodigal-son",
    title: "The Parable of the Prodigal Son",
    book: "LUK",
    chapter: 15,
    startVerse: 11,
    endVerse: 32,
    reference: "LUK 15:11-32",
    aliases: ["prodigal son", "the prodigal son", "parable of the lost son", "lost son", "forgiving father"],
    category: "parable"
  },
  {
    id: "parable-sower",
    title: "The Parable of the Sower",
    book: "MAT",
    chapter: 13,
    startVerse: 1,
    endVerse: 23,
    reference: "MAT 13:1-23",
    aliases: ["parable of the sower", "the sower", "four soils", "seed on good soil"],
    category: "parable"
  },
  {
    id: "parable-mustard-seed",
    title: "The Parable of the Mustard Seed",
    book: "MAT",
    chapter: 13,
    startVerse: 31,
    endVerse: 32,
    reference: "MAT 13:31-32",
    aliases: ["mustard seed", "parable of the mustard seed", "faith like a mustard seed"],
    category: "parable"
  },
  {
    id: "parable-lost-sheep",
    title: "The Parable of the Lost Sheep",
    book: "LUK",
    chapter: 15,
    startVerse: 1,
    endVerse: 7,
    reference: "LUK 15:1-7",
    aliases: ["lost sheep", "parable of the lost sheep", "ninety nine sheep", "leaving the ninety nine"],
    category: "parable"
  },
  {
    id: "parable-lost-coin",
    title: "The Parable of the Lost Coin",
    book: "LUK",
    chapter: 15,
    startVerse: 8,
    endVerse: 10,
    reference: "LUK 15:8-10",
    aliases: ["lost coin", "parable of the lost coin", "ten silver coins"],
    category: "parable"
  },
  {
    id: "parable-talents",
    title: "The Parable of the Talents",
    book: "MAT",
    chapter: 25,
    startVerse: 14,
    endVerse: 30,
    reference: "MAT 25:14-30",
    aliases: ["parable of the talents", "the talents", "five talents two talents one talent"],
    category: "parable"
  },
  {
    id: "parable-rich-fool",
    title: "The Parable of the Rich Fool",
    book: "LUK",
    chapter: 12,
    startVerse: 13,
    endVerse: 21,
    reference: "LUK 12:13-21",
    aliases: ["rich fool", "parable of the rich fool", "bigger barns"],
    category: "parable"
  },
  {
    id: "parable-pharisee-tax-collector",
    title: "The Pharisee and the Tax Collector",
    book: "LUK",
    chapter: 18,
    startVerse: 9,
    endVerse: 14,
    reference: "LUK 18:9-14",
    aliases: ["pharisee and publican", "pharisee and the tax collector", "god have mercy on me a sinner"],
    category: "parable"
  },
  {
    id: "parable-pearl-great-price",
    title: "The Pearl of Great Price and Hidden Treasure",
    book: "MAT",
    chapter: 13,
    startVerse: 44,
    endVerse: 46,
    reference: "MAT 13:44-46",
    aliases: ["pearl of great price", "hidden treasure", "treasure hidden in a field"],
    category: "parable"
  },
  {
    id: "parable-unforgiving-servant",
    title: "The Parable of the Unforgiving Servant",
    book: "MAT",
    chapter: 18,
    startVerse: 21,
    endVerse: 35,
    reference: "MAT 18:21-35",
    aliases: ["unforgiving servant", "parable of the unforgiving servant", "seventy times seven forgiveness"],
    category: "parable"
  },
  {
    id: "parable-sheep-and-goats",
    title: "The Sheep and the Goats (Final Judgment)",
    book: "MAT",
    chapter: 25,
    startVerse: 31,
    endVerse: 46,
    reference: "MAT 25:31-46",
    aliases: ["sheep and goats", "the sheep and the goats", "least of these my brothers"],
    category: "parable"
  },
  {
    id: "parable-ten-virgins",
    title: "The Parable of the Ten Virgins",
    book: "MAT",
    chapter: 25,
    startVerse: 1,
    endVerse: 13,
    reference: "MAT 25:1-13",
    aliases: ["ten virgins", "parable of the ten virgins", "five wise five foolish virgins", "oil for lamps"],
    category: "parable"
  },

  // --- SERMONS & DISCOURSES ---
  {
    id: "beatitudes",
    title: "The Beatitudes",
    book: "MAT",
    chapter: 5,
    startVerse: 1,
    endVerse: 12,
    reference: "MAT 5:1-12",
    aliases: ["beatitudes", "the beatitudes", "blessed are the poor in spirit", "sermon on the mount blessings"],
    category: "discourse"
  },
  {
    id: "sermon-on-the-mount",
    title: "The Sermon on the Mount",
    book: "MAT",
    chapter: 5,
    startVerse: 1,
    endVerse: 48,
    reference: "MAT 5:1-48",
    aliases: ["sermon on the mount", "jesus sermon on the mount", "salt and light"],
    category: "discourse"
  },
  {
    id: "lords-prayer",
    title: "The Lord's Prayer",
    book: "MAT",
    chapter: 6,
    startVerse: 9,
    endVerse: 13,
    reference: "MAT 6:9-13",
    aliases: ["lords prayer", "the lords prayer", "our father in heaven", "model prayer"],
    category: "discourse"
  },
  {
    id: "golden-rule",
    title: "The Golden Rule",
    book: "MAT",
    chapter: 7,
    startVerse: 12,
    endVerse: 12,
    reference: "MAT 7:12",
    aliases: ["golden rule", "the golden rule", "do to others as you would have them do to you"],
    category: "discourse"
  },
  {
    id: "great-commission",
    title: "The Great Commission",
    book: "MAT",
    chapter: 28,
    startVerse: 16,
    endVerse: 20,
    reference: "MAT 28:16-20",
    aliases: ["great commission", "the great commission", "go make disciples of all nations", "baptizing them in the name"],
    category: "discourse"
  },
  {
    id: "bread-of-life",
    title: "The Bread of Life Discourse",
    book: "JHN",
    chapter: 6,
    startVerse: 25,
    endVerse: 59,
    reference: "JHN 6:25-59",
    aliases: ["bread of life", "i am the bread of life", "eat my flesh drink my blood"],
    category: "discourse"
  },
  {
    id: "good-shepherd",
    title: "The Good Shepherd Discourse",
    book: "JHN",
    chapter: 10,
    startVerse: 1,
    endVerse: 18,
    reference: "JHN 10:1-18",
    aliases: ["good shepherd", "the good shepherd", "i am the good shepherd", "shepherd lays down his life"],
    category: "discourse"
  },
  {
    id: "true-vine",
    title: "The True Vine",
    book: "JHN",
    chapter: 15,
    startVerse: 1,
    endVerse: 17,
    reference: "JHN 15:1-17",
    aliases: ["true vine", "the true vine", "i am the vine you are the branches", "abide in me"],
    category: "discourse"
  },
  {
    id: "high-priestly-prayer",
    title: "Jesus' High Priestly Prayer",
    book: "JHN",
    chapter: 17,
    startVerse: 1,
    endVerse: 26,
    reference: "JHN 17:1-26",
    aliases: ["high priestly prayer", "jesus prayer in john 17", "that they may all be one"],
    category: "discourse"
  },

  // --- PROPHETIC & MESSIANIC PASSAGES ---
  {
    id: "suffering-servant",
    title: "The Suffering Servant",
    book: "ISA",
    chapter: 53,
    startVerse: 1,
    endVerse: 12,
    reference: "ISA 53:1-12",
    aliases: ["suffering servant", "the suffering servant", "suffering servant prophesied in isaiah", "suffering servant in isaiah", "isaiah 53 prophecy", "pierced for our transgressions", "by his stripes we are healed", "man of sorrows"],
    category: "prophecy"
  },
  {
    id: "emmanuel-prophecy",
    title: "The Sign of Immanuel / Virgin Birth",
    book: "ISA",
    chapter: 7,
    startVerse: 14,
    endVerse: 14,
    reference: "ISA 7:14",
    aliases: ["immanuel prophecy", "virgin birth prophecy", "virgin shall conceive", "god with us"],
    category: "prophecy"
  },
  {
    id: "unto-us-a-child-is-born",
    title: "Prince of Peace / Unto Us a Child is Born",
    book: "ISA",
    chapter: 9,
    startVerse: 6,
    endVerse: 7,
    reference: "ISA 9:6-7",
    aliases: ["unto us a child is born", "prince of peace", "wonderful counselor mighty god everlasting father"],
    category: "prophecy"
  },
  {
    id: "ruler-from-bethlehem",
    title: "The Ruler Born in Bethlehem",
    book: "MIC",
    chapter: 5,
    startVerse: 2,
    endVerse: 5,
    reference: "MIC 5:2-5",
    aliases: ["bethlehem prophecy", "ruler from bethlehem", "bethlehem ephrathah prophecy"],
    category: "prophecy"
  },
  {
    id: "new-covenant-jeremiah",
    title: "The Promise of the New Covenant",
    book: "JER",
    chapter: 31,
    startVerse: 31,
    endVerse: 34,
    reference: "JER 31:31-34",
    aliases: ["new covenant", "promise of the new covenant", "law in their minds write it on their hearts"],
    category: "prophecy"
  },
  {
    id: "valley-of-dry-bones",
    title: "The Valley of Dry Bones",
    book: "EZK",
    chapter: 37,
    startVerse: 1,
    endVerse: 14,
    reference: "EZK 37:1-14",
    aliases: ["valley of dry bones", "dry bones", "ezekiel dry bones", "can these bones live"],
    category: "prophecy"
  },
  {
    id: "seventy-weeks",
    title: "Daniel's Seventy Weeks",
    book: "DAN",
    chapter: 9,
    startVerse: 24,
    endVerse: 27,
    reference: "DAN 9:24-27",
    aliases: ["seventy weeks", "daniels seventy weeks", "70 weeks of daniel"],
    category: "prophecy"
  },

  // --- EPISTLES & PRACTICAL TEACHINGS ---
  {
    id: "fruits-of-the-spirit",
    title: "The Fruit of the Spirit",
    book: "GAL",
    chapter: 5,
    startVerse: 22,
    endVerse: 26,
    reference: "GAL 5:22-26",
    aliases: ["fruits of the spirit", "fruit of the spirit", "nine fruits of the spirit", "fruit of the holy spirit", "love joy peace patience kindness"],
    category: "epistle"
  },
  {
    id: "armor-of-god",
    title: "The Armor of God",
    book: "EPH",
    chapter: 6,
    startVerse: 10,
    endVerse: 20,
    reference: "EPH 6:10-20",
    aliases: ["armor of god", "the armor of god", "full armor of god", "shield of faith belt of truth helmet of salvation"],
    category: "epistle"
  },
  {
    id: "love-chapter",
    title: "The Way of Love (1 Corinthians 13)",
    book: "1CO",
    chapter: 13,
    startVerse: 1,
    endVerse: 13,
    reference: "1CO 13:1-13",
    aliases: ["love chapter", "agape love", "love is patient love is kind", "faith hope love greatest of these is love"],
    category: "epistle"
  },
  {
    id: "resurrection-chapter",
    title: "The Resurrection of the Dead (1 Corinthians 15)",
    book: "1CO",
    chapter: 15,
    startVerse: 1,
    endVerse: 58,
    reference: "1CO 15:1-58",
    aliases: ["resurrection chapter", "firstfruits of the resurrection", "death is swallowed up in victory"],
    category: "epistle"
  },
  {
    id: "hall-of-faith",
    title: "The Hall of Faith / Heroes of Faith",
    book: "HEB",
    chapter: 11,
    startVerse: 1,
    endVerse: 40,
    reference: "HEB 11:1-40",
    aliases: ["hall of faith", "heroes of faith", "by faith abraham by faith moses", "faith is confidence in what we hope for"],
    category: "epistle"
  },
  {
    id: "taming-the-tongue",
    title: "Taming the Tongue",
    book: "JAS",
    chapter: 3,
    startVerse: 1,
    endVerse: 12,
    reference: "JAS 3:1-12",
    aliases: ["taming the tongue", "the tongue is a fire", "controlling the tongue"],
    category: "epistle"
  },
  {
    id: "christ-hymn-kenosis",
    title: "The Christ Hymn / Kenosis",
    book: "PHP",
    chapter: 2,
    startVerse: 5,
    endVerse: 11,
    reference: "PHP 2:5-11",
    aliases: ["christ hymn", "kenosis", "emptied himself", "every knee shall bow every tongue confess"],
    category: "hymn"
  },

  // --- OLD TESTAMENT CORNERSTONES ---
  {
    id: "ten-commandments-exodus",
    title: "The Ten Commandments (Decalogue)",
    book: "EXO",
    chapter: 20,
    startVerse: 1,
    endVerse: 17,
    reference: "EXO 20:1-17",
    aliases: ["ten commandments", "the ten commandments", "10 commandments", "decalogue", "two tablets of stone", "mount sinai commandments"],
    category: "law"
  },
  {
    id: "shema",
    title: "The Shema (Hear O Israel)",
    book: "DEU",
    chapter: 6,
    startVerse: 4,
    endVerse: 9,
    reference: "DEU 6:4-9",
    aliases: ["the shema", "shema yisrael", "hear o israel the lord our god the lord is one", "love the lord your god with all your heart"],
    category: "law"
  },
  {
    id: "creation-account",
    title: "The Creation of the Heavens and Earth",
    book: "GEN",
    chapter: 1,
    startVerse: 1,
    endVerse: 31,
    reference: "GEN 1:1-31",
    aliases: ["creation account", "seven days of creation", "creation of the world", "in the beginning god created"],
    category: "narrative"
  },
  {
    id: "fall-of-man",
    title: "The Fall of Man / Garden of Eden",
    book: "GEN",
    chapter: 3,
    startVerse: 1,
    endVerse: 24,
    reference: "GEN 3:1-24",
    aliases: ["the fall of man", "garden of eden fall", "original sin", "serpent in the garden", "tree of the knowledge of good and evil"],
    category: "narrative"
  },
  {
    id: "david-and-goliath",
    title: "David and Goliath",
    book: "1SA",
    chapter: 17,
    startVerse: 1,
    endVerse: 58,
    reference: "1SA 17:1-58",
    aliases: ["david and goliath", "david kills goliath", "five smooth stones"],
    category: "narrative"
  },
  {
    id: "the-shepherd-psalm",
    title: "The Lord is My Shepherd (Psalm 23)",
    book: "PSA",
    chapter: 23,
    startVerse: 1,
    endVerse: 6,
    reference: "PSA 23:1-6",
    aliases: ["psalm 23", "the lord is my shepherd", "twenty third psalm", "valley of the shadow of death"],
    category: "hymn"
  },
  {
    id: "psalm-of-repentance",
    title: "David's Prayer of Repentance (Psalm 51)",
    book: "PSA",
    chapter: 51,
    startVerse: 1,
    endVerse: 19,
    reference: "PSA 51:1-19",
    aliases: ["psalm 51", "create in me a clean heart", "davids prayer of repentance"],
    category: "hymn"
  },
  {
    id: "job-discourse-suffering",
    title: "The Mystery of God and Suffering (Job 38-42)",
    book: "JOB",
    chapter: 38,
    startVerse: 1,
    endVerse: 41,
    reference: "JOB 38:1-41",
    aliases: ["why do the righteous suffer job", "god speaks to job out of the whirlwind", "where were you when i laid the foundations of the earth"],
    category: "narrative"
  },
  {
    id: "proverbs-31-woman",
    title: "The Wife of Noble Character (Proverbs 31)",
    book: "PRO",
    chapter: 31,
    startVerse: 10,
    endVerse: 31,
    reference: "PRO 31:10-31",
    aliases: ["proverbs 31 woman", "virtuous woman", "wife of noble character", "charm is deceptive beauty is fleeting"],
    category: "hymn"
  }
];

function build() {
  const outputPath = path.join(process.cwd(), 'data', 'pericopes.json');
  fs.writeFileSync(outputPath, JSON.stringify(PERICOPES, null, 2), 'utf-8');
  console.log(`Successfully generated ${PERICOPES.length} pericope records at ${outputPath}`);
}

build();
