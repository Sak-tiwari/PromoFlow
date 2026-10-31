import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { rankCoupons } from './ranking.js';

const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

const reportSchema = z.object({
  domain: z.string().toLowerCase().regex(DOMAIN_RE),
  code: z.string().trim().toUpperCase().regex(CODE_RE),
  outcome: z.enum(['applied', 'invalid', 'expired', 'min_spend_not_met', 'not_applicable', 'no_effect']),
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

const normDomain = (d) => String(d || '').toLowerCase().replace(/^www\./, '');

export function createApp({ repo, allowedOrigins = [] } = {}) {
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

  app.get('/api/v1/coupons/:domain', limiter(120), async (req, res, next) => {
    try {
      const domain = normDomain(req.params.domain);
      if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: { code: 'BAD_DOMAIN', message: 'Invalid domain' } });
      const ranked = rankCoupons(await repo.listCoupons(domain)).map(
        ({ domain: _d, status: _s, ...c }) => c,
      );
      res.json({ domain, coupons: ranked });
    } catch (e) { next(e); }
  });

  app.post('/api/v1/coupons/report', limiter(30), async (req, res, next) => {
    try {
      const parsed = reportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid report', details: parsed.error.issues.map((i) => i.path.join('.')) } });
      }
      const day = new Date().toISOString().slice(0, 10);
      const counted = await repo.recordReport({ ...parsed.data, domain: normDomain(parsed.data.domain), day });
      res.status(202).json({ counted });
    } catch (e) { next(e); }
  });

  app.get('/api/v1/stores/:domain/config', limiter(120), async (req, res, next) => {
    try {
      const store = await repo.getStore(normDomain(req.params.domain));
      if (!store) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown store' } });
      res.json(store);
    } catch (e) { next(e); }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ level: 'error', msg: err.message }));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });
  return app;
}
