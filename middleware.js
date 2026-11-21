// Vercel Routing Middleware: shows a password screen before the calculator opens.
// Password: Vercel → Project → Settings → Environment Variables → SITE_PASSWORD.
// If SITE_PASSWORD is not set there, DEFAULT_PASSWORD below is used.
// After the right password, the browser remembers it for 30 days (cookie).

export const config = { matcher: '/:path*' };

const DEFAULT_PASSWORD = '1234';
const COOKIE = 'mj_access';
const OPEN_PATHS = ['/mj-logo.png', '/favicon.ico']; // logo shows on the password screen

async function tokenFor(password) {
  const bytes = new TextEncoder().encode('mahavir-jewellers:' + password);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const all = request.headers.get('cookie') || '';
  const hit = all.split(/;\s*/).find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

function page(wrong) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Mahavir Jewellers</title>
<link rel="icon" href="/mj-logo.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&display=swap">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:Jost,system-ui,sans-serif;background:#fff;color:#1d1a15;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.box{width:100%;max-width:360px;text-align:center}
img{width:200px;max-width:70%;height:auto}
.rule{height:1px;margin:18px auto 22px;width:70%;background:linear-gradient(90deg,transparent,#e6cf8f,transparent)}
label{display:block;font-size:.75rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#7a705f;margin-bottom:10px}
input{width:100%;font:inherit;font-size:1.6rem;font-weight:600;letter-spacing:.3em;text-align:center;padding:14px;border:1px solid #ece4d2;border-radius:14px;background:#fdfbf6;outline:none}
input:focus{border-color:#a9802c;box-shadow:0 0 0 3px rgba(169,128,44,.18)}
button{margin-top:14px;width:100%;font:inherit;font-weight:600;font-size:1rem;letter-spacing:.12em;text-transform:uppercase;color:#fff;border:0;border-radius:14px;padding:15px;cursor:pointer;background:linear-gradient(135deg,#b8892b 0%,#d9b964 50%,#a9802c 100%);box-shadow:0 8px 18px -10px rgba(138,102,32,.7)}
.err{color:#b3261e;font-size:.9rem;margin-top:12px;min-height:1.2em}
</style></head><body>
<form class="box" method="post">
<img src="/mj-logo.png" alt="Mahavir Jewellers">
<div class="rule"></div>
<label for="pw">Enter Password</label>
<input id="pw" name="password" type="password" inputmode="numeric" autocomplete="current-password" autofocus required>
<button type="submit">Open</button>
<div class="err" role="alert">${wrong ? 'Wrong password, try again' : ''}</div>
</form></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  if (OPEN_PATHS.includes(url.pathname)) return;

  const password = process.env.SITE_PASSWORD || DEFAULT_PASSWORD;
  const token = await tokenFor(password);

  if (readCookie(request, COOKIE) === token) return; // already unlocked: open the site

  if (request.method === 'POST') {
    let given = '';
    try { given = String((await request.formData()).get('password') || ''); } catch (e) {}
    if (given && (await tokenFor(given)) === token) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: url.pathname + url.search,
          'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return page(true);
  }

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'locked' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return page(false);
}
