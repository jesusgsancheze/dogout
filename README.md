# Dogout · Libreta del mánager de softbol

App web privada para manejar un equipo de softbol:

- **Roster**: jugadores con número, posiciones, cómo batean y lanzan.
- **Pizarra**: campo dibujado donde arrastras las fichas para armar la defensa (4–5 infielders, 3–4 outfielders) y el orden al bate (hasta 12). Puedes guardar varios borradores.
- **Juegos**: registro turno a turno (H, 2B, 3B, HR, BB, K, out, error, bola ocupada, SF, SH), CI, CA, BR y defensa (IJ, PO, A, E, DP), con box score automático.
- **Estadísticas**: acumulado por torneo con las columnas de beisbolysoftbol.com (VB, H, H2, H3, HR, SH, SF, AL, CI, CA, BR, BB, K, PDE, SLG, AVG, OPS · IJ, PO, A, E, DP, LT, PDF).

Acceso con usuario y contraseña. El administrador puede crear más usuarios (por ejemplo, un coach) desde **Cuenta**.

## Stack

- Node.js 20+ con Express
- MongoDB (Atlas)
- Frontend sin build: HTML, CSS y JavaScript en `public/`

## 1. Preparar MongoDB Atlas

1. En Atlas, crea un cluster (el plan gratis **M0** sirve y no vence).
2. **Database Access** → crea un usuario de base de datos con permiso *Read and write to any database*.
3. **Network Access** → agrega `0.0.0.0/0`. Render no tiene una IP fija en el plan gratis, así que hace falta permitir todas; la protección la dan el usuario y la clave de la base.
4. **Connect → Drivers** → copia la cadena `mongodb+srv://...` y reemplaza `<password>` por la clave del usuario.

La app crea sola las colecciones (`players`, `lineups`, `games`, `users`, `sessions`) en la base `dogout`.

## 2. Desplegar en Render

**Opción A — Blueprint (recomendada):** en Render, *New → Blueprint*, elige este repo. Render lee `render.yaml` y te pide las variables secretas.

**Opción B — Web Service manual:** *New → Web Service*, elige el repo y configura:

| Campo | Valor |
|---|---|
| Runtime | Node |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/healthz` |

### Variables de entorno

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | tu cadena de Atlas |
| `MONGODB_DB` | `dogout` |
| `ADMIN_USERNAME` | tu usuario, en minúsculas (ej. `jesus`) |
| `ADMIN_PASSWORD` | una clave de 8+ caracteres |

El administrador se crea **solo la primera vez**, cuando la base no tiene usuarios. Después puedes cambiar la clave desde **Cuenta** dentro de la app; cambiar `ADMIN_PASSWORD` en Render ya no tiene efecto.

> En el plan gratis, Render duerme el servicio tras 15 minutos sin uso y tarda cerca de un minuto en despertar. Tus datos no se pierden: viven en Atlas.

## 3. Correr en tu computadora

```bash
cp .env.example .env   # y llena MONGODB_URI, ADMIN_USERNAME, ADMIN_PASSWORD
npm install
npm run dev            # http://localhost:3000
```

## Usuarios y contraseñas

- Desde la app: **Cuenta** → cambiar contraseña; si eres administrador, crear o borrar usuarios.
- Desde la terminal (si olvidaste la clave), con `MONGODB_URI` en tu `.env`:

```bash
npm run create-user -- jesus NuevaClave123 admin
```

Esto crea el usuario o le cambia la clave, y cierra sus sesiones abiertas.

## Respaldo

**Cuenta → Descargar respaldo** baja un JSON con todos los jugadores, borradores y juegos. También existe `GET /api/export`.

## Seguridad

- Contraseñas guardadas con bcrypt.
- Sesión en cookie `httpOnly`, `secure` en producción y `SameSite=Lax`; en la base solo se guarda el hash del token. Dura 30 días (`SESSION_DAYS`).
- Máximo 10 intentos de login cada 15 minutos por IP.
- Las peticiones que modifican datos exigen un encabezado propio de la app, lo que bloquea envíos desde otros sitios.
- Cabeceras de seguridad con Helmet (CSP estricta, sin iframes).
- Cambiar tu contraseña cierra la sesión en tus otros dispositivos.

## API

Todas bajo `/api`, requieren sesión salvo `login`. Las que modifican datos requieren el encabezado `X-Dogout: 1`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/login` | `{username, password}` |
| POST | `/api/logout` | Cierra la sesión |
| GET | `/api/me` | Usuario actual |
| POST | `/api/me/password` | `{current, next}` |
| GET/POST | `/api/users` | Listar / crear (solo admin) |
| DELETE | `/api/users/:username` | Borrar (solo admin) |
| GET | `/api/data` | Todo: `{players, lineups, games}` |
| PUT | `/api/:col/:id` | Guarda un documento (`players`, `lineups`, `games`) |
| DELETE | `/api/:col/:id` | Borra un documento |
| GET | `/api/export` | Respaldo JSON |
