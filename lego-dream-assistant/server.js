import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import {
  MAX_PHOTOS, PLAN_SCHEMA, SWAP_SCHEMA, SWAP_SYSTEM, SYSTEM,
  buildRequestText, normalizePlan, pieceRange, swapRequestText,
} from './lib/plan.js';
import { demoPlan } from './lib/demo.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.LEGO_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.LEGO_EFFORT || 'high';
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use('/vendor/three', express.static(path.join(dir, 'node_modules/three')));
app.use('/lib', express.static(path.join(dir, 'lib')));
app.use(express.static(path.join(dir, 'public')));

app.get('/api/health', (_req, res) => res.json({ mode: hasKey ? 'ai' : 'demo' }));

class Declined extends Error {}

// One structured-output request; resolves with the parsed JSON reply.
async function askClaude({ system, content, schema, effort }) {
  const message = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    })
    .finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Declined('I can’t build that one. Try asking for something else!');
  }
  const json = message.content.find((b) => b.type === 'text')?.text;
  if (message.stop_reason === 'max_tokens' || !json) {
    throw new Declined('That build got too big. Try something a bit smaller!');
  }
  return JSON.parse(json);
}

function sendError(res, err) {
  if (err instanceof Declined) return res.status(422).json({ error: err.message });
  console.error('request failed:', err);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return res.status(500).json({ error: 'The app’s AI key is not working. Ask a grown-up to check it.' });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: 'Lots of builders right now! Wait a moment and try again.' });
  }
  if (err instanceof Anthropic.BadRequestError) {
    return res.status(400).json({ error: 'I couldn’t read that. Try again with a new photo.' });
  }
  res.status(502).json({ error: 'Something went wrong. Please try again.' });
}

app.post('/api/build', async (req, res) => {
  const wish = String(req.body?.wish ?? '').trim().slice(0, 200);
  if (!wish) return res.status(400).json({ error: 'Tell me what you want to build!' });

  const images = [];
  for (const url of Array.isArray(req.body?.images) ? req.body.images.slice(0, MAX_PHOTOS) : []) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (!m) return res.status(400).json({ error: 'One of the photos did not work. Try taking it again.' });
    images.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  const range = pieceRange(req.body?.minPieces, req.body?.maxPieces);

  if (!client) return res.json({ mode: 'demo', plan: normalizePlan(demoPlan(wish)) });

  try {
    const raw = await askClaude({
      system: SYSTEM,
      schema: PLAN_SCHEMA,
      effort: EFFORT,
      content: [...images, { type: 'text', text: buildRequestText({ photoCount: images.length, wish, range }) }],
    });
    res.json({ mode: 'ai', plan: normalizePlan(raw) });
  } catch (err) {
    sendError(res, err);
  }
});

// Replacement pieces for one step, when the child is missing a piece.
app.post('/api/swap', async (req, res) => {
  if (!client) return res.status(503).json({ error: 'Swaps need the AI.' });
  const plan = normalizePlan(req.body?.plan);
  const stepIndex = Number(req.body?.stepIndex);
  const g = req.body?.group ?? {};
  const group = { kind: String(g.kind), color: String(g.color), sizeA: Number(g.sizeA), sizeB: Number(g.sizeB) };
  if (!plan.steps[stepIndex]) return res.status(400).json({ error: 'I lost track of that step. Try again.' });
  const hint = String(req.body?.hint ?? '').trim().slice(0, 200);

  try {
    const swap = await askClaude({
      system: SWAP_SYSTEM,
      schema: SWAP_SCHEMA,
      effort: 'medium',
      content: swapRequestText({ plan, stepIndex, group, hint }),
    });
    res.json({ swap });
  } catch (err) {
    sendError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`Lego Dream Assistant on http://localhost:${PORT} (${hasKey ? `AI mode, ${MODEL}` : 'demo mode: set ANTHROPIC_API_KEY for real builds'})`);
});
