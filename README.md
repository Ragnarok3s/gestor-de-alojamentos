# Gestor de Alojamentos

Aplicação Express para gestão de propriedades com backoffice, frontoffice e serviços
auxiliares (integrações OTA, pricing, automações, etc.). O servidor arranca um único
processo Node que expõe os módulos via HTTP.

## Requisitos

- Node.js 24.x (mínimo 18)
- npm 9+
- SQLite incluído por defeito (ficheiro é criado automaticamente)

## Instalação

1. Clona o repositório.
2. Duplica o ficheiro `.env.example` para `.env` e ajusta as variáveis conforme necessário.
3. Instala as dependências: `npm install`.

## Scripts disponíveis

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Arranca o servidor Express em modo desenvolvimento. |
| `npm run build` | Corre lint, typecheck e valida o bootstrap do servidor sem abrir portas. |
| `npm start` | Arranca o servidor em modo produção via `src/index.js`. |
| `npm run lint` | Verifica sintaxe (`node --check`) e espaços em branco com `--max-warnings=0`. |
| `npm run typecheck` | Passa `node --check` a todos os ficheiros JavaScript. |
| `npm test` | Executa os testes de domínio (`scripts/run-tests.js`) e a suite Jest (inclui fumos de navegação). |
| `npm run depcheck` | Procura dependências potencialmente não usadas com suporte a configs (webpack/eslint/ts/...) |
| `npm run analyze:routes` | Gera `reports/routes-analysis.json` com o grafo de rotas e navegação. |

Scripts utilitários adicionais:

- `node scripts/find-unused.js` — lista módulos e assets não referenciados.
- `node scripts/run-tests.js` — corre a suite de regressão usada anteriormente para CI.

## Pipeline de arranque

O bootstrap foi separado em camadas independentes para facilitar testes e manutenção:

1. `src/config/index.js` lê o ambiente, valida portas/SSL e resolve caminhos base (public, base de dados).
2. `src/infra/logger.js` expõe o logger partilhado (`server/logger.js`) para ser injetado na aplicação.
3. `src/services/index.js` liga a base de dados e inicializa serviços de domínio, devolvendo também `shutdown()`
   e listas de middlewares/rotas adicionais que devem ser aplicadas ao Express.
4. `src/app/createApp.js` recebe `{ services, config, logger }`, aplica middlewares globais, injeta os serviços
   e regista as rotas dos módulos. Não chama `listen`, permitindo injecção de mocks em testes.
5. `src/server/start.js` cria o servidor HTTP/HTTPS, trata sinais `SIGINT/SIGTERM` e chama `services.shutdown()`
   durante o desligar. O ficheiro `src/index.js` expõe `start()` e `createAppWithDefaults()` para CLI e testes.

### Testes sem arrancar portas reais

Utiliza `const { createApp } = require('./src/app/createApp')` para montar uma app com serviços mockados e
`supertest`. É possível passar `routes` personalizados e `services` parciais (ex.: `{ appRoutes: [...] }`) para
controlar exactamente o que é exposto. Para usar a configuração real mas sem abrir sockets:

```js
const { createAppWithDefaults } = require('./src/index');
process.env.SKIP_SERVER_START = '1';
process.env.DATABASE_PATH = ':memory:';
const { app, services } = createAppWithDefaults();
// usa app/serviços nos testes e termina chamando await services.shutdown?.()
```

## Ambiente de desenvolvimento

- Os helpers de datas vivem em `server/dayjs.js` e `src/lib/dates.js` e já expõem plugins UTC/timezone. Usa `calculateNights`/`ensureZonedDayjs` para cálculos de estadias (os testes cobrem casos de DST).
- Ficheiros e módulos descontinuados devem ser movidos para `legacy/_archive` para manter
histórico sem poluir o código activo.
- A estrutura principal encontra-se em `src/modules` (frontoffice, backoffice, auth, etc.) e
`server/` (serviços, integrações e automações).
- Existe um logger mínimo em `server/logger.js` com `requestId`; qualquer `console.log/warn/error` passa por ele.
- Define `APP_DEFAULT_TIMEZONE` no `.env` se precisares de outro fuso horário base.

## Testes e qualidade

1. Corre sempre `npm run lint` e `npm run typecheck` antes de submeter alterações.
2. Garante que `npm test` passa (inclui testes de fumo do backoffice com fetch real).
3. Executa `npm run depcheck` para confirmar que não ficam dependências órfãs.
4. Regera `reports/routes-analysis.json` com `npm run analyze:routes` para detectar rotas órfãs.

Os testes geram cobertura V8 em `coverage/`. Remove a pasta se não for necessária para commits.

## Arranque em produção

- Define `DATABASE_PATH` para apontar para o ficheiro SQLite desejado.
- Activa `FORCE_SECURE_COOKIE=1` e configura `SSL_KEY_PATH`/`SSL_CERT_PATH` se quiseres servir HTTPS directo.
- Configura as variáveis `SMTP_*` e `EXPORT_SIGNING_KEY` para funcionalidades de e-mail/export seguros.
- Ajusta `PUBLIC_BASE_URL`/`REVIEW_FEEDBACK_URL` para links externos emitidos por emails.
- Usa `npm start` (ou um process manager como pm2) para servir a aplicação.

## Relatórios

- `reports/routes-analysis.json`: grafo de rotas + ligações gerado pela última execução de `npm run analyze:routes`.
- `legacy/_archive/`: contém módulos removidos mas ainda documentados.

## Licença

ISC — ver `package.json`.
