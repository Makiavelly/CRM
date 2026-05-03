import express from 'express';
import cors from 'cors';
import { db, initDb, buildPatch } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3001);

initDb();

app.use(cors());
app.use(express.json());

function ok(res, data) {
  res.json(data);
}

function notFound(res, message = 'Запись не найдена') {
  res.status(404).json({ error: message });
}

function managerRows() {
  return db.prepare(`
    SELECT id, name, email, role, status
    FROM users
    ORDER BY role, name
  `).all();
}

function leadRows() {
  return db.prepare(`
    SELECT leads.*, users.name AS manager_name
    FROM leads
    LEFT JOIN users ON users.id = leads.manager_id
    ORDER BY leads.created_at DESC
  `).all();
}

function clientRows() {
  return db.prepare(`
    SELECT clients.*,
      COUNT(DISTINCT deals.id) AS deals_count,
      COALESCE(SUM(CASE WHEN deals.status != 'lost' THEN deals.amount ELSE 0 END), 0) AS total_amount
    FROM clients
    LEFT JOIN deals ON deals.client_id = clients.id
    GROUP BY clients.id
    ORDER BY clients.created_at DESC
  `).all();
}

function dealRows() {
  return db.prepare(`
    SELECT deals.*,
      clients.name AS client_name,
      clients.company AS client_company,
      users.name AS manager_name,
      pipeline_stages.name AS stage_name,
      pipeline_stages.position AS stage_position
    FROM deals
    JOIN clients ON clients.id = deals.client_id
    LEFT JOIN users ON users.id = deals.manager_id
    JOIN pipeline_stages ON pipeline_stages.id = deals.stage_id
    ORDER BY pipeline_stages.position, deals.updated_at DESC
  `).all();
}

function taskRows() {
  return db.prepare(`
    SELECT tasks.*,
      users.name AS manager_name,
      clients.name AS client_name,
      deals.title AS deal_title
    FROM tasks
    LEFT JOIN users ON users.id = tasks.manager_id
    LEFT JOIN clients ON clients.id = tasks.client_id
    LEFT JOIN deals ON deals.id = tasks.deal_id
    ORDER BY
      CASE tasks.status WHEN 'overdue' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
      tasks.due_date ASC
  `).all();
}

function communicationRows() {
  return db.prepare(`
    SELECT communications.*,
      clients.name AS client_name,
      deals.title AS deal_title,
      users.name AS manager_name
    FROM communications
    LEFT JOIN clients ON clients.id = communications.client_id
    LEFT JOIN deals ON deals.id = communications.deal_id
    LEFT JOIN users ON users.id = communications.manager_id
    ORDER BY communications.created_at DESC
    LIMIT 100
  `).all();
}

function reports() {
  const total = db.prepare(`
    SELECT
      COUNT(*) AS deals_count,
      COALESCE(SUM(amount), 0) AS pipeline_amount,
      COALESCE(SUM(CASE WHEN status = 'won' THEN amount ELSE 0 END), 0) AS won_amount,
      COALESCE(SUM(CASE WHEN status = 'open' THEN amount * probability / 100.0 ELSE 0 END), 0) AS forecast_amount
    FROM deals
  `).get();

  const funnel = db.prepare(`
    SELECT pipeline_stages.id, pipeline_stages.name, pipeline_stages.position,
      COUNT(deals.id) AS deals_count,
      COALESCE(SUM(deals.amount), 0) AS amount
    FROM pipeline_stages
    LEFT JOIN deals ON deals.stage_id = pipeline_stages.id AND deals.status = 'open'
    GROUP BY pipeline_stages.id
    ORDER BY pipeline_stages.position
  `).all();

  const managers = db.prepare(`
    SELECT users.id, users.name,
      COALESCE(deal_stats.deals_count, 0) AS deals_count,
      COALESCE(deal_stats.amount, 0) AS amount,
      COALESCE(deal_stats.won_amount, 0) AS won_amount,
      COALESCE(task_stats.overdue_tasks, 0) AS overdue_tasks
    FROM users
    LEFT JOIN (
      SELECT manager_id,
        COUNT(*) AS deals_count,
        SUM(amount) AS amount,
        SUM(CASE WHEN status = 'won' THEN amount ELSE 0 END) AS won_amount
      FROM deals
      GROUP BY manager_id
    ) AS deal_stats ON deal_stats.manager_id = users.id
    LEFT JOIN (
      SELECT manager_id, COUNT(*) AS overdue_tasks
      FROM tasks
      WHERE status = 'overdue'
      GROUP BY manager_id
    ) AS task_stats ON task_stats.manager_id = users.id
    WHERE users.role = 'manager'
    ORDER BY amount DESC
  `).all();

  const conversion = db.prepare(`
    SELECT
      COUNT(*) AS leads_total,
      COUNT(CASE WHEN status = 'qualified' THEN 1 END) AS qualified,
      COUNT(CASE WHEN status = 'converted' THEN 1 END) AS converted,
      COUNT(CASE WHEN status = 'lost' THEN 1 END) AS lost
    FROM leads
  `).get();

  return { total, funnel, managers, conversion };
}

app.get('/api/health', (req, res) => ok(res, { status: 'ok' }));

app.get('/api/dashboard', (req, res) => {
  const report = reports();
  ok(res, {
    stats: {
      leads: db.prepare('SELECT COUNT(*) AS count FROM leads WHERE status != ?').get('lost').count,
      clients: db.prepare('SELECT COUNT(*) AS count FROM clients').get().count,
      openDeals: db.prepare('SELECT COUNT(*) AS count FROM deals WHERE status = ?').get('open').count,
      overdueTasks: db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE status = ?').get('overdue').count,
      forecastAmount: report.total.forecast_amount,
    },
    funnel: report.funnel,
    tasks: taskRows().slice(0, 5),
    communications: communicationRows().slice(0, 5),
  });
});

app.get('/api/users', (req, res) => ok(res, managerRows()));
app.post('/api/users', (req, res) => {
  const { name, email, role = 'manager', status = 'active' } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Имя и email обязательны' });
  const result = db.prepare('INSERT INTO users (name, email, role, status) VALUES (?, ?, ?, ?)').run(name, email, role, status);
  ok(res.status(201), db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid));
});
app.patch('/api/users/:id', (req, res) => {
  const row = buildPatch('users', req.params.id, req.body, ['name', 'email', 'role', 'status']);
  if (!row) return notFound(res);
  ok(res, row);
});

app.get('/api/stages', (req, res) => {
  ok(res, db.prepare('SELECT * FROM pipeline_stages ORDER BY position').all());
});
app.post('/api/stages', (req, res) => {
  const { name, position, probability = 10 } = req.body;
  if (!name || !position) return res.status(400).json({ error: 'Название и позиция обязательны' });
  const result = db.prepare('INSERT INTO pipeline_stages (name, position, probability) VALUES (?, ?, ?)').run(name, position, probability);
  ok(res.status(201), db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(result.lastInsertRowid));
});
app.patch('/api/stages/:id', (req, res) => {
  const row = buildPatch('pipeline_stages', req.params.id, req.body, ['name', 'position', 'probability']);
  if (!row) return notFound(res);
  ok(res, row);
});

app.get('/api/leads', (req, res) => ok(res, leadRows()));
app.post('/api/leads', (req, res) => {
  const { name, company, phone, email, source = 'web', product, status = 'new', manager_id, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Имя лида обязательно' });
  const result = db.prepare(`
    INSERT INTO leads (name, company, phone, email, source, product, status, manager_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, company, phone, email, source, product, status, manager_id || null, notes);
  ok(res.status(201), db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid));
});
app.patch('/api/leads/:id', (req, res) => {
  const row = buildPatch('leads', req.params.id, { ...req.body, updated_at: new Date().toISOString() }, [
    'name', 'company', 'phone', 'email', 'source', 'product', 'status', 'manager_id', 'notes', 'updated_at',
  ]);
  if (!row) return notFound(res);
  ok(res, row);
});
app.post('/api/leads/:id/convert', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return notFound(res, 'Лид не найден');

  const clientResult = db.prepare(`
    INSERT INTO clients (name, company, phone, email, source, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(lead.name, lead.company, lead.phone, lead.email, lead.source, lead.notes);

  const firstStage = db.prepare('SELECT * FROM pipeline_stages ORDER BY position LIMIT 1').get();
  const title = req.body.title || `Сделка: ${lead.company || lead.name}`;
  const amount = Number(req.body.amount || 0);
  const dealResult = db.prepare(`
    INSERT INTO deals (title, client_id, lead_id, manager_id, stage_id, amount, probability, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, clientResult.lastInsertRowid, lead.id, lead.manager_id, firstStage.id, amount, firstStage.probability, lead.notes);

  db.prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('converted', lead.id);

  ok(res.status(201), {
    client: db.prepare('SELECT * FROM clients WHERE id = ?').get(clientResult.lastInsertRowid),
    deal: db.prepare('SELECT * FROM deals WHERE id = ?').get(dealResult.lastInsertRowid),
  });
});

app.get('/api/clients', (req, res) => ok(res, clientRows()));
app.post('/api/clients', (req, res) => {
  const { name, company, phone, email, source = 'manual', notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Имя клиента обязательно' });
  const result = db.prepare(`
    INSERT INTO clients (name, company, phone, email, source, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, company, phone, email, source, notes);
  ok(res.status(201), db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid));
});
app.patch('/api/clients/:id', (req, res) => {
  const row = buildPatch('clients', req.params.id, req.body, ['name', 'company', 'phone', 'email', 'source', 'notes']);
  if (!row) return notFound(res);
  ok(res, row);
});

app.get('/api/deals', (req, res) => ok(res, dealRows()));
app.post('/api/deals', (req, res) => {
  const { title, client_id, manager_id, stage_id, amount = 0, probability = 10, status = 'open', close_date, notes } = req.body;
  if (!title || !client_id || !stage_id) return res.status(400).json({ error: 'Название, клиент и этап обязательны' });
  const result = db.prepare(`
    INSERT INTO deals (title, client_id, manager_id, stage_id, amount, probability, status, close_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, client_id, manager_id || null, stage_id, amount, probability, status, close_date, notes);
  ok(res.status(201), db.prepare('SELECT * FROM deals WHERE id = ?').get(result.lastInsertRowid));
});
app.patch('/api/deals/:id', (req, res) => {
  const row = buildPatch('deals', req.params.id, { ...req.body, updated_at: new Date().toISOString() }, [
    'title', 'client_id', 'lead_id', 'manager_id', 'stage_id', 'amount', 'probability', 'status', 'close_date', 'notes', 'updated_at',
  ]);
  if (!row) return notFound(res);
  ok(res, row);
});

app.get('/api/tasks', (req, res) => ok(res, taskRows()));
app.post('/api/tasks', (req, res) => {
  const { title, description, due_date, status = 'planned', type = 'call', manager_id, client_id, deal_id } = req.body;
  if (!title || !due_date) return res.status(400).json({ error: 'Название и срок задачи обязательны' });
  const result = db.prepare(`
    INSERT INTO tasks (title, description, due_date, status, type, manager_id, client_id, deal_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, description, due_date, status, type, manager_id || null, client_id || null, deal_id || null);
  ok(res.status(201), db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid));
});
app.patch('/api/tasks/:id', (req, res) => {
  const row = buildPatch('tasks', req.params.id, req.body, ['title', 'description', 'due_date', 'status', 'type', 'manager_id', 'client_id', 'deal_id']);
  if (!row) return notFound(res);
  ok(res, row);
});

app.get('/api/communications', (req, res) => ok(res, communicationRows()));
app.post('/api/communications', (req, res) => {
  const { client_id, deal_id, manager_id, type = 'call', summary } = req.body;
  if (!summary) return res.status(400).json({ error: 'Итог коммуникации обязателен' });
  const result = db.prepare(`
    INSERT INTO communications (client_id, deal_id, manager_id, type, summary)
    VALUES (?, ?, ?, ?, ?)
  `).run(client_id || null, deal_id || null, manager_id || null, type, summary);
  ok(res.status(201), db.prepare('SELECT * FROM communications WHERE id = ?').get(result.lastInsertRowid));
});

app.get('/api/reports', (req, res) => ok(res, reports()));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера', detail: err.message });
});

app.listen(port, () => {
  console.log(`CRM API listening on http://127.0.0.1:${port}`);
});
