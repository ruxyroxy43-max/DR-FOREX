module.exports = function config(_request, response) {
  try {
    let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '')
      .trim()
      .replace(/\/rest\/v1\/?$/, '');
    let anonKey = (
      process.env.SUPABASE_ANON_KEY
      || process.env.SUPABASE_PUBLISHABLE_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || ''
    ).trim();

    response.setHeader('Cache-Control', 'no-store');
    if (!url || !anonKey || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
      return response.status(200).json({ configured: false });
    }

    return response.status(200).json({ configured: true, url, anonKey });
  } catch (error) {
    console.error('Supabase configuration endpoint failed:', error);
    return response.status(500).json({ configured: false, error: 'Configuration endpoint failed' });
  }
};
