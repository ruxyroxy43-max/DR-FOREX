module.exports = function config(_request, response) {
  const url = (process.env.SUPABASE_URL || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({ configured: Boolean(url && anonKey), url, anonKey });
};
