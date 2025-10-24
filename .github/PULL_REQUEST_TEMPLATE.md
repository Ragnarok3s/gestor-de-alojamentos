## Objetivo
[Resumo curto do que muda e porquê]

## Escopo
- Inclui: [...]
- Exclui: [...]

## Alterações
- Pastas/arquitetura: [antes → depois]
- Diff(s) exemplificativo(s): [blocos curtos]

## Riscos & Mitigações
- Risco: [...]
- Mitigação: [...]

## Testes
- Unit: [ ]
- Integração (supertest): [ ]
- Snapshots de views: [ ]
- Cobertura local: [xx%]

## Checklist de Aceitação
- [ ] Sem EJS custom; só `ejs` oficial.
- [ ] SQL extraído para `repositories/`.
- [ ] `createApp()` sem `listen` e com DI de serviços.
- [ ] Rotas críticas testadas (200/401/403/500).
- [ ] Rollback documentado.

## Rollback
Passos rápidos de reversão: `git revert <merge-commit>`

## Tarefas relacionadas
Closes #[issues]
