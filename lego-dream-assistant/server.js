import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { PLAN_SCHEMA, SYSTEM, normalizePlan } from './lib/plan.js';
import { demoPlan } from './lib/demo.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.LEGO_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.LEGO_EFFORT || 'high';
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use('/vendor/three', express.static(path.join(dir, 'node_modules/three')));
app.use('/lib', express.static(path.join(dir, 'lib')));
app.use(express.static(path.join(dir, 'public')));

app.get('/api/health', (_req, res) => res.json({ mode: hasKey ? 'ai' : 'demo' }));

app.post('/api/build', async (req, res) => {
  const wish = String(req.body?.wish ?? '').trim().slice(0, 200);
  if (!wish) return res.status(400).json({ error: 'Tell me what you want to build!' });

  let image = null;
  if (req.body?.image) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(req.body.image);
    if (!m) return res.status(400).json({ error: 'That photo did not work. Try taking it again.' });
    image = { type: 'base64', media_type: m[1], data: m[2] };
  }

  if (!client) return res.json({ mode: 'demo', plan: normalizePlan(demoPlan(wish)) });

  try {
    const content = [];
    if (image) content.push({ type: 'image', source: image });
    content.push({
      type: 'text',
      text: `${image ? 'Here is a photo of my bricks.' : 'I have no photo of my bricks.'} I want to build: ${wish}`,
    });

    const message = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { effort: EFFORT, format: { type: 'json_schema', schema: PLAN_SCHEMA } },
        messages: [{ role: 'user', content }],
      })
      .finalMessage();

    if (message.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'I can’t build that one. Try asking for something else!' });
    }
    const json = message.content.find((b) => b.type === 'text')?.text;
    if (message.stop_reason === 'max_tokens' || !json) {
      return res.status(502).json({ error: 'That build got too big. Try something a bit smaller!' });
    }
    res.json({ mode: 'ai', plan: normalizePlan(JSON.parse(json)) });
  } catch (err) {
    console.error('build failed:', err);
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return res.status(500).json({ error: 'The app’s AI key is not working. Ask a grown-up to check it.' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Lots of builders right now! Wait a moment and try again.' });
    }
    if (err instanceof Anthropic.BadRequestError) {
      return res.status(400).json({ error: 'I couldn’t read that photo. Try taking it again.' });
    }
    res.status(502).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`Lego Dream Assistant on http://localhost:${PORT} (${hasKey ? `AI mode, ${MODEL}` : 'demo mode: set ANTHROPIC_API_KEY for real builds'})`);
});
