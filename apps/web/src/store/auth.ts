import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  workspaceName: string;
  workspaceSlug: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<{ requires2fa?: boolean; challengeToken?: string }>;
  verify2fa: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (access: string, refresh: string, user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const data = await authApi.login(email, password);
          if (data.challengeToken) {
            return { requires2fa: true, challengeToken: data.challengeToken };
          }
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          // Fetch profile to populate user object
          try {
            const me = await authApi.me();
            const user: User = {
              id: me.userId,
              email: me.tenant?.ownerEmail ?? email,
              name: me.tenant?.name ?? me.tenant?.slug ?? email,
              workspaceName: me.tenant?.name ?? me.tenant?.slug ?? '',
              workspaceSlug: me.tenant?.slug ?? '',
            };
            set({ user });
          } catch { /* user stays null but token allows access */ }
          return {};
        } finally {
          set({ isLoading: false });
        }
      },

      verify2fa: async (challengeToken, code) => {
        set({ isLoading: true });
        try {
          const data = await authApi.verify2fa(challengeToken, code);
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          try {
            const me = await authApi.me();
            const user: User = {
              id: me.userId,
              email: me.tenant?.ownerEmail ?? '',
              name: me.tenant?.name ?? me.tenant?.slug ?? '',
              workspaceName: me.tenant?.name ?? me.tenant?.slug ?? '',
              workspaceSlug: me.tenant?.slug ?? '',
            };
            set({ user });
          } catch { /* ignore */ }
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        if (refreshToken) {
          try { await authApi.logout(refreshToken); } catch { /* ignore */ }
        }
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ user: null, accessToken: null, refreshToken: null });
      },

      setTokens: (access, refresh, user) => {
        localStorage.setItem('accessToken', access);
        localStorage.setItem('refreshToken', refresh);
        set({ accessToken: access, refreshToken: refresh, user });
      },
    }),
    {
      name: 'afriflow-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);
