
export const CONFIG = {
  SUPABASE_URL: 'https://uapokujxttcphkuftkzc.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhcG9rdWp4dHRjcGhrdWZ0a3pjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNDMxODEsImV4cCI6MjExMDcxOTE4MX0.OjvYJ-eKkPBWWCWr_3yVFsaHLWR4Ae2yg8PF1vj9L6E',
  APP_NAME: 'WMS',
  APP_FULL_NAME: 'Workshop Management System',
  ADMIN_FUNCTION: 'admin-users',
};

export const isConfigured = () =>
  CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') &&
  CONFIG.SUPABASE_ANON_KEY && !CONFIG.SUPABASE_ANON_KEY.includes('YOUR-SUPABASE');
