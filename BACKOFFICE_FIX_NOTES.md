# Notas de correção Backoffice

## Ficheiros tocados
- `server.js`
- `src/modules/backoffice/index.js`
- `src/modules/backoffice/scripts/sidebar-navigation.js`
- `src/modules/backoffice/scripts/ux-enhancements.js`
- `src/modules/backoffice/ux-api.js`
- `src/modules/frontoffice/index.js`
- `src/modules/owners/index.js`
- `src/services/unit-blocks.js`
- `tests/e2e/ux.spec.js`
- `MICROCOPY.md`
- `TESTS.md`

## Antes / Depois (resumo)
- **Sidenav backoffice**: antes o layout tinha alinhamentos quebrados e não respeitava breakpoints. Agora o sidebar usa CSS responsivo com estados desktop/compact/mobile, tooltips acessíveis, controlo de foco, preferência persistida e no modo recolhido expõe apenas ícones + botão de expandir.
- **Bloqueio de unidades**: fluxo estava disperso e operava unidade a unidade. Foi centralizado na tabela de unidades com seleção múltipla, sumário vivo, modal reescrito, validações consistentes e badges instantâneos.
- **Mapa de reservas**: drag & drop falhava por colisões de IDs e não bloqueava destinos inválidos. Atualizámos os bindings, mensagens de erro (bloqueios, datas passadas) e feedback visual/toast.
- **Channel Manager**: cards e grelhas estavam desalinhados nas laterais. A secção foi harmonizada com cartões dedicados, cabeçalhos equilibrados e grelhas com espaçamentos consistentes em todas as colunas.
- **Área do proprietário**: layout não escalava para tablet/mobile. Agora aplica breakpoints oficiais, tabelas em formato stacked, formulários a uma coluna e grelhas com 3→2→1 colunas.
- **Testes**: Playwright cobre os fluxos críticos (sidenav, bloqueio em lote, DnD válido/ inválido, responsividade owners). Unit-service mantém validações e rollback atómico.

## Decisões e compromissos
- Mantivemos a transação de `createBlocks` como "all-or-nothing" para evitar estados mistos. Mensagens de conflito incluem a unidade afectada para guiar o utilizador.
- No calendário, optámos por reaproveitar o markup existente e adicionar razões específicas para bloqueios em vez de introduzir elementos adicionais, evitando regressões visuais.
- Os testes E2E fazem fallback para `test.skip` quando o seed não fornece dados suficientes (p.e. menos de duas unidades ou reservas confirmadas) para garantir estabilidade na CI.

## Known limitations
- O DnD depende de pelo menos uma reserva confirmada disponível e pode não exercitar movimentos entre unidades se não existirem slots livres na base de testes.
- O bloqueio em lote não expõe UI para remover rapidamente bloqueios recém-criados; é necessário gerir cada entrada manualmente.
- Em ecrãs muito altos (>1200px) o sidebar continua sticky mas não recalcula a altura do topo dinamicamente; não afecta usabilidade mas poderá ser refinado.

## Follow-ups sugeridos
- Adicionar gestão de bloqueios (listagem/remoção) integrada na tabela para completar o ciclo.
- Considerar memorizar a última tab activa via `localStorage` para utilizadores multi-tarefa.
- Expandir os testes para cobrir undo de DnD via API quando disponível.
