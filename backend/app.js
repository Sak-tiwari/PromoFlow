import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { rankCoupons } from './ranking.js';
import { validateRecipe } from '../src/adapters/recipe.js';

const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

const reportSchema = z.object({
  domain: z.string().toLowerCase().regex(DOMAIN_RE),
  code: z.string().trim().toUpperCase().regex(CODE_RE),
  outcome: z.enum(['applied', 'invalid', 'expired', 'min_spend_not_met', 'not_applicable', 'no_effect']),
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

const shareSchema = z.object({
  domain: z.string().toLowerCase().regex(DOMAIN_RE),
  code: z.string().trim().toUpperCase().regex(CODE_RE),
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

/** Fields the extension needs. Outcome counts stay on the server; descriptions are short. */
const publicCoupon = (c) => ({
  code: c.code, score: c.score, source: c.source ?? null, sources: c.sources ?? (c.source ? [c.source] : []),
  lastSeen: c.lastSeen ?? null, lastSuccessAt: c.lastSuccessAt ?? null, expiresAt: c.expiresAt ?? null,
  minSpend: c.minSpend ?? null, firstOrderOnly: !!c.firstOrderOnly, description: c.description ?? '',
  stats: { tries: c.stats?.tries ?? 0, successes: c.stats?.successes ?? 0 },
});

const normDomain = (d) => String(d || '').toLowerCase().replace(/^www\./, '');

/** recipes: Map<host, validated recipe> (see backend/recipes.js). A recipe stored on the store document wins if it validates. */
export function createApp({ repo, allowedOrigins = [], recipes = new Map() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      // Browser extensions call from chrome-extension://<id>. Add extra origins through ALLOWED_ORIGINS.
      origin: (origin, cb) => cb(null, !origin || origin.startsWith('chrome-extension://') || allowedOrigins.includes(origin)),
    }),
  );
  app.use(express.json({ limit: '4kb' }));
  const limiter = (max) => rateLimit({ windowMs: 60_000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false });

  app.get('/health', (_req, res) => res.json({ status: 'ok', repo: repo.kind }));

  // ?k=12 (1-30) limits the list; ?exclude=CODE1,CODE2 skips codes the extension already tried.
  app.get('/api/v1/coupons/:domain', limiter(120), async (req, res, next) => {
    try {
      const domain = normDomain(req.params.domain);
      if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: { code: 'BAD_DOMAIN', message: 'Invalid domain' } });
      const k = Math.min(30, Math.max(1, Number.parseInt(req.query.k, 10) || 12));
      const exclude = String(req.query.exclude ?? '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => CODE_RE.test(x)).slice(0, 50);
      const ranked = rankCoupons(await repo.listCoupons(domain), { now: Date.now(), k, exclude }).map(publicCoupon);
      res.json({ domain, coupons: ranked });
    } catch (e) { next(e); }
  });

  // Opt-in: the shopper chose to share a code that measurably lowered their total. Only domain + code + a random client id.
  app.post('/api/v1/coupons/share', limiter(10), async (req, res, next) => {
    try {
      const parsed = shareSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid share' } });
      const r = await repo.recordShare({ ...parsed.data, domain: normDomain(parsed.data.domain), now: Date.now() });
      res.status(202).json(r);
    } catch (e) { next(e); }
  });

  app.post('/api/v1/coupons/report', limiter(30), async (req, res, next) => {
    try {
      const parsed = reportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid report', details: parsed.error.issues.map((i) => i.path.join('.')) } });
      }
      const day = new Date().toISOString().slice(0, 10);
      const counted = await repo.recordReport({ ...parsed.data, domain: normDomain(parsed.data.domain), day, now: Date.now() });
      res.status(202).json({ counted });
    } catch (e) { next(e); }
  });

  app.get('/api/v1/stores/:domain/config', limiter(120), async (req, res, next) => {
    try {
      const domain = normDomain(req.params.domain);
      if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: { code: 'BAD_DOMAIN', message: 'Invalid domain' } });
      const store = await repo.getStore(domain);
      // Anything stored in the database is re-validated before it is served: a recipe is data the extension will act on.
      const fromStore = store?.recipe ? validateRecipe(store.recipe) : null;
      const recipe = fromStore?.ok && fromStore.recipe.hosts.includes(domain) ? fromStore.recipe : (recipes.get(domain) ?? null);
      if (!store && !recipe) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown store' } });
      const { recipe: _unvalidated, ...rest } = store ?? { domain, name: domain, adapter: 'generic' };
      res.json({ ...rest, recipe });
    } catch (e) { next(e); }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ level: 'error', msg: err.message }));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });
  return app;
}
