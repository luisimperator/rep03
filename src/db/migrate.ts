import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DB_PATH = join(process.cwd(), 'data', 'database.db');

// Schema SQL inline para evitar problemas com paths
const SCHEMA_SQL = `
-- Tabela de pedidos
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id TEXT UNIQUE NOT NULL,
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    buyer_phone TEXT,
    address_street TEXT NOT NULL,
    address_number TEXT NOT NULL,
    address_complement TEXT,
    address_neighborhood TEXT NOT NULL,
    address_city TEXT NOT NULL,
    address_state TEXT NOT NULL,
    address_zip TEXT NOT NULL,
    address_country TEXT NOT NULL DEFAULT 'BR',
    status TEXT NOT NULL DEFAULT 'NOVO' CHECK(status IN ('NOVO', 'ENVIANDO', 'AGUARDANDO_LOGGI', 'ETIQUETA_GERADA', 'FALHA', 'POSTADO')),
    loggi_shipment_id TEXT,
    loggi_tracking_code TEXT,
    label_path TEXT,
    error_message TEXT,
    paid_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tabela de itens do pedido
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    sku_reference TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Tabela de eventos (auditoria)
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    invoice_id TEXT,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

-- Tabela de jobs (fila de processamento)
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_run_at TEXT NOT NULL DEFAULT (datetime('now')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices para otimização
CREATE INDEX IF NOT EXISTS idx_orders_invoice_id ON orders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_events_order_id ON events(order_id);
CREATE INDEX IF NOT EXISTS idx_events_invoice_id ON events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run_at ON jobs(next_run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
`;

export function runMigrations(): void {
  console.log('Iniciando migração do banco de dados...');
  console.log(`Caminho do banco: ${DB_PATH}`);

  // Garantir que o diretório data existe
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);

  // Habilitar foreign keys
  db.pragma('foreign_keys = ON');

  // Executar schema
  db.exec(SCHEMA_SQL);

  console.log('Migração concluída com sucesso!');

  // Mostrar tabelas criadas
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  console.log('Tabelas:', tables.map(t => t.name).join(', '));

  db.close();
}

// Executar se chamado como script principal
// Verificamos argv para saber se estamos sendo executados diretamente
const isMainModule = process.argv[1]?.includes('migrate');
if (isMainModule) {
  runMigrations();
}
