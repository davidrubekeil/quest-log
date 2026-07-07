/* Startet den Strava-OAuth-Flow: leitet zum Strava-Zustimmungsdialog weiter.
   client_id ist öffentlich; das Secret bleibt in strava-callback/strava-sync. */
exports.handler = async (event) => {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) return { statusCode: 500, body: 'STRAVA_CLIENT_ID nicht gesetzt' };
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  const redirectUri = `https://${host}/.netlify/functions/strava-callback`;
  const url = 'https://www.strava.com/oauth/authorize'
    + `?client_id=${encodeURIComponent(clientId)}`
    + '&response_type=code'
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + '&approval_prompt=auto'
    + '&scope=activity:read_all';
  return { statusCode: 302, headers: { Location: url }, body: '' };
};
