import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleChat } from './routes/chat';
import { handleHealth } from './routes/health';
import { handleEvaluate } from './routes/evaluate';
import { handleKeepAlive } from './routes/keep-alive';

export type Bindings = {
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
  GROQ_API_KEY?: string;
  GROQ_PRIMARY_MODEL?: string;
  GROQ_SECONDARY_MODEL?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  DATABASE_URL?: string;
  POSTGRES_URL?: string;
  EVAL_SECRET?: string;
  [key: string]: unknown;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

// Propagate Cloudflare Worker env bindings to process.env for downstream modules
app.use('*', async (c, next) => {
  if (c.env) {
    for (const [key, value] of Object.entries(c.env)) {
      if (typeof value === 'string' && !process.env[key]) {
        process.env[key] = value;
      }
    }
    // Bidirectional alias for Postgres connection string
    if (process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
      process.env.POSTGRES_URL = process.env.DATABASE_URL;
    }
    if (process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
      process.env.DATABASE_URL = process.env.POSTGRES_URL;
    }
  }
  await next();
});

// API Routes
app.get('/api/health', handleHealth);
app.post('/api/chat', handleChat);
app.post('/api/evaluate', handleEvaluate);
app.get('/api/keep-alive', handleKeepAlive);
app.on('HEAD', '/api/keep-alive', handleKeepAlive);

// Guard unmatched API routes from falling through to HTML SPA
app.all('/api/*', (c) => c.json({ error: 'Not Found' }, 404));

// Fallback to static assets for web pages (production Cloudflare Workers)
app.all('*', async (c) => {
  if (c.env?.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status === 404 && c.req.header('accept')?.includes('text/html')) {
      const url = new URL(c.req.url);
      url.pathname = '/index.html';
      return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
    }
    return res;
  }
  return c.text('Not Found', 404);
});

export default app;
