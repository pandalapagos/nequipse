# Desplegar en Azure App Service (Linux + Node 24)

## GitHub Actions (proveedor de compilación)

Si en Azure tienes **Proveedor de compilación: Acciones de GitHub**, necesitas el workflow
`.github/workflows/azure-webapp.yml` en el repo **y** el secreto de publicación.

### Paso 1 — Perfil de publicación

1. Azure Portal → tu **App Service**
2. **Obtener perfil de publicación** (descarga un `.PublishSettings`)
3. Abre el archivo con un editor y **copia todo el XML**

### Paso 2 — Secreto en GitHub

1. GitHub → repo `nequipse` → **Settings → Secrets and variables → Actions**
2. **New repository secret**
3. Nombre: `AZURE_WEBAPP_PUBLISH_PROFILE`
4. Valor: pega el XML completo del perfil

### Paso 3 — Nombre de la app en el workflow

En `.github/workflows/azure-webapp.yml` cambia:

```yaml
AZURE_WEBAPP_NAME: nequipse
```

por el nombre **exacto** de tu App Service (ej. `mi-app-nequipse`).

### Paso 4 — Push a main

Cada push a `main` ejecuta el workflow y sube el código a `/home/site/wwwroot`.

En GitHub → **Actions** debe verse en verde **Deploy Node.js to Azure**.

---

## Si ves "Application Error"

Casi siempre es una de estas 3 causas:

### 1. No se instalaron dependencias (`node_modules` vacío)

En **Configuración → Variables de aplicación** agrega:

| Variable | Valor |
|----------|--------|
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |

Luego **vuelve a desplegar** (Redeploy). Azure debe ejecutar `npm install` al subir el código.

### 2. Comando de inicio incorrecto

En **Configuración → Configuración general → Comando de inicio** usa **una** de estas opciones:

```
npm start
```

o:

```
bash startup.sh
```

**No uses** `node cluster.js` (rompe Telegram con error 409).

### 3. Ver el error real en logs

1. Azure Portal → tu App Service  
2. **Supervisión → Secuencia de registro (Log stream)**  
3. O **Diagnose and solve problems → Application Logs**

Busca líneas como:
- `Cannot find module 'express'` → falta `npm install`
- `EADDRINUSE` → puerto mal configurado (no definas PORT manualmente)
- `Telegram 409` → dos instancias con el mismo bot

---

## Variables obligatorias

| Variable | Ejemplo |
|----------|---------|
| `NODE_ENV` | `production` |
| `TELEGRAM_BOT_TOKEN` | token del bot |
| `TELEGRAM_CHAT_ID` | `-100xxxxxxxx` |
| `TRUST_PROXY` | `1` |

**No** configures `PORT` — Azure lo asigna automáticamente (8080).

---

## Configuración general (Azure Portal)

| Opción | Valor |
|--------|--------|
| Pila | Node 24 LTS |
| Comando de inicio | `npm start` o `bash startup.sh` |
| Web sockets | **Activado** |
| Always On | **Activado** (plan B1+) |
| Instancias | **1** (mismo bot Telegram) |

---

## Health check

Tras deploy correcto:

```
https://TU-APP.azurewebsites.net/health
```

Debe responder: `OK`

---

## Solo Caja Social (`Caja-Social-nuevo`)

Si despliegas esa carpeta como proyecto aparte:

- **Directorio raíz** del servicio: `Caja-Social-nuevo`
- Start: `npm start`
- Mismas variables Telegram + `TRUST_PROXY=1`
