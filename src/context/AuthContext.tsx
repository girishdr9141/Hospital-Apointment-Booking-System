import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthUser, ModuleKey, PermissionAction, RoleName } from '../types/opd';
import { apiClient, type RegisterPatientInput } from '../services/apiClient';
import {
  hasModulePermission as checkModulePermission,
  hasPermission as checkPermission,
} from '../utils/permissions';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (input: {
    full_name: string;
    email: string;
    password: string;
    expected_role?: RoleName;
  }) => Promise<AuthUser>;
  registerPatient: (input: RegisterPatientInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (permission?: string) => boolean;
  hasModulePermission: (moduleKey: ModuleKey, action: PermissionAction) => boolean;
  hasRole: (role: RoleName) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const current = await apiClient.getCurrentUser();
      setUser(current);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiClient
      .getCurrentUser()
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(
    async (input: {
      full_name: string;
      email: string;
      password: string;
      expected_role?: RoleName;
    }) => {
      const loggedIn = await apiClient.login(input);
      setUser(loggedIn);
      return loggedIn;
    },
    [],
  );

  const registerPatient = useCallback(async (input: RegisterPatientInput) => {
    const registered = await apiClient.registerPatient(input);
    setUser(registered);
    return registered;
  }, []);

  const logout = useCallback(async () => {
    await apiClient.logout();
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (permission?: string) => checkPermission(user, permission),
    [user],
  );

  const hasModulePermission = useCallback(
    (moduleKey: ModuleKey, action: PermissionAction) =>
      checkModulePermission(user, moduleKey, action),
    [user],
  );

  const hasRole = useCallback(
    (role: RoleName) => Boolean(user && (user.role === role || user.roles.includes(role))),
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        registerPatient,
        logout,
        refreshUser,
        hasPermission,
        hasModulePermission,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
