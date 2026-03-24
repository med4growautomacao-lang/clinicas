import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';

export type UserRole = 'gestor' | 'medico' | 'secretaria';

interface UserProfile {
  id: string;
  clinic_id: string;
  role: UserRole;
  full_name: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  clinicName: string;
  userRole: UserRole;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicName, setClinicName] = useState('');
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Safety timeout - if nothing happens in 5 seconds, stop loading
    const safetyTimeout = setTimeout(() => {
      console.warn('AuthContext: Safety timeout reached, forcing loading to false');
      setLoading(false);
    }, 5000);

    // 1. Check for existing session first
    supabase.auth.getSession().then(async ({ data: { session: currentSession }, error }) => {
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

    // 2. Listen for future auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.log('AuthContext: Auth event received:', event, 'Has session:', !!newSession);
      
      // Skip INITIAL_SESSION since we handled it with getSession above
      if (event === 'INITIAL_SESSION') {
        console.log('AuthContext: Skipping INITIAL_SESSION event');
        return;
      }

      setSession(newSession);
      setUser(newSession?.user ?? null);
      console.log('AuthContext: Updated user state to:', newSession?.user?.email ?? 'null');

      if (newSession?.user) {
        await fetchProfile(newSession.user.id);
      } else {
        console.log('AuthContext: No session, clearing profile');
        setProfile(null);
        setClinicName('');
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  async function fetchProfile(userId: string) {
    console.log('AuthContext: Fetching profile for:', userId);
    try {
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
        console.log('AuthContext: Profile found:', userData.full_name);
        setProfile({
          id: userData.id,
          clinic_id: userData.clinic_id,
          role: userData.role as UserRole,
          full_name: userData.full_name
        });

        const { data: clinicData } = await supabase
          .from('clinics')
          .select('name')
          .eq('id', userData.clinic_id)
          .maybeSingle();

        if (clinicData?.name) {
          setClinicName(clinicData.name);
        }
      } else {
        console.warn('AuthContext: No profile found in users table');
      }
    } catch (error) {
      console.error('AuthContext: Profile error:', error);
    } finally {
      console.log('AuthContext: Done loading');
      setLoading(false);
    }
  }

  const signOut = async () => {
    try {
      console.log('AuthContext: Attempting to sign out...');
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('AuthContext: Sign out error from Supabase:', error);
      } else {
        console.log('AuthContext: Sign out successful');
      }
    } catch (error) {
      console.error('AuthContext: Sign out unexpected exception:', error);
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
