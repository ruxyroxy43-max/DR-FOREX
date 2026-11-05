module.exports = function config(_request, response) {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({ configured: Boolean(url && anonKey), url, anonKey });
};
