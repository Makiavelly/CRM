import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'sales_crm.db'));
db.exec('PRAGMA foreign_keys = ON;');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('manager', 'leader')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'blocked')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      probability INTEGER NOT NULL DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      source TEXT NOT NULL DEFAULT 'web',
      product TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'qualified', 'converted', 'lost')),
      manager_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (manager_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      source TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      lead_id INTEGER,
      manager_id INTEGER,
      stage_id INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      probability INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'won', 'lost')),
      close_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (manager_id) REFERENCES users(id),
      FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'done', 'overdue')),
      type TEXT NOT NULL DEFAULT 'call',
      manager_id INTEGER,
      client_id INTEGER,
      deal_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (manager_id) REFERENCES users(id),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (deal_id) REFERENCES deals(id)
    );

    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      deal_id INTEGER,
      manager_id INTEGER,
      type TEXT NOT NULL DEFAULT 'call',
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (deal_id) REFERENCES deals(id),
      FOREIGN KEY (manager_id) REFERENCES users(id)
    );
  `);

  seedDb();
}

function seedDb() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return;

  const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
  const insertStage = db.prepare('INSERT INTO pipeline_stages (name, position, probability) VALUES (?, ?, ?)');
  const insertLead = db.prepare(`
    INSERT INTO leads (name, company, phone, email, source, product, status, manager_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertClient = db.prepare(`
    INSERT INTO clients (name, company, phone, email, source, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertDeal = db.prepare(`
    INSERT INTO deals (title, client_id, lead_id, manager_id, stage_id, amount, probability, status, close_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTask = db.prepare(`
    INSERT INTO tasks (title, description, due_date, status, type, manager_id, client_id, deal_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCommunication = db.prepare(`
    INSERT INTO communications (client_id, deal_id, manager_id, type, summary)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertUser.run('Анна Соколова', 'anna@crm.local', 'manager');
  insertUser.run('Игорь Морозов', 'igor@crm.local', 'manager');
  insertUser.run('Мария Лебедева', 'leader@crm.local', 'leader');

  [
    ['Новый лид', 1, 10],
    ['Переговоры', 2, 35],
    ['Коммерческое предложение', 3, 55],
    ['Согласование', 4, 75],
    ['Оплата', 5, 95],
  ].forEach((stage) => insertStage.run(...stage));

  insertLead.run('Олег Павлов', 'ООО Вектор', '+7 900 100-10-10', 'op@vector.ru', 'web', 'Внедрение CRM', 'new', 1, 'Оставил заявку на сайте.');
  insertLead.run('Светлана Ким', 'ИП Ким', '+7 900 200-20-20', 'kim@example.ru', 'email', 'Автоматизация заявок', 'qualified', 2, 'Нужна демонстрация продукта.');
  insertLead.run('Дмитрий Орлов', 'ТехноПарк', '+7 900 300-30-30', 'orlov@tech.ru', 'phone', 'Аналитика продаж', 'new', 1, 'Запросил обратный звонок.');

  const client1 = insertClient.run('Елена Смирнова', 'ГК Север', '+7 900 400-40-40', 'es@sever.ru', 'web', 'Крупный клиент, интерес к отчетности.').lastInsertRowid;
  const client2 = insertClient.run('Павел Егоров', 'ООО Альфа', '+7 900 500-50-50', 'egorov@alpha.ru', 'referral', 'Повторные продажи возможны в следующем квартале.').lastInsertRowid;

  const deal1 = insertDeal.run('CRM для ГК Север', client1, null, 1, 3, 450000, 55, 'open', '2026-05-30', 'Коммерческое предложение отправлено.').lastInsertRowid;
  const deal2 = insertDeal.run('Автоматизация отдела продаж Альфа', client2, null, 2, 4, 320000, 75, 'open', '2026-05-20', 'Согласование договора.').lastInsertRowid;
  insertDeal.run('Поддержка CRM Альфа', client2, null, 2, 5, 90000, 95, 'won', '2026-04-28', 'Оплата получена.');

  insertTask.run('Позвонить Олегу Павлову', 'Уточнить потребности и бюджет.', '2026-05-06', 'planned', 'call', 1, null, null);
  insertTask.run('Подготовить договор для Альфа', 'Передать руководителю на проверку.', '2026-05-04', 'planned', 'document', 2, client2, deal2);
  insertTask.run('Повторно отправить КП', 'Клиент не ответил после первого письма.', '2026-05-01', 'overdue', 'email', 1, client1, deal1);

  insertCommunication.run(client1, deal1, 1, 'email', 'Отправлено коммерческое предложение.');
  insertCommunication.run(client2, deal2, 2, 'meeting', 'Обсуждены условия договора и сроки оплаты.');
}

export function list(table, orderBy = 'id DESC') {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
}

export function getById(table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

export function buildPatch(table, id, body, allowedFields) {
  const entries = allowedFields
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
    .map((field) => [field, body[field]]);

  if (entries.length === 0) return getById(table, id);

  const setters = entries.map(([field]) => `${field} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  db.prepare(`UPDATE ${table} SET ${setters} WHERE id = ?`).run(...values, id);
  return getById(table, id);
}
