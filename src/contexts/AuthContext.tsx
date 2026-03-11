import React, { createContext, useContext, useState, ReactNode } from 'react';

export type UserRole = 'gestor' | 'medico' | 'secretaria';

interface AuthContextType {
  clinicName: string;
  userRole: UserRole;
  setClinicName: (name: string) => void;
  setUserRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [clinicName, setClinicName] = useState('Clínica Central');
  const [userRole, setUserRole] = useState<UserRole>('gestor');

  return (
    <AuthContext.Provider value={{ clinicName, userRole, setClinicName, setUserRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
