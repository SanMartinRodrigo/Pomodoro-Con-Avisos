"""
Capa de base de datos (SQLite) para la app de Pomodoro / Anti-Pomodoro.
Un único archivo .db en /data persiste todo: metas, etiquetas, sesiones,
pausas, mensajes de chat de invitados y tiempo compartido.
"""
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "app.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def dict_factory(cursor, row):
    fields = [col[0] for col in cursor.description]
    return {k: v for k, v in zip(fields, row)}


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as db:
        # Etiquetas personalizables (nombre + color), compartidas por todo el sistema
        db.execute("""
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#3b82f6',
                created_at TEXT NOT NULL
            )
        """)

        # Metas: pueden ser de tipo 'pomodoro' o 'anti' (antipomodoro).
        # study_minutes / break_minutes solo aplican a pomodoro.
        db.execute("""
            CREATE TABLE IF NOT EXISTS goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                mode TEXT NOT NULL CHECK(mode IN ('pomodoro','anti')),
                study_minutes INTEGER DEFAULT 25,
                break_minutes INTEGER DEFAULT 5,
                long_break_minutes INTEGER DEFAULT 20,
                cycles_before_long_break INTEGER DEFAULT 4,
                next_step TEXT DEFAULT '',
                archived INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS goal_tags (
                goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (goal_id, tag_id)
            )
        """)

        # Sesiones de trabajo (tanto pomodoro como anti-pomodoro).
        # source: 'admin' o 'guest'
        db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
                mode TEXT NOT NULL CHECK(mode IN ('pomodoro','anti','guest')),
                source TEXT NOT NULL DEFAULT 'admin',
                guest_name TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                active_seconds INTEGER DEFAULT 0,
                paused_seconds INTEGER DEFAULT 0,
                pomodoros_completed INTEGER DEFAULT 0,
                counts_toward_total INTEGER DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'running'
                    CHECK(status IN ('running','paused','stopped'))
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS session_tags (
                session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (session_id, tag_id)
            )
        """)

        # Chat de invitados (solo texto, se borra manualmente)
        db.execute("""
            CREATE TABLE IF NOT EXISTS guest_chat (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                author TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        db.execute("CREATE INDEX IF NOT EXISTS idx_sessions_goal ON sessions(goal_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode)")

        # Etiquetas por defecto si no existen
        existing = db.execute("SELECT COUNT(*) as c FROM tags").fetchone()["c"]
        if existing == 0:
            defaults = [
                ("Estudio", "#3b82f6"),
                ("Laburo", "#f59e0b"),
                ("Compartido", "#a855f7"),
            ]
            now = datetime.now().isoformat()
            for name, color in defaults:
                db.execute(
                    "INSERT INTO tags (name, color, created_at) VALUES (?,?,?)",
                    (name, color, now),
                )


if __name__ == "__main__":
    init_db()
    print(f"Base de datos inicializada en {DB_PATH}")
