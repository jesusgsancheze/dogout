import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const COOKIE = 'dg_sid';
const COLLECTIONS = new Set(['players', 'lineups', 'games']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const USER_RE = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;

const db = await connect();
const users = db.collection('users');
const sessions = db.collection('sessions');

await bootstrapAdmin();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: IS_PROD ? [] : null,
    },
  },
}));
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* ---------- sessions ---------- */
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token, maxAgeMs) {
  res.cookie(COOKIE, token, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: maxAgeMs, path: '/' });
}

async function loadSession(req, _res, next) {
  try {
    const token = readCookie(req, COOKIE);
    if (token) {
      const s = await sessions.findOne({ _id: hashToken(token), expiresAt: { $gt: new Date() } });
      if (s) {
        const u = await users.findOne({ _id: s.userId }, { projection: { passwordHash: 0 } });
        if (u) { req.user = u; req.sessionId = s._id; }
      }
    }
    next();
  } catch (e) { next(e); }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  next();
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede hacer esto.' });
  next();
}
// Cross-site requests can't set custom headers without a CORS preflight, which this server never approves.
function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Dogout') !== '1') return res.status(400).json({ error: 'Solicitud no válida.' });
  next();
}

app.use('/api', requireAppHeader, loadSession);

/* ---------- auth ---------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos e intenta de nuevo.' },
});
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

app.post('/api/login', loginLimiter, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const u = USER_RE.test(username) ? await users.findOne({ username }) : null;
  const ok = await bcrypt.compare(password, u?.passwordHash || DUMMY_HASH);
  if (!u || !ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 864e5;
  await sessions.insertOne({ _id: hashToken(token), userId: u._id, createdAt: new Date(), expiresAt: new Date(Date.now() + maxAge) });
  await users.updateOne({ _id: u._id }, { $set: { lastLoginAt: new Date() } });
  setSessionCookie(res, token, maxAge);
  res.json({ username: u.username, role: u.role });
});

app.post('/api/logout', async (req, res) => {
  if (req.sessionId) await sessions.deleteOne({ _id: req.sessionId });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ username: req.user.username, role: req.user.role }));

app.post('/api/me/password', requireAuth, async (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  const u = await users.findOne({ _id: req.user._id });
  if (!(await bcrypt.compare(current, u.passwordHash))) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  if (next.length < MIN_PASSWORD) return res.status(400).json({ error: `La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` });
  await users.updateOne({ _id: u._id }, { $set: { passwordHash: await bcrypt.hash(next, 12), passwordChangedAt: new Date() } });
  // Sign out every other device.
  await sessions.deleteMany({ userId: u._id, _id: { $ne: req.sessionId } });
  res.json({ ok: true });
});

/* ---------- user management (admin) ---------- */
app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  const list = await users.find({}, { projection: { passwordHash: 0 } }).sort({ username: 1 }).toArray();
  res.json(list.map((u) => ({ username: u.username, role: u.role, lastLoginAt: u.lastLoginAt || null })));
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'member';
  if (!USER_RE.test(username)) return res.status(400).json({ error: 'El usuario debe tener de 3 a 32 caracteres: letras minúsculas, números, punto, guion o guion bajo.' });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` });
  try {
    await users.insertOne({ _id: crypto.randomUUID(), username, role, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date() });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre.' });
    throw e;
  }
  res.status(201).json({ username, role });
});

app.delete('/api/users/:username', requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.params.username).toLowerCase();
  if (username === req.user.username) return res.status(400).json({ error: 'No puedes borrar tu propio usuario.' });
  const u = await users.findOne({ username });
  if (!u) return res.status(404).json({ error: 'Ese usuario no existe.' });
  await users.deleteOne({ _id: u._id });
  await sessions.deleteMany({ userId: u._id });
  res.json({ ok: true });
});

/* ---------- team data ---------- */
async function readAll() {
  const out = {};
  for (const col of COLLECTIONS) {
    out[col] = {};
    for (const d of await db.collection(col).find({}).toArray()) {
      const { _id, ...rest } = d;
      out[col][_id] = rest;
    }
  }
  return out;
}

app.get('/api/data', requireAuth, async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await readAll());
});

function checkTarget(req, res) {
  const { col, id } = req.params;
  if (!COLLECTIONS.has(col)) { res.status(404).json({ error: 'Colección desconocida.' }); return false; }
  if (!ID_RE.test(id)) { res.status(400).json({ error: 'Identificador no válido.' }); return false; }
  return true;
}

app.put('/api/:col/:id', requireAuth, async (req, res) => {
  if (!checkTarget(req, res)) return;
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'El documento debe ser un objeto.' });
  const { _id, ...doc } = body;
  doc.updatedBy = req.user.username;
  await db.collection(req.params.col).replaceOne({ _id: req.params.id }, doc, { upsert: true });
  res.json({ ok: true });
});

app.delete('/api/:col/:id', requireAuth, async (req, res) => {
  if (!checkTarget(req, res)) return;
  await db.collection(req.params.col).deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

app.get('/api/export', requireAuth, async (_req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Disposition', `attachment; filename="dogout-respaldo-${stamp}.json"`);
  res.set('Cache-Control', 'no-store');
  res.json({ exportedAt: new Date().toISOString(), ...(await readAll()) });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

/* ---------- static app ---------- */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: IS_PROD ? '1h' : 0 }));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El documento es demasiado grande.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido.' });
  res.status(500).json({ error: 'Error del servidor. Intenta de nuevo.' });
});

app.listen(PORT, () => console.log(`Dogout escuchando en el puerto ${PORT}`));

async function bootstrapAdmin() {
  if (await users.countDocuments({}, { limit: 1 })) return;
  const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!USER_RE.test(username) || password.length < MIN_PASSWORD) {
    console.warn('No hay usuarios. Define ADMIN_USERNAME y ADMIN_PASSWORD (mín. 8 caracteres) para crear el administrador inicial.');
    return;
  }
  await users.insertOne({ _id: crypto.randomUUID(), username, role: 'admin', passwordHash: await bcrypt.hash(password, 12), createdAt: new Date() });
  console.log(`Administrador inicial "${username}" creado.`);
}
