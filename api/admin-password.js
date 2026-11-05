function json(response, status, body) {
  response.status(status).setHeader('Content-Type', 'application/json');
  return response.end(JSON.stringify(body));
}

module.exports = async function adminPassword(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });

  const projectUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!projectUrl || !anonKey || !serviceRoleKey) {
    return json(response, 503, { error: 'Secure administrator password editing is not configured.' });
  }

  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return json(response, 401, { error: 'Authentication required.' });

  try {
    const userResponse = await fetch(`${projectUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization },
    });
    if (!userResponse.ok) return json(response, 401, { error: 'Authentication required.' });
    const authUser = await userResponse.json();
    const profileResponse = await fetch(`${projectUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=role,status`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    const profiles = await profileResponse.json();
    if (!profileResponse.ok || profiles[0]?.role !== 'admin' || profiles[0]?.status !== 'approved') {
      return json(response, 403, { error: 'Approved administrator access required.' });
    }

    const payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
    const password = String(payload.password || '');
    const userId = String(payload.userId || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId) || password.length < 8 || password.length > 72) {
      return json(response, 400, { error: 'Provide a valid user and a password between 8 and 72 characters.' });
    }

    const updateResponse = await fetch(`${projectUrl}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!updateResponse.ok) return json(response, 502, { error: 'Supabase could not update that password.' });
    return json(response, 200, { ok: true });
  } catch (error) {
    console.error('Administrator password update failed:', error);
    return json(response, 500, { error: 'Password update failed.' });
  }
};
