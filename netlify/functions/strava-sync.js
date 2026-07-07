/* Frischt den Access-Token per Refresh-Token auf (Secret bleibt serverseitig) und
   holt die Aktivitäten im angefragten Zeitraum. Gibt gemappte Aktivitäten +
   (evtl. rotierten) Refresh-Token zurück. */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
  const { refresh_token, after, before } = body;
  if (!refresh_token) return json(400, { error: 'no refresh_token' });

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return json(500, { error: 'noconfig' });

  try {
    const tokResp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token }),
    });
    const tok = await tokResp.json();
    if (!tok.access_token) return json(401, { error: 'refresh_failed' });

    const params = new URLSearchParams();
    if (after) params.set('after', String(after));
    if (before) params.set('before', String(before));
    params.set('per_page', '50');
    const actResp = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params.toString()}`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const acts = await actResp.json();
    if (!Array.isArray(acts)) return json(502, { error: 'strava_error', detail: acts });

    const activities = acts.map(a => ({
      id: a.id,
      name: a.name,
      type: a.sport_type || a.type,
      distance: a.distance,                       // m
      moving_time: a.moving_time,                 // s
      total_elevation_gain: a.total_elevation_gain, // m
      average_speed: a.average_speed,             // m/s
      start_date_local: a.start_date_local,
    }));

    return json(200, { refresh_token: tok.refresh_token || refresh_token, activities });
  } catch (e) {
    return json(500, { error: 'exception', message: String(e && e.message || e) });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
