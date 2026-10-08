let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    DatabaseSync = class {
      constructor(path) {
        this.db = new BetterSqlite3(path);
      }
      exec(sql) { return this.db.exec(sql); }
      prepare(sql) {
        const stmt = this.db.prepare(sql);
        return {
          run: (...args) => stmt.run(...args),
          get: (...args) => stmt.get(...args),
          all: (...args) => stmt.all(...args)
        };
      }
    };
  } catch (err2) {
    const fs = require('fs');
    const msg = `[DB CRASH] Node.js version: ${process.version}. Falha ao carregar SQLite nativo (node:sqlite) e better-sqlite3. Certifique-se de executar 'Run NPM Install' no cPanel ou selecionar Node.js v22+. Erro: ${err2.message}\n`;
    try { fs.appendFileSync(path.join(__dirname, '../passenger_crash.log'), msg); } catch (e) {}
    console.error(msg);
    throw err2;
  }
}

const path = require('path');
const dbPath = path.join(__dirname, 'vero_recovery.db');
const db = new DatabaseSync(dbPath);

// Habilitar WAL mode, cache em memória e busy_timeout para alta concorrência e velocidade instantânea
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 10000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA cache_size = -64000;'); // 64MB cache de páginas
  db.exec('PRAGMA mmap_size = 268435456;'); // 256MB memory mapping
  db.exec('PRAGMA temp_store = MEMORY;');
} catch (e) {
  console.warn('[DB PRAGMA WARN]', e.message);
}

/**
 * Função utilitária para adicionar coluna em tabela existente de forma segura
 */
function safeAddColumn(table, columnDefinition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition};`);
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('duplicate column name')) {
      // Coluna já existe, ignorar silenciosamente
    } else {
      console.warn(`[DB MIGRATION WARN] ${table} -> ${columnDefinition}:`, err.message);
    }
  }
}

// Inicializar as tabelas do banco de dados e aplicar migrações
function initDb() {
  // 1. Tabela campaigns
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
      dialer_provider TEXT DEFAULT 'vapi',
      vapi_assistant_id TEXT,
      vapi_phone_number_id TEXT,
      concurrency_limit INTEGER DEFAULT 14,
      total_leads INTEGER DEFAULT 0,
      processed_leads INTEGER DEFAULT 0,
      successful_calls INTEGER DEFAULT 0,
      failed_calls INTEGER DEFAULT 0,
      successful_sms INTEGER DEFAULT 0,
      failed_sms INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrações para a tabela campaigns
  safeAddColumn('campaigns', 'vapi_assistant_id TEXT');
  safeAddColumn('campaigns', 'vapi_phone_number_id TEXT');
  safeAddColumn('campaigns', 'dialer_provider TEXT DEFAULT "vapi"');
  safeAddColumn('campaigns', 'concurrency_limit INTEGER DEFAULT 14');
  safeAddColumn('campaigns', 'updated_at DATETIME');

  // 2. Tabela leads
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      cpf TEXT,
      debt_value REAL NOT NULL,
      due_date TEXT,
      barcode TEXT, -- Linha Digitável / Código de barras / PIX
      dias_atraso INTEGER, -- Dias em atraso
      status_internet TEXT, -- Status da internet / contrato
      occurrence TEXT, -- Tabulação / Ocorrência final
      email TEXT, -- E-mail do cliente
      call_id TEXT, -- ID da chamada na VAPI / Retell
      call_status TEXT DEFAULT 'pending', -- 'pending', 'calling', 'in_progress', 'completed', 'failed'
      call_attempts INTEGER DEFAULT 0,
      call_duration INTEGER DEFAULT 0,
      call_log TEXT,
      sms_status TEXT DEFAULT 'pending', -- 'pending', 'sending', 'completed', 'failed'
      sms_log TEXT,
      email_status TEXT DEFAULT 'pending', -- 'pending', 'sending', 'completed', 'failed'
      email_log TEXT,
      transcript TEXT,
      recording_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
  `);

  // Migrações para a tabela leads
  safeAddColumn('leads', 'barcode TEXT');
  safeAddColumn('leads', 'cpf TEXT');
  safeAddColumn('leads', 'dias_atraso INTEGER');
  safeAddColumn('leads', 'status_internet TEXT');
  safeAddColumn('leads', 'occurrence TEXT');
  safeAddColumn('leads', 'email TEXT');
  safeAddColumn('leads', 'email_status TEXT DEFAULT "pending"');
  safeAddColumn('leads', 'email_log TEXT');
  safeAddColumn('leads', 'call_id TEXT');
  safeAddColumn('leads', 'call_duration INTEGER DEFAULT 0');
  safeAddColumn('leads', 'transcript TEXT');
  safeAddColumn('leads', 'recording_url TEXT');
  safeAddColumn('leads', 'created_at DATETIME');
  safeAddColumn('leads', 'updated_at DATETIME');

  // 3. Criar Índices de Alta Performance para leitura instantânea de centenas de milhares de leads
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_leads_call_status ON leads(call_status);
      CREATE INDEX IF NOT EXISTS idx_leads_sms_status ON leads(sms_status);
      CREATE INDEX IF NOT EXISTS idx_leads_occurrence ON leads(occurrence);
      CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON leads(updated_at);
      CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
      CREATE INDEX IF NOT EXISTS idx_leads_camp_call_status ON leads(campaign_id, call_status);
      CREATE INDEX IF NOT EXISTS idx_leads_camp_sms_status ON leads(campaign_id, sms_status);
      CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    `);
  } catch (e) {
    console.warn('[DB INDEX WARN]', e.message);
  }

  // Garantir que registros existentes sem created_at/updated_at fiquem preenchidos com o timestamp atual
  try {
    db.exec('UPDATE leads SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;');
    db.exec('UPDATE leads SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;');
    db.exec('UPDATE campaigns SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;');
  } catch (e) {}
}

// Auto-executar initDb() no carregamento do módulo para garantir migrações imediatas
initDb();

// Helper para executar queries com auto-retry se o banco estiver ocupado
function run(sql, params = []) {
  let retries = 5;
  while (retries > 0) {
    try {
      const stmt = db.prepare(sql);
      return stmt.run(...params);
    } catch (err) {
      if (err.message && (err.message.includes('locked') || err.message.includes('busy')) && retries > 1) {
        retries--;
        const start = Date.now();
        while (Date.now() - start < 50) {}
      } else {
        throw err;
      }
    }
  }
}

// Helper para obter um único registro com auto-retry
function get(sql, params = []) {
  let retries = 5;
  while (retries > 0) {
    try {
      const stmt = db.prepare(sql);
      const result = stmt.get(...params);
      return result === undefined ? null : result;
    } catch (err) {
      if (err.message && (err.message.includes('locked') || err.message.includes('busy')) && retries > 1) {
        retries--;
        const start = Date.now();
        while (Date.now() - start < 50) {}
      } else {
        throw err;
      }
    }
  }
}

// Helper para obter múltiplos registros com auto-retry
function all(sql, params = []) {
  let retries = 5;
  while (retries > 0) {
    try {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    } catch (err) {
      if (err.message && (err.message.includes('locked') || err.message.includes('busy')) && retries > 1) {
        retries--;
        const start = Date.now();
        while (Date.now() - start < 50) {}
      } else {
        throw err;
      }
    }
  }
}

module.exports = {
  initDb,
  run,
  get,
  all,
  db
};
