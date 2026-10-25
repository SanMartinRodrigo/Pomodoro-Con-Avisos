"""
App de Pomodoro / Anti-Pomodoro con modo invitados.
Backend FastAPI + SQLite. Sirve también el frontend estático.
"""
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import get_db, init_db

app = FastAPI(title="Pomodoro / Anti-Pomodoro Local")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_PASSWORD = "1122"

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class LoginAdmin(BaseModel):
    password: str


class LoginGuest(BaseModel):
    name: str


class TagCreate(BaseModel):
    name: str
    color: str = "#3b82f6"


class GoalCreate(BaseModel):
    title: str
    mode: str  # 'pomodoro' | 'anti'
    study_minutes: int = 25
    break_minutes: int = 5
    long_break_minutes: int = 20
    cycles_before_long_break: int = 4
    next_step: str = ""
    tag_ids: List[int] = []


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    study_minutes: Optional[int] = None
    break_minutes: Optional[int] = None
    long_break_minutes: Optional[int] = None
    cycles_before_long_break: Optional[int] = None
    next_step: Optional[str] = None
    archived: Optional[bool] = None
    tag_ids: Optional[List[int]] = None


class SessionStart(BaseModel):
    goal_id: Optional[int] = None
    mode: str  # 'pomodoro' | 'anti' | 'guest'
    source: str = "admin"  # 'admin' | 'guest'
    guest_name: Optional[str] = None
    counts_toward_total: bool = True
    tag_ids: List[int] = []


class SessionUpdate(BaseModel):
    active_seconds: Optional[int] = None
    paused_seconds: Optional[int] = None
    pomodoros_completed: Optional[int] = None
    status: Optional[str] = None  # running | paused | stopped
    counts_toward_total: Optional[bool] = None


class ChatMessage(BaseModel):
    author: str
    message: str


# ---------------------------------------------------------------------------
# Auth (simple, local-only: no hay nada crítico que proteger más allá de
# separar vista admin de vista invitado en un uso casero de un solo usuario)
# ---------------------------------------------------------------------------
@app.post("/api/login/admin")
def login_admin(payload: LoginAdmin):
    if payload.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Clave incorrecta")
    return {"ok": True, "role": "admin"}


@app.post("/api/login/guest")
def login_guest(payload: LoginGuest):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nombre requerido")
    return {"ok": True, "role": "guest", "name": name}


# ---------------------------------------------------------------------------
# Etiquetas
# ---------------------------------------------------------------------------
@app.get("/api/tags")
def list_tags():
    with get_db() as db:
        return db.execute("SELECT * FROM tags ORDER BY name").fetchall()


@app.post("/api/tags")
def create_tag(payload: TagCreate):
    with get_db() as db:
        try:
            cur = db.execute(
                "INSERT INTO tags (name, color, created_at) VALUES (?,?,?)",
                (payload.name.strip(), payload.color, datetime.now().isoformat()),
            )
        except Exception:
            raise HTTPException(status_code=400, detail="La etiqueta ya existe")
        return db.execute("SELECT * FROM tags WHERE id=?", (cur.lastrowid,)).fetchone()


@app.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: int):
    with get_db() as db:
        db.execute("DELETE FROM tags WHERE id=?", (tag_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Metas
# ---------------------------------------------------------------------------
def _attach_tags(db, goal_id, tag_ids):
    db.execute("DELETE FROM goal_tags WHERE goal_id=?", (goal_id,))
    for tid in tag_ids:
        db.execute(
            "INSERT OR IGNORE INTO goal_tags (goal_id, tag_id) VALUES (?,?)",
            (goal_id, tid),
        )


def _goal_with_tags(db, goal_id):
    goal = db.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
    if not goal:
        return None
    tags = db.execute(
        """SELECT t.* FROM tags t
           JOIN goal_tags gt ON gt.tag_id = t.id
           WHERE gt.goal_id = ?""",
        (goal_id,),
    ).fetchall()
    goal["tags"] = tags
    return goal


@app.get("/api/goals")
def list_goals(mode: Optional[str] = None, archived: int = 0):
    with get_db() as db:
        q = "SELECT * FROM goals WHERE archived = ?"
        params = [archived]
        if mode:
            q += " AND mode = ?"
            params.append(mode)
        q += " ORDER BY created_at DESC"
        goals = db.execute(q, params).fetchall()
        return [_goal_with_tags(db, g["id"]) for g in goals]


@app.post("/api/goals")
def create_goal(payload: GoalCreate):
    if payload.mode not in ("pomodoro", "anti"):
        raise HTTPException(status_code=400, detail="mode inválido")
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO goals
               (title, mode, study_minutes, break_minutes, long_break_minutes,
                cycles_before_long_break, next_step, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                payload.title.strip(),
                payload.mode,
                payload.study_minutes,
                payload.break_minutes,
                payload.long_break_minutes,
                payload.cycles_before_long_break,
                payload.next_step,
                datetime.now().isoformat(),
            ),
        )
        goal_id = cur.lastrowid
        _attach_tags(db, goal_id, payload.tag_ids)
        return _goal_with_tags(db, goal_id)


@app.patch("/api/goals/{goal_id}")
def update_goal(goal_id: int, payload: GoalUpdate):
    with get_db() as db:
        goal = db.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
        if not goal:
            raise HTTPException(status_code=404, detail="Meta no encontrada")

        fields = []
        values = []
        data = payload.dict(exclude_unset=True, exclude={"tag_ids"})
        for key, val in data.items():
            if key == "archived":
                val = 1 if val else 0
            fields.append(f"{key} = ?")
            values.append(val)
        if fields:
            values.append(goal_id)
            db.execute(f"UPDATE goals SET {', '.join(fields)} WHERE id = ?", values)

        if payload.tag_ids is not None:
            _attach_tags(db, goal_id, payload.tag_ids)

        return _goal_with_tags(db, goal_id)


@app.delete("/api/goals/{goal_id}")
def delete_goal(goal_id: int):
    with get_db() as db:
        db.execute("DELETE FROM goals WHERE id=?", (goal_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sesiones (Pomodoro / Anti-Pomodoro / Invitados)
# ---------------------------------------------------------------------------
def _attach_session_tags(db, session_id, tag_ids):
    for tid in tag_ids:
        db.execute(
            "INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?,?)",
            (session_id, tid),
        )


def _session_with_tags(db, session_id):
    s = db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not s:
        return None
    tags = db.execute(
        """SELECT t.* FROM tags t
           JOIN session_tags st ON st.tag_id = t.id
           WHERE st.session_id = ?""",
        (session_id,),
    ).fetchall()
    s["tags"] = tags
    return s


@app.post("/api/sessions")
def start_session(payload: SessionStart):
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO sessions
               (goal_id, mode, source, guest_name, started_at,
                counts_toward_total, status)
               VALUES (?,?,?,?,?,?,'running')""",
            (
                payload.goal_id,
                payload.mode,
                payload.source,
                payload.guest_name,
                datetime.now().isoformat(),
                1 if payload.counts_toward_total else 0,
            ),
        )
        session_id = cur.lastrowid
        _attach_session_tags(db, session_id, payload.tag_ids)
        return _session_with_tags(db, session_id)


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: int, payload: SessionUpdate):
    with get_db() as db:
        s = db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not s:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")

        fields = []
        values = []
        data = payload.dict(exclude_unset=True)
        for key, val in data.items():
            if key == "counts_toward_total":
                val = 1 if val else 0
            fields.append(f"{key} = ?")
            values.append(val)

        if payload.status == "stopped":
            fields.append("ended_at = ?")
            values.append(datetime.now().isoformat())

        if fields:
            values.append(session_id)
            db.execute(f"UPDATE sessions SET {', '.join(fields)} WHERE id = ?", values)

        return _session_with_tags(db, session_id)


@app.get("/api/sessions/active")
def get_active_session(source: str = "admin"):
    """Devuelve la sesión activa (running o paused) para retomar tras un refresh."""
    with get_db() as db:
        s = db.execute(
            """SELECT * FROM sessions
               WHERE source = ? AND status IN ('running','paused')
               ORDER BY started_at DESC LIMIT 1""",
            (source,),
        ).fetchone()
        if not s:
            return None
        return _session_with_tags(db, s["id"])


@app.get("/api/sessions")
def list_sessions(goal_id: Optional[int] = None, mode: Optional[str] = None, limit: int = 200):
    with get_db() as db:
        q = "SELECT * FROM sessions WHERE 1=1"
        params = []
        if goal_id:
            q += " AND goal_id = ?"
            params.append(goal_id)
        if mode:
            q += " AND mode = ?"
            params.append(mode)
        q += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        sessions = db.execute(q, params).fetchall()
        return [_session_with_tags(db, s["id"]) for s in sessions]


# ---------------------------------------------------------------------------
# Análisis de datos
# ---------------------------------------------------------------------------
@app.get("/api/analytics/by-tag")
def analytics_by_tag():
    """
    Tiempo total por etiqueta + última vez que se sumó tiempo a esa etiqueta
    y en qué meta, para saber hace cuánto no se toca cada tema.
    """
    with get_db() as db:
        tags = db.execute("SELECT * FROM tags ORDER BY name").fetchall()
        result = []
        for tag in tags:
            rows = db.execute(
                """SELECT s.active_seconds, s.ended_at, s.started_at, s.goal_id,
                          s.counts_toward_total, g.title as goal_title
                   FROM sessions s
                   JOIN session_tags st ON st.session_id = s.id
                   LEFT JOIN goals g ON g.id = s.goal_id
                   WHERE st.tag_id = ? AND s.counts_toward_total = 1
                   ORDER BY COALESCE(s.ended_at, s.started_at) DESC""",
                (tag["id"],),
            ).fetchall()

            total_seconds = sum(r["active_seconds"] or 0 for r in rows)
            last = rows[0] if rows else None

            result.append({
                "tag": tag,
                "total_seconds": total_seconds,
                "last_activity_at": (last["ended_at"] or last["started_at"]) if last else None,
                "last_goal_title": last["goal_title"] if last else None,
                "session_count": len(rows),
            })
        return result


@app.get("/api/analytics/by-goal")
def analytics_by_goal():
    with get_db() as db:
        goals = db.execute("SELECT * FROM goals ORDER BY title").fetchall()
        result = []
        for goal in goals:
            rows = db.execute(
                """SELECT active_seconds, pomodoros_completed, ended_at, started_at
                   FROM sessions
                   WHERE goal_id = ? AND counts_toward_total = 1
                   ORDER BY started_at DESC""",
                (goal["id"],),
            ).fetchall()
            total_seconds = sum(r["active_seconds"] or 0 for r in rows)
            total_pomodoros = sum(r["pomodoros_completed"] or 0 for r in rows)
            last = rows[0] if rows else None
            result.append({
                "goal": _goal_with_tags(db, goal["id"]),
                "total_seconds": total_seconds,
                "total_pomodoros": total_pomodoros,
                "last_activity_at": (last["ended_at"] or last["started_at"]) if last else None,
            })
        return result


# ---------------------------------------------------------------------------
# Chat de invitados (REST para historial + WebSocket para tiempo real)
# ---------------------------------------------------------------------------
class ChatManager:
    def __init__(self):
        self.connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for conn in self.connections:
            try:
                await conn.send_json(data)
            except Exception:
                dead.append(conn)
        for d in dead:
            self.disconnect(d)


chat_manager = ChatManager()


@app.get("/api/chat")
def get_chat_history():
    with get_db() as db:
        return db.execute("SELECT * FROM guest_chat ORDER BY created_at ASC").fetchall()


@app.delete("/api/chat")
def clear_chat():
    with get_db() as db:
        db.execute("DELETE FROM guest_chat")
    return {"ok": True}


@app.websocket("/ws/chat")
async def chat_ws(websocket: WebSocket):
    await chat_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            if action == "message":
                author = str(data.get("author", "Anónimo")).strip()[:50]
                message = str(data.get("message", "")).strip()[:2000]
                if not message:
                    continue
                now = datetime.now().isoformat()
                with get_db() as db:
                    cur = db.execute(
                        "INSERT INTO guest_chat (author, message, created_at) VALUES (?,?,?)",
                        (author, message, now),
                    )
                    msg_id = cur.lastrowid
                await chat_manager.broadcast({
                    "type": "message",
                    "id": msg_id,
                    "author": author,
                    "message": message,
                    "created_at": now,
                })

            elif action == "clear":
                with get_db() as db:
                    db.execute("DELETE FROM guest_chat")
                await chat_manager.broadcast({"type": "cleared"})

    except WebSocketDisconnect:
        chat_manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# Recordatorios de salud: umbrales basados en literatura de ergonomía
# (regla 20-20-20 para fatiga visual, guías de pausas activas laborales,
# recomendaciones de hidratación e higiene postural en trabajo sedentario)
# ---------------------------------------------------------------------------
@app.get("/api/health-thresholds")
def health_thresholds():
    return {
        "active_break_minutes": 55,   # pausa activa / levantarse cada ~50-60 min
        "hydration_minutes": 75,      # tomar agua cada ~60-90 min
        "posture_minutes": 27,        # chequeo postural cada ~25-30 min
        "eye_rest_minutes": 20,       # regla 20-20-20: cada 20 min mirar 20s a 20 pies
        "exercises": [
            "Rotá los hombros hacia atrás 10 veces, despacio.",
            "Estirá el cuello: oreja al hombro, 15s de cada lado.",
            "Parate y caminá 2 minutos, aunque sea en el lugar.",
            "Estirá los brazos por encima de la cabeza y respirá hondo 5 veces.",
            "Rotá las muñecas y abrí/cerrá los dedos 10 veces.",
            "Ponete de pie y hacé 10 sentadillas suaves.",
            "Mirá un punto lejano (ventana) 20 segundos para descansar la vista.",
            "Enderezá la espalda, hombros relajados, pies apoyados en el piso.",
        ],
    }


# ---------------------------------------------------------------------------
# Servir el frontend
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
def serve_index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.on_event("startup")
def on_startup():
    init_db()
