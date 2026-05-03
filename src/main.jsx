import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  Mail,
  Phone,
  Plus,
  Settings,
  UserRound,
  UsersRound,
} from 'lucide-react';
import './styles.css';

const queryClient = new QueryClient();

const tabs = [
  { id: 'dashboard', label: 'Обзор', icon: LayoutDashboard },
  { id: 'leads', label: 'Лиды', icon: UserRound },
  { id: 'clients', label: 'Клиенты', icon: UsersRound },
  { id: 'deals', label: 'Воронка', icon: BriefcaseBusiness },
  { id: 'tasks', label: 'Задачи', icon: ClipboardList },
  { id: 'reports', label: 'Отчеты', icon: BarChart3 },
  { id: 'settings', label: 'Настройки', icon: Settings },
];

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
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
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const ActiveIcon = tabs.find((tab) => tab.id === activeTab)?.icon || LayoutDashboard;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Gauge size={22} /></div>
          <div>
            <strong>Sales CRM</strong>
            <span>Отдел продаж</span>
          </div>
        </div>

        <nav className="nav">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p>CRM-система для отдела продаж</p>
            <h1><ActiveIcon size={28} /> {tabs.find((tab) => tab.id === activeTab)?.label}</h1>
          </div>
          <div className="role-pill">Роль: руководитель</div>
        </header>

        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'leads' && <Leads />}
        {activeTab === 'clients' && <Clients />}
        {activeTab === 'deals' && <Deals />}
        {activeTab === 'tasks' && <Tasks />}
        {activeTab === 'reports' && <Reports />}
        {activeTab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

function useReferenceData() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const stages = useQuery({ queryKey: ['stages'], queryFn: () => api('/stages') });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api('/clients') });
  const deals = useQuery({ queryKey: ['deals'], queryFn: () => api('/deals') });

  return {
    users: users.data || [],
    stages: stages.data || [],
    clients: clients.data || [],
    deals: deals.data || [],
  };
}

function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard') });

  if (isLoading) return <Loading />;

  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Активные лиды" value={data.stats.leads} tone="blue" />
        <Metric label="Клиенты" value={data.stats.clients} tone="green" />
        <Metric label="Открытые сделки" value={data.stats.openDeals} tone="amber" />
        <Metric label="Просроченные задачи" value={data.stats.overdueTasks} tone="red" />
        <Metric label="Прогноз продаж" value={money(data.stats.forecastAmount)} tone="violet" />
      </div>

      <div className="two-columns">
        <Panel title="Воронка продаж" action={<BriefcaseBusiness size={18} />}>
          <Funnel stages={data.funnel} />
        </Panel>
        <Panel title="Ближайшие задачи" action={<ClipboardList size={18} />}>
          <TaskList tasks={data.tasks} compact />
        </Panel>
      </div>

      <Panel title="Последние коммуникации" action={<Mail size={18} />}>
        <div className="activity-list">
          {data.communications.map((item) => (
            <div className="activity" key={item.id}>
              <span className="type">{item.type}</span>
              <div>
                <strong>{item.client_name || item.deal_title || 'Контакт'}</strong>
                <p>{item.summary}</p>
              </div>
              <time>{dateText(item.created_at)}</time>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function Leads() {
  const queryClient = useQueryClient();
  const { users } = useReferenceData();
  const { data = [], isLoading } = useQuery({ queryKey: ['leads'], queryFn: () => api('/leads') });
  const [form, setForm] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    source: 'web',
    product: '',
    manager_id: '',
    notes: '',
  });

  const createLead = useMutation({
    mutationFn: (body) => api('/leads', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setForm({ name: '', company: '', phone: '', email: '', source: 'web', product: '', manager_id: '', notes: '' });
    },
  });

  const patchLead = useMutation({
    mutationFn: ({ id, body }) => api(`/leads/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const convertLead = useMutation({
    mutationFn: (lead) => api(`/leads/${lead.id}/convert`, {
      method: 'POST',
      body: { amount: 100000, title: `Сделка: ${lead.company || lead.name}` },
    }),
    onSuccess: () => {
      ['leads', 'clients', 'deals', 'dashboard', 'reports'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    },
  });

  if (isLoading) return <Loading />;

  return (
    <section className="stack">
      <Panel title="Регистрация входящей заявки" action={<Plus size={18} />}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          createLead.mutate({ ...form, manager_id: form.manager_id || null });
        }}>
          <TextInput label="Имя" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
          <TextInput label="Компания" value={form.company} onChange={(company) => setForm({ ...form, company })} />
          <TextInput label="Телефон" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
          <TextInput label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
          <Select label="Источник" value={form.source} onChange={(source) => setForm({ ...form, source })} options={[
            ['web', 'Сайт'],
            ['email', 'Email'],
            ['phone', 'Звонок'],
            ['referral', 'Рекомендация'],
          ]} />
          <TextInput label="Продукт" value={form.product} onChange={(product) => setForm({ ...form, product })} />
          <Select label="Менеджер" value={form.manager_id} onChange={(manager_id) => setForm({ ...form, manager_id })} options={[
            ['', 'Не назначен'],
            ...users.filter((user) => user.role === 'manager').map((user) => [user.id, user.name]),
          ]} />
          <TextInput label="Комментарий" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          <button className="primary-button" type="submit"><Plus size={18} /> Добавить лид</button>
        </form>
      </Panel>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Лид</th>
              <th>Контакты</th>
              <th>Источник</th>
              <th>Статус</th>
              <th>Менеджер</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {data.map((lead) => (
              <tr key={lead.id}>
                <td>
                  <strong>{lead.name}</strong>
                  <span>{lead.company || lead.product || 'Без компании'}</span>
                </td>
                <td>
                  <span><Phone size={14} /> {lead.phone || 'нет телефона'}</span>
                  <span><Mail size={14} /> {lead.email || 'нет email'}</span>
                </td>
                <td>{lead.source}</td>
                <td><Status value={lead.status} /></td>
                <td>{lead.manager_name || 'Не назначен'}</td>
                <td className="actions">
                  {lead.status !== 'converted' && (
                    <>
                      <button onClick={() => patchLead.mutate({ id: lead.id, body: { status: 'qualified' } })}>Квалифицировать</button>
                      <button onClick={() => convertLead.mutate(lead)}>В сделку</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Clients() {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['clients'], queryFn: () => api('/clients') });
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', source: 'manual', notes: '' });
  const createClient = useMutation({
    mutationFn: (body) => api('/clients', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setForm({ name: '', company: '', phone: '', email: '', source: 'manual', notes: '' });
    },
  });

  if (isLoading) return <Loading />;

  return (
    <section className="stack">
      <Panel title="Клиентская база" action={<UsersRound size={18} />}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          createClient.mutate(form);
        }}>
          <TextInput label="Имя" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
          <TextInput label="Компания" value={form.company} onChange={(company) => setForm({ ...form, company })} />
          <TextInput label="Телефон" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
          <TextInput label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
          <TextInput label="Комментарий" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          <button className="primary-button" type="submit"><Plus size={18} /> Добавить клиента</button>
        </form>
      </Panel>

      <div className="cards-grid">
        {data.map((client) => (
          <article className="entity-card" key={client.id}>
            <div className="entity-head">
              <div>
                <h3>{client.name}</h3>
                <p>{client.company || 'Частный клиент'}</p>
              </div>
              <span>{client.deals_count} сделок</span>
            </div>
            <div className="entity-details">
              <span><Phone size={15} /> {client.phone || 'Телефон не указан'}</span>
              <span><Mail size={15} /> {client.email || 'Email не указан'}</span>
              <strong>{money(client.total_amount)}</strong>
            </div>
            <p>{client.notes || 'История клиента пока не заполнена.'}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Deals() {
  const queryClient = useQueryClient();
  const { users, stages, clients } = useReferenceData();
  const { data = [], isLoading } = useQuery({ queryKey: ['deals'], queryFn: () => api('/deals') });
  const [form, setForm] = useState({
    title: '',
    client_id: '',
    manager_id: '',
    stage_id: '',
    amount: '',
    probability: 35,
    close_date: '',
    notes: '',
  });

  const createDeal = useMutation({
    mutationFn: (body) => api('/deals', { method: 'POST', body }),
    onSuccess: () => {
      ['deals', 'dashboard', 'reports', 'clients'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      setForm({ title: '', client_id: '', manager_id: '', stage_id: '', amount: '', probability: 35, close_date: '', notes: '' });
    },
  });

  const patchDeal = useMutation({
    mutationFn: ({ id, body }) => api(`/deals/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      ['deals', 'dashboard', 'reports', 'clients'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    },
  });

  const grouped = useMemo(() => stages.map((stage) => ({
    ...stage,
    deals: data.filter((deal) => deal.stage_id === stage.id && deal.status === 'open'),
  })), [stages, data]);

  if (isLoading) return <Loading />;

  return (
    <section className="stack">
      <Panel title="Новая сделка" action={<Plus size={18} />}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          createDeal.mutate({
            ...form,
            client_id: Number(form.client_id),
            manager_id: form.manager_id ? Number(form.manager_id) : null,
            stage_id: Number(form.stage_id),
            amount: Number(form.amount || 0),
            probability: Number(form.probability || 10),
          });
        }}>
          <TextInput label="Название" value={form.title} onChange={(title) => setForm({ ...form, title })} required />
          <Select label="Клиент" value={form.client_id} onChange={(client_id) => setForm({ ...form, client_id })} options={[
            ['', 'Выберите клиента'],
            ...clients.map((client) => [client.id, `${client.name} (${client.company || 'без компании'})`]),
          ]} />
          <Select label="Этап" value={form.stage_id} onChange={(stage_id) => {
            const stage = stages.find((item) => String(item.id) === String(stage_id));
            setForm({ ...form, stage_id, probability: stage?.probability || form.probability });
          }} options={[
            ['', 'Выберите этап'],
            ...stages.map((stage) => [stage.id, stage.name]),
          ]} />
          <Select label="Менеджер" value={form.manager_id} onChange={(manager_id) => setForm({ ...form, manager_id })} options={[
            ['', 'Не назначен'],
            ...users.filter((user) => user.role === 'manager').map((user) => [user.id, user.name]),
          ]} />
          <TextInput label="Сумма" type="number" value={form.amount} onChange={(amount) => setForm({ ...form, amount })} />
          <TextInput label="Дата закрытия" type="date" value={form.close_date} onChange={(close_date) => setForm({ ...form, close_date })} />
          <TextInput label="Комментарий" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          <button className="primary-button" type="submit"><Plus size={18} /> Создать сделку</button>
        </form>
      </Panel>

      <div className="kanban">
        {grouped.map((stage) => (
          <section className="kanban-column" key={stage.id}>
            <header>
              <h3>{stage.name}</h3>
              <span>{stage.deals.length}</span>
            </header>
            <div className="deal-stack">
              {stage.deals.map((deal) => (
                <article className="deal-card" key={deal.id}>
                  <h4>{deal.title}</h4>
                  <p>{deal.client_company || deal.client_name}</p>
                  <strong>{money(deal.amount)}</strong>
                  <div className="progress">
                    <span style={{ width: `${deal.probability}%` }} />
                  </div>
                  <div className="deal-actions">
                    <select
                      value={deal.stage_id}
                      onChange={(event) => {
                        const nextStage = stages.find((item) => String(item.id) === event.target.value);
                        patchDeal.mutate({
                          id: deal.id,
                          body: { stage_id: nextStage.id, probability: nextStage.probability },
                        });
                      }}
                    >
                      {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <button onClick={() => patchDeal.mutate({ id: deal.id, body: { status: 'won' } })}>Оплачено</button>
                    <button onClick={() => patchDeal.mutate({ id: deal.id, body: { status: 'lost' } })}>Потеряна</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function Tasks() {
  const queryClient = useQueryClient();
  const { users, clients, deals } = useReferenceData();
  const { data = [], isLoading } = useQuery({ queryKey: ['tasks'], queryFn: () => api('/tasks') });
  const [form, setForm] = useState({
    title: '',
    description: '',
    due_date: '',
    type: 'call',
    manager_id: '',
    client_id: '',
    deal_id: '',
  });
  const createTask = useMutation({
    mutationFn: (body) => api('/tasks', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setForm({ title: '', description: '', due_date: '', type: 'call', manager_id: '', client_id: '', deal_id: '' });
    },
  });
  const patchTask = useMutation({
    mutationFn: ({ id, body }) => api(`/tasks/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  if (isLoading) return <Loading />;

  return (
    <section className="stack">
      <Panel title="Постановка задачи менеджеру" action={<ClipboardList size={18} />}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          createTask.mutate({
            ...form,
            manager_id: form.manager_id || null,
            client_id: form.client_id || null,
            deal_id: form.deal_id || null,
          });
        }}>
          <TextInput label="Задача" value={form.title} onChange={(title) => setForm({ ...form, title })} required />
          <TextInput label="Описание" value={form.description} onChange={(description) => setForm({ ...form, description })} />
          <TextInput label="Срок" type="date" value={form.due_date} onChange={(due_date) => setForm({ ...form, due_date })} required />
          <Select label="Тип" value={form.type} onChange={(type) => setForm({ ...form, type })} options={[
            ['call', 'Звонок'],
            ['email', 'Email'],
            ['meeting', 'Встреча'],
            ['document', 'Документ'],
          ]} />
          <Select label="Менеджер" value={form.manager_id} onChange={(manager_id) => setForm({ ...form, manager_id })} options={[
            ['', 'Не назначен'],
            ...users.filter((user) => user.role === 'manager').map((user) => [user.id, user.name]),
          ]} />
          <Select label="Клиент" value={form.client_id} onChange={(client_id) => setForm({ ...form, client_id })} options={[
            ['', 'Не привязан'],
            ...clients.map((client) => [client.id, client.name]),
          ]} />
          <Select label="Сделка" value={form.deal_id} onChange={(deal_id) => setForm({ ...form, deal_id })} options={[
            ['', 'Не привязана'],
            ...deals.map((deal) => [deal.id, deal.title]),
          ]} />
          <button className="primary-button" type="submit"><Plus size={18} /> Добавить задачу</button>
        </form>
      </Panel>

      <TaskList tasks={data} onDone={(task) => patchTask.mutate({ id: task.id, body: { status: 'done' } })} />
    </section>
  );
}

function Reports() {
  const { data, isLoading } = useQuery({ queryKey: ['reports'], queryFn: () => api('/reports') });

  if (isLoading) return <Loading />;

  const conversionRate = data.conversion.leads_total
    ? Math.round((data.conversion.converted / data.conversion.leads_total) * 100)
    : 0;

  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Всего сделок" value={data.total.deals_count} tone="blue" />
        <Metric label="Портфель" value={money(data.total.pipeline_amount)} tone="green" />
        <Metric label="Закрыто оплатой" value={money(data.total.won_amount)} tone="amber" />
        <Metric label="Прогноз" value={money(data.total.forecast_amount)} tone="violet" />
        <Metric label="Конверсия лидов" value={`${conversionRate}%`} tone="red" />
      </div>

      <div className="two-columns">
        <Panel title="Воронка и конверсия" action={<BarChart3 size={18} />}>
          <Funnel stages={data.funnel} />
        </Panel>
        <Panel title="Эффективность менеджеров" action={<UsersRound size={18} />}>
          <div className="manager-list">
            {data.managers.map((manager) => (
              <div className="manager-row" key={manager.id}>
                <div>
                  <strong>{manager.name}</strong>
                  <span>{manager.deals_count} сделок, просрочено задач: {manager.overdue_tasks}</span>
                </div>
                <b>{money(manager.amount)}</b>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const { users, stages } = useReferenceData();
  const [userForm, setUserForm] = useState({ name: '', email: '', role: 'manager' });
  const [stageForm, setStageForm] = useState({ name: '', position: '', probability: 10 });

  const createUser = useMutation({
    mutationFn: (body) => api('/users', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setUserForm({ name: '', email: '', role: 'manager' });
    },
  });
  const createStage = useMutation({
    mutationFn: (body) => api('/stages', { method: 'POST', body }),
    onSuccess: () => {
      ['stages', 'dashboard', 'reports'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      setStageForm({ name: '', position: '', probability: 10 });
    },
  });

  return (
    <section className="stack">
      <div className="two-columns">
        <Panel title="Пользователи и роли" action={<UsersRound size={18} />}>
          <form className="compact-form" onSubmit={(event) => {
            event.preventDefault();
            createUser.mutate(userForm);
          }}>
            <TextInput label="Имя" value={userForm.name} onChange={(name) => setUserForm({ ...userForm, name })} required />
            <TextInput label="Email" value={userForm.email} onChange={(email) => setUserForm({ ...userForm, email })} required />
            <Select label="Роль" value={userForm.role} onChange={(role) => setUserForm({ ...userForm, role })} options={[
              ['manager', 'Менеджер'],
              ['leader', 'Руководитель'],
            ]} />
            <button className="primary-button" type="submit"><Plus size={18} /> Добавить</button>
          </form>
          <div className="settings-list">
            {users.map((user) => (
              <div key={user.id}>
                <strong>{user.name}</strong>
                <span>{user.email} · {user.role === 'leader' ? 'руководитель' : 'менеджер'}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Этапы воронки" action={<Settings size={18} />}>
          <form className="compact-form" onSubmit={(event) => {
            event.preventDefault();
            createStage.mutate({
              ...stageForm,
              position: Number(stageForm.position),
              probability: Number(stageForm.probability),
            });
          }}>
            <TextInput label="Название этапа" value={stageForm.name} onChange={(name) => setStageForm({ ...stageForm, name })} required />
            <TextInput label="Позиция" type="number" value={stageForm.position} onChange={(position) => setStageForm({ ...stageForm, position })} required />
            <TextInput label="Вероятность, %" type="number" value={stageForm.probability} onChange={(probability) => setStageForm({ ...stageForm, probability })} />
            <button className="primary-button" type="submit"><Plus size={18} /> Добавить</button>
          </form>
          <div className="settings-list">
            {stages.map((stage) => (
              <div key={stage.id}>
                <strong>{stage.position}. {stage.name}</strong>
                <span>Вероятность закрытия: {stage.probability}%</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}

function Funnel({ stages }) {
  const max = Math.max(...stages.map((stage) => Number(stage.amount || stage.deals_count || 1)), 1);

  return (
    <div className="funnel">
      {stages.map((stage) => (
        <div className="funnel-row" key={stage.id}>
          <div>
            <strong>{stage.name}</strong>
            <span>{stage.deals_count} сделок · {money(stage.amount)}</span>
          </div>
          <div className="bar">
            <span style={{ width: `${Math.max((Number(stage.amount || 0) / max) * 100, stage.deals_count ? 12 : 4)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskList({ tasks, onDone, compact = false }) {
  return (
    <div className={compact ? 'task-list compact' : 'task-list'}>
      {tasks.map((task) => (
        <article className="task-card" key={task.id}>
          <div>
            <h3>{task.title}</h3>
            <p>{task.description || task.deal_title || task.client_name || 'Без описания'}</p>
            <span>{task.manager_name || 'Не назначен'} · {dateText(task.due_date)}</span>
          </div>
          <div className="task-side">
            <Status value={task.status} />
            {onDone && task.status !== 'done' && (
              <button className="icon-button" title="Отметить выполненной" onClick={() => onDone(task)}>
                <CheckCircle2 size={18} />
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>{title}</h2>
        <div className="panel-action">{action}</div>
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

function Status({ value }) {
  const labels = {
    new: 'новый',
    qualified: 'квалифицирован',
    converted: 'в сделке',
    lost: 'потерян',
    open: 'открыта',
    won: 'оплачена',
    planned: 'запланирована',
    done: 'выполнена',
    overdue: 'просрочена',
  };

  return <span className={`status ${value}`}>{labels[value] || value}</span>;
}

function Loading() {
  return <div className="loading">Загрузка данных...</div>;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
