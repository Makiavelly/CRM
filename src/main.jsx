import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Download,
  Gauge,
  LogOut,
  MessageSquareText,
  Plus,
  Search,
  Settings,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import './styles.css';

const queryClient = new QueryClient();
const tokenKey = 'sales_crm_token';

async function api(path, options = {}) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(`/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Ошибка запроса');
  return data;
}

function money(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function dateText(value) {
  if (!value) return 'Без даты';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function App() {
  const [token, setToken] = useState(localStorage.getItem(tokenKey));
  const [selectedProjectId, setSelectedProjectId] = useState(null);

  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => api('/auth/me'),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) return <AuthScreen onAuth={(nextToken) => setToken(nextToken)} />;
  if (me.isError) return <AuthScreen onAuth={(nextToken) => setToken(nextToken)} expired />;
  if (me.isLoading) return <Loading label="Загрузка профиля..." />;

  const projects = me.data.projects || [];
  const projectId = selectedProjectId || projects[0]?.id;
  const user = me.data.user;

  return (
    <CrmShell
      user={user}
      projects={projects}
      projectId={projectId}
      onProjectChange={setSelectedProjectId}
      onLogout={() => {
        localStorage.removeItem(tokenKey);
        queryClient.clear();
        setToken(null);
      }}
    />
  );
}

function AuthScreen({ onAuth, expired = false }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: 'owner@crm.local',
    password: 'demo123',
    role: 'manager_owner',
    company_name: '',
  });
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body: form });
      localStorage.setItem(tokenKey, data.token);
      onAuth(data.token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <span><Gauge size={24} /></span>
          <div>
            <strong>Sales CRM</strong>
            <p>Рабочая система для контроля продаж</p>
          </div>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Вход</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Регистрация</button>
        </div>

        {expired && <p className="notice">Сессия закончилась. Войдите снова.</p>}
        {error && <p className="error">{error}</p>}

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <>
              <div className="inline-fields">
                <TextInput label="Имя" value={form.first_name} onChange={(first_name) => setForm({ ...form, first_name })} required />
                <TextInput label="Фамилия" value={form.last_name} onChange={(last_name) => setForm({ ...form, last_name })} required />
              </div>
              <Select label="Роль" value={form.role} onChange={(role) => setForm({ ...form, role })} options={[
                ['manager_owner', 'Управляющий'],
                ['sales_manager', 'Менеджер'],
              ]} />
              {form.role === 'manager_owner' && (
                <TextInput label="Компания" value={form.company_name} onChange={(company_name) => setForm({ ...form, company_name })} required />
              )}
            </>
          )}
          <TextInput label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} required />
          <TextInput label="Пароль" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} required />
          <button className="primary-button" type="submit">{mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
        </form>

        <div className="demo-logins">
          <button onClick={() => setForm({ ...form, email: 'owner@crm.local', password: 'demo123' })}>owner@crm.local</button>
          <button onClick={() => setForm({ ...form, email: 'ivan@crm.local', password: 'demo123' })}>ivan@crm.local</button>
          <button onClick={() => setForm({ ...form, email: 'anna@crm.local', password: 'demo123' })}>anna@crm.local</button>
        </div>
      </section>
    </main>
  );
}

function CrmShell({ user, projects, projectId, onProjectChange, onLogout }) {
  const [activeView, setActiveView] = useState('workspace');
  const project = projects.find((item) => item.id === projectId);
  const isOwner = user.role === 'manager_owner';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Gauge size={22} /></div>
          <div>
            <strong>Sales CRM</strong>
            <span>{isOwner ? 'Управляющий' : 'Менеджер продаж'}</span>
          </div>
        </div>

        <nav className="nav">
          <NavButton icon={BriefcaseBusiness} label="Рабочая область" active={activeView === 'workspace'} onClick={() => setActiveView('workspace')} />
          <NavButton icon={BarChart3} label="Метрики" active={activeView === 'reports'} onClick={() => setActiveView('reports')} />
          {isOwner && <NavButton icon={Settings} label="Настройки проекта" active={activeView === 'settings'} onClick={() => setActiveView('settings')} />}
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p>{project?.company_name || 'Компания'} / {project?.name || 'Проект не выбран'}</p>
            <h1>{activeView === 'workspace' ? 'Клиенты и воронка' : activeView === 'reports' ? 'Отчеты и метрики' : 'Настройки проекта'}</h1>
          </div>
          <div className="topbar-actions">
            <select value={projectId || ''} onChange={(event) => onProjectChange(Number(event.target.value))}>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <span className="role-pill">{user.name}</span>
            <button className="icon-button ghost" title="Выйти" onClick={onLogout}><LogOut size={18} /></button>
          </div>
        </header>

        {!projectId && <EmptyState title="Нет проекта" text="Управляющий создает компанию и проект при регистрации." />}
        {projectId && activeView === 'workspace' && <Workspace projectId={projectId} user={user} />}
        {projectId && activeView === 'reports' && <Reports projectId={projectId} />}
        {projectId && activeView === 'settings' && <ProjectSettings projectId={projectId} />}
      </main>
    </div>
  );
}

function Workspace({ projectId, user }) {
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [query, setQuery] = useState('');
  const dashboard = useQuery({ queryKey: ['dashboard', projectId], queryFn: () => api(`/dashboard?projectId=${projectId}`) });
  const stages = useQuery({ queryKey: ['stages', projectId], queryFn: () => api(`/projects/${projectId}/pipeline-stages`) });
  const clients = useQuery({ queryKey: ['clients', projectId], queryFn: () => api(`/projects/${projectId}/clients`) });
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => api('/notifications') });
  const visibleClients = (clients.data || []).filter((client) => {
    const haystack = `${client.name} ${client.short_description || ''} ${(client.tags || []).join(' ')} ${Object.values(client.contacts || {}).join(' ')}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const selectedClient = selectedClientId ? visibleClients.find((client) => client.id === selectedClientId) : null;

  if (dashboard.isLoading || stages.isLoading || clients.isLoading) return <Loading label="Загрузка рабочей области..." />;

  return (
    <section className="workspace-grid">
      <div className="main-workspace">
        <div className="metric-grid">
          <Metric label="Клиенты" value={dashboard.data.stats.clients} />
          <Metric label="Портфель" value={money(dashboard.data.stats.activeAmount)} tone="green" />
          <Metric label="Запланировано" value={dashboard.data.stats.plannedInteractions} tone="amber" />
          <Metric label="Уведомления" value={dashboard.data.stats.unreadNotifications} tone="violet" />
        </div>

        <div className="toolbar">
          <label className="search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по клиентам, тегам, контактам" />
          </label>
        </div>

        <Kanban
          projectId={projectId}
          stages={stages.data}
          clients={visibleClients}
          onOpenClient={setSelectedClientId}
        />
      </div>

      <aside className="right-rail">
        <Panel title="Уведомления" icon={Bell}>
          <div className="rail-list">
            {(notifications.data || []).slice(0, 4).map((item) => (
              <article key={item.id} className={item.is_read ? 'rail-item muted' : 'rail-item'}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </article>
            ))}
          </div>
        </Panel>
        <Panel title="Ближайшие события" icon={CalendarClock}>
          <div className="rail-list">
            {(dashboard.data.upcoming || []).map((item) => (
              <article key={item.id} className="rail-item">
                <strong>{item.title}</strong>
                <span>{item.client_name} · {dateText(item.scheduled_at)}</span>
              </article>
            ))}
          </div>
        </Panel>
      </aside>

      {selectedClient && (
        <ClientDrawer
          client={selectedClient}
          projectId={projectId}
          stages={stages.data}
          currentUser={user}
          onClose={() => setSelectedClientId(null)}
        />
      )}
    </section>
  );
}

function Kanban({ projectId, stages, clients, onOpenClient }) {
  const queryClient = useQueryClient();
  const moveClient = useMutation({
    mutationFn: ({ clientId, toStageId }) => api(`/clients/${clientId}/move-stage`, {
      method: 'POST',
      body: { to_stage_id: Number(toStageId), comment: 'Перемещено с Kanban-доски' },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
    },
  });

  return (
    <div className="kanban">
      {stages.map((stage) => {
        const stageClients = clients.filter((client) => client.current_stage_id === stage.id);
        return (
          <section className="kanban-column" key={stage.id}>
            <header>
              <div>
                <h3>{stage.name}</h3>
                <span style={{ color: stage.color }}>{money(stageClients.reduce((sum, client) => sum + Number(client.deal_amount || 0), 0))}</span>
              </div>
              <b>{stageClients.length}</b>
            </header>
            <div className="deal-stack">
              {stageClients.map((client) => (
                <article className="client-card" key={client.id}>
                  <button className="card-open" onClick={() => onOpenClient(client.id)}>
                    <div>
                      <h4>{client.name}</h4>
                      <p>{client.short_description || 'Описание не заполнено'}</p>
                    </div>
                    <ChevronRight size={18} />
                  </button>
                  <div className="tags">
                    {(client.tags || []).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <div className="card-meta">
                    <strong>{money(client.deal_amount)}</strong>
                    <span>{client.manager_name || 'Без менеджера'}</span>
                  </div>
                  <select
                    value={client.current_stage_id || ''}
                    onChange={(event) => moveClient.mutate({ clientId: client.id, toStageId: event.target.value })}
                  >
                    {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </article>
              ))}
              {stageClients.length === 0 && <div className="empty-column">Нет клиентов</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ClientDrawer({ client, projectId, stages, currentUser, onClose }) {
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: ['notes', client.id], queryFn: () => api(`/clients/${client.id}/notes`) });
  const interactions = useQuery({ queryKey: ['interactions', client.id], queryFn: () => api(`/clients/${client.id}/interactions`) });
  const [note, setNote] = useState('');
  const [eventForm, setEventForm] = useState({ title: '', type: 'call', scheduled_at: '' });

  const addNote = useMutation({
    mutationFn: () => api(`/clients/${client.id}/notes`, { method: 'POST', body: { message: note, source: 'manual' } }),
    onSuccess: () => {
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['notes', client.id] });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
    },
  });
  const addInteraction = useMutation({
    mutationFn: () => api(`/clients/${client.id}/interactions`, { method: 'POST', body: eventForm }),
    onSuccess: () => {
      setEventForm({ title: '', type: 'call', scheduled_at: '' });
      queryClient.invalidateQueries({ queryKey: ['interactions', client.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
    },
  });
  const completeInteraction = useMutation({
    mutationFn: (id) => api(`/interactions/${id}/complete`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['interactions', client.id] }),
  });

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span>{client.stage_name}</span>
            <h2>{client.name}</h2>
            <p>{client.short_description}</p>
          </div>
          <button className="icon-button ghost" onClick={onClose}>×</button>
        </header>

        <section className="client-summary">
          <div><span>Сумма</span><strong>{money(client.deal_amount)}</strong></div>
          <div><span>Менеджер</span><strong>{client.manager_name || currentUser.name}</strong></div>
          <div><span>Телефон</span><strong>{client.contacts?.phone || 'Не указан'}</strong></div>
          <div><span>Email</span><strong>{client.contacts?.email || 'Не указан'}</strong></div>
        </section>

        <Panel title="Записная книжка" icon={MessageSquareText}>
          <div className="note-list">
            {(notes.data || []).map((item) => (
              <article className="note-bubble" key={item.id}>
                <p>{item.message}</p>
                <span>{item.manager_name || currentUser.name} · {dateText(item.created_at)} · {item.source}</span>
              </article>
            ))}
          </div>
          <form className="note-form" onSubmit={(event) => {
            event.preventDefault();
            addNote.mutate();
          }}>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Новая заметка по клиенту" required />
            <button className="primary-button" type="submit">Добавить заметку</button>
          </form>
        </Panel>

        <Panel title="События" icon={CalendarClock}>
          <div className="rail-list">
            {(interactions.data || []).map((item) => (
              <article className="interaction-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.type} · {dateText(item.scheduled_at)} · {item.status}</span>
                </div>
                {item.status !== 'completed' && (
                  <button className="icon-button" title="Выполнено" onClick={() => completeInteraction.mutate(item.id)}>
                    <CheckCircle2 size={18} />
                  </button>
                )}
              </article>
            ))}
          </div>
          <form className="event-form" onSubmit={(event) => {
            event.preventDefault();
            addInteraction.mutate();
          }}>
            <TextInput label="Событие" value={eventForm.title} onChange={(title) => setEventForm({ ...eventForm, title })} required />
            <div className="inline-fields">
              <Select label="Тип" value={eventForm.type} onChange={(type) => setEventForm({ ...eventForm, type })} options={[
                ['call', 'Звонок'],
                ['meeting', 'Встреча'],
                ['message', 'Сообщение'],
                ['email', 'Email'],
              ]} />
              <TextInput label="Когда" type="datetime-local" value={eventForm.scheduled_at} onChange={(scheduled_at) => setEventForm({ ...eventForm, scheduled_at })} required />
            </div>
            <button className="secondary-button" type="submit">Запланировать</button>
          </form>
        </Panel>
      </aside>
    </div>
  );
}

function ProjectSettings({ projectId }) {
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ['members', projectId], queryFn: () => api(`/projects/${projectId}/members`) });
  const stages = useQuery({ queryKey: ['stages', projectId], queryFn: () => api(`/projects/${projectId}/pipeline-stages`) });
  const [memberForm, setMemberForm] = useState({ first_name: '', last_name: '', email: '' });
  const [clientForm, setClientForm] = useState({
    name: '',
    short_description: '',
    phone: '',
    email: '',
    tags: '',
    deal_amount: '',
    assigned_manager_id: '',
  });
  const [stageName, setStageName] = useState('');

  const managers = (members.data || []).filter((member) => member.role === 'sales_manager');
  const firstStageId = stages.data?.[0]?.id;

  const addMember = useMutation({
    mutationFn: () => api(`/projects/${projectId}/members`, { method: 'POST', body: memberForm }),
    onSuccess: () => {
      setMemberForm({ first_name: '', last_name: '', email: '' });
      queryClient.invalidateQueries({ queryKey: ['members', projectId] });
    },
  });
  const addClient = useMutation({
    mutationFn: () => api(`/projects/${projectId}/clients`, {
      method: 'POST',
      body: {
        name: clientForm.name,
        short_description: clientForm.short_description,
        assigned_manager_id: clientForm.assigned_manager_id ? Number(clientForm.assigned_manager_id) : null,
        current_stage_id: firstStageId,
        deal_amount: Number(clientForm.deal_amount || 0),
        contacts: { phone: clientForm.phone, email: clientForm.email },
        tags: clientForm.tags,
      },
    }),
    onSuccess: () => {
      setClientForm({ name: '', short_description: '', phone: '', email: '', tags: '', deal_amount: '', assigned_manager_id: '' });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
    },
  });
  const addStage = useMutation({
    mutationFn: () => api(`/projects/${projectId}/pipeline-stages`, { method: 'POST', body: { name: stageName } }),
    onSuccess: () => {
      setStageName('');
      queryClient.invalidateQueries({ queryKey: ['stages', projectId] });
    },
  });

  if (members.isLoading || stages.isLoading) return <Loading label="Загрузка настроек..." />;

  return (
    <section className="settings-grid">
      <Panel title="Менеджеры проекта" icon={UserPlus}>
        <form className="stack-form" onSubmit={(event) => {
          event.preventDefault();
          addMember.mutate();
        }}>
          <div className="inline-fields">
            <TextInput label="Имя" value={memberForm.first_name} onChange={(first_name) => setMemberForm({ ...memberForm, first_name })} />
            <TextInput label="Фамилия" value={memberForm.last_name} onChange={(last_name) => setMemberForm({ ...memberForm, last_name })} />
          </div>
          <TextInput label="Email" value={memberForm.email} onChange={(email) => setMemberForm({ ...memberForm, email })} required />
          <button className="primary-button" type="submit"><Plus size={18} /> Добавить менеджера</button>
          <p className="hint">Если менеджера нет, он будет создан с паролем demo123.</p>
        </form>
        <div className="settings-list">
          {members.data.map((member) => (
            <div key={member.id}>
              <strong>{member.name}</strong>
              <span>{member.email} · {member.role === 'manager_owner' ? 'управляющий' : 'менеджер'}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Новый клиент" icon={UsersRound}>
        <form className="stack-form" onSubmit={(event) => {
          event.preventDefault();
          addClient.mutate();
        }}>
          <TextInput label="Клиент" value={clientForm.name} onChange={(name) => setClientForm({ ...clientForm, name })} required />
          <TextInput label="Короткое описание" value={clientForm.short_description} onChange={(short_description) => setClientForm({ ...clientForm, short_description })} />
          <div className="inline-fields">
            <TextInput label="Телефон" value={clientForm.phone} onChange={(phone) => setClientForm({ ...clientForm, phone })} />
            <TextInput label="Email" value={clientForm.email} onChange={(email) => setClientForm({ ...clientForm, email })} />
          </div>
          <div className="inline-fields">
            <TextInput label="Теги" value={clientForm.tags} onChange={(tags) => setClientForm({ ...clientForm, tags })} />
            <TextInput label="Сумма" type="number" value={clientForm.deal_amount} onChange={(deal_amount) => setClientForm({ ...clientForm, deal_amount })} />
          </div>
          <Select label="Назначить" value={clientForm.assigned_manager_id} onChange={(assigned_manager_id) => setClientForm({ ...clientForm, assigned_manager_id })} options={[
            ['', 'Без менеджера'],
            ...managers.map((manager) => [manager.id, manager.name]),
          ]} />
          <button className="primary-button" type="submit"><Plus size={18} /> Создать клиента</button>
        </form>
      </Panel>

      <Panel title="Этапы воронки" icon={Settings}>
        <form className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          addStage.mutate();
        }}>
          <TextInput label="Название этапа" value={stageName} onChange={setStageName} required />
          <button className="secondary-button" type="submit">Добавить</button>
        </form>
        <div className="settings-list">
          {stages.data.map((stage) => (
            <div key={stage.id}>
              <strong>{stage.position}. {stage.name}</strong>
              <span>Максимум без активности: {stage.max_days_without_activity} дней</span>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function Reports({ projectId }) {
  const report = useQuery({ queryKey: ['report', projectId], queryFn: () => api(`/reports/project/${projectId}`) });
  if (report.isLoading) return <Loading label="Считаю метрики..." />;

  async function downloadCsv() {
    const token = localStorage.getItem(tokenKey);
    const response = await fetch(`/api/reports/project/${projectId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `project-${projectId}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Клиенты" value={report.data.stats.clients} />
        <Metric label="Портфель" value={money(report.data.stats.activeAmount)} tone="green" />
        <Metric label="События" value={report.data.stats.plannedInteractions} tone="amber" />
        <Metric label="Уведомления" value={report.data.stats.unreadNotifications} tone="violet" />
      </div>
      <div className="two-columns">
        <Panel title="Воронка проекта" icon={BriefcaseBusiness}>
          <div className="funnel">
            {report.data.stages.map((stage) => (
              <div className="funnel-row" key={stage.id}>
                <div>
                  <strong>{stage.name}</strong>
                  <span>{stage.clients_count} клиентов · {money(stage.amount)}</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${Math.max(stage.clients_count * 18, 5)}%`, background: stage.color }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Лидерборд менеджеров" icon={BarChart3}>
          <div className="manager-list">
            {report.data.managers.map((manager) => (
              <div className="manager-row" key={manager.id}>
                <div>
                  <strong>{manager.name}</strong>
                  <span>{manager.clients_count} клиентов · {manager.transitions_count} переходов · просрочек {manager.overdue_interactions}</span>
                </div>
                <b>{money(manager.pipeline_amount)}</b>
              </div>
            ))}
          </div>
          <button className="download-link" onClick={downloadCsv}><Download size={17} /> Скачать CSV</button>
        </Panel>
      </div>
    </section>
  );
}

function NavButton({ icon: Icon, label, active, onClick }) {
  return (
    <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

function Metric({ label, value, tone = 'blue' }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>{title}</h2>
        {Icon && <div className="panel-action"><Icon size={18} /></div>}
      </header>
      {children}
    </section>
  );
}

function TextInput({ label, value, onChange, type = 'text', required = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} required={required} />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
    </label>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function Loading({ label = 'Загрузка...' }) {
  return <div className="loading">{label}</div>;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
