import express from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import { db, hashPassword, initDb, normalizeClient, userPublic, verifyPassword } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const sessions = new Map();

initDb();

app.use(cors());
app.use(express.json());

function ok(res, data, status = 200) {
  res.status(status).json(data);
}

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM crm_users WHERE lower(email) = lower(?)').get(email);
}

function getProject(projectId) {
  return db.prepare(`
    SELECT projects.*, companies.name AS company_name, companies.owner_id
    FROM projects
    JOIN companies ON companies.id = projects.company_id
    WHERE projects.id = ?
  `).get(projectId);
}

function isProjectMember(projectId, userId) {
  const row = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
  return Boolean(row);
}

function canAccessProject(projectId, user) {
  const project = getProject(projectId);
  if (!project) return false;
  if (user.role === 'manager_owner') return project.owner_id === user.id || isProjectMember(projectId, user.id);
  return isProjectMember(projectId, user.id);
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const userId = token ? sessions.get(token) : null;
  if (!userId) return fail(res, 401, 'Нужна авторизация');
  const user = db.prepare('SELECT * FROM crm_users WHERE id = ?').get(userId);
  if (!user) return fail(res, 401, 'Сессия устарела');
  req.user = user;
  next();
}

function requireOwner(req, res, next) {
  if (req.user.role !== 'manager_owner') return fail(res, 403, 'Доступно только управляющему');
  next();
}

function projectGuard(req, res, next) {
  const projectId = Number(req.params.projectId || req.query.projectId);
  if (!projectId || !canAccessProject(projectId, req.user)) return fail(res, 403, 'Нет доступа к проекту');
  req.project = getProject(projectId);
  next();
}

function listProjects(user) {
  if (user.role === 'manager_owner') {
    return db.prepare(`
      SELECT projects.*, companies.name AS company_name
      FROM projects
      JOIN companies ON companies.id = projects.company_id
      WHERE companies.owner_id = ?
      ORDER BY projects.created_at DESC
    `).all(user.id);
  }

  return db.prepare(`
    SELECT projects.*, companies.name AS company_name
    FROM projects
    JOIN companies ON companies.id = projects.company_id
    JOIN project_members ON project_members.project_id = projects.id
    WHERE project_members.user_id = ?
    ORDER BY projects.created_at DESC
  `).all(user.id);
}

function listMembers(projectId) {
  return db.prepare(`
    SELECT crm_users.id, crm_users.first_name, crm_users.last_name, crm_users.email, crm_users.role,
      project_members.role_in_project, project_members.created_at
    FROM project_members
    JOIN crm_users ON crm_users.id = project_members.user_id
    WHERE project_members.project_id = ?
    ORDER BY crm_users.role, crm_users.last_name
  `).all(projectId).map(userPublic);
}

function listStages(projectId) {
  return db.prepare('SELECT * FROM funnel_stages WHERE project_id = ? ORDER BY position').all(projectId);
}

function listClients(projectId, user) {
  const sql = `
    SELECT crm_clients.*,
      funnel_stages.name AS stage_name,
      funnel_stages.color AS stage_color,
      funnel_stages.max_days_without_activity,
      crm_users.first_name || ' ' || crm_users.last_name AS manager_name,
      MAX(client_notes.created_at) AS last_note_at,
      MAX(client_interactions.created_at) AS last_interaction_at
    FROM crm_clients
    LEFT JOIN funnel_stages ON funnel_stages.id = crm_clients.current_stage_id
    LEFT JOIN crm_users ON crm_users.id = crm_clients.assigned_manager_id
    LEFT JOIN client_notes ON client_notes.client_id = crm_clients.id
    LEFT JOIN client_interactions ON client_interactions.client_id = crm_clients.id
    WHERE crm_clients.project_id = ?
      ${user.role === 'sales_manager' ? 'AND crm_clients.assigned_manager_id = ?' : ''}
    GROUP BY crm_clients.id
    ORDER BY crm_clients.updated_at DESC
  `;
  const rows = user.role === 'sales_manager'
    ? db.prepare(sql).all(projectId, user.id)
    : db.prepare(sql).all(projectId);
  return rows.map(normalizeClient);
}

function getClient(clientId) {
  const row = db.prepare(`
    SELECT crm_clients.*,
      funnel_stages.name AS stage_name,
      crm_users.first_name || ' ' || crm_users.last_name AS manager_name
    FROM crm_clients
    LEFT JOIN funnel_stages ON funnel_stages.id = crm_clients.current_stage_id
    LEFT JOIN crm_users ON crm_users.id = crm_clients.assigned_manager_id
    WHERE crm_clients.id = ?
  `).get(clientId);
  return normalizeClient(row);
}

function clientGuard(req, res, next) {
  const client = getClient(Number(req.params.clientId));
  if (!client) return fail(res, 404, 'Клиент не найден');
  if (!canAccessProject(client.project_id, req.user)) return fail(res, 403, 'Нет доступа к клиенту');
  if (req.user.role === 'sales_manager' && client.assigned_manager_id !== req.user.id) {
    return fail(res, 403, 'Менеджер видит только назначенных клиентов');
  }
  req.client = client;
  next();
}

function dashboard(projectId, user) {
  const clients = listClients(projectId, user);
  const stages = listStages(projectId);
  const stageCounts = stages.map((stage) => ({
    ...stage,
    clients_count: clients.filter((client) => client.current_stage_id === stage.id).length,
    amount: clients
      .filter((client) => client.current_stage_id === stage.id)
      .reduce((sum, client) => sum + Number(client.deal_amount || 0), 0),
  }));

  const managerRows = db.prepare(`
    SELECT crm_users.id, crm_users.first_name || ' ' || crm_users.last_name AS name,
      (
        SELECT COUNT(*)
        FROM crm_clients
        WHERE crm_clients.project_id = project_members.project_id
          AND crm_clients.assigned_manager_id = crm_users.id
      ) AS clients_count,
      (
        SELECT COALESCE(SUM(deal_amount), 0)
        FROM crm_clients
        WHERE crm_clients.project_id = project_members.project_id
          AND crm_clients.assigned_manager_id = crm_users.id
      ) AS pipeline_amount,
      (
        SELECT COUNT(*)
        FROM stage_transitions
        WHERE stage_transitions.project_id = project_members.project_id
          AND stage_transitions.manager_id = crm_users.id
      ) AS transitions_count,
      (
        SELECT COUNT(*)
        FROM client_interactions
        WHERE client_interactions.project_id = project_members.project_id
          AND client_interactions.manager_id = crm_users.id
          AND client_interactions.status = 'completed'
      ) AS completed_interactions,
      (
        SELECT COUNT(*)
        FROM client_interactions
        WHERE client_interactions.project_id = project_members.project_id
          AND client_interactions.manager_id = crm_users.id
          AND client_interactions.status IN ('missed', 'planned')
          AND client_interactions.scheduled_at < datetime('now')
      ) AS overdue_interactions
    FROM project_members
    JOIN crm_users ON crm_users.id = project_members.user_id
    WHERE project_members.project_id = ? AND crm_users.role = 'sales_manager'
    ORDER BY transitions_count DESC, pipeline_amount DESC
  `).all(projectId);

  const upcoming = db.prepare(`
    SELECT client_interactions.*, crm_clients.name AS client_name
    FROM client_interactions
    JOIN crm_clients ON crm_clients.id = client_interactions.client_id
    WHERE client_interactions.project_id = ?
      ${user.role === 'sales_manager' ? 'AND client_interactions.manager_id = ?' : ''}
      AND client_interactions.status = 'planned'
    ORDER BY client_interactions.scheduled_at ASC
    LIMIT 6
  `);

  const transitions = db.prepare(`
    SELECT stage_transitions.*, crm_clients.name AS client_name,
      from_stage.name AS from_stage_name, to_stage.name AS to_stage_name,
      crm_users.first_name || ' ' || crm_users.last_name AS manager_name
    FROM stage_transitions
    JOIN crm_clients ON crm_clients.id = stage_transitions.client_id
    LEFT JOIN funnel_stages AS from_stage ON from_stage.id = stage_transitions.from_stage_id
    JOIN funnel_stages AS to_stage ON to_stage.id = stage_transitions.to_stage_id
    LEFT JOIN crm_users ON crm_users.id = stage_transitions.manager_id
    WHERE stage_transitions.project_id = ?
    ORDER BY stage_transitions.created_at DESC
    LIMIT 8
  `).all(projectId);

  return {
    stats: {
      clients: clients.length,
      activeAmount: clients.reduce((sum, client) => sum + Number(client.deal_amount || 0), 0),
      plannedInteractions: db.prepare(`
        SELECT COUNT(*) AS count FROM client_interactions
        WHERE project_id = ? AND status = 'planned'
          ${user.role === 'sales_manager' ? 'AND manager_id = ?' : ''}
      `).get(...(user.role === 'sales_manager' ? [projectId, user.id] : [projectId])).count,
      unreadNotifications: db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).count,
    },
    stages: stageCounts,
    managers: managerRows,
    upcoming: user.role === 'sales_manager' ? upcoming.all(projectId, user.id) : upcoming.all(projectId),
    transitions,
  };
}

app.get('/api/health', (req, res) => ok(res, { status: 'ok' }));

app.post('/api/auth/register', (req, res) => {
  const { first_name, last_name, email, password, role, company_name } = req.body;
  if (!first_name || !last_name || !email || !password || !role) return fail(res, 400, 'Заполните обязательные поля');
  if (!['sales_manager', 'manager_owner'].includes(role)) return fail(res, 400, 'Некорректная роль');
  if (role === 'manager_owner' && !company_name) return fail(res, 400, 'Для управляющего нужна компания');
  if (getUserByEmail(email)) return fail(res, 409, 'Email уже зарегистрирован');

  const result = db.prepare(`
    INSERT INTO crm_users (first_name, last_name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(first_name, last_name, email, hashPassword(password), role);
  const user = db.prepare('SELECT * FROM crm_users WHERE id = ?').get(result.lastInsertRowid);

  if (role === 'manager_owner') {
    const company = db.prepare('INSERT INTO companies (name, owner_id) VALUES (?, ?)').run(company_name, user.id).lastInsertRowid;
    const project = db.prepare('INSERT INTO projects (company_id, name, description) VALUES (?, ?, ?)').run(company, 'Первый проект', 'Базовый проект компании').lastInsertRowid;
    db.prepare('INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)').run(project, user.id, 'owner');
    ['Лид', 'Заинтересованность', 'Квалификация', 'Переговоры', 'Сделка', 'Отказ'].forEach((name, index) => {
      db.prepare(`
        INSERT INTO funnel_stages (project_id, name, position, is_final_success, is_final_failed)
        VALUES (?, ?, ?, ?, ?)
      `).run(project, name, index + 1, name === 'Сделка' ? 1 : 0, name === 'Отказ' ? 1 : 0);
    });
  }

  const token = randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  ok(res, { token, user: userPublic(user), projects: listProjects(user) }, 201);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return fail(res, 401, 'Неверный email или пароль');
  const token = randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  ok(res, { token, user: userPublic(user), projects: listProjects(user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  sessions.delete(token);
  ok(res, { ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  ok(res, { user: userPublic(req.user), projects: listProjects(req.user) });
});

app.get('/api/projects', requireAuth, (req, res) => ok(res, listProjects(req.user)));

app.post('/api/projects', requireAuth, requireOwner, (req, res) => {
  const { company_id, name, description } = req.body;
  if (!name) return fail(res, 400, 'Название проекта обязательно');
  let companyId = company_id;
  if (!companyId) {
    const company = db.prepare('SELECT id FROM companies WHERE owner_id = ? ORDER BY id LIMIT 1').get(req.user.id);
    companyId = company?.id;
  }
  if (!companyId) return fail(res, 400, 'Компания не найдена');
  const result = db.prepare('INSERT INTO projects (company_id, name, description) VALUES (?, ?, ?)').run(companyId, name, description || null);
  db.prepare('INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)').run(result.lastInsertRowid, req.user.id, 'owner');
  ok(res, getProject(result.lastInsertRowid), 201);
});

app.get('/api/projects/:projectId/members', requireAuth, projectGuard, (req, res) => ok(res, listMembers(req.project.id)));

app.post('/api/projects/:projectId/members', requireAuth, requireOwner, projectGuard, (req, res) => {
  const { email, first_name = 'Новый', last_name = 'Менеджер' } = req.body;
  if (!email) return fail(res, 400, 'Email менеджера обязателен');
  let user = getUserByEmail(email);
  if (!user) {
    const result = db.prepare(`
      INSERT INTO crm_users (first_name, last_name, email, password_hash, role)
      VALUES (?, ?, ?, ?, 'sales_manager')
    `).run(first_name, last_name, email, hashPassword('demo123'));
    user = db.prepare('SELECT * FROM crm_users WHERE id = ?').get(result.lastInsertRowid);
  }
  db.prepare(`
    INSERT OR IGNORE INTO project_members (project_id, user_id, role_in_project)
    VALUES (?, ?, 'manager')
  `).run(req.project.id, user.id);
  ok(res, { member: userPublic(user), members: listMembers(req.project.id) }, 201);
});

app.get('/api/projects/:projectId/pipeline-stages', requireAuth, projectGuard, (req, res) => ok(res, listStages(req.project.id)));

app.post('/api/projects/:projectId/pipeline-stages', requireAuth, requireOwner, projectGuard, (req, res) => {
  const { name, position, color = '#2e8b7d', max_days_without_activity = 7 } = req.body;
  if (!name) return fail(res, 400, 'Название этапа обязательно');
  const nextPosition = position || (listStages(req.project.id).length + 1);
  const result = db.prepare(`
    INSERT INTO funnel_stages (project_id, name, position, color, max_days_without_activity)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.project.id, name, nextPosition, color, max_days_without_activity);
  ok(res, db.prepare('SELECT * FROM funnel_stages WHERE id = ?').get(result.lastInsertRowid), 201);
});

app.get('/api/projects/:projectId/clients', requireAuth, projectGuard, (req, res) => ok(res, listClients(req.project.id, req.user)));

app.post('/api/projects/:projectId/clients', requireAuth, projectGuard, (req, res) => {
  const { name, short_description, contacts = {}, tags = [], deal_amount = 0, assigned_manager_id, current_stage_id } = req.body;
  if (!name) return fail(res, 400, 'Имя клиента обязательно');
  if (req.user.role !== 'manager_owner') return fail(res, 403, 'Клиентов создает управляющий');
  const firstStage = listStages(req.project.id)[0];
  if (!firstStage && !current_stage_id) return fail(res, 400, 'Сначала создайте этапы воронки');
  const managerId = assigned_manager_id || null;
  const result = db.prepare(`
    INSERT INTO crm_clients
      (project_id, assigned_manager_id, current_stage_id, name, short_description, contacts, tags, deal_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.project.id,
    managerId,
    current_stage_id || firstStage.id,
    name,
    short_description || null,
    JSON.stringify(contacts),
    JSON.stringify(Array.isArray(tags) ? tags : String(tags).split(',').map((tag) => tag.trim()).filter(Boolean)),
    Number(deal_amount || 0),
  );
  const client = getClient(result.lastInsertRowid);
  if (managerId) {
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
      VALUES (?, 'new_lead_assigned', 'Новый клиент назначен', ?, 'client', ?)
    `).run(managerId, `${client.name} назначен вам в проекте ${req.project.name}.`, client.id);
  }
  ok(res, client, 201);
});

app.get('/api/clients/:clientId', requireAuth, clientGuard, (req, res) => ok(res, req.client));

app.post('/api/clients/:clientId/assign', requireAuth, requireOwner, clientGuard, (req, res) => {
  const { manager_id } = req.body;
  if (!manager_id || !isProjectMember(req.client.project_id, manager_id)) return fail(res, 400, 'Менеджер не найден в проекте');
  db.prepare('UPDATE crm_clients SET assigned_manager_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(manager_id, req.client.id);
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
    VALUES (?, 'new_lead_assigned', 'Клиент назначен', ?, 'client', ?)
  `).run(manager_id, `${req.client.name} назначен вам.`, req.client.id);
  ok(res, getClient(req.client.id));
});

app.post('/api/clients/:clientId/move-stage', requireAuth, clientGuard, (req, res) => {
  const { to_stage_id, comment } = req.body;
  const stage = db.prepare('SELECT * FROM funnel_stages WHERE id = ? AND project_id = ?').get(to_stage_id, req.client.project_id);
  if (!stage) return fail(res, 400, 'Этап не найден');
  db.prepare(`
    INSERT INTO stage_transitions (client_id, project_id, manager_id, from_stage_id, to_stage_id, comment)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.client.id, req.client.project_id, req.user.id, req.client.current_stage_id || null, stage.id, comment || null);
  db.prepare('UPDATE crm_clients SET current_stage_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(stage.id, req.client.id);
  ok(res, getClient(req.client.id));
});

app.get('/api/clients/:clientId/notes', requireAuth, clientGuard, (req, res) => {
  ok(res, db.prepare(`
    SELECT client_notes.*, crm_users.first_name || ' ' || crm_users.last_name AS manager_name
    FROM client_notes
    JOIN crm_users ON crm_users.id = client_notes.manager_id
    WHERE client_notes.client_id = ?
    ORDER BY client_notes.created_at ASC
  `).all(req.client.id));
});

app.post('/api/clients/:clientId/notes', requireAuth, clientGuard, (req, res) => {
  const { message, source = 'manual' } = req.body;
  if (!message) return fail(res, 400, 'Текст заметки обязателен');
  const result = db.prepare('INSERT INTO client_notes (client_id, manager_id, message, source) VALUES (?, ?, ?, ?)').run(req.client.id, req.user.id, message, source);
  db.prepare('UPDATE crm_clients SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.client.id);
  ok(res, db.prepare('SELECT * FROM client_notes WHERE id = ?').get(result.lastInsertRowid), 201);
});

app.get('/api/clients/:clientId/interactions', requireAuth, clientGuard, (req, res) => {
  ok(res, db.prepare(`
    SELECT client_interactions.*, crm_users.first_name || ' ' || crm_users.last_name AS manager_name
    FROM client_interactions
    JOIN crm_users ON crm_users.id = client_interactions.manager_id
    WHERE client_interactions.client_id = ?
    ORDER BY client_interactions.scheduled_at ASC
  `).all(req.client.id));
});

app.post('/api/clients/:clientId/interactions', requireAuth, clientGuard, (req, res) => {
  const { type = 'call', title, description, scheduled_at } = req.body;
  if (!title || !scheduled_at) return fail(res, 400, 'Название и дата события обязательны');
  const managerId = req.client.assigned_manager_id || req.user.id;
  const result = db.prepare(`
    INSERT INTO client_interactions (client_id, manager_id, project_id, type, title, description, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.client.id, managerId, req.client.project_id, type, title, description || null, scheduled_at);
  ok(res, db.prepare('SELECT * FROM client_interactions WHERE id = ?').get(result.lastInsertRowid), 201);
});

app.post('/api/interactions/:id/complete', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM client_interactions WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 404, 'Событие не найдено');
  if (!canAccessProject(row.project_id, req.user)) return fail(res, 403, 'Нет доступа');
  db.prepare(`
    UPDATE client_interactions
    SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(row.id);
  ok(res, db.prepare('SELECT * FROM client_interactions WHERE id = ?').get(row.id));
});

app.get('/api/notifications', requireAuth, (req, res) => {
  ok(res, db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id));
});

app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  ok(res, { ok: true });
});

app.get('/api/dashboard', requireAuth, projectGuard, (req, res) => ok(res, dashboard(req.project.id, req.user)));

app.get('/api/reports/project/:projectId', requireAuth, projectGuard, (req, res) => ok(res, dashboard(req.project.id, req.user)));

app.get('/api/reports/project/:projectId/download', requireAuth, projectGuard, (req, res) => {
  const data = dashboard(req.project.id, req.user);
  const lines = [
    ['manager', 'clients', 'pipeline_amount', 'transitions', 'completed_interactions', 'overdue_interactions'],
    ...data.managers.map((manager) => [
      manager.name,
      manager.clients_count,
      manager.pipeline_amount,
      manager.transitions_count,
      manager.completed_interactions,
      manager.overdue_interactions,
    ]),
  ];
  const csv = lines.map((line) => line.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="project-${req.project.id}-report.csv"`);
  res.send(`\uFEFF${csv}`);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера', detail: err.message });
});

app.listen(port, () => {
  console.log(`CRM API listening on http://127.0.0.1:${port}`);
});
