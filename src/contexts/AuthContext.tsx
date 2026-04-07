import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';

export type UserRole = 'gestor' | 'medico' | 'secretaria' | 'super-admin' | 'org_admin';

interface UserProfile {
  id: string;
  clinic_id: string | null;
  role: UserRole;
  full_name: string;
  // Org-admin fields
  organization_id?: string;
  organization_name?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  clinicName: string;
  userRole: UserRole;
  loading: boolean;
  // Org-admin: clínica ativa selecionada (substitui profile.clinic_id para hooks)
  activeClinicId: string | null;
  setActiveClinicId: (id: string | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicName, setClinicName] = useState('');
  const [activeClinicId, setActiveClinicId] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    const safetyTimeout = setTimeout(() => {
      if (!ignore) {
        console.warn('AuthContext: Safety timeout reached, forcing loading to false');
        setLoading(false);
      }
    }, 5000);

    supabase.auth.getSession().then(async ({ data: { session: currentSession }, error }) => {
      if (ignore) return;
      console.log('AuthContext: getSession result:', currentSession?.user?.email ?? 'no session', error);

      if (error) {
        console.error('AuthContext: getSession error:', error);
        clearTimeout(safetyTimeout);
        setLoading(false);
        return;
      }

      setSession(currentSession);
      setUser(currentSession?.user ?? null);

      if (currentSession?.user) {
        await fetchProfile(currentSession.user.id);
      } else {
        setLoading(false);
      }

      clearTimeout(safetyTimeout);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (ignore) return;
      console.log('AuthContext: Auth event received:', event, 'Has session:', !!newSession);

      if (event === 'INITIAL_SESSION') {
        console.log('AuthContext: Skipping INITIAL_SESSION event');
        return;
      }

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        const userId = newSession.user.id;
        setTimeout(() => fetchProfile(userId), 0);
      } else {
        console.log('AuthContext: No session, clearing profile');
        setProfile(null);
        setClinicName('');
        setActiveClinicId(null);
        setLoading(false);
      }
    });

    return () => {
      ignore = true;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  async function fetchProfile(userId: string) {
    console.log('AuthContext: Fetching profile for:', userId);
    try {
      // 1. Tentar usuário de clínica normal primeiro
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (userError) {
        console.error('AuthContext: User fetch error:', userError);
        setLoading(false);
        return;
      }

      if (userData) {
        console.log('AuthContext: Profile loaded (clinic user):', userData.email, 'Role:', userData.role);
        setProfile({
          id: userData.id,
          clinic_id: userData.clinic_id,
          role: userData.role as UserRole,
          full_name: userData.full_name
        });
        setActiveClinicId(userData.clinic_id);

        const { data: clinicData } = await supabase
          .from('clinics')
          .select('name')
          .eq('id', userData.clinic_id)
          .maybeSingle();

        if (clinicData?.name) setClinicName(clinicData.name);
        return;
      }

      // 2. Verificar se é org-admin
      const { data: orgUser } = await supabase
        .from('org_users')
        .select('*, organizations(id, name)')
        .eq('user_id', userId)
        .maybeSingle();

      if (orgUser) {
        console.log('AuthContext: Profile loaded (org_admin):', orgUser.email, 'Org:', (orgUser.organizations as any)?.name);
        const org = orgUser.organizations as any;
        setProfile({
          id: userId,
          clinic_id: null,
          role: 'org_admin',
          full_name: orgUser.full_name || orgUser.email || '',
          organization_id: orgUser.organization_id,
          organization_name: org?.name || ''
        });
        setActiveClinicId(null);
        setClinicName(org?.name || '');
        return;
      }

      console.warn('AuthContext: No profile found in users or org_users');
    } catch (error) {
      console.error('AuthContext: Profile error:', error);
    } finally {
      console.log('AuthContext: Done loading');
      setLoading(false);
    }
  }

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error('AuthContext: Sign out error:', error);
    } catch (error) {
      console.error('AuthContext: Sign out exception:', error);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      clinicName,
      userRole: profile?.role || 'secretaria',
      loading,
      activeClinicId,
      setActiveClinicId,
      signOut
    }}>
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
