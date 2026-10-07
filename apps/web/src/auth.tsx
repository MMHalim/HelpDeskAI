import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@helpdesk/shared';
import { api, ApiError } from './lib/api';

interface AuthContextValue {
  user: UserDto | null;
  isLoading: boolean;
  isAdmin: boolean;
  features: string[];
  can: (featureKey: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const result = await api.get<{ user: UserDto }>('/api/auth/me');
        return result.user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.post<{ user: UserDto }>('/api/auth/login', { email, password });
      queryClient.setQueryData(['me'], result.user);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    queryClient.setQueryData(['me'], null);
    queryClient.clear();
  }, [queryClient]);

  const can = useCallback(
    (featureKey: string) => (data?.role === 'admin' ? true : (data?.features.includes(featureKey) ?? false)),
    [data],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: data ?? null,
      isLoading,
      isAdmin: data?.role === 'admin',
      features: data?.features ?? [],
      can,
      login,
      logout,
    }),
    [data, isLoading, can, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
