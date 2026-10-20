import { MongoClient } from 'mongodb';

export async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Falta la variable MONGODB_URI (la cadena de conexión de MongoDB Atlas).');
    process.exit(1);
  }
  const client = new MongoClient(uri, { appName: 'dogout' });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'dogout');
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  // MongoDB removes expired sessions on its own.
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('sessions').createIndex({ userId: 1 });
  return db;
}
