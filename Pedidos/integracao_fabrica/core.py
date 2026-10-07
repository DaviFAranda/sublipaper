"""Regras iniciais de pedido, lote, visibilidade e apontamento.

Banco SQLite explícito para desenvolvimento/homologação. Nenhuma conexão aos
bancos operacionais é aberta por este módulo. A implantação usará PostgreSQL.
"""
from __future__ import annotations

import json
import hashlib
import hmac
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path


SECTORS = {
    "comercial", "estoque", "digital", "preparacao", "calandra",
    "corte", "costura", "revisao", "expedicao", "financeiro", "pcp", "gestao",
}
PRODUCTION = SECTORS - {"comercial", "financeiro", "pcp", "gestao"}
EVENT_ACTIONS = {"recebido", "iniciado", "produzido", "aprovado", "rejeitado", "liberado", "perda", "devolvido"}
DETAIL_FIELDS = {
    "estoque": {"roll_code", "reference", "note"},
    "digital": {"machine", "paper_batch", "reference", "note"},
    "preparacao": {"roll_code", "fabric_bundle", "reference", "note"},
    "calandra": {"paper_batch", "fabric_bundle", "destination", "note"},
    "corte": {"mold_ref", "pieces", "destination", "note"},
    "costura": {"model", "pieces", "destination", "note"},
    "revisao": {"reference", "destination", "note"},
    "expedicao": {"volume_ref", "recipient", "destination", "note"},
}
ORDER_FIELDS_BY_ROLE = {
    "comercial": {"client", "service", "fabric", "width_m", "unit", "unit_price", "delivery"},
    "estoque": {"client", "service", "fabric", "width_m", "unit", "delivery"},
    "digital": {"service", "fabric", "width_m", "unit", "delivery"},
    "preparacao": {"fabric", "width_m", "unit", "delivery"},
    "calandra": {"fabric", "width_m", "unit", "delivery"},
    "corte": {"service", "fabric", "unit", "delivery"},
    "costura": {"fabric", "unit", "delivery"},
    "revisao": {"service", "unit", "delivery"},
    "expedicao": {"client", "service", "unit", "delivery"},
    "financeiro": {"client", "service", "unit", "unit_price"},
    "pcp": {"client", "service", "fabric", "width_m", "unit", "delivery"},
    "gestao": {"client", "service", "fabric", "width_m", "unit", "unit_price", "delivery"},
}


def quantity(value: object) -> Decimal:
    try:
        result = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError):
        raise ValueError("Quantidade inválida") from None
    if not result.is_finite() or result <= 0 or result.as_tuple().exponent < -3:
        raise ValueError("Quantidade deve ser positiva e ter até três casas decimais")
    return result


def price_value(value: object) -> Decimal:
    try:
        result = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError):
        raise ValueError("Preço inválido") from None
    if not result.is_finite() or result < 0 or result.as_tuple().exponent < -3:
        raise ValueError("Preço inválido")
    return result


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Factory:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        if self.path.name == "pedidos.sqlite3" or self.path.name == "sistema_digital.db":
            raise ValueError("O núcleo não pode usar o banco de outro sistema")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connection(self, write: bool = False):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=10000")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if write:
                db.commit()
        except Exception:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    def initialize(self):
        with self.connection(write=True) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY, number TEXT UNIQUE NOT NULL,
                    request_key TEXT UNIQUE NOT NULL, client TEXT NOT NULL,
                    service TEXT NOT NULL, fabric TEXT NOT NULL,
                    width_m TEXT NOT NULL, unit TEXT NOT NULL,
                    unit_price TEXT, delivery TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'rascunho',
                    revision INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS items (
                    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
                    art TEXT NOT NULL, planned TEXT NOT NULL,
                    original_path TEXT NOT NULL DEFAULT '',
                    asset_id TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS ops (
                    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
                    item_id TEXT NOT NULL REFERENCES items(id),
                    number TEXT NOT NULL UNIQUE, planned TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'aguardando',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, operation_key TEXT UNIQUE NOT NULL,
                    op_id TEXT NOT NULL REFERENCES ops(id), sector TEXT NOT NULL,
                    action TEXT NOT NULL, amount TEXT, unit TEXT NOT NULL,
                    actor TEXT NOT NULL, occurred_at TEXT NOT NULL,
                    details TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
                    role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    expires_at TEXT NOT NULL,
                    revoked_at TEXT
                );
                CREATE TABLE IF NOT EXISTS login_failures (
                    username TEXT PRIMARY KEY, failures INTEGER NOT NULL,
                    locked_until TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_items_order ON items(order_id);
                CREATE INDEX IF NOT EXISTS idx_ops_order ON ops(order_id);
                CREATE INDEX IF NOT EXISTS idx_events_op ON events(op_id,sector,action);
            """)

    def create_user(self, username: str, password: str, role: str,
                    actor_role: str | None = None) -> dict:
        username = username.strip()
        if not username or len(username) > 80 or not isinstance(password, str) or not password or role not in SECTORS:
            raise ValueError("Usuário, senha ou perfil inválido")
        with self.connection(write=True) as db:
            count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if count and actor_role != "gestao":
                raise PermissionError("Somente Gestão cria usuários")
            if not count and role != "gestao":
                raise ValueError("O primeiro usuário deve ser Gestão")
            salt = secrets.token_bytes(16)
            digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
            user_id = uuid.uuid4().hex
            db.execute("INSERT INTO users(id,username,password_salt,password_hash,role,created_at) VALUES(?,?,?,?,?,?)",
                       (user_id, username, salt.hex(), digest.hex(), role, now()))
            return {"id": user_id, "username": username, "role": role}

    def list_users(self, actor_role: str) -> list[dict]:
        if actor_role != "gestao":
            raise PermissionError("Somente Gestão consulta usuários")
        with self.connection() as db:
            return [dict(row) for row in db.execute(
                "SELECT id,username,role,active,created_at FROM users ORDER BY username")]

    def change_user(self, user_id: str, actor_role: str, *, active: bool | None = None,
                    password: str | None = None, actor_id: str | None = None) -> None:
        if actor_role != "gestao":
            raise PermissionError("Somente Gestão altera usuários")
        if active is None and password is None:
            raise ValueError("Nenhuma alteração solicitada")
        if password is not None and (not isinstance(password, str) or not password):
            raise ValueError("Senha não pode ficar vazia")
        if active is False and user_id == actor_id:
            raise ValueError("Não é possível desativar a própria conta")
        with self.connection(write=True) as db:
            if not db.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
                raise KeyError("Usuário não encontrado")
            if active is not None:
                db.execute("UPDATE users SET active=? WHERE id=?", (int(active), user_id))
            if password is not None:
                salt = secrets.token_bytes(16)
                digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
                db.execute("UPDATE users SET password_salt=?,password_hash=? WHERE id=?",
                           (salt.hex(), digest.hex(), user_id))
            db.execute("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", (now(), user_id))

    def login(self, username: str, password: str) -> str:
        username = username.strip()
        failure_message = "Credenciais inválidas"
        with self.connection(write=True) as db:
            failure = db.execute("SELECT failures,locked_until FROM login_failures WHERE username=?", (username,)).fetchone()
            if failure and failure["locked_until"] and datetime.fromisoformat(failure["locked_until"]) > datetime.now(timezone.utc):
                failure_message = "Aguarde dois minutos antes de tentar novamente"
            else:
                user = db.execute("SELECT * FROM users WHERE username=? AND active=1", (username,)).fetchone()
                salt = bytes.fromhex(user["password_salt"]) if user else bytes(16)
                expected = bytes.fromhex(user["password_hash"]) if user else bytes(32)
                actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
                if not user or user["role"] not in SECTORS or not hmac.compare_digest(expected, actual):
                    count = int(failure["failures"]) + 1 if failure else 1
                    locked = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(timespec="seconds") if count >= 5 else None
                    db.execute("""INSERT INTO login_failures(username,failures,locked_until) VALUES(?,?,?)
                                  ON CONFLICT(username) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until""",
                               (username, count, locked))
                else:
                    db.execute("DELETE FROM login_failures WHERE username=?", (username,))
                    token = secrets.token_urlsafe(32)
                    digest = hashlib.sha256(token.encode()).hexdigest()
                    expires_at = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(timespec="seconds")
                    db.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (digest, user["id"], expires_at))
                    return token
        raise PermissionError(failure_message)

    def authenticated_user(self, token: str) -> dict:
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.connection() as db:
            row = db.execute("""SELECT u.id,u.username,u.role,s.expires_at
                                FROM sessions s JOIN users u ON u.id=s.user_id
                                WHERE s.token_hash=? AND s.revoked_at IS NULL AND u.active=1""", (digest,)).fetchone()
            if not row or row["role"] not in SECTORS or datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
                raise PermissionError("Sessão inválida")
            return {"id": row["id"], "username": row["username"], "role": row["role"]}

    def logout(self, token: str) -> None:
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.connection(write=True) as db:
            db.execute("UPDATE sessions SET revoked_at=? WHERE token_hash=?", (now(), digest))

    def create_order(self, payload: dict, actor_role: str) -> dict:
        if actor_role != "comercial":
            raise PermissionError("Somente Comercial cadastra pedidos")
        request_key = str(payload.get("request_key") or "").strip()
        client = str(payload.get("client") or "").strip()
        service = str(payload.get("service") or "").strip()
        fabric = str(payload.get("fabric") or "").strip()
        delivery = str(payload.get("delivery") or "").strip()
        unit = str(payload.get("unit") or "").strip()
        width = quantity(payload.get("width_m"))
        if not request_key or not client or not service or not fabric or not delivery or unit not in {"m", "kg", "pc"}:
            raise ValueError("Dados gerais incompletos")
        raw_items = payload.get("items")
        if not isinstance(raw_items, list) or not raw_items:
            raise ValueError("Pedido precisa de arte")
        items = []
        for item in raw_items:
            art = str(item.get("art") or "").strip()
            if not art:
                raise ValueError("Nome da arte obrigatório")
            items.append((art, str(quantity(item.get("quantity"))), str(item.get("original_path") or ""), str(item.get("asset_id") or "")))
        raw_price = payload.get("unit_price")
        price = None if raw_price in (None, "") else str(price_value(raw_price))
        with self.connection(write=True) as db:
            previous = db.execute("SELECT id FROM orders WHERE request_key=?", (request_key,)).fetchone()
            if previous:
                return self.order(previous["id"], actor_role, db)
            row = db.execute("SELECT MAX(CAST(SUBSTR(number,6) AS INTEGER)) n FROM orders WHERE number GLOB 'SP-D-[0-9]*'").fetchone()
            number = f"SP-D-{int(row['n'] or 0)+1:06d}"
            order_id = uuid.uuid4().hex
            db.execute("INSERT INTO orders(id,number,request_key,client,service,fabric,width_m,unit,unit_price,delivery,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       (order_id, number, request_key, client, service, fabric, str(width), unit, price, delivery, now()))
            for art, planned, original_path, asset_id in items:
                db.execute("INSERT INTO items(id,order_id,art,planned,original_path,asset_id) VALUES(?,?,?,?,?,?)",
                           (uuid.uuid4().hex, order_id, art, planned, original_path, asset_id))
            return self.order(order_id, actor_role, db)

    def order(self, order_id: str, role: str, db=None) -> dict:
        if role not in SECTORS:
            raise PermissionError("Perfil inválido")
        if db is None:
            with self.connection() as conn:
                return self.order(order_id, role, conn)
        row = db.execute("SELECT * FROM orders WHERE id=? OR number=?", (order_id, order_id)).fetchone()
        if not row:
            raise KeyError("Pedido não encontrado")
        order = dict(row)
        order.pop("request_key")
        fields = {"id", "number", "status", "revision", "created_at"} | ORDER_FIELDS_BY_ROLE[role]
        order = {key: value for key, value in order.items() if key in fields}
        items = [dict(r) for r in db.execute("SELECT * FROM items WHERE order_id=? ORDER BY rowid", (row["id"],))]
        for item in items:
            item.pop("order_id")
            if role != "digital":
                item.pop("original_path")
            if role in {"financeiro", "expedicao", "estoque", "preparacao", "pcp"}:
                item.pop("asset_id")
        order["items"] = items
        return order

    def orders(self, role: str) -> list[dict]:
        if role not in SECTORS:
            raise PermissionError("Perfil inválido")
        with self.connection() as db:
            ids = [row["id"] for row in db.execute("SELECT id FROM orders ORDER BY created_at DESC,number DESC LIMIT 200")]
            return [self.order(order_id, role, db) for order_id in ids]

    def ops_for_order(self, order_id: str, role: str) -> list[dict]:
        if role not in SECTORS:
            raise PermissionError("Perfil inválido")
        with self.connection() as db:
            actual_id = self.order(order_id, role, db)["id"]
            return [dict(row) for row in db.execute("""
                SELECT p.id,p.number,p.item_id,i.art,p.planned,o.unit,p.status,p.created_at
                FROM ops p JOIN items i ON i.id=p.item_id
                JOIN orders o ON o.id=p.order_id
                WHERE p.order_id=? ORDER BY p.number
            """, (actual_id,))]

    def release_order(self, order_id: str, role: str) -> None:
        if role != "pcp":
            raise PermissionError("Somente PCP libera o pedido")
        with self.connection(write=True) as db:
            changed = db.execute("UPDATE orders SET status='liberado' WHERE id=? AND status='rascunho'", (order_id,)).rowcount
            if changed != 1:
                raise ValueError("Pedido não está em rascunho")

    def create_op(self, item_id: str, amount: object, role: str) -> dict:
        if role != "pcp":
            raise PermissionError("Somente PCP cria OP")
        planned = quantity(amount)
        with self.connection(write=True) as db:
            item = db.execute("SELECT i.*,o.number,o.status FROM items i JOIN orders o ON o.id=i.order_id WHERE i.id=?", (item_id,)).fetchone()
            if not item or item["status"] != "liberado":
                raise ValueError("Arte de pedido liberado não encontrada")
            ops = list(db.execute("SELECT planned FROM ops WHERE item_id=?", (item_id,)))
            if sum((Decimal(r["planned"]) for r in ops), Decimal(0)) + planned > Decimal(item["planned"]):
                raise ValueError("OPs excedem a quantidade da arte")
            sequence = len(ops) + 1
            op_id = uuid.uuid4().hex
            item_sequence = db.execute("SELECT COUNT(*) n FROM items WHERE order_id=? AND rowid<= (SELECT rowid FROM items WHERE id=?)", (item["order_id"], item_id)).fetchone()["n"]
            number = f"{item['number']}-{item_sequence:02d}-{sequence:02d}"
            db.execute("INSERT INTO ops(id,order_id,item_id,number,planned,created_at) VALUES(?,?,?,?,?,?)",
                       (op_id, item["order_id"], item_id, number, str(planned), now()))
            return {"id": op_id, "number": number, "item_id": item_id, "planned": str(planned)}

    def record_event(self, *, op_id: str, sector: str, action: str, amount: object,
                     actor: str, operation_key: str, details: dict | None = None, role: str) -> dict:
        if role != sector or sector not in PRODUCTION:
            raise PermissionError("Setor não autorizado")
        if action not in EVENT_ACTIONS or not actor.strip() or not operation_key.strip():
            raise ValueError("Apontamento incompleto")
        details = details or {}
        if not isinstance(details, dict) or set(details) - DETAIL_FIELDS[sector]:
            raise ValueError("Campos de apontamento não permitidos para este setor")
        value = quantity(amount)
        with self.connection(write=True) as db:
            previous = db.execute("SELECT * FROM events WHERE operation_key=?", (operation_key,)).fetchone()
            if previous:
                if (previous["op_id"] != op_id or previous["sector"] != sector or
                    previous["action"] != action or Decimal(previous["amount"]) != value or
                    previous["actor"] != actor.strip() or json.loads(previous["details"]) != details):
                    raise ValueError("Chave de operação reutilizada com conteúdo diferente")
                return dict(previous)
            op = db.execute("SELECT p.id,p.planned,o.unit FROM ops p JOIN orders o ON o.id=p.order_id WHERE p.id=?", (op_id,)).fetchone()
            if not op:
                raise ValueError("OP não encontrada")
            if action in {"produzido", "aprovado", "liberado"}:
                existing = list(db.execute("SELECT amount FROM events WHERE op_id=? AND sector=? AND action=?", (op_id, sector, action)))
                total = sum((Decimal(r["amount"]) for r in existing), Decimal(0)) + value
                if total > Decimal(op["planned"]):
                    raise ValueError("Quantidade acima do planejado para a OP")
            event_id = uuid.uuid4().hex
            timestamp = now()
            db.execute("INSERT INTO events(id,operation_key,op_id,sector,action,amount,unit,actor,occurred_at,details) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       (event_id, operation_key, op_id, sector, action, str(value), op["unit"], actor.strip(), timestamp, json.dumps(details, ensure_ascii=False)))
            return dict(db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone())

    def events(self, op_id: str, role: str) -> list[dict]:
        if role not in SECTORS:
            raise PermissionError("Perfil inválido")
        with self.connection() as db:
            if role in {"pcp", "gestao"}:
                query = "SELECT * FROM events WHERE op_id=? ORDER BY occurred_at,id"
                args = (op_id,)
            else:
                query = "SELECT * FROM events WHERE op_id=? AND sector=? ORDER BY occurred_at,id"
                args = (op_id, role)
            return [dict(row) for row in db.execute(query, args)]
