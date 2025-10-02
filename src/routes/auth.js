const bcrypt = require('bcryptjs');

const html = require('../utils/html');
const layout = require('../views/layout');
const { createSession, destroySession } = require('../services/session');

function registerAuthRoutes(app, { db, loginRateLimiter, sessionCookieOptions }) {
  const limiter = loginRateLimiter || ((req, res, next) => next());
  const cookieOptions = sessionCookieOptions || { httpOnly: true, sameSite: 'lax', secure: false };

  app.get('/login', (req,res)=>{
    const { error, next: nxt } = req.query;
    res.send(layout({ title: 'Login', body: html`
      <div class="max-w-md mx-auto card p-6">
        <h1 class="text-xl font-semibold mb-4">Login Backoffice</h1>
        ${error ? `<div class="mb-3 text-sm text-rose-600">${error}</div>`: ''}
        <form method="post" action="/login" class="grid gap-3">
          ${nxt ? `<input type="hidden" name="next" value="${nxt}"/>` : ''}
          <input name="username" class="input" placeholder="Utilizador" required />
          <input name="password" type="password" class="input" placeholder="Palavra-passe" required />
          <button class="btn btn-primary">Entrar</button>
        </form>
      </div>
    `}));
  });
  app.post('/login', loginRateLimiter, (req,res)=>{
    const { username, password, next: nxt } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !bcrypt.compareSync(String(password), u.password_hash)) return res.redirect('/login?error=Credenciais inválidas');
    const token = createSession(db, u.id);
    res.cookie('adm', token, sessionCookieOptions);
    res.redirect(nxt || '/admin');
  });
  app.post('/logout', (req,res)=>{ destroySession(db, req.cookies.adm); res.clearCookie('adm', sessionCookieOptions); res.redirect('/'); });
  
}

module.exports = registerAuthRoutes;
