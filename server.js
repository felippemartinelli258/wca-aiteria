console.log("✅ SERVER ATUALIZADO CARREGOU");
const express = require("express");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
require("dotenv").config();

const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");

/* ==============================
   MIDDLEWARES
============================== */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "wcacai.sid",
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12, // 12h
    },
  })
);

/* ==============================
   ADMIN AUTH
============================== */
let ADMIN_HASH = null;

async function ensureAdminHash() {
  if (!ADMIN_HASH) {
    const raw = process.env.ADMIN_PASSWORD || "admin123";
    ADMIN_HASH = await bcrypt.hash(raw, 10);
  }
}

function isAdmin(req) {
  return !!(req.session && req.session.isAdmin);
}

/* ==============================
   🔒 Evita cache (PWA / Service Worker)
============================== */
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/") ||
    req.path.startsWith("/pedido") ||
    req.path.startsWith("/pedidos")
  ) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

/* ==============================
   HELPERS
============================== */
function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function isValidBRPhone(digits) {
  // Aceita 10 ou 11 dígitos (DDD + número)
  return digits.length === 10 || digits.length === 11;
}

function maskPhone(digits) {
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  return digits.slice(0, 2) + "*****" + digits.slice(-3);
}

/* ==============================
   ROTAS ADMIN (ANTES DO STATIC)
============================== */
app.get("/admin/login", (req, res) => {
  const file = path.join(PUBLIC_DIR, "admin", "login.html");
  console.log("➡ Servindo:", file);
  res.sendFile(file);
});

app.get("/admin/login.html", (req, res) => {
  const file = path.join(PUBLIC_DIR, "admin", "login.html");
  console.log("➡ Servindo:", file);
  res.sendFile(file);
});

app.get("/admin", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/admin/login");
  const file = path.join(PUBLIC_DIR, "admin", "admin.html");
  console.log("➡ Servindo:", file);
  res.sendFile(file);
});

app.get("/admin/admin.html", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/admin/login");
  const file = path.join(PUBLIC_DIR, "admin", "admin.html");
  console.log("➡ Servindo:", file);
  res.sendFile(file);
});

/* ==============================
   API LOGIN ADMIN
============================== */
app.post("/api/admin/login", async (req, res) => {
  await ensureAdminHash();

  const { password } = req.body;
  if (!password) return res.status(400).json({ ok: false, erro: "Senha obrigatória" });

  const ok = await bcrypt.compare(password, ADMIN_HASH);
  if (!ok) return res.status(401).json({ ok: false, erro: "Senha inválida" });

  req.session.isAdmin = true;
  return res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* ==============================
   STATIC (CLIENTE + ARQUIVOS)
============================== */
app.use(express.static(PUBLIC_DIR));

/* ==============================
   STATUS API
============================== */
app.get("/api/status", (req, res) => {
  const row = db.prepare("SELECT COUNT(*) AS total FROM pedidos").get();
  res.json({
    status: "🚀 WC Açaíteria API rodando (SQLite)",
    totalPedidos: row.total,
  });
});

/* ==============================
   BUSCAR CLIENTE POR TELEFONE (PÚBLICO)
   GET /api/cliente?telefone=...
============================== */
app.get("/api/cliente", (req, res) => {
  const telDigits = onlyDigits(req.query.telefone);
  if (!telDigits || !isValidBRPhone(telDigits)) {
    return res.status(400).json({ ok: false, erro: "Telefone inválido" });
  }

  const row = db
    .prepare(`SELECT telefone, nome, endereco, referencia FROM clientes WHERE telefone = ?`)
    .get(telDigits);

  if (!row) return res.json({ ok: true, existe: false });

  return res.json({
    ok: true,
    existe: true,
    cliente: {
      telefone: row.telefone,
      telefoneMascarado: maskPhone(row.telefone),
      nome: row.nome || "",
      endereco: row.endereco || "",
      referencia: row.referencia || "",
    },
  });
});

/* ==============================
   CRIAR PEDIDO (CLIENTE) — COM TELEFONE OBRIGATÓRIO
============================== */
app.post("/pedido", (req, res) => {
  const {
    nomeCliente,
    telefone,
    tamanho,
    acompanhamentos,
    total,
    tipoEntrega,
    endereco,
    referencia,
  } = req.body;

  // telefone obrigatório
  const telDigits = onlyDigits(telefone);
  if (!telDigits || !isValidBRPhone(telDigits)) {
    return res.status(400).json({ ok: false, erro: "Telefone obrigatório (com DDD)" });
  }

  if (!tamanho || !Array.isArray(acompanhamentos) || acompanhamentos.length === 0) {
    return res.status(400).json({ ok: false, erro: "Pedido inválido" });
  }

  const tipo = tipoEntrega === "Entrega" ? "Entrega" : "Retirada";

  if (tipo === "Entrega") {
    const end = String(endereco || "").trim();
    if (end.length < 10) {
      return res.status(400).json({ ok: false, erro: "Endereço obrigatório para entrega" });
    }
  }

  const totalNumber = Number(String(total ?? "").replace(",", "."));
  if (!Number.isFinite(totalNumber) || totalNumber < 0) {
    return res.status(400).json({ ok: false, erro: "Total inválido" });
  }
  const total_centavos = Math.round(totalNumber * 100);

  const publicToken = crypto.randomBytes(16).toString("hex");
  const nowIso = new Date().toISOString();

  // salva/atualiza cliente por telefone
  const nomeFinal = String(nomeCliente || "").trim() || "Não informado";
  const endFinal = tipo === "Entrega" ? String(endereco || "").trim() : "";
  const refFinal = tipo === "Entrega" ? String(referencia || "").trim() : "";

  db.prepare(`
    INSERT INTO clientes (telefone, nome, endereco, referencia, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(telefone) DO UPDATE SET
      nome = COALESCE(NULLIF(excluded.nome,''), clientes.nome),
      endereco = COALESCE(NULLIF(excluded.endereco,''), clientes.endereco),
      referencia = COALESCE(NULLIF(excluded.referencia,''), clientes.referencia),
      updated_at = excluded.updated_at
  `).run(telDigits, nomeFinal, endFinal, refFinal, nowIso);

  // insere pedido
  const stmt = db.prepare(`
    INSERT INTO pedidos (
      created_at,
      nomeCliente,
      cliente_telefone,
      tamanho,
      acompanhamentos,
      total_centavos,
      status,
      tipo_entrega,
      endereco,
      referencia,
      public_token
    )
    VALUES (?, ?, ?, ?, ?, ?, 'Recebido', ?, ?, ?, ?)
  `);

  const info = stmt.run(
    nowIso,
    nomeFinal,
    telDigits,
    tamanho,
    JSON.stringify(acompanhamentos),
    total_centavos,
    tipo,
    tipo === "Entrega" ? endFinal : null,
    tipo === "Entrega" ? refFinal : null,
    publicToken
  );

  res.status(201).json({
    ok: true,
    mensagem: "Pedido criado com sucesso",
    pedido: {
      id: info.lastInsertRowid,
      token: publicToken,
      nomeCliente: nomeFinal,
      telefone: telDigits,
      telefoneMascarado: maskPhone(telDigits),
      tamanho,
      acompanhamentos,
      total: totalNumber,
      status: "Recebido",
      criadoEm: nowIso,
      tipoEntrega: tipo,
    },
  });
});

/* ==============================
   CLIENTE ACOMPANHAR PEDIDO (PÚBLICO)
   GET /api/pedido/:id?token=...
============================== */
app.get("/api/pedido/:id", (req, res) => {
  const { id } = req.params;
  const token = String(req.query.token || "");

  if (!token || token.length < 10) {
    return res.status(401).json({ erro: "Token inválido" });
  }

  const row = db.prepare(`
    SELECT id, created_at, nomeCliente, cliente_telefone, tamanho, acompanhamentos, total_centavos,
           status, tipo_entrega, endereco, referencia, public_token
    FROM pedidos
    WHERE id = ?
  `).get(id);

  if (!row) return res.status(404).json({ erro: "Pedido não encontrado" });
  if (row.public_token !== token) return res.status(401).json({ erro: "Não autorizado" });

  res.json({
    id: row.id,
    criadoEm: row.created_at,
    nomeCliente: row.nomeCliente,
    telefoneMascarado: maskPhone(row.cliente_telefone),
    tamanho: row.tamanho,
    acompanhamentos: JSON.parse(row.acompanhamentos),
    total: (row.total_centavos / 100).toFixed(2),
    status: row.status,
    tipoEntrega: row.tipo_entrega,
    endereco: row.tipo_entrega === "Entrega" ? row.endereco : null,
    referencia: row.tipo_entrega === "Entrega" ? row.referencia : null,
  });
});

/* ==============================
   LISTAR PEDIDOS (ADMIN)
============================== */
app.get("/pedidos", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "Não autorizado" });

  const rows = db.prepare("SELECT * FROM pedidos ORDER BY id DESC LIMIT 500").all();

  const pedidos = rows.map((r) => ({
    id: r.id,
    nomeCliente: r.nomeCliente,
    telefone: r.cliente_telefone || null,
    telefoneMascarado: maskPhone(r.cliente_telefone),
    tamanho: r.tamanho,
    acompanhamentos: JSON.parse(r.acompanhamentos),
    total: (r.total_centavos / 100).toFixed(2),
    status: r.status,
    criadoEm: r.created_at,
    tipoEntrega: r.tipo_entrega,
    endereco: r.endereco,
    referencia: r.referencia,
  }));

  res.json(pedidos);
});

/* ==============================
   HISTÓRICO DO CLIENTE (ADMIN)
   GET /api/admin/cliente/:telefone/pedidos
============================== */
app.get("/api/admin/cliente/:telefone/pedidos", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "Não autorizado" });

  const telDigits = onlyDigits(req.params.telefone);
  if (!telDigits || !isValidBRPhone(telDigits)) {
    return res.status(400).json({ erro: "Telefone inválido" });
  }

  const cliente = db
    .prepare(`SELECT telefone, nome, endereco, referencia, updated_at FROM clientes WHERE telefone = ?`)
    .get(telDigits);

  const rows = db.prepare(`
    SELECT id, created_at, nomeCliente, cliente_telefone, tamanho, acompanhamentos, total_centavos,
           status, tipo_entrega, endereco, referencia
    FROM pedidos
    WHERE cliente_telefone = ?
    ORDER BY id DESC
    LIMIT 200
  `).all(telDigits);

  const pedidos = rows.map(r => ({
    id: r.id,
    criadoEm: r.created_at,
    nomeCliente: r.nomeCliente,
    telefone: r.cliente_telefone,
    telefoneMascarado: maskPhone(r.cliente_telefone),
    tamanho: r.tamanho,
    acompanhamentos: JSON.parse(r.acompanhamentos),
    total: (r.total_centavos / 100).toFixed(2),
    status: r.status,
    tipoEntrega: r.tipo_entrega,
    endereco: r.endereco,
    referencia: r.referencia,
  }));

  return res.json({
    ok: true,
    telefone: telDigits,
    telefoneMascarado: maskPhone(telDigits),
    cliente: cliente || null,
    pedidos,
  });
});

/* ==============================
   ATUALIZAR STATUS (ADMIN)
============================== */
app.put("/pedido/:id", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "Não autorizado" });

  const { id } = req.params;
  const { status } = req.body;

  const allowed = ["Recebido", "Em preparo", "Saiu para entrega", "Finalizado"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ erro: "Status inválido" });
  }

  const info = db.prepare("UPDATE pedidos SET status = ? WHERE id = ?").run(status, id);
  if (info.changes === 0) return res.status(404).json({ erro: "Pedido não encontrado" });

  res.json({ mensagem: "Status atualizado" });
});

/* ==============================
   DELETAR PEDIDO (ADMIN)
============================== */
app.delete("/pedido/:id", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "Não autorizado" });

  const { id } = req.params;

  const info = db.prepare("DELETE FROM pedidos WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ erro: "Pedido não encontrado" });

  res.json({ mensagem: "Pedido removido" });
});

/* ==============================
   ERRO
============================== */
app.use((err, req, res, next) => {
  console.error("❌ ERRO:", err);
  res.status(500).send("Erro interno no servidor. Veja o terminal.");
});

/* ==============================
   SERVIDOR
============================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 Servidor rodando em:`);
  console.log(`➡ Local: http://localhost:${PORT}`);
  console.log(`➡ Admin: http://localhost:${PORT}/admin/login`);
});