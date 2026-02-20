# BibleLM

A minimalist, fast, neutral Bible chatbot web app that quotes real verses with original-language (Hebrew/Greek) data. Zero-cost deployment on Vercel Hobby + Groq free tier.

## Features

- **Neutral, Scripture-First**: Responses quote exact verses without theological commentary.
- **Original Languages**: Hebrew/Greek word breakdowns (transliteration, Strong's, gloss) for key words.
- **Fast RAG**: Hybrid retrieval using reference parsing, Groq semantic hints, and a bundled verse index.
- **Free Tier Optimized**: Uses Groq \`llama-3.1-8b-instant\` to maximize free tier rate limits (~14k TPM). Includes UI for bringing your own Groq API key to use \`70b\` models.

## Setup

1. **Install dependencies**:
   \`\`\`bash
   npm install
   \`\`\`

2. **Environment Variables**:
   Create a \`.env.local\` file in the root directory and add your Groq API key:
   \`\`\`
   GROQ_API_KEY=gsk_your_key_here
   \`\`\`

3. **Data Bundling (One-Time)**:
   We bundle the Strong's dictionary and ~1000 common verses to ensure fast edge execution without a database.
   \`\`\`bash
   npm run build:data
   \`\`\`
   _(Note: The repo already includes a generated \`data\` folder, but you can run this to regenerate it)._

4. **Run the dev server**:
   \`\`\`bash
   npm run dev
   \`\`\`
   Open [http://localhost:3000](http://localhost:3000)

## Test Queries (Controversial & Hard)

To verify the neutrality and accuracy of the bot, try these queries:

1. **Abortion**: "What does the Bible say about abortion?" _(Should quote Ps 139, Ex 21 without modern political commentary)._
2. **Homosexuality**: "What is the biblical view of homosexuality?" _(Should quote Lev 18, Rom 1, 1 Cor 6)._
3. **Divorce**: "Is divorce allowed?" _(Should quote Mal 2, Matt 5/19)._
4. **Slavery**: "Does the Bible support slavery?" _(Should quote Eph 6, Ex 21, Philemon)._
5. **Women in Ministry**: "Can women be pastors?" _(Should quote 1 Tim 2, Gal 3, Rom 16)._
6. **Rare Verse Fallback**: "What does 1 Chronicles 4:9 say?" _(Should fallback to fetch API properly since it's not in the bundle)._

## Deployment

Deploy seamlessly to [Vercel](https://vercel.com/):

1. Connect your GitHub repository.
2. Add \`GROQ_API_KEY\` to your Environment Variables in the Vercel dashboard.
3. Deploy! Vercel Edge Functions handle the `/api/chat` route for streaming.
