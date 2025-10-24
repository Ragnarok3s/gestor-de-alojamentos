'use strict';

(function initCalendarDragAndDrop() {
  const board = document.querySelector('[data-calendar-board]');
  if (!board) return;
  if (board.getAttribute('data-can-reschedule') !== '1') return;
  const entries = board.querySelectorAll('[data-calendar-entry]');
  const cells = Array.from(board.querySelectorAll('[data-calendar-cell]'));
  if (!entries.length || !cells.length) return;
  let dragData = null;

  function addDays(iso, days) {
    if (!iso) return iso;
    const parts = iso.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return iso;
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function clearDropTargets() {
    cells.forEach(function(cell) {
      cell.classList.remove('is-drop-target');
    });
  }

  entries.forEach(function(entry) {
    entry.addEventListener('dragstart', function(event) {
      if (entry.getAttribute('draggable') !== 'true') return;
      const id = entry.getAttribute('data-entry-id');
      const start = entry.getAttribute('data-entry-start');
      const end = entry.getAttribute('data-entry-end');
      if (!id || !start || !end) return;
      dragData = {
        id: id,
        start: start,
        end: end,
        nights: Number(entry.getAttribute('data-entry-nights') || '1'),
        element: entry
      };
      entry.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        try {
          event.dataTransfer.setData('text/plain', id);
        } catch (err) {
          // ignore
        }
      }
    });
    entry.addEventListener('dragend', function() {
      entry.classList.remove('is-dragging');
      clearDropTargets();
      dragData = null;
    });
  });

  cells.forEach(function(cell) {
    cell.addEventListener('dragover', function(event) {
      if (!dragData) return;
      if (cell.getAttribute('data-in-month') !== '1') return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      cells.forEach(function(other) {
        if (other !== cell) other.classList.remove('is-drop-target');
      });
      cell.classList.add('is-drop-target');
    });
    cell.addEventListener('dragleave', function() {
      cell.classList.remove('is-drop-target');
    });
    cell.addEventListener('drop', function(event) {
      if (!dragData) return;
      if (cell.getAttribute('data-in-month') !== '1') return;
      event.preventDefault();
      const entry = dragData.element;
      const entryId = dragData.id;
      const originalStart = dragData.start;
      const nights = Number.isFinite(dragData.nights) && dragData.nights > 0 ? dragData.nights : 1;
      const targetDate = cell.getAttribute('data-date');
      clearDropTargets();
      dragData = null;
      if (!entryId || !targetDate || targetDate === originalStart) return;
      if (entry) {
        entry.classList.remove('is-dragging');
        entry.classList.add('is-saving');
      }
      const checkout = addDays(targetDate, nights);
      fetch('/calendar/booking/' + encodeURIComponent(entryId) + '/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkin: targetDate, checkout: checkout })
      })
        .then(function(res) {
          return res
            .json()
            .catch(function() {
              return { ok: false, message: 'Erro inesperado.' };
            })
            .then(function(data) {
              return { res: res, data: data };
            });
        })
        .then(function(result) {
          const ok = result && result.res && result.res.ok && result.data && result.data.ok;
          if (ok) {
            window.location.reload();
          } else {
            if (entry) entry.classList.remove('is-saving');
            const message = result && result.data && result.data.message ? result.data.message : 'Não foi possível reagendar a reserva.';
            window.alert(message);
          }
        })
        .catch(function() {
          if (entry) entry.classList.remove('is-saving');
          window.alert('Erro de rede ao reagendar a reserva.');
        });
    });
  });
})();
