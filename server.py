import csv
import io
import json
import sqlite3
from cgi import FieldStorage
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "expense.db"
HOST = "0.0.0.0"
PORT = 4173
ALLOWED_TABLES = {"users", "budgets", "expenses"}


def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with db_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS budgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                category_name TEXT NOT NULL,
                monthly_budget REAL NOT NULL CHECK(monthly_budget >= 0),
                UNIQUE(user_id, category_name),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                budget_id INTEGER NOT NULL,
                amount REAL NOT NULL CHECK(amount > 0),
                expense_date TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(budget_id) REFERENCES budgets(id) ON DELETE CASCADE
            )
            """
        )
        conn.executemany("INSERT OR IGNORE INTO users(name) VALUES (?)", [("Dev",), ("Devi",)])


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/users":
            return self.api_users()

        if path.startswith("/api/users/"):
            return self.api_user_get(path, parse_qs(parsed.query))

        if path.startswith("/api/export/") and path.endswith(".csv"):
            table = path.split("/")[-1].replace(".csv", "")
            return self.api_export_csv(table)

        return self.serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/users/"):
            return self.api_user_post(path)

        if path.startswith("/api/import/"):
            table = path.split("/")[-1]
            return self.api_import_csv(table)

        self.send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/users/"):
            return self.api_user_delete(path)
        self.send_json({"error": "Not found"}, 404)

    def api_users(self):
        with db_conn() as conn:
            rows = conn.execute("SELECT id, name FROM users ORDER BY id").fetchall()
            self.send_json([dict(r) for r in rows])

    def api_user_get(self, path, query):
        parts = [p for p in path.split("/") if p]
        if len(parts) < 4:
            return self.send_json({"error": "Not found"}, 404)

        user_id = parts[2]
        section = parts[3]

        with db_conn() as conn:
            if section == "budgets":
                rows = conn.execute(
                    """
                    SELECT id, category_name AS name, monthly_budget AS budget
                    FROM budgets WHERE user_id = ? ORDER BY id DESC
                    """,
                    (user_id,),
                ).fetchall()
                return self.send_json([dict(r) for r in rows])

            if section == "expenses":
                month = query.get("month", [None])[0]
                if month:
                    rows = conn.execute(
                        """
                        SELECT e.id, e.budget_id AS budgetId, e.amount,
                               e.expense_date AS date, b.category_name AS categoryName
                        FROM expenses e
                        JOIN budgets b ON b.id = e.budget_id
                        WHERE e.user_id = ? AND substr(e.expense_date, 1, 7) = ?
                        ORDER BY e.expense_date DESC, e.id DESC
                        """,
                        (user_id, month),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """
                        SELECT e.id, e.budget_id AS budgetId, e.amount,
                               e.expense_date AS date, b.category_name AS categoryName
                        FROM expenses e
                        JOIN budgets b ON b.id = e.budget_id
                        WHERE e.user_id = ?
                        ORDER BY e.expense_date DESC, e.id DESC
                        """,
                        (user_id,),
                    ).fetchall()
                return self.send_json([dict(r) for r in rows])

        return self.send_json({"error": "Not found"}, 404)

    def api_user_post(self, path):
        parts = [p for p in path.split("/") if p]
        if len(parts) < 4:
            return self.send_json({"error": "Not found"}, 404)

        user_id = parts[2]
        section = parts[3]
        payload = self.read_json()
        if payload is None:
            return self.send_json({"error": "Invalid JSON"}, 400)

        with db_conn() as conn:
            if section == "budgets":
                name = str(payload.get("name", "")).strip()
                budget = payload.get("budget")
                try:
                    budget = float(budget)
                except (TypeError, ValueError):
                    return self.send_json({"error": "Invalid budget payload"}, 400)
                if not name or budget < 0:
                    return self.send_json({"error": "Invalid budget payload"}, 400)

                try:
                    cur = conn.execute(
                        "INSERT INTO budgets(user_id, category_name, monthly_budget) VALUES(?, ?, ?)",
                        (user_id, name, budget),
                    )
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "Category already exists for this account"}, 409)

                row = conn.execute(
                    "SELECT id, category_name AS name, monthly_budget AS budget FROM budgets WHERE id = ?",
                    (cur.lastrowid,),
                ).fetchone()
                return self.send_json(dict(row), 201)

            if section == "expenses":
                budget_id = payload.get("budgetId")
                amount = payload.get("amount")
                date = payload.get("date")
                try:
                    budget_id = int(budget_id)
                    amount = float(amount)
                    datetime.strptime(date, "%Y-%m-%d")
                except (TypeError, ValueError):
                    return self.send_json({"error": "Invalid expense payload"}, 400)
                if amount <= 0:
                    return self.send_json({"error": "Invalid expense payload"}, 400)

                exists = conn.execute(
                    "SELECT id FROM budgets WHERE id = ? AND user_id = ?", (budget_id, user_id)
                ).fetchone()
                if not exists:
                    return self.send_json({"error": "Budget/category not found for user"}, 400)

                cur = conn.execute(
                    "INSERT INTO expenses(user_id, budget_id, amount, expense_date) VALUES (?, ?, ?, ?)",
                    (user_id, budget_id, amount, date),
                )
                row = conn.execute(
                    "SELECT id, budget_id AS budgetId, amount, expense_date AS date FROM expenses WHERE id = ?",
                    (cur.lastrowid,),
                ).fetchone()
                return self.send_json(dict(row), 201)

        return self.send_json({"error": "Not found"}, 404)

    def api_user_delete(self, path):
        parts = [p for p in path.split("/") if p]
        if len(parts) == 5 and parts[3] == "budgets":
            user_id, budget_id = parts[2], parts[4]
            with db_conn() as conn:
                conn.execute("DELETE FROM budgets WHERE id = ? AND user_id = ?", (budget_id, user_id))
            self.send_response(204)
            self.end_headers()
            return

        self.send_json({"error": "Not found"}, 404)

    def api_export_csv(self, table):
        if table not in ALLOWED_TABLES:
            return self.send_json({"error": "Invalid table"}, 400)

        query_map = {
            "users": "SELECT id, name FROM users ORDER BY id",
            "budgets": "SELECT id, user_id, category_name, monthly_budget FROM budgets ORDER BY id",
            "expenses": "SELECT id, user_id, budget_id, amount, expense_date FROM expenses ORDER BY id",
        }

        with db_conn() as conn:
            rows = conn.execute(query_map[table]).fetchall()

        output = io.StringIO()
        writer = csv.writer(output)

        if table == "users":
            writer.writerow(["id", "name"])
            for row in rows:
                writer.writerow([row["id"], row["name"]])
        elif table == "budgets":
            writer.writerow(["id", "user_id", "category_name", "monthly_budget"])
            for row in rows:
                writer.writerow([row["id"], row["user_id"], row["category_name"], row["monthly_budget"]])
        else:
            writer.writerow(["id", "user_id", "budget_id", "amount", "expense_date"])
            for row in rows:
                writer.writerow([row["id"], row["user_id"], row["budget_id"], row["amount"], row["expense_date"]])

        data = output.getvalue().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{table}.csv"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def api_import_csv(self, table):
        if table not in ALLOWED_TABLES:
            return self.send_json({"error": "Invalid table"}, 400)

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            return self.send_json({"error": "Upload must be multipart/form-data"}, 400)

        form = FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type},
        )

        if "csvfile" not in form:
            return self.send_json({"error": "Missing file field 'csvfile'"}, 400)

        file_item = form["csvfile"]
        if not getattr(file_item, "file", None):
            return self.send_json({"error": "No file uploaded"}, 400)

        try:
            text = file_item.file.read().decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(text))
            rows = list(reader)
            self.replace_table_from_csv(table, rows)
            return self.send_json({"status": "ok", "imported": len(rows)})
        except Exception as exc:  # noqa: BLE001
            return self.send_json({"error": f"Import failed: {exc}"}, 400)

    def replace_table_from_csv(self, table, rows):
        with db_conn() as conn:
            if table == "users":
                conn.execute("DELETE FROM users")
                for row in rows:
                    conn.execute(
                        "INSERT INTO users(id, name) VALUES (?, ?)",
                        (int(row["id"]), row["name"].strip()),
                    )
            elif table == "budgets":
                conn.execute("DELETE FROM budgets")
                for row in rows:
                    conn.execute(
                        "INSERT INTO budgets(id, user_id, category_name, monthly_budget) VALUES (?, ?, ?, ?)",
                        (int(row["id"]), int(row["user_id"]), row["category_name"].strip(), float(row["monthly_budget"])),
                    )
            else:
                conn.execute("DELETE FROM expenses")
                for row in rows:
                    datetime.strptime(row["expense_date"], "%Y-%m-%d")
                    conn.execute(
                        "INSERT INTO expenses(id, user_id, budget_id, amount, expense_date) VALUES (?, ?, ?, ?, ?)",
                        (
                            int(row["id"]),
                            int(row["user_id"]),
                            int(row["budget_id"]),
                            float(row["amount"]),
                            row["expense_date"],
                        ),
                    )

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        file_path = (ROOT / rel).resolve()

        if not str(file_path).startswith(str(ROOT)) or not file_path.exists() or file_path.is_dir():
            self.send_response(404)
            self.end_headers()
            return

        content_type = "text/plain"
        if file_path.suffix == ".html":
            content_type = "text/html"
        elif file_path.suffix == ".css":
            content_type = "text/css"
        elif file_path.suffix == ".js":
            content_type = "application/javascript"

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    init_db()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Expense tracker running on http://localhost:{PORT}")
    httpd.serve_forever()
