const html = require('../utils/html');

function layout({ title = 'Booking Engine', body, user, activeNav = '', activeBackofficeNav = '' }) {
  const hasUser = !!user;
  const navClass = (key) => `nav-link${activeNav === key ? ' active' : ''}`;
  const backofficeNavClass = (key) => `subnav-link${activeBackofficeNav === key ? ' active' : ''}`;
  const shouldShowBackofficeNav = hasUser && Boolean(activeBackofficeNav);

  const navItems = hasUser
    ? [
        { key: 'search', label: 'Pesquisar', href: '/search' },
        { key: 'calendar', label: 'Mapa de reservas', href: '/calendar' },
        { key: 'backoffice', label: 'Backoffice', href: '/admin' },
        { key: 'bookings', label: 'Reservas', href: '/admin/bookings' },
        ...(user && user.role === 'admin'
          ? [{ key: 'users', label: 'Utilizadores', href: '/admin/utilizadores' }]
          : []),
        { key: 'export', label: 'Exportar Excel', href: '/admin/export' },
      ]
    : [{ key: 'search', label: 'Pesquisar', href: '/search' }];
  return html`<!doctype html>
  <html lang="pt">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
      <script src="https://unpkg.com/hyperscript.org@0.9.12"></script>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/lucide@latest"></script>
      <style>
        .input { box-sizing:border-box; width:100%; min-width:0; display:block; padding:.5rem .75rem; border-radius:.5rem; border:1px solid #cbd5e1; background:#fff; line-height:1.25rem; }
        .btn  { display:inline-block; padding:.5rem .75rem; border-radius:.5rem; }
        .btn-primary{ background:#0f172a; color:#fff; }
        .btn-muted{ background:#e2e8f0; }
        .card{ background:#fff; border-radius: .75rem; box-shadow: 0 1px 2px rgba(16,24,40,.05); }
        body.app-body{margin:0;background:#fafafa;color:#4b4d59;font-family:'Inter','Segoe UI',sans-serif;}
        .app-shell{min-height:100vh;display:flex;flex-direction:column;}
        .topbar{background:#f7f6f9;border-bottom:1px solid #e2e1e8;box-shadow:0 1px 0 rgba(15,23,42,.04);}
        .topbar-inner{max-width:1120px;margin:0 auto;padding:24px 32px 12px;display:flex;flex-wrap:wrap;align-items:center;gap:24px;}
        .brand{display:flex;align-items:center;gap:12px;color:#5f616d;font-weight:600;text-decoration:none;font-size:1.125rem;}
        .brand-logo{width:40px;height:40px;border-radius:14px;background:linear-gradient(130deg,#ffb347,#ff5a91);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;box-shadow:0 10px 20px rgba(255,90,145,.25);}
        .brand-name{letter-spacing:.02em;}
        .nav-links{display:flex;align-items:center;gap:28px;flex-wrap:wrap;}
        .nav-link{position:relative;color:#7a7b88;font-weight:500;text-decoration:none;padding-bottom:6px;transition:color .2s ease;}
        .nav-link:hover{color:#424556;}
        .nav-link.active{color:#2f3140;}
        .nav-link.active::after{content:'';position:absolute;left:0;right:0;bottom:-12px;height:3px;border-radius:999px;background:linear-gradient(90deg,#ff5a91,#ffb347);}
        .nav-actions{margin-left:auto;display:flex;align-items:center;gap:18px;}
        .logout-form{margin:0;}
        .logout-form button,.login-link{background:none;border:none;color:#7a7b88;font-weight:500;cursor:pointer;padding:0;text-decoration:none;}
        .logout-form button:hover,.login-link:hover{color:#2f3140;}
        .nav-accent-bar{height:3px;background:linear-gradient(90deg,#ff5a91,#ffb347);opacity:.55;}
        .subnav{background:#f1f5f9;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;}
        .subnav-inner{max-width:1120px;margin:0 auto;padding:10px 32px;display:flex;gap:28px;}
        .subnav-link{color:#64748b;text-decoration:none;font-weight:500;letter-spacing:.01em;}
        .subnav-link:hover{color:#1e293b;}
        .subnav-link.active{color:#0f172a;position:relative;}
        .subnav-link.active::after{content:'';position:absolute;left:0;right:0;bottom:-10px;height:2px;background:#0f172a;border-radius:999px;}
        .main-content{flex:1;max-width:1120px;margin:0 auto;padding:56px 32px 64px;width:100%;}
        .footer{background:#f7f6f9;border-top:1px solid #e2e1e8;color:#8c8d97;font-size:.875rem;}
        .footer-inner{max-width:1120px;margin:0 auto;padding:20px 32px;}
        .search-hero{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:32px;text-align:center;}
        .search-title{font-size:2.25rem;font-weight:600;color:#5a5c68;margin:0;}
        .search-form{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end;background:#f7f6f9;border-radius:28px;padding:32px;border:1px solid rgba(255,166,67,.4);box-shadow:0 24px 42px rgba(15,23,42,.08);}
        .search-field{display:flex;flex-direction:column;gap:10px;text-align:left;}
        .search-field label{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;font-weight:600;color:#9b9ca6;}
        .search-dates{display:flex;gap:14px;flex-wrap:wrap;}
        .search-input{width:100%;border-radius:16px;border:2px solid rgba(255,166,67,.6);padding:14px 16px;background:#fff;font-size:1rem;color:#44454f;transition:border-color .2s ease,box-shadow .2s ease;}
        .search-input:focus{border-color:#ff8c00;outline:none;box-shadow:0 0 0 4px rgba(255,166,67,.2);}
        .search-submit{display:flex;justify-content:flex-end;}
        .search-button{display:inline-flex;align-items:center;justify-content:center;padding:14px 40px;border-radius:999px;border:none;background:linear-gradient(130deg,#ffb347,#ff6b00);color:#fff;font-weight:700;font-size:1.05rem;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease;}
        .search-button:hover{transform:translateY(-1px);box-shadow:0 14px 26px rgba(255,107,0,.25);}
        @media (max-width:900px){.topbar-inner{padding:20px 24px 10px;gap:18px;}.nav-link.active::after{bottom:-10px;}.main-content{padding:48px 24px 56px;}.search-form{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));}}
        @media (max-width:680px){.topbar-inner{padding:18px 20px 10px;}.nav-links{gap:18px;}.nav-actions{width:100%;justify-content:flex-end;}.main-content{padding:40px 20px 56px;}.search-form{grid-template-columns:1fr;padding:28px;}.search-dates{flex-direction:column;}.search-submit{justify-content:stretch;}.search-button{width:100%;}}
        .gallery-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.9);padding:2rem;z-index:9999;opacity:0;pointer-events:none;transition:opacity .2s ease;}
        .gallery-overlay.show{opacity:1;pointer-events:auto;}
        .gallery-overlay .gallery-inner{position:relative;width:100%;max-width:min(960px,90vw);}
        .gallery-overlay .gallery-image{width:100%;max-height:calc(100vh - 8rem);border-radius:1rem;object-fit:contain;background:#0f172a;}
        .gallery-overlay .gallery-close{position:absolute;top:-2.5rem;right:0;background:none;border:none;color:#fff;font-size:2.25rem;cursor:pointer;line-height:1;}
        .gallery-overlay .gallery-caption{margin-top:1rem;color:#e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:.75rem;font-size:.875rem;}
        .gallery-overlay .gallery-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(15,23,42,.6);border:none;color:#fff;width:2.75rem;height:2.75rem;border-radius:9999px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.75rem;transition:background .2s ease;}
        .gallery-overlay .gallery-nav:hover{background:rgba(15,23,42,.85);}
        .gallery-overlay .gallery-prev{left:-1.5rem;}
        .gallery-overlay .gallery-next{right:-1.5rem;}
        .gallery-overlay .gallery-counter{font-weight:600;}
        @media (max-width:640px){
          .gallery-overlay{padding:1rem;}
          .gallery-overlay .gallery-close{top:.5rem;right:.5rem;}
          .gallery-overlay .gallery-nav{bottom:1rem;top:auto;transform:none;}
          .gallery-overlay .gallery-prev{left:1rem;}
          .gallery-overlay .gallery-next{right:1rem;}
          .gallery-overlay .gallery-caption{flex-direction:column;align-items:flex-start;}
        }
      </style>
      <script>
        const HAS_USER = ${hasUser ? 'true' : 'false'};
        function refreshIcons(){
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        }
        if (document.readyState !== 'loading') {
          refreshIcons();
        } else {
          document.addEventListener('DOMContentLoaded', refreshIcons);
        }
        window.addEventListener('load', refreshIcons);
        document.addEventListener('htmx:afterSwap', refreshIcons);
        function syncCheckout(e){
          const ci = e.target.value; const co = document.getElementById('checkout');
          if (co && co.value && co.value <= ci) { co.value = ci; }
          if (co) co.min = ci;
        }
        if (HAS_USER) {
          window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'm' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
              window.location.href = '/calendar';
            }
          });
        }

        // Lightbox / Galeria
        (function(){
          let overlay;
          let imgEl;
          let captionEl;
          let counterEl;
          let prevBtn;
          let nextBtn;
          const state = { images: [], index: 0 };

          function ensureOverlay() {
            if (overlay) return;
            overlay = document.createElement('div');
            overlay.className = 'gallery-overlay';
            overlay.innerHTML = [
              '<div class="gallery-inner">',
              '  <button type="button" class="gallery-close" data-gallery-close>&times;</button>',
              '  <img class="gallery-image" src="" alt="" />',
              '  <button type="button" class="gallery-nav gallery-prev" data-gallery-prev>&lsaquo;</button>',
              '  <button type="button" class="gallery-nav gallery-next" data-gallery-next>&rsaquo;</button>',
              '  <div class="gallery-caption">',
              '    <span class="gallery-counter"></span>',
              '    <span class="gallery-text"></span>',
              '  </div>',
              '</div>'
            ].join('');
            document.body.appendChild(overlay);
            imgEl = overlay.querySelector('.gallery-image');
            captionEl = overlay.querySelector('.gallery-text');
            counterEl = overlay.querySelector('.gallery-counter');
            prevBtn = overlay.querySelector('[data-gallery-prev]');
            nextBtn = overlay.querySelector('[data-gallery-next]');
            overlay.addEventListener('click', (event) => {
              if (event.target === overlay || event.target.hasAttribute('data-gallery-close')) {
                hideOverlay();
              }
            });
            prevBtn.addEventListener('click', (event) => {
              event.stopPropagation();
              showIndex(state.index - 1);
            });
            nextBtn.addEventListener('click', (event) => {
              event.stopPropagation();
              showIndex(state.index + 1);
            });
            document.addEventListener('keydown', (event) => {
              if (!overlay.classList.contains('show')) return;
              if (event.key === 'Escape') hideOverlay();
              if (event.key === 'ArrowLeft') showIndex(state.index - 1);
              if (event.key === 'ArrowRight') showIndex(state.index + 1);
            });
          }

          function showIndex(index) {
            if (!state.images.length) return;
            if (index < 0) index = state.images.length - 1;
            if (index >= state.images.length) index = 0;
            state.index = index;
            const image = state.images[index];
            imgEl.src = image.url;
            imgEl.alt = image.alt || '';
            captionEl.textContent = image.alt || '';
            counterEl.textContent = (index + 1) + ' / ' + state.images.length;
          }

          function showOverlay(images, index) {
            ensureOverlay();
            state.images = images || [];
            if (!state.images.length) return;
            overlay.classList.add('show');
            document.body.style.overflow = 'hidden';
            showIndex(index || 0);
          }

          function hideOverlay() {
            overlay.classList.remove('show');
            document.body.style.overflow = '';
            state.images = [];
            state.index = 0;
          }

          document.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-gallery-trigger]');
            if (!trigger) return;
            const images = trigger.getAttribute('data-gallery-images');
            if (!images) return;
            try {
              const parsed = JSON.parse(images);
              const index = Number(trigger.getAttribute('data-gallery-index')) || 0;
              showOverlay(parsed, index);
            } catch (_) {
              // ignore
            }
          });
        })();
      </script>
    </head>
    <body class="app-body">
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <a class="brand" href="/">
              <span class="brand-logo">BE</span>
              <span class="brand-name">Booking Engine</span>
            </a>
            <nav class="nav-links">
              ${navItems
                .map((item) => `<a class="${navClass(item.key)}" href="${item.href}">${item.label}</a>`)
                .join('')}
            </nav>
            <div class="nav-actions">
              ${hasUser
                ? html`<form class="logout-form" method="post" action="/logout"><button type="submit">Log-out (${user.username})</button></form>`
                : html`<a class="login-link" href="/login">Login</a>`}
            </div>
          </div>
          <div class="nav-accent-bar"></div>
          ${shouldShowBackofficeNav
            ? html`<div class="subnav">
                <div class="subnav-inner">
                  <a class="${backofficeNavClass('calendar')}" href="/calendar">Calendário</a>
                  <a class="${backofficeNavClass('bookings')}" href="/admin/bookings">Reservas</a>
                  <a class="${backofficeNavClass('properties')}" href="/admin#properties">Propriedades</a>
                  <a class="${backofficeNavClass('units')}" href="/admin#units">Unidades</a>
                  <a class="${backofficeNavClass('rates')}" href="/admin/rates">Rates</a>
                </div>
              </div>`
            : ''}
        </header>
        <main class="main-content">
          ${body}
        </main>
        <footer class="footer">
          <div class="footer-inner">
            &copy; ${new Date().getFullYear()} Booking Engine. Todos os direitos reservados.
          </div>
        </footer>
      </div>
      <script>
        refreshIcons();
      </script>
    </body>
  </html>`;
}

module.exports = layout;
