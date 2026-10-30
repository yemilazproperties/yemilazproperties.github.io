(() => {
  const config = window.HEARTH_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return;
  window.hearthSupabase = window.supabase.createClient(config.url, config.publishableKey);
})();
