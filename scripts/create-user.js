// Crea o restablece un usuario desde la terminal.
// Uso: npm run create-user -- <usuario> <contraseña> [admin|member]
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { connect } from '../lib/db.js';

const [usernameRaw, password, roleRaw] = process.argv.slice(2);
const username = String(usernameRaw || '').trim().toLowerCase();
const role = roleRaw === 'member' ? 'member' : 'admin';

if (!/^[a-z0-9._-]{3,32}$/.test(username) || !password || password.length < 8) {
  console.error('Uso: npm run create-user -- <usuario> <contraseña de 8+ caracteres> [admin|member]');
  process.exit(1);
}

const db = await connect();
const passwordHash = await bcrypt.hash(password, 12);
const existing = await db.collection('users').findOne({ username });
if (existing) {
  await db.collection('users').updateOne({ _id: existing._id }, { $set: { passwordHash, role } });
  await db.collection('sessions').deleteMany({ userId: existing._id });
  console.log(`Usuario "${username}" actualizado (${role}). Se cerraron sus sesiones abiertas.`);
} else {
  await db.collection('users').insertOne({ _id: crypto.randomUUID(), username, role, passwordHash, createdAt: new Date() });
  console.log(`Usuario "${username}" creado (${role}).`);
}
process.exit(0);
