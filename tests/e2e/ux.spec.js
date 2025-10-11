const { test, expect } = require('@playwright/test');

const baseURL = process.env.E2E_BASE_URL || '';
const adminUser = process.env.E2E_USER || 'gestor';
const adminPass = process.env.E2E_PASSWORD || 'change-me';

async function ensureLogin(page) {
  await page.goto(baseURL + '/auth/login');
  await page.fill('input[name="username"]', adminUser);
  await page.fill('input[name="password"]', adminPass);
  await Promise.all([
    page.waitForURL('**/admin'),
    page.click('button[type="submit"]')
  ]);
}

function formatFutureDate(daysAhead) {
  const base = new Date();
  base.setDate(base.getDate() + daysAhead);
  const month = String(base.getMonth() + 1).padStart(2, '0');
  const day = String(base.getDate()).padStart(2, '0');
  return `${base.getFullYear()}-${month}-${day}`;
}

test.describe('Casas de Pousadouro — Fluxos UX críticos', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!baseURL, 'Define E2E_BASE_URL para executar os testes de interface.');
    await ensureLogin(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Sidenav responsivo e acessível', async ({ page }) => {
    const shell = page.locator('[data-bo-shell]');
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'desktop');
    await expect(shell).toHaveAttribute('data-sidebar-collapsed', '0');

    const collapseButton = page.locator('[data-sidebar-collapse]');
    await collapseButton.click();
    await expect(shell).toHaveAttribute('data-sidebar-collapsed', '1');
    await collapseButton.click();
    await expect(shell).toHaveAttribute('data-sidebar-collapsed', '0');

    const calendarTab = page.locator('[data-bo-target="calendar"]');
    await calendarTab.focus();
    await page.keyboard.press('Enter');
    await expect(calendarTab).toHaveClass(/is-active/);
    await expect(page.locator('[data-bo-pane="calendar"]')).toHaveClass(/is-active/);

    await page.setViewportSize({ width: 900, height: 900 });
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'compact');
    await expect(shell).toHaveAttribute('data-sidebar-collapsed', '1');
    await expect(collapseButton).toHaveAttribute('aria-hidden', 'true');

    await page.setViewportSize({ width: 640, height: 900 });
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'mobile');
    const trigger = page.locator('[data-sidebar-trigger]');
    const overlay = page.locator('[data-sidebar-overlay]');
    await trigger.click();
    await expect(shell).toHaveAttribute('data-sidebar-open', '1');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(shell).toHaveAttribute('data-sidebar-open', '0');
    const focusReturned = await trigger.evaluate(node => document.activeElement === node);
    expect(focusReturned).toBeTruthy();

    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Bloquear múltiplas unidades e mostrar badge imediato', async ({ page }) => {
    await page.locator('[data-bo-target="overview"]').click();
    const checkboxes = page.locator('[data-unit-select]');
    const totalCheckboxes = await checkboxes.count();
    test.skip(totalCheckboxes < 2, 'São necessárias pelo menos duas unidades para o teste.');

    const firstCheckbox = checkboxes.nth(0);
    const secondCheckbox = checkboxes.nth(1);
    const firstUnitId = await firstCheckbox.getAttribute('value');
    const secondUnitId = await secondCheckbox.getAttribute('value');
    expect(firstUnitId).toBeTruthy();
    expect(secondUnitId).toBeTruthy();

    await firstCheckbox.check();
    await secondCheckbox.check();
    await expect(firstCheckbox).toBeChecked();
    await expect(secondCheckbox).toBeChecked();

    const summary = page.locator('[data-block-summary]');
    await expect(summary).toHaveText('2 unidades selecionadas.');

    const openButton = page.locator('[data-block-open]');
    await expect(openButton).toBeEnabled();
    await openButton.click();

    const modal = page.locator('[data-block-modal]');
    await expect(modal).not.toHaveClass(/hidden/);

    const startDate = formatFutureDate(365 * 2 + 5);
    const endDate = formatFutureDate(365 * 2 + 8);
    await page.fill('[data-block-start]', startDate);
    await page.fill('[data-block-end]', endDate);
    await page.fill('[data-block-reason]', 'Bloqueio de manutenção preventiva.');

    const dialogPromise = page.waitForEvent('dialog');
    const responsePromise = page
      .waitForResponse(resp => resp.url().endsWith('/admin/api/units/blocks/bulk') && resp.request().method() === 'POST')
      .then(resp => resp.json());
    await page.click('[data-block-submit]');
    const dialog = await dialogPromise;
    await expect(dialog.message()).toContain('Confirmas o bloqueio');
    await dialog.accept();

    const payload = await responsePromise;
    expect(payload.ok).toBeTruthy();
    await expect(page.locator('.bo-toast--success', { hasText: 'Bloqueio criado para' })).toBeVisible();

    await expect(modal).toHaveClass(/hidden/);
    await expect(summary).toHaveText('Seleciona unidades para bloquear.');
    await expect(page.locator('[data-block-clear]')).toBeHidden();
    await expect(firstCheckbox).not.toBeChecked();
    await expect(secondCheckbox).not.toBeChecked();

    if (firstUnitId) {
      await expect(page.locator(`[data-block-badge="${firstUnitId}"]`).first()).toBeVisible();
    }
    if (secondUnitId) {
      await expect(page.locator(`[data-block-badge="${secondUnitId}"]`).first()).toBeVisible();
    }
  });

  test('Mapa de reservas — drag & drop válido e inválido', async ({ page }) => {
    await page.locator('[data-bo-target="calendar"]').click();
    const board = page.locator('[data-calendar-board]');
    await expect(board).toBeVisible();

    const entry = board.locator('[data-calendar-entry][data-entry-status="CONFIRMED"]').first();
    const entryId = await entry.getAttribute('data-entry-id');
    const originStart = await entry.getAttribute('data-entry-start');
    const nightsAttr = await entry.getAttribute('data-entry-nights');
    test.skip(!entryId || !originStart, 'Sem reservas confirmadas disponíveis para reagendamento.');
    const nights = Number.parseInt(nightsAttr || '1', 10) || 1;

    const candidate = await board.evaluate((id, nightsCount) => {
      const source = document.querySelector(`[data-calendar-entry][data-entry-id="${id}"]`);
      if (!source) return null;
      const unitId = source.getAttribute('data-unit-id');
      const start = source.getAttribute('data-entry-start');
      const entries = Array.from(document.querySelectorAll('[data-calendar-entry]'));
      const cells = Array.from(document.querySelectorAll('[data-calendar-cell][data-in-month="1"]'));
      function addDays(iso, delta) {
        const date = new Date(iso + 'T00:00:00');
        date.setDate(date.getDate() + delta);
        return date.toISOString().slice(0, 10);
      }
      for (const cell of cells) {
        const date = cell.getAttribute('data-date');
        if (!date || !unitId || !start) continue;
        if (date <= start) continue;
        const newEnd = addDays(date, nightsCount);
        const blocked = entries.some(entryEl => {
          if (entryEl === source) return false;
          if (entryEl.getAttribute('data-unit-id') !== unitId) return false;
          const status = (entryEl.getAttribute('data-entry-status') || '').toUpperCase();
          if (status === 'CANCELLED') return false;
          const entryStart = entryEl.getAttribute('data-entry-start');
          const entryEnd = entryEl.getAttribute('data-entry-end');
          return !(entryEnd <= date || entryStart >= newEnd);
        });
        if (!blocked) {
          return { date, end: newEnd };
        }
      }
      return null;
    }, entryId, nights);

    test.skip(!candidate, 'Sem datas livres para reagendar.');

    const targetCell = board.locator(`[data-calendar-cell][data-date="${candidate.date}"] .bo-calendar-cell-body`).first();
    const responsePromise = page
      .waitForResponse(resp => resp.url().includes(`/calendar/booking/${entryId}/reschedule`) && resp.request().method() === 'POST')
      .then(resp => resp.json());
    const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle' });
    await entry.dragTo(targetCell, { force: true });
    const resPayload = await responsePromise;
    expect(resPayload.ok).toBeTruthy();
    expect(resPayload.message).toContain('Reserva reagendada');
    await navigationPromise;

    await expect(board).toBeVisible();
    const movedEntry = board.locator(`[data-calendar-entry][data-entry-id="${entryId}"]`).first();
    await expect(movedEntry).toHaveAttribute('data-entry-start', candidate.date);

    const revertResponsePromise = page
      .waitForResponse(resp => resp.url().includes(`/calendar/booking/${entryId}/reschedule`) && resp.request().method() === 'POST')
      .then(resp => resp.json());
    const revertNavigationPromise = page.waitForNavigation({ waitUntil: 'networkidle' });
    const originalCell = board.locator(`[data-calendar-cell][data-date="${originStart}"] .bo-calendar-cell-body`).first();
    await movedEntry.dragTo(originalCell, { force: true });
    const revertPayload = await revertResponsePromise;
    expect(revertPayload.ok).toBeTruthy();
    await revertNavigationPromise;

    await expect(board).toBeVisible();
    const restoredEntry = board.locator(`[data-calendar-entry][data-entry-id="${entryId}"]`).first();
    await expect(restoredEntry).toHaveAttribute('data-entry-start', originStart);

    const pastDateIso = await board.evaluate(() => {
      const today = new Date().toISOString().slice(0, 10);
      const cell = Array.from(document.querySelectorAll('[data-calendar-cell][data-in-month="1"]'))
        .find(el => (el.getAttribute('data-date') || '') < today);
      return cell ? cell.getAttribute('data-date') : null;
    });
    test.skip(!pastDateIso, 'Sem células de dias passados no mês visível.');

    const pastCell = board.locator(`[data-calendar-cell][data-date="${pastDateIso}"] .bo-calendar-cell-body`).first();
    await restoredEntry.dragTo(pastCell, { force: true });
    const toastMessage = page.locator('[data-calendar-toast-message]');
    await expect(toastMessage).toHaveText(/Data no passado/i);
  });

  test('Área do proprietário responsiva em 1024/768/480px', async ({ page }) => {
    await page.goto(baseURL + '/owners');
    const main = page.locator('.owners-main');
    await expect(main).toBeVisible();

    const sizes = [
      { width: 1024, height: 900 },
      { width: 768, height: 900 },
      { width: 480, height: 900 }
    ];

    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
      const hasOverflow = await page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement;
        return root.scrollWidth > window.innerWidth + 2;
      });
      expect(hasOverflow).toBeFalsy();
    }

    await page.setViewportSize({ width: 768, height: 900 });
    const tableRowDisplay = await page
      .locator('.owners-table tbody tr')
      .first()
      .evaluate(el => window.getComputedStyle(el).display);
    expect(tableRowDisplay).toBe('grid');

    const cellDirection = await page
      .locator('.owners-table tbody tr td')
      .first()
      .evaluate(el => window.getComputedStyle(el).flexDirection);
    expect(cellDirection).toBe('column');

    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
