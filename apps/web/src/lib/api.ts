import axios from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Inject token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('no_refresh');
        const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

// ── Auth ──────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),
  register: (data: { email: string; password: string; slug: string; name: string }) =>
    api.post('/auth/register', data).then((r) => r.data),
  verify2fa: (challengeToken: string, code?: string, backupCode?: string) =>
    api.post('/auth/2fa/verify', { challengeToken, code, backupCode }).then((r) => r.data),
  logout: (refreshToken: string) =>
    api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me').then((r) => r.data),
};

// ── Analytics ─────────────────────────────────────────────────────
export const analyticsApi = {
  dashboard: (from?: string, to?: string) =>
    api.get('/analytics/dashboard', { params: { from, to } }).then((r) => r.data),
};

// ── Contacts ──────────────────────────────────────────────────────
export const contactsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/contacts', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/contacts/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post('/contacts', data).then((r) => r.data),
  update: (id: string, data: unknown) => api.patch(`/contacts/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/contacts/${id}`),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/contacts/import', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
};

// ── Funnels ───────────────────────────────────────────────────────
export const funnelsApi = {
  list: () => api.get('/funnels').then((r) => r.data),
  get: (id: string) => api.get(`/funnels/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post('/funnels', data).then((r) => r.data),
  update: (id: string, data: unknown) => api.patch(`/funnels/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/funnels/${id}`),
  analytics: (id: string) => api.get(`/funnels/${id}/analytics`).then((r) => r.data),
  publish: (id: string) => api.post(`/funnels/${id}/publish`).then((r) => r.data),
};

// ── Emails ────────────────────────────────────────────────────────
export const emailsApi = {
  // Email campaigns (uses the dedicated /campaigns prefix)
  campaigns: () => api.get('/campaigns').then((r) => r.data),
  createCampaign: (data: unknown) => api.post('/campaigns', data).then((r) => r.data),
  sendCampaign: (id: string) => api.post(`/campaigns/${id}/send`).then((r) => r.data),
  // Newsletters and stats are under /emails prefix
  newsletters: () => api.get('/emails/newsletters').then((r) => r.data),
  createNewsletter: (data: unknown) => api.post('/emails/newsletters', data).then((r) => r.data),
  statistics: (params?: Record<string, unknown>) =>
    api.get('/emails/statistics/overview', { params }).then((r) => r.data),
  senders: () => api.get('/emails/senders').then((r) => r.data),
};

// ── CRM ───────────────────────────────────────────────────────────
export const crmApi = {
  pipelines:      ()                              => api.get('/crm/pipelines').then((r) => r.data),
  getPipeline:    (id: string)                    => api.get(`/crm/pipelines/${id}`).then((r) => r.data),
  createPipeline: (data: unknown)                 => api.post('/crm/pipelines', data).then((r) => r.data),
  updatePipeline: (id: string, data: unknown)     => api.patch(`/crm/pipelines/${id}`, data).then((r) => r.data),
  deletePipeline: (id: string)                    => api.delete(`/crm/pipelines/${id}`),
  createStage:    (pipelineId: string, data: unknown) =>
    api.post(`/crm/pipelines/${pipelineId}/stages`, data).then((r) => r.data),
  updateStage:    (pipelineId: string, stageId: string, data: unknown) =>
    api.patch(`/crm/pipelines/${pipelineId}/stages/${stageId}`, data).then((r) => r.data),
  createDeal:     (pipelineId: string, data: unknown) =>
    api.post(`/crm/pipelines/${pipelineId}/deals`, data).then((r) => r.data),
  moveDeal:       (dealId: string, data: unknown) =>
    api.patch(`/crm/pipelines/deals/${dealId}`, data).then((r) => r.data),
};

// ── Produits / Ventes ─────────────────────────────────────────────
export const salesApi = {
  // Products and coupons live under /resources
  products: () => api.get('/resources/products').then((r) => r.data),
  createProduct: (data: unknown) => api.post('/resources/products', data).then((r) => r.data),
  updateProduct: (id: string, data: unknown) => api.patch(`/resources/products/${id}`, data).then((r) => r.data),
  deleteProduct: (id: string) => api.delete(`/resources/products/${id}`),
  coupons: () => api.get('/resources/coupons').then((r) => r.data),
  createCoupon: (data: unknown) => api.post('/resources/coupons', data).then((r) => r.data),
  deleteCoupon: (id: string) => api.delete(`/resources/coupons/${id}`),
  // Orders and subscriptions live under /sales
  orders: () => api.get('/sales/orders').then((r) => r.data),
  subscriptions: () => api.get('/sales/subscriptions').then((r) => r.data),
};

// ── Automations ───────────────────────────────────────────────────
export const automationsApi = {
  list: () => api.get('/automations').then((r) => r.data),
  create: (data: unknown) => api.post('/automations', data).then((r) => r.data),
  toggle: (id: string, status: 'active' | 'paused') =>
    api.patch(`/automations/${id}`, { status }).then((r) => r.data),
  delete: (id: string) => api.delete(`/automations/${id}`),
};

// ── Paramètres ────────────────────────────────────────────────────
export const settingsApi = {
  getProfile: () => api.get('/settings/profile').then((r) => r.data),
  updateProfile: (data: unknown) => api.patch('/settings/profile', data).then((r) => r.data),
  getAccount: () => api.get('/settings/account').then((r) => r.data),
  updateAccount: (data: unknown) => api.patch('/settings/account', data).then((r) => r.data),
  apiKeys: () => api.get('/settings/api-keys').then((r) => r.data),
  createApiKey: (data: unknown) => api.post('/settings/api-keys', data).then((r) => r.data),
  deleteApiKey: (id: string) => api.delete(`/settings/api-keys/${id}`),
  webhooks: () => api.get('/settings/webhooks').then((r) => r.data),
  createWebhook: (data: unknown) => api.post('/settings/webhooks', data).then((r) => r.data),
  updateWebhook: (id: string, data: unknown) => api.patch(`/settings/webhooks/${id}`, data).then((r) => r.data),
  deleteWebhook: (id: string) => api.delete(`/settings/webhooks/${id}`),
  paymentGateways: () => api.get('/settings/payment-settings').then((r) => r.data),
  emailSettings: () => api.get('/settings/email-settings').then((r) => r.data),
  updateEmailSettings: (data: unknown) => api.patch('/settings/email-settings', data).then((r) => r.data),
};
