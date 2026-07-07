/* Empfängt den OAuth-Code von Strava, tauscht ihn (mit Secret) gegen Tokens und
   leitet zur App zurück, wobei der Refresh-Token im URL-Fragment übergeben wird. */
exports.handler = async (event) => {
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  const appUrl = `https://${host}/`;
  const q = event.queryStringParameters || {};
  if (q.error) return redirect(appUrl, `strava-error=${encodeURIComponent(q.error)}`);
  if (!q.code) return redirect(appUrl, 'strava-error=nocode');

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirect(appUrl, 'strava-error=noconfig');

  try {
    const resp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: q.code, grant_type: 'authorization_code' }),
    });
    const data = await resp.json();
    if (!data.refresh_token) return redirect(appUrl, 'strava-error=exchange');
    return redirect(appUrl, `strava-refresh=${encodeURIComponent(data.refresh_token)}`);
  } catch (e) {
    return redirect(appUrl, 'strava-error=exception');
  }
};

function redirect(appUrl, hash) {
  return { statusCode: 302, headers: { Location: `${appUrl}#${hash}` }, body: '' };
}
