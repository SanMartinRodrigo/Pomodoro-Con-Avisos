# Pomodoro / Anti-Pomodoro

**Aplicación web de gestión del tiempo para estudio y trabajo**, con dos formas de registrar la concentración: un temporizador Pomodoro configurable y un cronómetro libre que distingue actividad y pausas.

> **Estado:** proyecto personal funcional para ejecución local. No está preparado para desplegarse públicamente sin incorporar autenticación y autorización en el backend.

## ¿Qué permite hacer?

- **Pomodoro:** configurar duración de estudio, descansos y ciclos por objetivo.
- **Anti-Pomodoro:** registrar tiempo real dedicado a una meta, diferenciando tiempo activo y pausas.
- **Objetivos y etiquetas:** organizar sesiones y registrar próximos pasos.
- **Análisis:** consultar tiempo acumulado por objetivo/etiqueta y pomodoros completados.
- **Sesiones compartidas:** trabajar con invitados y utilizar chat en tiempo real mediante WebSocket.
- **Recordatorios:** recibir avisos de hidratación, postura y pausas activas.
- **Preferencias:** alternar tema claro y oscuro.

## Tecnologías

**Backend:** Python, FastAPI, SQLite y WebSockets.  
**Frontend:** HTML, CSS y JavaScript sin framework.

## Ejecutar localmente

Requisitos: Python 3 y pip.

### Windows (PowerShell)

Desde la carpeta raíz del proyecto:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd backend
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### Linux / macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./run.sh
```

Abrí `http://localhost:8000` en el navegador. La base de datos SQLite se crea localmente en `data/`.

## Estructura

```text
backend/          API y persistencia en SQLite
frontend/         Interfaz y lógica del navegador
data/             Base de datos local (excluida de Git)
docs/screenshots/ Capturas para el portfolio
requirements.txt  Dependencias del backend
run.sh            Inicio local en Linux/macOS
```

## Limitaciones y seguridad

Este repositorio es una **demostración de desarrollo**, no una aplicación segura para alojar en Internet en su estado actual. El ingreso de administrador usa una contraseña fija en el código y las rutas de modificación no verifican una sesión autenticada: la distinción entre administrador e invitado en la interfaz **no protege la API**. También debe revisarse la política CORS y el acceso al chat antes de un despliegue público. Ejecutar exclusivamente en una máquina de confianza mediante `127.0.0.1`.


## Chat enriquecido (versión portfolio)

- Texto en **negrita**, *cursiva*, ~~tachado~~ y `código`, mediante botones o Markdown.
- Enlaces con texto legible usando `[nombre](https://ejemplo.com)`.
- Imágenes PNG/JPG/WebP y GIF subidas desde el chat (máximo 5 MB). Se guardan en `uploads/`, que debe mantenerse fuera de Git.
- Selector de GIFs predefinidos (requiere acceso a GIPHY en Internet) y stickers emoji.
- Tecla **Enter** envía; **Shift + Enter** agrega una nueva línea.

**Nota de seguridad:** el acceso de administrador existente usa una contraseña fija y no hay autenticación segura en WebSocket, carga de imágenes o borrado del chat. Esta versión está destinada a uso local/en red de confianza, no a Internet pública. El sistema permite contenido compartido por todos los invitados: evitá subir datos sensibles.
