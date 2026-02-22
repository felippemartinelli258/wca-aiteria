const Database = require("better-sqlite3");
const path = require("path");

// ✅ Render Disk: use SQLITE_PATH=/var/data/data.sqlite
const dbPath = process.env.SQLITE_PATH
  ? process.env.SQLITE_PATH
  : path.join(__dirname, "data.sqlite");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

/* ==============================
   PEDIDOS (tabela base)
============================== */
db.exec(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    nomeCliente TEXT,
    tamanho TEXT NOT NULL,
    acompanhamentos TEXT NOT NULL,
    total_centavos INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Recebido'
  );
`);

function ensureColumn(table, name, sqlType, defaultSQL = null) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (cols.includes(name)) return;

  const def = defaultSQL !== null ? ` DEFAULT ${defaultSQL}` : "";
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sqlType}${def};`);
}

// pedidos: novas colunas
ensureColumn("pedidos", "tipo_entrega", "TEXT", "'Retirada'");
ensureColumn("pedidos", "endereco", "TEXT");
ensureColumn("pedidos", "referencia", "TEXT");
ensureColumn("pedidos", "public_token", "TEXT");
ensureColumn("pedidos", "cliente_telefone", "TEXT");

// índices
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_pedidos_created_at ON pedidos(created_at);
  CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
  CREATE INDEX IF NOT EXISTS idx_pedidos_public_token ON pedidos(public_token);
  CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_tel ON pedidos(cliente_telefone);
`);

/* ==============================
   CLIENTES (novo)
============================== */
db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    telefone TEXT PRIMARY KEY,
    nome TEXT,
    endereco TEXT,
    referencia TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_clientes_updated_at ON clientes(updated_at);
`);

/* ==============================
   Preenche tokens faltando em pedidos antigos
============================== */
try {
  const rows = db.prepare(`
    SELECT id FROM pedidos
    WHERE public_token IS NULL OR TRIM(public_token) = ''
  `).all();

  if (rows.length) {
    const upd = db.prepare(`UPDATE pedidos SET public_token = ? WHERE id = ?`);
    for (const r of rows) {
      const token = (Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2))
        .slice(0, 32);
      upd.run(token, r.id);
    }
  }
} catch (e) {}

module.exports = db;