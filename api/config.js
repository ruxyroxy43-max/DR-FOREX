module.exports = function config(_request, response) {
  try {
    const configuredUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const configuredKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    const legacyProject = configuredUrl.includes('ortxctszchqawldfpgjh.supabase.co');
    let url = legacyProject ? 'https://pinybipcawlvsrjbjbtz.supabase.co' : configuredUrl;
    while (url.endsWith('/')) url = url.slice(0, -1);
    url = url.endsWith('/rest/v1') ? url.slice(0, -8) : url;
    const anonKey = legacyProject ? 'sb_publishable_VKwLrVb0nIhA7kjbxJdMug_-KMPvH8m' : configuredKey;
    response.setHeader('Cache-Control', 'no-store');
    if (!url.startsWith('https://') || !url.endsWith('.supabase.co') || !anonKey) return response.status(200).json({ configured: false });
    return response.status(200).json({ configured: true, url, anonKey });
  } catch (error) {
    console.error('Supabase configuration endpoint failed:', error);
    return response.status(500).json({ configured: false, error: 'Configuration endpoint failed' });
  }
};
