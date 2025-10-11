# Guia de Testes

## Playwright E2E
1. Exporta as credenciais e URL da instância:
   ```bash
   export E2E_BASE_URL="http://localhost:3000"
   export E2E_USER="gestor"
   export E2E_PASSWORD="change-me"
   ```
2. Executa apenas o conjunto crítico de UX:
   ```bash
   npx playwright test tests/e2e/ux.spec.js
   ```

Os testes fazem skip automático se o seed não contiver dados suficientes (p.ex. menos de duas unidades ou reservas confirmadas).

## Testes unitários / lint
Sem alterações nesta sweep. Mantém o `npm test` habitual caso já exista na pipeline.
