import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://yzpclhuifquhfqpiwysh.supabase.co';
const supabaseAnonKey = 'sb_publishable_4Hfsnn5kukFzZDs7SxQnMw_oXRuB_Nd';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
