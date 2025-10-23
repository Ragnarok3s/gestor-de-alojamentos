# Changelog

## 2025-10-23

### Added
- Configuração partilhada do Day.js (`server/dayjs.js`) e helpers utilitários em `src/lib/dates.js`.
- Scripts de auditoria (`scripts/analyze-routes.js`, `scripts/find-unused.js`) e fumos Jest para o backoffice.
- Script `npm run analyze:routes` e pipeline `npm test` combinando regressão e Jest.
- `.env.example` com as variáveis relevantes para desenvolvimento e produção.
- Documentação principal (`README.md`) e relatório actualizado em `reports/routes-analysis.json`.

### Changed
- Navegação do backoffice actualizada (links para Propriedades, Pagamentos, Planos Tarifários).
- Normalização de imports Day.js em serviços, testes e servidor principal.
- Limpeza de espaços em branco em `src/modules/auth/index.js` e `src/modules/backoffice/calendar.js`.
- `scripts/depcheck.js` agora detecta dependências usadas através de strings estáticas.
- `tests/run-tests.js` sem duplicação de função e `npm test` executa toda a suite.

### Removed
- Código legado movido para `legacy/_archive/` (`src/modules/payments/index.js`, `src/services/ownerPush.js`).
## 2025-10-23 (refinamento)

### Added
- Middleware de logging (`server/logger.js` e `server/middleware/requestLogger.js`) com `requestId` e binding do `console`.
- Tratador de erros consistente com resposta JSON/HTML e referência (`server/middleware/errorHandler.js`).
- Testes de datas sensíveis a DST (`tests/unit/dates/timezone-behaviour.test.js`) e navegação do backoffice.
- Configuração de lint (`.eslintrc.cjs`), Prettier e `tsconfig.json` para `tsc --noEmit`.
- README dentro de `legacy/_archive` com instruções de recuperação.

### Changed
- `src/lib/dates.js` expõe helpers `calculateNights`/`ensureZonedDayjs` e suporta `APP_DEFAULT_TIMEZONE`.
- `server.js` e `server/initServices.js` usam o logger partilhado e tratadores centralizados.
- Scripts npm modernizados (`npm run build` encadeia lint/typecheck, `npm run lint` impõe `--max-warnings=0`, `npm test` usa a suite Jest de fumos).
- `.env.example` e `README.md` actualizados com novas variáveis e instruções de troubleshooting.
- `scripts/depcheck.js` cobre configs adicionais (webpack/eslint/ts/jest) ao procurar dependências por padrões estáticos.

### Fixed
- Respostas 404 incluem o código de referência do pedido e são registadas no logger.
