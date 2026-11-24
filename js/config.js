
export const CONFIG = {
  SUPABASE_URL: 'https://uapokujxttcphkuftkzc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_DATxe_3YpWMCHvI5Wy1W8g_LvH2IA_S',
  APP_NAME: 'WMS',
  APP_FULL_NAME: 'Workshop Management System',

  ADMIN_FUNCTION: 'admin-users',
};

export const isConfigured = () =>
  CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') &&
  CONFIG.SUPABASE_ANON_KEY && !CONFIG.SUPABASE_ANON_KEY.includes('YOUR-SUPABASE');
