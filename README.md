# Porra 2026 — Actualizador automático

Actualiza los resultados del Mundial 2026 en Firebase automáticamente cada 10 minutos entre las 19:00 y las 09:00 hora española.

## Setup en GitHub

### 1. Crear el repositorio
- Ve a github.com → New repository
- Nombre: `porra-2026-updater`
- Privado ✓
- Sin README (ya lo tienes)

### 2. Subir los archivos
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TU_USUARIO/porra-2026-updater.git
git push -u origin main
```

### 3. Añadir los secretos
Ve a tu repositorio → Settings → Secrets and variables → Actions → New repository secret

**Secreto 1: `FD_API_KEY`**
```
c766e326042b4ff782907255d8ab5f7a
```

**Secreto 2: `FIREBASE_SERVICE_ACCOUNT`**
Pega el contenido completo del archivo JSON de Firebase (la clave de servicio).

### 4. Activar Actions
Ve a la pestaña **Actions** del repositorio → habilitar si pide permiso.

## Funcionamiento

- Se ejecuta cada 10 minutos entre las 17:00-07:00 UTC (19:00-09:00 hora española)
- Consulta football-data.org por partidos terminados hoy y ayer
- Actualiza Firebase solo si hay cambios
- Puedes lanzarlo manualmente desde Actions → Run workflow

## Logs

En la pestaña Actions puedes ver el historial de ejecuciones y los logs de cada una.
