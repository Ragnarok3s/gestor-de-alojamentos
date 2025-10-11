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

test.describe('Casas de Pousadouro — Fluxos UX críticos', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!baseURL, 'Define E2E_BASE_URL para executar os testes de interface.');
    await ensureLogin(page);
  });

  test('Atualizar preços apenas para fim-de-semana', async ({ page }) => {
    test.skip(!baseURL, 'Define E2E_BASE_URL para executar os testes de interface.');

    await page.locator('[data-bo-target="overview"]').click();
    const ratesCard = page.locator('[data-rates-bulk]');
    await expect(ratesCard).toBeVisible();
    await ratesCard.locator('[data-rate-start]').fill('2025-08-15');
    await ratesCard.locator('[data-rate-end]').fill('2025-08-18');
    await ratesCard.locator('[data-rate-price]').fill('185');
    await ratesCard.locator('[data-rate-weekends]').check();
    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/admin/api/rates/bulk') && resp.request().method() === 'PUT'),
      ratesCard.locator('[data-rate-apply]').click()
    ]);
    await expect(page.locator('.bo-toast--success', { hasText: 'Preços atualizados' })).toBeVisible();
    await page.locator('.bo-toast__action', { hasText: 'Anular' }).click();
    await expect(page.locator('.bo-toast--success', { hasText: 'Alteração anulada' })).toBeVisible();
  });

  test('Bloquear duas unidades e validar badge', async ({ page }) => {
    test.skip(!baseURL, 'Define E2E_BASE_URL para executar os testes de interface.');

    await page.locator('[data-bo-target="overview"]').click();
    const buttons = page.locator('[data-block-unit]');
    const firstButton = buttons.first();
    const secondButton = buttons.nth(1);
    const firstUnitId = await firstButton.getAttribute('data-block-unit');
    await firstButton.click();
    await page.locator('[data-block-modal]').waitFor({ state: 'visible' });
    await page.fill('[data-block-start]', '2025-09-01');
    await page.fill('[data-block-end]', '2025-09-05');
    await page.fill('[data-block-reason]', 'Manutenção preventiva');
    const firstDialogPromise = page.waitForEvent('dialog');
    const firstResponsePromise = page.waitForResponse(resp => resp.url().match(/\/admin\/api\/units\/\d+\/blocks/) && resp.request().method() === 'POST');
    await page.click('[data-block-submit]');
    const firstDialog = await firstDialogPromise;
    await expect(firstDialog.message()).toContain('Confirmas o bloqueio');
    await firstDialog.accept();
    const firstResponse = await firstResponsePromise;
    await expect(firstResponse.status()).toBe(201);
    await expect(page.locator('.bo-toast--success', { hasText: 'Bloqueio criado para' })).toBeVisible();

    await secondButton.click();
    await page.locator('[data-block-modal]').waitFor({ state: 'visible' });
    await page.fill('[data-block-start]', '2025-10-10');
    await page.fill('[data-block-end]', '2025-10-12');
    await page.fill('[data-block-reason]', 'Evento privado');
    const secondDialogPromise = page.waitForEvent('dialog');
    const secondResponsePromise = page.waitForResponse(resp => resp.url().match(/\/admin\/api\/units\/\d+\/blocks/) && resp.request().method() === 'POST');
    await page.click('[data-block-submit]');
    const secondDialog = await secondDialogPromise;
    await expect(secondDialog.message()).toContain('Confirmas o bloqueio');
    await secondDialog.accept();
    const secondResponse = await secondResponsePromise;
    await expect(secondResponse.status()).toBe(201);
    await expect(page.locator('.bo-toast--success', { hasText: 'Bloqueio criado para' })).toBeVisible();

    const visibleBadges = page.locator('[data-unit-row] [data-block-badge]:not([hidden])');
    await expect(visibleBadges).toHaveCount(2);

    if (firstUnitId) {
      const bookingUrl = `${baseURL}/book/${firstUnitId}?checkin=2025-09-01&checkout=2025-09-05`;
      const response = await page.goto(bookingUrl, { waitUntil: 'domcontentloaded' });
      await expect(response?.status()).toBe(409);
      await expect(page.locator('body')).toContainText('já não tem disponibilidade');
      await page.goto(baseURL + '/admin');
      await page.locator('[data-bo-target="overview"]').click();
    }
  });

  test('Responder a uma review negativa', async ({ page }) => {
    test.skip(!baseURL, 'Define E2E_BASE_URL para executar os testes de interface.');

    await page.locator('[data-bo-target="reviews"]').click();
    const reviewsRoot = page.locator('[data-reviews-root]');
    await expect(reviewsRoot).toBeVisible();
    await page.locator('[data-review-filter="negative"]').click();
    const firstReview = page.locator('[data-review-id]').first();
    await firstReview.locator('button:has-text("Responder")').click();
    const composer = page.locator('[data-review-composer]');
    await expect(composer).toBeVisible();
    await composer.locator('[data-review-response]').fill('Obrigado pelo feedback, já reforçámos a equipa.');
    await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/admin/api/reviews/') && resp.request().method() === 'POST'),
      composer.locator('[data-review-submit]').click()
    ]);
    await expect(page.locator('.bo-toast--success', { hasText: 'Resposta registada' })).toBeVisible();
    await expect(firstReview.locator('.bo-status-badge', { hasText: 'Respondida' })).toBeVisible();
  });

  test('Exportar relatório semanal em CSV', async ({ page }) => {
    test.skip(!baseURL, 'Define E2E_BASE_URL para executar os testes de interface.');

    await page.locator('[data-bo-target="estatisticas"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-weekly-from]').fill('2025-07-01');
    await page.locator('[data-weekly-to]').fill('2025-07-07');
    await page.locator('[data-weekly-export-action="csv"]').click();
    const download = await downloadPromise;
    await expect(download.suggestedFilename()).toMatch(/relatorio-semanal/);
    const stream = await download.createReadStream();
    if (stream) {
      const contents = await new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
      });
      expect(contents).toContain('Período,Ocupação (%)');
      expect(contents).toContain('Reservas');
    }
  });
});
