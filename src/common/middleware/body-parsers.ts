import type {
  Application,
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from 'express';
import { json, urlencoded } from 'express';

/** Express' own default, kept for every route except the larger ones below. */
const DEFAULT_BODY_LIMIT = '100kb';

/**
 * Ticket forms can carry a whole panel (up to 300 new parameters with their
 * reference values), well above 100 KB.
 */
const LARGE_BODY_ROUTES: { path: string; limit: string }[] = [
  { path: '/api/tickets', limit: '2mb' },
];

const payloadTooLarge: ErrorRequestHandler = (
  error: { type?: string; limit?: number },
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (error?.type !== 'entity.too.large') return next(error);
  const limitKb = error.limit ? Math.round(error.limit / 1024) : undefined;
  res.status(413).json({
    statusCode: 413,
    message: `La solicitud es demasiado grande${limitKb ? ` (máximo ${limitKb} KB)` : ''}: divídela en partes más pequeñas`,
    error: 'Payload Too Large',
  });
};

/**
 * Replaces Nest's built-in body parsers (create the app with
 * `bodyParser: false`). A route parsed by a larger limit is skipped by the
 * default parser, which only reads unparsed bodies.
 */
export function registerBodyParsers(app: Application) {
  for (const { path, limit } of LARGE_BODY_ROUTES) {
    app.use(path, json({ limit }));
  }
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
  app.use(payloadTooLarge);
}
