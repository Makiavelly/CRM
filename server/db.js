import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'sales_crm.db'));
db.exec('PRAGMA foreign_keys = ON;');

const migrations = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS crm_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('sales_manager', 'manager_owner')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES crm_users(id)
      );

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      );

      CREATE TABLE IF NOT EXISTS project_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role_in_project TEXT NOT NULL DEFAULT 'manager',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, user_id),
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (user_id) REFERENCES crm_users(id)
      );

      CREATE TABLE IF NOT EXISTS funnel_stages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT '#2e8b7d',
        is_final_success INTEGER NOT NULL DEFAULT 0,
        is_final_failed INTEGER NOT NULL DEFAULT 0,
        max_days_without_activity INTEGER NOT NULL DEFAULT 7,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS crm_clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        assigned_manager_id INTEGER,
        current_stage_id INTEGER,
        name TEXT NOT NULL,
        short_description TEXT,
        contacts TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        deal_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (assigned_manager_id) REFERENCES crm_users(id),
        FOREIGN KEY (current_stage_id) REFERENCES funnel_stages(id)
      );

      CREATE TABLE IF NOT EXISTS stage_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        manager_id INTEGER,
        from_stage_id INTEGER,
        to_stage_id INTEGER NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES crm_clients(id),
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (manager_id) REFERENCES crm_users(id),
        FOREIGN KEY (from_stage_id) REFERENCES funnel_stages(id),
        FOREIGN KEY (to_stage_id) REFERENCES funnel_stages(id)
      );

      CREATE TABLE IF NOT EXISTS client_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        manager_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES crm_clients(id),
        FOREIGN KEY (manager_id) REFERENCES crm_users(id)
      );

      CREATE TABLE IF NOT EXISTS client_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        manager_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'call',
        title TEXT NOT NULL,
        description TEXT,
        scheduled_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES crm_clients(id),
        FOREIGN KEY (manager_id) REFERENCES crm_users(id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        related_entity_type TEXT,
        related_entity_id INTEGER,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES crm_users(id)
      );
    `,
  },
];

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
  }

  seedDb();
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const passwordHash = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === passwordHash.length && timingSafeEqual(stored, passwordHash);
}

function seedDb() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM crm_users').get().count;
  if (userCount > 0) return;

  const password = hashPassword('demo123');
  const insertUser = db.prepare(`
    INSERT INTO crm_users (first_name, last_name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `);
  const owner = insertUser.run('Мария', 'Лебедева', 'owner@crm.local', password, 'manager_owner').lastInsertRowid;
  const ivan = insertUser.run('Иван', 'Петров', 'ivan@crm.local', password, 'sales_manager').lastInsertRowid;
  const anna = insertUser.run('Анна', 'Смирнова', 'anna@crm.local', password, 'sales_manager').lastInsertRowid;

  const company = db.prepare('INSERT INTO companies (name, owner_id) VALUES (?, ?)').run('Demo Sales Company', owner).lastInsertRowid;
  const project = db.prepare('INSERT INTO projects (company_id, name, description) VALUES (?, ?, ?)').run(
    company,
    'B2B Sales',
    'Демо-проект для проверки минимальной CRM-вертикали.',
  ).lastInsertRowid;

  db.prepare('INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)').run(project, owner, 'owner');
  db.prepare('INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)').run(project, ivan, 'manager');
  db.prepare('INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)').run(project, anna, 'manager');

  const insertStage = db.prepare(`
    INSERT INTO funnel_stages (project_id, name, position, color, is_final_success, is_final_failed, max_days_without_activity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const stageLead = insertStage.run(project, 'Лид', 1, '#2f79c4', 0, 0, 3).lastInsertRowid;
  const stageInterest = insertStage.run(project, 'Заинтересованность', 2, '#7464c9', 0, 0, 5).lastInsertRowid;
  const stageNeed = insertStage.run(project, 'Квалификация', 3, '#2e8b7d', 0, 0, 7).lastInsertRowid;
  const stageTalk = insertStage.run(project, 'Переговоры', 4, '#c9832e', 0, 0, 7).lastInsertRowid;
  const stageWon = insertStage.run(project, 'Сделка', 5, '#2e8b7d', 1, 0, 14).lastInsertRowid;
  insertStage.run(project, 'Отказ', 6, '#c85151', 0, 1, 14);

  const insertClient = db.prepare(`
    INSERT INTO crm_clients
      (project_id, assigned_manager_id, current_stage_id, name, short_description, contacts, tags, deal_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const client1 = insertClient.run(
    project,
    ivan,
    stageLead,
    'Олег Павлов',
    'Интересуется внедрением CRM для отдела продаж.',
    JSON.stringify({ phone: '+7 900 100-10-10', email: 'op@vector.ru', telegram: '@opavlov' }),
    JSON.stringify(['B2B', 'новый лид']),
    180000,
  ).lastInsertRowid;
  const client2 = insertClient.run(
    project,
    ivan,
    stageTalk,
    'Елена Смирнова',
    'Крупный клиент, обсуждает отчетность и контроль менеджеров.',
    JSON.stringify({ phone: '+7 900 400-40-40', email: 'es@sever.ru' }),
    JSON.stringify(['enterprise', 'важно']),
    450000,
  ).lastInsertRowid;
  const client3 = insertClient.run(
    project,
    anna,
    stageNeed,
    'Павел Егоров',
    'Нужна автоматизация повторных продаж.',
    JSON.stringify({ phone: '+7 900 500-50-50', email: 'egorov@alpha.ru' }),
    JSON.stringify(['повторные продажи']),
    320000,
  ).lastInsertRowid;
  insertClient.run(
    project,
    anna,
    stageInterest,
    'Светлана Ким',
    'Просит демонстрацию продукта для команды.',
    JSON.stringify({ phone: '+7 900 200-20-20', email: 'kim@example.ru' }),
    JSON.stringify(['демо', 'теплый']),
    120000,
  );

  const insertNote = db.prepare('INSERT INTO client_notes (client_id, manager_id, message, source) VALUES (?, ?, ?, ?)');
  insertNote.run(client1, ivan, 'Оставил заявку на сайте. Нужно уточнить бюджет и сроки внедрения.', 'manual');
  insertNote.run(client2, ivan, 'Отправлено коммерческое предложение. Клиент ждет согласование у директора.', 'copied_from_social');
  insertNote.run(client3, anna, 'На встрече подтвердили потребность в контроле повторных касаний.', 'meeting_summary');

  const insertInteraction = db.prepare(`
    INSERT INTO client_interactions (client_id, manager_id, project_id, type, title, description, scheduled_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertInteraction.run(client1, ivan, project, 'call', 'Позвонить Олегу', 'Уточнить требования и бюджет.', '2026-05-18T10:00', 'planned');
  insertInteraction.run(client2, ivan, project, 'email', 'Повторно отправить КП', 'Клиент не ответил после первого письма.', '2026-05-16T11:30', 'missed');
  insertInteraction.run(client3, anna, project, 'meeting', 'Демо для отдела продаж', 'Показать Kanban и отчеты.', '2026-05-19T15:00', 'planned');

  db.prepare(`
    INSERT INTO stage_transitions (client_id, project_id, manager_id, from_stage_id, to_stage_id, comment)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(client2, project, ivan, stageNeed, stageTalk, 'Клиент перешел к обсуждению договора.');
  db.prepare(`
    INSERT INTO stage_transitions (client_id, project_id, manager_id, from_stage_id, to_stage_id, comment)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(client3, project, anna, stageInterest, stageNeed, 'Потребность подтверждена на встрече.');

  db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ivan, 'new_lead_assigned', 'Новый клиент назначен', 'Олег Павлов назначен вам в проекте B2B Sales.', 'client', client1);
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(owner, 'system', 'Демо-данные готовы', 'Можно проверить путь управляющего и менеджера.', 'project', project);

  db.prepare('UPDATE crm_clients SET current_stage_id = ? WHERE id = ?').run(stageWon, client3);
}

export function userPublic(row) {
  if (!row) return null;
  const { password_hash, ...user } = row;
  return {
    ...user,
    name: `${row.first_name} ${row.last_name}`.trim(),
  };
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeClient(row) {
  if (!row) return null;
  return {
    ...row,
    contacts: parseJson(row.contacts, {}),
    tags: parseJson(row.tags, []),
  };
}

