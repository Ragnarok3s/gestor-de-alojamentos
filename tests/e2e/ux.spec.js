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
    const firstButton = page.locator('[data-block-unit]').first();
    await firstButton.click();
    await page.locator('[data-block-modal]').waitFor({ state: 'visible' });
    await page.fill('[data-block-start]', '2025-09-01');
    await page.fill('[data-block-end]', '2025-09-05');
    await page.fill('[data-block-reason]', 'Manutenção preventiva');
    await Promise.all([
      page.waitForResponse(resp => resp.url().match(/\/admin\/api\/units\/\d+\/blocks/)),
      page.click('[data-block-submit]')
    ]);
    await expect(page.locator('.bo-toast--success', { hasText: 'Bloqueio criado' })).toBeVisible();
    await expect(page.locator('[data-block-badge]:not(.hidden)')).toHaveCount(1);
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
  });
});
