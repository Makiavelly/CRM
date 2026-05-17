import React, { useEffect, useMemo, useRef, useState } from 'react';
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
const selectedProjectKey = 'sales_crm_selected_project';
const liveRefreshMs = 5000;

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

function dateGroupText(value) {
  if (!value) return 'Без даты';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function timeText(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isInteractionOverdue(item) {
  return item?.status !== 'completed' && new Date(item?.scheduled_at).getTime() < Date.now();
}

function interactionStatusText(item) {
  if (item?.status === 'completed') return 'выполнено';
  if (item?.status === 'missed' || isInteractionOverdue(item)) return 'просрочено';
  return 'запланировано';
}

function monthTitle(value) {
  const date = new Date(`${value}-01T00:00`);
  return new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function buildCalendarDays(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leading = (firstDay.getDay() + 6) % 7;
  return [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return {
        day,
        key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      };
    }),
  ];
}

function App() {
  const [token, setToken] = useState(localStorage.getItem(tokenKey));
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    const savedProjectId = Number(localStorage.getItem(selectedProjectKey));
    return savedProjectId || null;
  });

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
  const projectId = projects.some((item) => item.id === selectedProjectId) ? selectedProjectId : projects[0]?.id;
  const user = me.data.user;

  function changeProject(nextProjectId) {
    const normalizedProjectId = nextProjectId ? Number(nextProjectId) : null;
    if (normalizedProjectId) localStorage.setItem(selectedProjectKey, String(normalizedProjectId));
    else localStorage.removeItem(selectedProjectKey);
    setSelectedProjectId(normalizedProjectId);
  }

  return (
    <CrmShell
      user={user}
      projects={projects}
      projectId={projectId}
      onProjectChange={changeProject}
      onLogout={() => {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(selectedProjectKey);
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
  const queryClient = useQueryClient();
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
          {!isOwner && <NavButton icon={MessageSquareText} label="Чаты" active={activeView === 'chats'} onClick={() => setActiveView('chats')} />}
          <NavButton icon={BarChart3} label="Метрики" active={activeView === 'reports'} onClick={() => setActiveView('reports')} />
          {isOwner && <NavButton icon={Settings} label="Настройки проекта" active={activeView === 'settings'} onClick={() => setActiveView('settings')} />}
        </nav>

        {projectId && <SidebarDigest projectId={projectId} />}
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p>{project?.company_name || 'Компания'} / {project?.name || 'Проект не выбран'}</p>
            <h1>{activeView === 'workspace' ? 'Клиенты и воронка' : activeView === 'chats' ? 'Чаты клиентов' : activeView === 'reports' ? 'Отчеты и метрики' : 'Настройки проекта'}</h1>
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
        {projectId && activeView === 'chats' && <Chats projectId={projectId} currentUser={user} />}
        {projectId && activeView === 'reports' && <Reports projectId={projectId} user={user} />}
        {projectId && activeView === 'settings' && (
          <ProjectSettings
            projectId={projectId}
            project={project}
            projects={projects}
            onProjectCreated={(nextProjectId) => {
              queryClient.invalidateQueries({ queryKey: ['me'] });
              onProjectChange(nextProjectId);
            }}
            onProjectDeleted={(deletedProjectId) => {
              const nextProject = projects.find((item) => item.id !== deletedProjectId);
              queryClient.setQueriesData({ queryKey: ['me'] }, (old) => old ? {
                ...old,
                projects: (old.projects || []).filter((item) => item.id !== deletedProjectId),
              } : old);
              queryClient.invalidateQueries({ queryKey: ['me'] });
              onProjectChange(nextProject?.id || null);
            }}
          />
        )}
      </main>
    </div>
  );
}

function SidebarDigest({ projectId }) {
  const dashboard = useQuery({
    queryKey: ['sidebar-dashboard', projectId],
    queryFn: () => api(`/dashboard?projectId=${projectId}`),
    enabled: Boolean(projectId),
    refetchInterval: liveRefreshMs,
  });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api('/notifications'),
    enabled: Boolean(projectId),
    refetchInterval: liveRefreshMs,
  });

  const allNotifications = notifications.data || [];
  const upcoming = dashboard.data?.upcoming || [];

  if (dashboard.isLoading || notifications.isLoading || (!allNotifications.length && !upcoming.length)) return null;

  return (
    <div className="sidebar-digest">
      <section className="sidebar-digest-block">
        <div className="sidebar-digest-title">
          <Bell size={15} />
          <span>Уведомления</span>
        </div>
        <div className="sidebar-digest-scroll">
          {allNotifications.length ? allNotifications.map((item) => (
            <article key={item.id} className={item.is_read ? 'sidebar-digest-item muted' : 'sidebar-digest-item'}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
            </article>
          )) : <p className="sidebar-empty">Новых нет</p>}
        </div>
      </section>

      <section className="sidebar-digest-block">
        <div className="sidebar-digest-title">
          <CalendarClock size={15} />
          <span>Ближайшие</span>
        </div>
        <div className="sidebar-digest-scroll">
          {upcoming.length ? upcoming.map((item) => (
            <article key={item.id} className="sidebar-digest-item">
              <strong>{item.title}</strong>
              <span>{item.client_name} · {dateText(item.scheduled_at)}</span>
            </article>
          )) : <p className="sidebar-empty">План пуст</p>}
        </div>
      </section>
    </div>
  );
}
function Workspace({ projectId, user }) {
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [query, setQuery] = useState('');
  const dashboard = useQuery({ queryKey: ['dashboard', projectId], queryFn: () => api(`/dashboard?projectId=${projectId}`), refetchInterval: liveRefreshMs });
  const stages = useQuery({ queryKey: ['stages', projectId], queryFn: () => api(`/projects/${projectId}/pipeline-stages`) });
  const clients = useQuery({ queryKey: ['clients', projectId], queryFn: () => api(`/projects/${projectId}/clients`), refetchInterval: liveRefreshMs });
  const members = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => api(`/projects/${projectId}/members`),
    enabled: user.role === 'manager_owner',
  });
  const visibleClients = (clients.data || []).filter((client) => {
    const haystack = `${client.name} ${client.short_description || ''} ${(client.tags || []).join(' ')} ${Object.values(client.contacts || {}).join(' ')}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const selectedClient = selectedClientId ? visibleClients.find((client) => client.id === selectedClientId) : null;

  if (dashboard.isLoading || stages.isLoading || clients.isLoading || (user.role === 'manager_owner' && members.isLoading)) return <Loading label="Загрузка рабочей области..." />;

  return (
    <section className="workspace-grid">
      <div className="main-workspace">
        <div className="metric-grid">
          <Metric label="Клиенты" value={dashboard.data.stats.clients} />
          <Metric label="Портфель" value={money(dashboard.data.stats.activeAmount)} tone="green" />
          <Metric label="Переходы" value={dashboard.data.stats.transitions} tone="amber" />
          <Metric label="Просрочено" value={dashboard.data.stats.overdueInteractions} tone="violet" />
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
          managers={(members.data || []).filter((member) => member.role === 'sales_manager')}
          canAssign={user.role === 'manager_owner'}
          canDelete={user.role === 'manager_owner'}
          onOpenClient={setSelectedClientId}
        />
      </div>

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

function Kanban({ projectId, stages, clients, managers = [], canAssign = false, canDelete = false, onOpenClient }) {
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
  const assignClient = useMutation({
    mutationFn: ({ clientId, managerId }) => api(`/clients/${clientId}/assign`, {
      method: 'POST',
      body: { manager_id: Number(managerId) },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
    },
  });
  const deleteClient = useMutation({
    mutationFn: (clientId) => api(`/clients/${clientId}`, { method: 'DELETE' }),
    onSuccess: (_result, clientId) => {
      queryClient.setQueryData(['clients', projectId], (old = []) => old.filter((client) => client.id !== clientId));
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
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
                    aria-label="Этап клиента"
                    value={client.current_stage_id || ''}
                    onChange={(event) => moveClient.mutate({ clientId: client.id, toStageId: event.target.value })}
                  >
                    {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  {canAssign && (
                    <label className="card-select">
                      <span>Менеджер</span>
                      <select
                        value={client.assigned_manager_id || ''}
                        onChange={(event) => assignClient.mutate({ clientId: client.id, managerId: event.target.value })}
                        disabled={!managers.length}
                      >
                        <option value="" disabled>Выберите менеджера</option>
                        {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
                      </select>
                    </label>
                  )}
                  {canDelete && (
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Удалить клиента "${client.name}" навсегда?`)) {
                          deleteClient.mutate(client.id);
                        }
                      }}
                    >
                      Удалить клиента
                    </button>
                  )}
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

function Chats({ projectId, currentUser }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState({ id: null, message: '' });
  const [clientForm, setClientForm] = useState({ name: '', short_description: '', tags: '', deal_amount: '' });
  const [contactForm, setContactForm] = useState({ phone: '', email: '', telegram: '' });
  const [eventForm, setEventForm] = useState({ title: '', type: 'call', scheduled_at: '', description: '' });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedCalendarDay, setSelectedCalendarDay] = useState(dateKey(new Date()));
  const [savedAction, setSavedAction] = useState('');
  const savedTimer = useRef(null);
  const clients = useQuery({ queryKey: ['clients', projectId], queryFn: () => api(`/projects/${projectId}/clients`), refetchInterval: liveRefreshMs });
  const stages = useQuery({ queryKey: ['stages', projectId], queryFn: () => api(`/projects/${projectId}/pipeline-stages`) });

  function markSaved(action, after) {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedAction(action);
    savedTimer.current = setTimeout(() => {
      setSavedAction('');
      after?.();
    }, 850);
  }

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const visibleClients = (clients.data || []).filter((client) => {
    const haystack = `${client.name} ${client.short_description || ''} ${(client.tags || []).join(' ')} ${Object.values(client.contacts || {}).join(' ')}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const selectedClient = (clients.data || []).find((client) => client.id === selectedClientId);
  const activeClientId = selectedClient?.id;

  useEffect(() => {
    if (!selectedClient) return;
    setClientForm({
      name: selectedClient.name || '',
      short_description: selectedClient.short_description || '',
      tags: (selectedClient.tags || []).join(', '),
      deal_amount: selectedClient.deal_amount ?? '',
    });
    setContactForm({
      phone: selectedClient.contacts?.phone || '',
      email: selectedClient.contacts?.email || '',
      telegram: selectedClient.contacts?.telegram || '',
    });
  }, [selectedClientId, selectedClient]);

  const notes = useQuery({
    queryKey: ['notes', activeClientId],
    queryFn: () => api(`/clients/${activeClientId}/notes`),
    enabled: Boolean(activeClientId),
  });
  const interactions = useQuery({
    queryKey: ['interactions', activeClientId],
    queryFn: () => api(`/clients/${activeClientId}/interactions`),
    enabled: Boolean(activeClientId),
    refetchInterval: liveRefreshMs,
  });

  const addNote = useMutation({
    mutationFn: () => api(`/clients/${activeClientId}/notes`, {
      method: 'POST',
      body: { message: note, source: 'manual' },
    }),
    onSuccess: () => {
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['notes', activeClientId] });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
    },
  });
  const updateNote = useMutation({
    mutationFn: () => api(`/notes/${editingNote.id}`, {
      method: 'PATCH',
      body: { message: editingNote.message },
    }),
    onSuccess: (updatedNote) => {
      queryClient.setQueryData(['notes', activeClientId], (old = []) => old.map((item) => (
        item.id === updatedNote.id ? { ...item, ...updatedNote } : item
      )));
      markSaved(`note-${updatedNote.id}`, () => setEditingNote({ id: null, message: '' }));
      queryClient.invalidateQueries({ queryKey: ['notes', activeClientId] });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
    },
  });
  const deleteNote = useMutation({
    mutationFn: (noteId) => api(`/notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: (_result, noteId) => {
      queryClient.setQueryData(['notes', activeClientId], (old = []) => old.filter((item) => item.id !== noteId));
      setEditingNote({ id: null, message: '' });
      queryClient.invalidateQueries({ queryKey: ['notes', activeClientId] });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
    },
  });
  const moveStage = useMutation({
    mutationFn: (stageId) => api(`/clients/${activeClientId}/move-stage`, {
      method: 'POST',
      body: { to_stage_id: Number(stageId), comment: 'Перемещено из чата' },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
    },
  });
  const updateClient = useMutation({
    mutationFn: () => api(`/clients/${activeClientId}`, {
      method: 'PATCH',
      body: clientForm,
    }),
    onSuccess: (client) => {
      queryClient.setQueryData(['clients', projectId], (old = []) => old.map((item) => (item.id === client.id ? client : item)));
      markSaved('client');
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
    },
  });
  const updateContacts = useMutation({
    mutationFn: () => api(`/clients/${activeClientId}/contacts`, {
      method: 'PUT',
      body: { contacts: contactForm },
    }),
    onSuccess: () => {
      markSaved('contacts');
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
    },
  });
  const addInteraction = useMutation({
    mutationFn: () => api(`/clients/${activeClientId}/interactions`, { method: 'POST', body: eventForm }),
    onSuccess: (interaction) => {
      const key = dateKey(interaction.scheduled_at);
      if (key) {
        setCalendarMonth(key.slice(0, 7));
        setSelectedCalendarDay(key);
      }
      setEventForm({ title: '', type: 'call', scheduled_at: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['interactions', activeClientId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-dashboard', projectId] });
    },
  });
  const deleteInteraction = useMutation({
    mutationFn: (interactionId) => api(`/interactions/${interactionId}`, { method: 'DELETE' }),
    onSuccess: (_result, interactionId) => {
      queryClient.setQueryData(['interactions', activeClientId], (old = []) => old.filter((item) => item.id !== interactionId));
      queryClient.invalidateQueries({ queryKey: ['interactions', activeClientId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
    },
  });
  const completeInteraction = useMutation({
    mutationFn: (interactionId) => api(`/interactions/${interactionId}/complete`, { method: 'POST' }),
    onSuccess: (updatedInteraction) => {
      queryClient.setQueryData(['interactions', activeClientId], (old = []) => old.map((item) => (
        item.id === updatedInteraction.id ? { ...item, ...updatedInteraction } : item
      )));
      queryClient.invalidateQueries({ queryKey: ['interactions', activeClientId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
    },
  });

  const timeline = useMemo(() => {
    const noteItems = (notes.data || []).map((item) => ({
      id: `note-${item.id}`,
      noteId: item.id,
      kind: 'note',
      text: item.message,
      date: item.created_at,
      managerId: item.manager_id,
      canEdit: Number(item.manager_id) === Number(currentUser.id),
    }));
    const interactionItems = (interactions.data || []).map((item) => ({
      id: `interaction-${item.id}`,
      kind: 'interaction',
      text: item.description || item.title,
      date: item.completed_at || item.scheduled_at,
    }));
    return [...noteItems, ...interactionItems].sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [notes.data, interactions.data, currentUser.id]);

  const groupedTimeline = useMemo(() => timeline.reduce((groups, item) => {
    const date = dateGroupText(item.date);
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.date !== date) groups.push({ date, items: [item] });
    else lastGroup.items.push(item);
    return groups;
  }, []), [timeline]);

  const calendarGroups = useMemo(() => (interactions.data || []).reduce((groups, item) => {
    const date = dateKey(item.scheduled_at);
    groups[date] = [...(groups[date] || []), item];
    return groups;
  }, {}), [interactions.data]);
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const selectedDayEvents = calendarGroups[selectedCalendarDay] || [];

  if (clients.isLoading || stages.isLoading) return <Loading label="Загрузка чатов..." />;

  if (!selectedClient) {
    return (
      <section className="chat-picker">
        <div className="toolbar">
          <label className="search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти клиента" />
          </label>
        </div>
        <div className="chat-picker-grid">
          {visibleClients.map((client) => (
            <button className="chat-picker-card" key={client.id} onClick={() => setSelectedClientId(client.id)}>
              <div>
                <strong>{client.name}</strong>
                <span>{client.stage_name || 'Без этапа'} · {client.manager_name || currentUser.name}</span>
              </div>
              <ChevronRight size={18} />
            </button>
          ))}
          {visibleClients.length === 0 && <EmptyState title="Клиенты не найдены" text="Попробуйте изменить поисковый запрос." />}
        </div>
      </section>
    );
  }

  return (
    <section className="chat-detail-layout">
      <section className="chat-history-panel">
        <header className="chat-header">
          <div>
            <button className="back-link" type="button" onClick={() => setSelectedClientId(null)}>← Все клиенты</button>
            <span>{selectedClient.stage_name || 'Клиент'}</span>
            <h2>{selectedClient.name}</h2>
            <p>{selectedClient.short_description || 'История сообщений и заметок по клиенту.'}</p>
          </div>
          <strong>{money(selectedClient.deal_amount)}</strong>
        </header>

        <div className="chat-timeline">
          {groupedTimeline.map((group) => (
            <section className="chat-date-group" key={group.date}>
              <div className="chat-date-separator">{group.date}</div>
              {group.items.map((item) => (
                <article className="chat-message" key={item.id}>
                  <div>
                    {editingNote.id === item.noteId ? (
                      <form className="message-edit-form" onSubmit={(event) => {
                        event.preventDefault();
                        updateNote.mutate();
                      }}>
                        <textarea value={editingNote.message} onChange={(event) => setEditingNote({ ...editingNote, message: event.target.value })} required />
                        <div className="message-actions">
                          <button className="secondary-button" type="button" onClick={() => setEditingNote({ id: null, message: '' })}>Отмена</button>
                          <button className={savedAction === `note-${item.noteId}` ? 'primary-button saved' : 'primary-button'} type="submit">
                            {savedAction === `note-${item.noteId}` ? 'Сохранено' : 'Сохранить'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p>{item.text}</p>
                        <footer className="message-footer">
                          <time>{timeText(item.date)}</time>
                          {item.canEdit && (
                            <span className="message-actions">
                              <button className="text-button" type="button" onClick={() => setEditingNote({ id: item.noteId, message: item.text })}>Ред..</button>
                              <button className="text-button danger" type="button" onClick={() => deleteNote.mutate(item.noteId)}>Удалить</button>
                            </span>
                          )}
                        </footer>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </section>
          ))}
          {timeline.length === 0 && <EmptyState title="История пуста" text="Добавьте первую заметку по клиенту." />}
        </div>

        <form className="chat-compose" onSubmit={(event) => {
          event.preventDefault();
          addNote.mutate();
        }}>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Новая заметка или сообщение по клиенту" required />
          <button className="primary-button" type="submit">Добавить в историю</button>
        </form>
      </section>

      <aside className="chat-side-panel">
        <Panel title="Клиент" icon={UsersRound}>
          <form className="stack-form" onSubmit={(event) => {
            event.preventDefault();
            updateClient.mutate();
          }}>
            <TextInput label="Название клиента" value={clientForm.name} onChange={(name) => setClientForm({ ...clientForm, name })} required />
            <TextInput label="Короткое описание" value={clientForm.short_description} onChange={(short_description) => setClientForm({ ...clientForm, short_description })} />
            <div className="inline-fields">
              <TextInput label="Теги" value={clientForm.tags} onChange={(tags) => setClientForm({ ...clientForm, tags })} />
              <TextInput label="Сумма" type="number" value={clientForm.deal_amount} onChange={(deal_amount) => setClientForm({ ...clientForm, deal_amount })} />
            </div>
            <button className={savedAction === 'client' ? 'secondary-button saved' : 'secondary-button'} type="submit">
              {savedAction === 'client' ? 'Сохранено' : 'Сохранить клиента'}
            </button>
          </form>
        </Panel>

        <Panel title="Этап" icon={BriefcaseBusiness}>
          <Select
            label="Этап воронки"
            value={selectedClient.current_stage_id || ''}
            onChange={(stageId) => moveStage.mutate(stageId)}
            options={(stages.data || []).map((stage) => [String(stage.id), stage.name])}
          />
        </Panel>

        <Panel title="Контакты" icon={UsersRound}>
          <form className="stack-form" onSubmit={(event) => {
            event.preventDefault();
            updateContacts.mutate();
          }}>
            <TextInput label="Телефон" value={contactForm.phone} onChange={(phone) => setContactForm({ ...contactForm, phone })} />
            <TextInput label="Email" value={contactForm.email} onChange={(email) => setContactForm({ ...contactForm, email })} />
            <TextInput label="Telegram" value={contactForm.telegram} onChange={(telegram) => setContactForm({ ...contactForm, telegram })} />
            <button className={savedAction === 'contacts' ? 'secondary-button saved' : 'secondary-button'} type="submit">
              {savedAction === 'contacts' ? 'Сохранено' : 'Сохранить контакты'}
            </button>
          </form>
        </Panel>

        <Panel title="Новое событие" icon={CalendarClock}>
          <form className="stack-form" onSubmit={(event) => {
            event.preventDefault();
            addInteraction.mutate();
          }}>
            <TextInput label="Название" value={eventForm.title} onChange={(title) => setEventForm({ ...eventForm, title })} required />
            <Select label="Тип" value={eventForm.type} onChange={(type) => setEventForm({ ...eventForm, type })} options={[
              ['call', 'Звонок'],
              ['meeting', 'Встреча'],
              ['message', 'Сообщение'],
              ['email', 'Email'],
            ]} />
            <TextInput label="Дата и время" type="datetime-local" value={eventForm.scheduled_at} onChange={(scheduled_at) => setEventForm({ ...eventForm, scheduled_at })} required />
            <TextInput label="Описание" value={eventForm.description} onChange={(description) => setEventForm({ ...eventForm, description })} />
            <button className="primary-button" type="submit">Создать событие</button>
          </form>
        </Panel>

        <Panel title="Календарь" icon={CalendarClock}>
          <div className="calendar-widget">
            <div className="calendar-toolbar">
              <button type="button" className="icon-button ghost" onClick={() => {
                const date = new Date(`${calendarMonth}-01T00:00`);
                date.setMonth(date.getMonth() - 1);
                setCalendarMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
              }}>‹</button>
              <strong>{monthTitle(calendarMonth)}</strong>
              <button type="button" className="icon-button ghost" onClick={() => {
                const date = new Date(`${calendarMonth}-01T00:00`);
                date.setMonth(date.getMonth() + 1);
                setCalendarMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
              }}>›</button>
            </div>
            <div className="calendar-weekdays">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-month-grid">
              {calendarDays.map((day, index) => day ? (
                <button
                  type="button"
                  key={day.key}
                  className={[
                    'calendar-cell',
                    calendarGroups[day.key]?.length ? 'has-events' : '',
                    selectedCalendarDay === day.key ? 'active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setSelectedCalendarDay(day.key)}
                >
                  <span>{day.day}</span>
                  {calendarGroups[day.key]?.length ? <b>{calendarGroups[day.key].length}</b> : null}
                </button>
              ) : <span className="calendar-cell empty" key={`empty-${index}`} />)}
            </div>
            <div className="calendar-list">
              {selectedDayEvents.map((item) => (
                <article className="calendar-event" key={item.id}>
                  <div>
                    <time>{timeText(item.scheduled_at)}</time>
                    <span>{item.title} · {interactionStatusText(item)}</span>
                  </div>
                  <span className="message-actions">
                    {item.status === 'planned' && !isInteractionOverdue(item) && (
                      <button className="text-button" type="button" onClick={() => completeInteraction.mutate(item.id)}>Выполнено</button>
                    )}
                    <button className="text-button danger" type="button" onClick={() => deleteInteraction.mutate(item.id)}>Удалить</button>
                  </span>
                </article>
              ))}
              {selectedDayEvents.length === 0 && <p className="sidebar-empty">На выбранный день событий нет</p>}
            </div>
          </div>
        </Panel>
      </aside>
    </section>
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
  const deleteClient = useMutation({
    mutationFn: () => api(`/clients/${client.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.setQueryData(['clients', projectId], (old = []) => old.filter((item) => item.id !== client.id));
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      onClose();
    },
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
          <div className="drawer-actions">
            {currentUser.role === 'manager_owner' && (
              <button
                className="danger-button"
                type="button"
                onClick={() => {
                  if (window.confirm(`Удалить клиента "${client.name}" навсегда?`)) {
                    deleteClient.mutate();
                  }
                }}
              >
                Удалить клиента
              </button>
            )}
            <button className="icon-button ghost" onClick={onClose}>×</button>
          </div>
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
                  <span>{item.type} · {dateText(item.scheduled_at)} · {interactionStatusText(item)}</span>
                </div>
                {item.status === 'planned' && !isInteractionOverdue(item) && (
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

function ProjectSettings({ projectId, project, projects = [], onProjectCreated, onProjectDeleted }) {
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ['members', projectId], queryFn: () => api(`/projects/${projectId}/members`) });
  const stages = useQuery({ queryKey: ['stages', projectId], queryFn: () => api(`/projects/${projectId}/pipeline-stages`) });
  const [projectForm, setProjectForm] = useState({ name: '', description: '' });
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

  const createProject = useMutation({
    mutationFn: () => api('/projects', { method: 'POST', body: projectForm }),
    onSuccess: (project) => {
      setProjectForm({ name: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onProjectCreated?.(project.id);
    },
  });
  const deleteProject = useMutation({
    mutationFn: () => api(`/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['members', projectId] });
      queryClient.removeQueries({ queryKey: ['stages', projectId] });
      queryClient.removeQueries({ queryKey: ['clients', projectId] });
      queryClient.removeQueries({ queryKey: ['dashboard', projectId] });
      queryClient.removeQueries({ queryKey: ['sidebar-dashboard', projectId] });
      queryClient.removeQueries({ queryKey: ['report', projectId] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      onProjectDeleted?.(projectId);
    },
  });
  const addMember = useMutation({
    mutationFn: () => api(`/projects/${projectId}/members`, { method: 'POST', body: memberForm }),
    onSuccess: () => {
      setMemberForm({ first_name: '', last_name: '', email: '' });
      queryClient.invalidateQueries({ queryKey: ['members', projectId] });
    },
  });
  const deleteMember = useMutation({
    mutationFn: (memberId) => api(`/projects/${projectId}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: (_result, memberId) => {
      queryClient.setQueryData(['members', projectId], (old = []) => old.filter((member) => member.id !== memberId));
      queryClient.invalidateQueries({ queryKey: ['members', projectId] });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
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
    onSuccess: (stage) => {
      setStageName('');
      queryClient.setQueryData(['stages', projectId], (old = []) => {
        const next = old.some((item) => item.id === stage.id) ? old : [...old, stage];
        return [...next].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      });
      queryClient.invalidateQueries({ queryKey: ['stages', projectId] });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
    },
  });
  const deleteStage = useMutation({
    mutationFn: (stageId) => api(`/projects/${projectId}/pipeline-stages/${stageId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stages', projectId] });
      queryClient.invalidateQueries({ queryKey: ['clients', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      queryClient.invalidateQueries({ queryKey: ['report', projectId] });
    },
  });

  if (members.isLoading || stages.isLoading) return <Loading label="Загрузка настроек..." />;

  return (
    <section className="settings-grid">
      <Panel title="Новый проект" icon={BriefcaseBusiness}>
        <form className="stack-form" onSubmit={(event) => {
          event.preventDefault();
          createProject.mutate();
        }}>
          <TextInput label="Название проекта" value={projectForm.name} onChange={(name) => setProjectForm({ ...projectForm, name })} required />
          <TextInput label="Описание" value={projectForm.description} onChange={(description) => setProjectForm({ ...projectForm, description })} />
          <button className="primary-button" type="submit"><Plus size={18} /> Создать проект</button>
          <p className="hint">Проект сразу получит базовую воронку: лид, интерес, квалификация, переговоры, сделка, отказ.</p>
        </form>
      </Panel>

      <Panel title="Удаление проекта" icon={Settings}>
        <div className="stack-form">
          <p className="hint">
            Проект “{project?.name || 'текущий проект'}” будет удален вместе с клиентами, этапами, заметками, событиями и отчетной историей.
          </p>
          <button
            className="danger-button"
            type="button"
            disabled={deleteProject.isPending}
            onClick={() => {
              const projectName = project?.name || 'текущий проект';
              if (window.confirm(`Удалить проект "${projectName}" навсегда? Это действие нельзя отменить.`)) {
                deleteProject.mutate();
              }
            }}
          >
            {deleteProject.isPending ? 'Удаление...' : 'Удалить проект'}
          </button>
          {projects.length <= 1 && <p className="hint">Это последний доступный проект. После удаления рабочая область станет пустой.</p>}
        </div>
      </Panel>

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
            <div className="stage-row" key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <span>{member.email} · {member.role === 'manager_owner' ? 'управляющий' : 'менеджер'}</span>
              </div>
              {member.role === 'sales_manager' && (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Удалить менеджера "${member.name}" из проекта? Его клиенты останутся без назначенного менеджера.`)) {
                      deleteMember.mutate(member.id);
                    }
                  }}
                >
                  Удалить
                </button>
              )}
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
            <div className="stage-row" key={stage.id}>
              <div>
                <strong>{stage.position}. {stage.name}</strong>
                <span>Максимум без активности: {stage.max_days_without_activity} дней</span>
              </div>
              <button
                className="danger-button"
                type="button"
                onClick={() => deleteStage.mutate(stage.id)}
                title="Удалить этап можно только если на нем нет клиентов"
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function Reports({ projectId, user }) {
  const [period, setPeriod] = useState({ from: '', to: '' });
  const reportParams = new URLSearchParams();
  if (period.from) reportParams.set('from', period.from);
  if (period.to) reportParams.set('to', period.to);
  const reportQuery = reportParams.toString();
  const reportPath = `/reports/project/${projectId}${reportQuery ? `?${reportQuery}` : ''}`;
  const report = useQuery({
    queryKey: ['report', projectId, period.from, period.to],
    queryFn: () => api(reportPath),
  });
  if (report.isLoading) return <Loading label="Считаю метрики..." />;
  const isOwner = user.role === 'manager_owner';

  async function downloadCsv() {
    const token = localStorage.getItem(tokenKey);
    const response = await fetch(`/api/reports/project/${projectId}/download${reportQuery ? `?${reportQuery}` : ''}`, {
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
      <div className="report-actions">
        <TextInput label="С" type="date" value={period.from} onChange={(from) => setPeriod({ ...period, from })} />
        <TextInput label="По" type="date" value={period.to} onChange={(to) => setPeriod({ ...period, to })} />
        <button className="primary-button" type="button" onClick={() => report.refetch()}>Сформировать отчёт</button>
        <button className="secondary-button" type="button" onClick={() => setPeriod({ from: '', to: '' })}>Всё время</button>
        <button className="secondary-button" type="button" onClick={downloadCsv}><Download size={17} /> Скачать CSV</button>
      </div>
      <div className="metric-grid">
        <Metric label="Клиенты" value={report.data.stats.clients} />
        <Metric label="Портфель" value={money(report.data.stats.activeAmount)} tone="green" />
        <Metric label="Успешные сделки" value={report.data.stats.wonClients} tone="green" />
        <Metric label="Сумма сделок" value={money(report.data.stats.wonAmount)} tone="amber" />
      </div>
      <div className="metric-grid">
        <Metric label="Переходы" value={report.data.stats.transitions} />
        <Metric label="Заметки" value={report.data.stats.notes} tone="green" />
        <Metric label="Выполнено событий" value={report.data.stats.completedInteractions} tone="amber" />
        <Metric label="Просрочено" value={report.data.stats.overdueInteractions} tone="violet" />
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
        {isOwner && (
          <Panel title="Просрочили события" icon={CalendarClock}>
            <div className="manager-list">
              {(report.data.overdue || []).map((item) => (
                <div className="manager-row" key={item.id}>
                  <div>
                    <strong>{item.manager_name || 'Без менеджера'}</strong>
                    <span>{item.client_name} · {item.title}</span>
                  </div>
                  <b>{dateText(item.scheduled_at)}</b>
                </div>
              ))}
              {(report.data.overdue || []).length === 0 && (
                <p className="sidebar-empty">Просроченных событий нет</p>
              )}
            </div>
          </Panel>
        )}
        <Panel title={isOwner ? 'Лидерборд менеджеров' : 'Моя активность'} icon={BarChart3}>
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

function Panel({ title, icon: Icon, children, className = '' }) {
  return (
    <section className={`panel ${className}`.trim()}>
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
