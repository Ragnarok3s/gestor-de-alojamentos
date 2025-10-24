# Plano de Refatoração Arquitetural

## Estado atual

- **Acoplamento excessivo no backoffice**: `src/modules/backoffice/index.js` (5145 linhas) mistura preparação de SQL, regras de negócio e renderização de EJS no mesmo módulo, com consultas preparadas logo no topo (`db.prepare('SELECT property_id FROM units WHERE id = ?')`) e renderers personalizados para `partials/*.ejs`. 【F:src/modules/backoffice/index.js†L220-L270】
- **Frontoffice monolítico**: `src/modules/frontoffice/index.js` (3443 linhas) encapsula consultas SQL, transformação de dados e renderização numa única função de registo de rotas. 【F:src/modules/frontoffice/index.js†L364-L399】
- **Serviços com SQL embutido**: `src/services/twoFactorService.js` compila múltiplos `db.prepare` no mesmo serviço, acoplando acesso a dados e lógica de negócio. 【F:src/services/twoFactorService.js†L11-L117】
- **Renderer customizado de EJS**: `src/lib/viewRenderer.js` recompila templates manualmente com cache próprio em vez de delegar diretamente ao EJS oficial. 【F:src/lib/viewRenderer.js†L33-L74】

## Estrutura alvo

```text
src/
  server/
    createApp.js        # apenas configuração HTTP/Express
    initServices.js     # orquestra injeção de dependências
    start.js            # bootstrap que chama createApp + listen
  shared/
    db/                 # conexões e migrations comuns
    utils/              # helpers sem side-effects
  backoffice/
    db/                 # repositórios (sqlite/sql abstraído)
    services/           # regras de negócio + autorização
    controllers/        # camadas HTTP, sem SQL
    views/              # templates EJS oficiais
  frontoffice/
    db/
    services/
    controllers/
    views/
  owners/
    ...
```

- Os templates passam a usar apenas `ejs.renderFile` com `<%=` por defeito.
- Controllers apenas recebem `req/res` e chamam serviços; serviços dependem de repositórios com APIs estáveis (ex.: `bookingRepository.findById`); repositórios encapsulam SQL bruto ou camada fina de ORM.

## Roadmap incremental (PRs pequenas)

1. **Fase 0 – Fundamentos**
   - Criar `src/server/createApp.js`, `src/server/initServices.js` e `src/server/start.js` exportando funções puras e sem `app.listen` implícito.
   - Substituir o renderer customizado por chamadas diretas a `ejs.renderFile`, mantendo compatibilidade.
   - Adicionar testes de fumos (supertest) para garantir que `createApp()` monta middlewares básicos.

2. **Fase 1 – Backoffice/Bookings**
   - Introduzir `backoffice/db/bookingRepository.js` com métodos `findById`, `listSummaries`, `countByStatus`.
   - Mover lógica de autorização para `backoffice/services/bookingService.js`.
   - Reescrever controladores de bookings isolando manipulação de `req/res`.
   - Adicionar testes: unitários para `bookingService`, integração com supertest para rotas críticas e snapshots para `views/backoffice/bookings.ejs`.

3. **Fase 2 – Backoffice/Housekeeping**
   - Fatiar `housekeeping.js` em repositório (`taskRepository`), serviço (`housekeepingService`) e controllers (`boardController`, `taskActionsController`).
   - Cobrir regras de escalonamento com testes unitários e garantir paridade de HTML da vista principal.

4. **Fase 3 – Frontoffice/Guest Portal**
   - Extrair repositórios (`guestBookingRepository`, `policyRepository`) para remover SQL de controladores.
   - Isolar transformação de payload em serviços com testes unitários.

5. **Fase 4 – Serviços transversais**
   - Migrar `twoFactorService`, `sessionService`, `tenantsService` para usarem repositórios em `shared/db`.
   - Avaliar migração para ORM leve (Kysely ou Drizzle) onde joins múltiplos são frequentes (ex.: bookings + properties).

6. **Fase 5 – Consolidação**
   - Garantir reutilização de repositórios entre módulos (backoffice/frontoffice) partilhando contratos.
   - Atualizar documentação e gerar relatórios de cobertura (>70%).

Cada fase deve terminar com CI verde, cobertura mínima de 70% nos arquivos tocados e checklist de aceitação assinado.

## Exemplo de diff incremental

```diff
-  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
-  if (!existing) {
-    return res.status(404).render('backoffice/not-found');
-  }
+  const booking = await bookingRepository.findById(id);
+  if (!booking) {
+    return res.status(404).render('backoffice/not-found');
+  }
+  await bookingService.assertTenantAccess({ booking, user: req.user });
```

## Checklist de aceitação por PR

- [ ] Estrutura de pastas alinhada com a fase (nenhuma nova dependência cíclica).
- [ ] Nenhum SQL restante em controllers/views do escopo da fase.
- [ ] Serviços cobertos por testes unitários (>70% statements).
- [ ] Rotas expostas cobertas por testes supertest feliz/triste.
- [ ] Snapshots atualizados das views alteradas.
- [ ] `npm test` e lint executados com sucesso.
- [ ] Documentação/README da área atualizados.
- [ ] Plano de rollback definido (git revert ou feature flag).

## Plano de rollback

1. Manter cada fase numa feature branch isolada.
2. Guardar migrações de schema compatíveis com versão anterior (sem `DROP` definitivo).
3. Para rollback rápido: `git revert <merge-commit>` + reexecutar scripts de seed opcionais.
4. Backups de base de dados antes de aplicar migrations novas.

## Backlog de extração de SQL → Repositórios

| Área | Local atual | Método proposto |
| --- | --- | --- |
| Backoffice Roles | `modules/backoffice/index.js` (`SELECT property_id FROM units WHERE id = ?`) | `backoffice/db/roleAssignmentsRepository.getContext(unitId)` |
| Backoffice Bookings | `modules/backoffice/bookings.js` (`SELECT b.*, u.name AS unit_name ...`) | `backoffice/db/bookingRepository.listDetailed(filter)` |
| Housekeeping | `modules/backoffice/housekeeping.js` (`SELECT ht.id ...`) | `backoffice/db/housekeepingRepository.listBoard(params)` |
| Frontoffice Guest Portal | `modules/frontoffice/index.js` (`SELECT b.*, u.name AS unit_name ...`) | `frontoffice/db/guestPortalRepository.findBookingWithPolicy(bookingId)` |
| Two-factor Auth | `services/twoFactorService.js` (`SELECT user_id, secret ...`) | `shared/db/twoFactorRepository.getConfig(userId)` |
| Tenants | `services/tenants.js` (`SELECT id, name, domain ...`) | `shared/db/tenantRepository.list()` |
| Sessions | `services/session.js` (`SELECT s.token, s.token_hash ...`) | `shared/db/sessionRepository.findActiveByTokenHash(hash)` |

Cada repositório deve expor objetos tipados (Typescript ou JSDoc) e testes cobrindo operações CRUD, simulando erros de base de dados.

## Estratégia de testes

- **Unit tests (services)**: Jest com mocks de repositórios para cobrir regras de negócio.
- **Integração (controllers)**: Supertest instanciando `createApp()` com SQLite in-memory e fixtures para validar status codes/autorização.
- **Snapshots de views**: Renderizar templates com dados representativos e guardar snapshots estáveis.
- **Cobertura**: Exigir >70% nas unidades modificadas através de `npm test -- --coverage --collectCoverageFrom` direcionado.

## Entregáveis esperados

- Estrutura de pastas conforme acima após cada fase.
- PRs pequenas (≤400 linhas) com diffs semelhantes ao exemplo.
- Checklist preenchido e partilhado em cada PR.
- Script/documento de rollback por fase.
