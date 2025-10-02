const bcrypt = require('bcryptjs');

const html = require('../utils/html');
const { esc } = require('../utils/format');
const layout = require('../views/layout');

function registerAdminUsersRoutes(app, { db, requireAdmin }) {
  if (!requireAdmin) throw new Error('requireAdmin middleware is required for user management routes');

  // ===================== Utilizadores (admin) =====================
  app.get('/admin/utilizadores', requireAdmin, (req,res)=>{
    const users = db.prepare('SELECT id, username, role FROM users ORDER BY username').all();
    res.send(layout({ title:'Utilizadores', user: req.user, activeNav: 'users', body: html`
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <h1 class="text-2xl font-semibold mb-4">Utilizadores</h1>
  
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section class="card p-4">
          <h2 class="font-semibold mb-3">Criar novo utilizador</h2>
          <form method="post" action="/admin/users/create" class="grid gap-2">
            <input required name="username" class="input" placeholder="Utilizador" />
            <input required type="password" name="password" class="input" placeholder="Password (min 8)" />
            <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
            <select name="role" class="input">
              <option value="admin">admin</option>
              <option value="gestor">gestor</option>
              <option value="limpezas">limpezas</option>
            </select>
            <button class="btn btn-primary">Criar</button>
          </form>
        </section>
  
        <section class="card p-4">
          <h2 class="font-semibold mb-3">Alterar password</h2>
          <form method="post" action="/admin/users/password" class="grid gap-2">
            <label class="text-sm">Selecionar utilizador</label>
            <select required name="user_id" class="input">
              ${users.map(u=>`<option value="${u.id}">${esc(u.username)} (${u.role})</option>`).join('')}
            </select>
            <input required type="password" name="new_password" class="input" placeholder="Nova password (min 8)" />
            <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
            <button class="btn btn-primary">Alterar</button>
          </form>
          <p class="text-sm text-slate-500 mt-2">Ao alterar, as sessões desse utilizador são terminadas.</p>
        </section>
      </div>
    `}));
  });
  
  app.post('/admin/users/create', requireAdmin, (req,res)=>{
    const { username, password, confirm, role } = req.body;
    if (!username || !password || password.length < 8) return res.status(400).send('Password inválida (min 8).');
    if (password !== confirm) return res.status(400).send('Passwords não coincidem.');
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) return res.status(400).send('Utilizador já existe.');
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run(username, hash, role || 'gestor');
    res.redirect('/admin/utilizadores');
  });
  
  app.post('/admin/users/password', requireAdmin, (req,res)=>{
    const { user_id, new_password, confirm } = req.body;
    if (!new_password || new_password.length < 8) return res.status(400).send('Password inválida (min 8).');
    if (new_password !== confirm) return res.status(400).send('Passwords não coincidem.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).send('Utilizador não encontrado');
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
    res.redirect('/admin/utilizadores');
  });
  
}

module.exports = registerAdminUsersRoutes;
