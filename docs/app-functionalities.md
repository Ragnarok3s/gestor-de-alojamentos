# Funcionalidades da Aplicação

_Gerado automaticamente em: 2025-10-14 17:51_

## Sumário
- Número total de funcionalidades: 16
- Módulos analisados: [api, ui, cli, jobs, models, tests]
- Nota: Documento deduplicado (sem funcionalidades repetidas).

## Tabela Resumo
| # | Funcionalidade | Entradas | Principais Módulos | Observações |
|---|----------------|----------|---------------------|-------------|
| 1 | Autenticação Backoffice e Sessões | UI/API `/login`, `POST /logout` | `src/modules/auth`; `src/services/session.js` | CSRF e cookies seguros configurados |
| 2 | Segurança de Conta e 2FA | UI `/account/seguranca`, `POST` 2FA rotas | `src/modules/account`; `src/services/twoFactorService.js` | Gestão de códigos e desafios |
| 3 | Motor de Reservas Público | UI `/`, `/book/:unitId`, API `POST /book` | `src/modules/frontoffice/index.js` | Validações de hóspedes e quotas |
| 4 | Calendário Operacional e Reagendamento | UI `/calendar`, API `/calendar/booking/:id/...` | `src/modules/frontoffice/index.js` | Reagendamento com validação de conflitos |
| 5 | Gestão de Tarefas de Limpeza | UI `/limpeza/tarefas`, `/admin/limpeza` | `src/modules/backoffice/index.js` | Fluxos de criação, progresso e reabertura |
| 6 | Gestão de Propriedades e Unidades | UI `/admin/properties`, `/admin/units/:id` | `src/modules/backoffice/index.js` | Inclui geocoding e galeria de imagens |
| 7 | Gestão de Reservas no Backoffice | UI `/admin/bookings` e detalhes | `src/modules/backoffice/index.js` | Edição, notas e cancelamentos com auditoria |
| 8 | Gestão de Tarifas e Bloqueios | API `/admin/api/rates/*`, `/admin/api/units/:id/blocks` | `src/modules/backoffice/ux-api.js`; serviços de rates/blocks | Bulk edit com undo e bloqueios anti-conflito |
| 9 | Centro de Reviews e Respostas | UI aba reviews, API `/admin/api/reviews` | `src/modules/backoffice/ux-api.js`; `src/services/review-center.js` | Telemetria e filtros negativos |
|10 | Relatórios e KPIs Exportáveis | UI aba estatísticas, API `/admin/api/reports/weekly` | `src/modules/backoffice/ux-api.js`; `src/services/reporting.js` | Exporta CSV/PDF com limites de 31 dias |
|11 | Channel Manager e Integrações OTA | UI `#channel-manager`, API `/admin/channel-*` | `src/modules/backoffice/index.js`; `server.js` | Sincronizações auto e uploads manuais |
|12 | Portal de Proprietários | UI `/owners` | `src/modules/owners/index.js` | Dashboards por propriedade e canais |
|13 | Motor de Automações Operacionais | API `/admin/automation/*` | `src/modules/backoffice/index.js`; `server/automations/engine.js` | Exporta métricas e aciona drivers |
|14 | Assistente de Decisão Comercial | Jobs agendados | `server/decisions/assistant.js`; `server.js` | Sugere ajustes de preço/promoções |
|15 | Chatbot de Apoio à Reserva | UI widget `/chatbot` | `server/chatbot/router.js`; `server.js` | Sessões persistentes e feedback |
|16 | Reindexação da Base de Conhecimento | CLI `createKbReindexer` | `server/kb/reindex.js` | Atualiza índice de FAQ/artigos |

---

## Funcionalidades (detalhe)

### Autenticação Backoffice e Sessões
**O que é:** Implementa formulário e processamento de login/logout com proteção CSRF, validação de credenciais bcrypt e gestão de sessões persistentes com cookies `httpOnly` e tolerância a redirecionamentos seguros.【F:src/modules/auth/index.js†L1-L101】【F:src/services/session.js†L3-L140】  
**O que o utilizador consegue fazer:**
- Abrir o formulário `/login` e receber feedback de erro/sucesso.【F:src/modules/auth/index.js†L20-L61】
- Autenticar-se por `POST /login` com rotação automática de token CSRF.【F:src/modules/auth/index.js†L63-L101】
- Obter redireciono condicional para dashboard, reservas ou limpeza conforme permissões.【F:src/modules/auth/index.js†L82-L101】
- Terminar sessão via `POST /logout`, com registo de auditoria e destruição da sessão persistente.【F:src/modules/auth/index.js†L103-L118】【F:src/services/session.js†L64-L70】
**Entradas:**
- **API:** `POST /login`, `POST /logout`
- **UI:** `/login`
- **CLI:** —
**Módulos principais:** `src/modules/auth/index.js`, `src/services/session.js`, `server.js` (configuração de cookies e permissões).【F:server.js†L3200-L3256】  
**Dependências relevantes:** `bcryptjs` para hash das passwords, `cookie-parser` e o serviço de sessão próprio.【F:server.js†L5-L55】【F:src/services/session.js†L3-L140】  
**Exemplo real:** _“Uma rececionista acede a `/login`, insere as credenciais e é redirecionada para `/admin` com a sessão guardada por 7 dias; ao terminar o turno, clica em “Terminar sessão”, limpando o cookie `adm`.”_  
**Notas/Riscos:** Exige HTTPS para definir `secureCookies` quando configurado; redirecionos externos são bloqueados por `isSafeRedirectTarget` para prevenir open-redirects.【F:server.js†L130-L192】【F:src/modules/auth/index.js†L23-L47】

### Segurança de Conta e 2FA
**O que é:** Área de conta que permite ativar, confirmar, regenerar e desativar autenticação de dois fatores, bem como consultar logs de sessão e exportar CSV de acessos.【F:src/modules/account/index.js†L1-L181】【F:src/services/twoFactorService.js†L11-L205】  
**O que o utilizador consegue fazer:**
- Iniciar configuração 2FA com QR code e códigos de recuperação.【F:src/modules/account/index.js†L65-L131】
- Confirmar códigos TOTP e gerar novos códigos de recuperação.【F:src/modules/account/index.js†L132-L168】【F:src/services/twoFactorService.js†L133-L205】
- Desativar 2FA ou cancelar configuração pendente, com rotação de tokens.【F:src/modules/account/index.js†L168-L207】
- Consultar e exportar histórico dos últimos 50 eventos de sessão.【F:src/modules/account/index.js†L182-L238】
**Entradas:**
- **API:** `POST /account/seguranca/2fa/*`
- **UI:** `/account/seguranca`
- **CLI:** —
**Módulos principais:** `src/modules/account/index.js`, `src/services/twoFactorService.js`, `src/services/twoFactor.js` (geração de códigos).【F:src/services/twoFactorService.js†L11-L205】  
**Dependências relevantes:** `crypto` para hashing, utilitários TOTP customizados, `dayjs` para datas.【F:src/services/twoFactorService.js†L1-L205】  
**Exemplo real:** _“Um diretor ativa o 2FA, digitaliza o QR code, confirma o token de 6 dígitos e descarrega novos códigos de recuperação antes de sair da página.”_  
**Notas/Riscos:** Falhas na validação rejeitam tokens; rotas exigem sessão autenticada e validação de CSRF em cada formulário.【F:src/modules/account/index.js†L14-L33】【F:src/modules/account/index.js†L109-L131】

### Motor de Reservas Público
**O que é:** Portal público que lista unidades disponíveis por propriedade, calcula cotações e aceita submissões de reserva com validações de contacto e agência, emitindo confirmações pendentes ou automáticas conforme permissões.【F:src/modules/frontoffice/index.js†L39-L200】【F:src/modules/frontoffice/index.js†L798-L960】  
**O que o utilizador consegue fazer:**
- Pesquisar unidades por datas, hóspedes e propriedade com verificação de capacidade e estadia mínima.【F:src/modules/frontoffice/index.js†L108-L200】
- Visualizar ficha de confirmação `/book/:unitId` com resumo de preço e dados da unidade.【F:src/modules/frontoffice/index.js†L805-L906】
- Submeter reserva (`POST /book`) e receber estado `PENDING` ou `CONFIRMED` de acordo com privilégios internos.【F:src/modules/frontoffice/index.js†L909-L960】
- Receber feedback imediato sobre conflitos ou falhas de validação (ex.: capacidade, CSRF).【F:src/modules/frontoffice/index.js†L909-L949】
**Entradas:**
- **API:** `POST /book`
- **UI:** `/`, `/search`, `/book/:unitId`
- **CLI:** —
**Módulos principais:** `src/modules/frontoffice/index.js`, `src/services/booking-emails.js`, `server.js` (branding e emailer).【F:server.js†L1609-L1638】  
**Dependências relevantes:** `dayjs` para datas, `better-sqlite3` para persistência, `crypto` para tokens de confirmação.【F:src/modules/frontoffice/index.js†L39-L960】  
**Exemplo real:** _“Um hóspede escolhe 15–18 Agosto para dois adultos, confirma a “Suite Vista Rio” e recebe mensagem de reserva pendente enquanto a equipa valida.”_  
**Notas/Riscos:** Bloqueios e reservas sobrepostas geram erro 409; testes E2E confirmam que unidades bloqueadas retornam `409` ao tentar reservar no período indisponível.【F:tests/e2e/ux.spec.js†L76-L124】

### Calendário Operacional e Reagendamento
**O que é:** Visão privada do calendário com filtros por propriedade/unidade, listagem mobile responsiva e endpoints para reagendar ou cancelar reservas e bloqueios com validação de conflitos e estadia mínima.【F:src/modules/frontoffice/index.js†L1109-L1899】  
**O que o utilizador consegue fazer:**
- Navegar mês a mês e filtrar por unidade, datas ou hóspede.【F:src/modules/frontoffice/index.js†L1110-L1208】
- Visualizar overview por estado (confirmadas, pendentes) e totais de noites.【F:src/modules/frontoffice/index.js†L1178-L1199】
- Reagendar reservas com cálculo de nova tarifa e registo de mudança.【F:src/modules/frontoffice/index.js†L1806-L1849】
- Reagendar ou cancelar bloqueios diretamente do calendário com validação cruzada.【F:src/modules/frontoffice/index.js†L1869-L1899】
**Entradas:**
- **API:** `POST /calendar/booking/:id/reschedule`, `POST /calendar/booking/:id/cancel`, `POST /calendar/block/:id/reschedule`
- **UI:** `/calendar`
- **CLI:** —
**Módulos principais:** `src/modules/frontoffice/index.js` (secção calendário), `server.js` (permissões), `src/services/unit-blocks.js` para conflitos.【F:server.js†L3200-L3256】【F:src/services/unit-blocks.js†L1-L90】  
**Dependências relevantes:** `dayjs`, serviços de pricing e logging de alterações.【F:src/modules/frontoffice/index.js†L1806-L1899】  
**Exemplo real:** _“A gestora arrasta uma reserva para novas datas; o sistema recalcula o preço, verifica mínimos e atualiza a linha no calendário.”_  
**Notas/Riscos:** Apenas perfis com `calendar.reschedule` podem alterar datas; conflitos com reservas/bloqueios devolvem `409`.【F:src/modules/frontoffice/index.js†L1820-L1887】

### Gestão de Tarefas de Limpeza
**O que é:** Painéis `/limpeza/tarefas` e `/admin/limpeza` com métricas, backlog, criação de tarefas baseadas em reservas e ações de progresso/conclusão/reabertura, registando auditoria completa.【F:src/modules/backoffice/index.js†L987-L1843】  
**O que o utilizador consegue fazer:**
- Consultar quadro de limpeza com pendentes, em curso e concluídas (últimas 24h/7d).【F:src/modules/backoffice/index.js†L987-L1058】
- Criar tarefas a partir de reservas, definindo prioridade, prazos e tipo (checkout/checkin/etc.).【F:src/modules/backoffice/index.js†L1635-L1751】
- Atualizar estado para “em progresso” ou “concluída” com registo de timestamps e utilizadores.【F:src/modules/backoffice/index.js†L1753-L1815】
- Reabrir tarefas para revisão e manter histórico de alterações.【F:src/modules/backoffice/index.js†L1817-L1843】
**Entradas:**
- **API:** `POST /admin/limpeza/tarefas`, `POST /limpeza/tarefas/:id/progresso`, `POST /limpeza/tarefas/:id/concluir`
- **UI:** `/limpeza/tarefas`, `/admin/limpeza`
- **CLI:** —
**Módulos principais:** `src/modules/backoffice/index.js` (secção housekeeping), `server/services/pricing.js` para cálculos auxiliares (quando integra com automações).【F:src/modules/backoffice/index.js†L987-L1843】  
**Dependências relevantes:** `dayjs` para planeamento, logging via `logActivity` e base de dados de housekeeping.【F:src/modules/backoffice/index.js†L1635-L1815】  
**Exemplo real:** _“A governanta cria uma limpeza ‘checkout’ ligada à reserva 542, marca início quando a equipa chega e conclui após inspeção, ficando registados os tempos.”_  
**Notas/Riscos:** Campos de data/hora validados e normalizados; acesso restrito por permissões `housekeeping.view/manage/complete`.【F:src/modules/backoffice/index.js†L987-L1099】【F:src/modules/backoffice/index.js†L1635-L1843】

### Gestão de Propriedades e Unidades
**O que é:** Formulários administrativos para criar/editar propriedades (com geocodificação), gerir unidades, definir rates manuais e administrar galerias de imagens com compressão automática.【F:src/modules/backoffice/index.js†L4160-L4859】  
**O que o utilizador consegue fazer:**
- Criar novas propriedades com morada e coordenadas obtidas por geocoding.【F:src/modules/backoffice/index.js†L4160-L4194】
- Editar detalhes, ver reservas associadas e eliminar propriedades/unidades se necessário.【F:src/modules/backoffice/index.js†L4206-L4276】【F:src/modules/backoffice/index.js†L4685-L4702】
- Criar unidades com capacidades, definir rates específicas e bloquear datas diretamente na ficha.【F:src/modules/backoffice/index.js†L4376-L4753】
- Carregar, reordenar e definir imagem principal de cada unidade com compressão via `sharp` quando disponível.【F:src/modules/backoffice/index.js†L4755-L4859】
**Entradas:**
- **API:** `POST /admin/properties/*`, `POST /admin/units/*`
- **UI:** `/admin/properties/:id`, `/admin/units/:id`
- **CLI:** —
**Módulos principais:** `src/modules/backoffice/index.js`, `server.js` (geocoding helper), `src/services/channel-integrations.js` (para dashboards de propriedade).【F:server.js†L1500-L1640】  
**Dependências relevantes:** `multer`/`sharp` para uploads, `https` e serviços de geocoding externos, `ExcelJS` para exportações associadas.【F:server.js†L7-L83】【F:src/modules/backoffice/index.js†L4755-L4837】  
**Exemplo real:** _“Ao integrar uma nova quinta, o administrador cria a propriedade, regista morada, adiciona três unidades e carrega a sessão fotográfica, escolhendo a imagem de destaque.”_  
**Notas/Riscos:** Eliminar propriedade remove unidades/reservas; compressão de imagens falha silenciosamente se `sharp` indisponível (aviso na inicialização).【F:src/modules/backoffice/index.js†L4198-L4204】【F:server.js†L9-L19】

### Gestão de Reservas no Backoffice
**O que é:** Listagem avançada `/admin/bookings` com filtros, ecrã detalhado com edição de dados, recalculo de tarifas, notas, cancelamentos e eliminação administradora, incluindo envio automático de emails ao confirmar.【F:src/modules/backoffice/index.js†L4894-L5263】  
**O que o utilizador consegue fazer:**
- Filtrar reservas por hóspede, estado ou mês e abrir ficha detalhada.【F:src/modules/backoffice/index.js†L4895-L4992】
- Atualizar datas, contactos, estado e notas internas; ao confirmar envia email configurável ao hóspede.【F:src/modules/backoffice/index.js†L5129-L5218】
- Adicionar notas cronológicas e cancelar reservas com registo de auditoria.【F:src/modules/backoffice/index.js†L5223-L5248】
- Eliminar definitivamente (apenas admin) mantendo logs de alterações.【F:src/modules/backoffice/index.js†L5250-L5263】
**Entradas:**
- **API:** `POST /admin/bookings/:id/update`, `POST /admin/bookings/:id/notes`, `POST /admin/bookings/:id/cancel`
- **UI:** `/admin/bookings`, `/admin/bookings/:id`
- **CLI:** —
**Módulos principais:** `src/modules/backoffice/index.js`, `src/services/booking-emails.js`, `src/services/email-templates.js`.【F:src/modules/backoffice/index.js†L4895-L5263】【F:src/services/booking-emails.js†L24-L99】  
**Dependências relevantes:** `dayjs` para formatação, emailer configurado no servidor.【F:server.js†L1609-L1638】  
**Exemplo real:** _“A equipa ajusta a estadia de uma reserva, confirma-a e o hóspede recebe o email ‘booking_confirmed_guest’ automaticamente.”_  
**Notas/Riscos:** Atualizações verificam conflitos e estadias mínimas; cancelamentos e eliminações requerem permissões específicas (`bookings.cancel`, `users.manage`).【F:src/modules/backoffice/index.js†L4895-L5263】

### Gestão de Tarifas e Bloqueios
**O que é:** API UX dedicada a atualizações em massa de tarifas, undo imediato e criação de bloqueios de unidades com prevenção de sobreposições, integrada no dashboard de overview.【F:src/modules/backoffice/ux-api.js†L52-L144】  
**O que o utilizador consegue fazer:**
- Aplicar preços para várias unidades e noites via `PUT /admin/api/rates/bulk`, com telemetria e resumo de impacto.【F:src/modules/backoffice/ux-api.js†L52-L88】
- Reverter alterações recentes com `POST /admin/api/rates/bulk/undo`.【F:src/modules/backoffice/ux-api.js†L91-L98】
- Bloquear unidades específicas justificando o motivo, verificando reservas e bloqueios existentes.【F:src/modules/backoffice/ux-api.js†L100-L144】
- Confirmar via UI com toasts, undo e validação (coberto por testes Playwright).【F:tests/e2e/ux.spec.js†L23-L125】
**Entradas:**
- **API:** `PUT /admin/api/rates/bulk`, `POST /admin/api/rates/bulk/undo`, `POST /admin/api/units/:unitId/blocks`
- **UI:** Dashboard `/admin` (cartão “Gestão rápida de preços” e modal de bloqueios)
- **CLI:** —
**Módulos principais:** `src/modules/backoffice/ux-api.js`, `src/services/rate-management.js`, `src/services/unit-blocks.js` (normalização e persistência).【F:src/services/rate-management.js†L1-L101】【F:src/services/unit-blocks.js†L1-L90】  
**Dependências relevantes:** `dayjs` para datas, telemetria opcional, validações customizadas.  
**Exemplo real:** _“O revenue manager atualiza os fins de semana de Agosto para €185, confirma o toast “Preços atualizados” e, ao detectar um erro, usa “Anular” para desfazer as rates.”_  
**Notas/Riscos:** Payload inválido dispara `ValidationError`; bloqueios rejeitam períodos com reservas ou bloqueios prévios garantindo consistência.【F:src/services/unit-blocks.js†L33-L85】

### Centro de Reviews e Respostas
**O que é:** API e UI para listar reviews negativas ou recentes, redigir respostas e registar telemetria/auditoria da interação, exibindo badges “Respondida”.【F:src/modules/backoffice/ux-api.js†L146-L188】【F:tests/e2e/ux.spec.js†L127-L145】  
**O que o utilizador consegue fazer:**
- Filtrar avaliações negativas e recentes com `/admin/api/reviews?filter=negative`.【F:src/modules/backoffice/ux-api.js†L146-L156】
- Enviar respostas via `POST /admin/api/reviews/:id/respond` com validação e logging.【F:src/modules/backoffice/ux-api.js†L158-L188】
- Receber confirmação visual na UI e ver badge de status atualizado (teste E2E).【F:tests/e2e/ux.spec.js†L127-L145】
**Entradas:**
- **API:** `GET /admin/api/reviews`, `POST /admin/api/reviews/:id/respond`
- **UI:** Aba “Avaliações” em `/admin`
- **CLI:** —
**Módulos principais:** `src/modules/backoffice/ux-api.js`, `src/services/review-center.js` (regras de negócio).【F:src/services/review-center.js†L1-L104】  
**Dependências relevantes:** Telemetria opcional para medir sucesso/falha das respostas.  
**Exemplo real:** _“A diretora filtra críticas negativas, responde a um comentário e vê o banner ‘Resposta registada’ com a avaliação marcada como respondida.”_  
**Notas/Riscos:** IDs inválidos ou respostas vazias geram `ValidationError`; permissões de backoffice aplicadas pelo router principal.【F:src/modules/backoffice/ux-api.js†L159-L188】

### Relatórios e KPIs Exportáveis
**O que é:** Serviço de reporting que gera snapshots semanais com KPIs (ocupação, ADR, RevPAR) e endpoints para exportar em JSON, CSV ou PDF, com verificação de intervalos até 31 dias.【F:src/modules/backoffice/ux-api.js†L190-L235】【F:src/services/reporting.js†L1-L128】  
**O que o utilizador consegue fazer:**
- Solicitar snapshot via `GET /admin/api/reports/weekly?from=...&to=...` e visualizar no dashboard.【F:src/modules/backoffice/ux-api.js†L190-L220】
- Exportar CSV/PDF com cabeçalhos e formatação PT-PT.【F:src/modules/backoffice/ux-api.js†L210-L235】
- Aceder sumário rápido de KPIs correntes com `GET /admin/api/kpis/summary`.【F:src/modules/backoffice/ux-api.js†L236-L244】
- Confirmar via UI que downloads incluem cabeçalhos corretos (teste E2E).【F:tests/e2e/ux.spec.js†L147-L189】
**Entradas:**
- **API:** `GET /admin/api/reports/weekly`, `GET /admin/api/kpis/summary`
- **UI:** Aba “Estatísticas” em `/admin`
- **CLI:** —
**Módulos principais:** `src/modules/backoffice/ux-api.js`, `src/services/reporting.js`, `src/services/reporting-pdf.js`.  
**Dependências relevantes:** `dayjs` e `ExcelJS` (para alguns cálculos no dashboard), `pdfkit` via módulo PDF.  
**Exemplo real:** _“Antes da reunião semanal, a diretora exporta CSV e PDF de 1-7 Julho e valida que o ficheiro contém colunas de ocupação e reservas.”_  
**Notas/Riscos:** Intervalos superiores a 31 dias são rejeitados; formato inválido devolve erro tratado. Telemetria regista sucesso/falha.【F:src/modules/backoffice/ux-api.js†L190-L235】【F:src/services/reporting.js†L28-L83】

### Channel Manager e Integrações OTA
**O que é:** Consolida integrações automáticas/manuais com OTAs, apresenta alertas e histórico de importações e expõe rotas para guardar credenciais, sincronizar e importar ficheiros com logging e avisos UI.【F:src/modules/backoffice/index.js†L2035-L4140】【F:server.js†L1646-L1755】  
**O que o utilizador consegue fazer:**
- Visualizar cartões de canais com estado, última sincronização e alertas.【F:src/modules/backoffice/index.js†L2035-L2247】【F:src/modules/backoffice/index.js†L3685-L3717】
- Guardar credenciais e configurações automáticas via `POST /admin/channel-integrations/:key/settings`.【F:src/modules/backoffice/index.js†L4055-L4085】
- Desencadear sincronização manual (`POST /admin/channel-integrations/:key/sync`) e acompanhar resumo de processamento.【F:src/modules/backoffice/index.js†L4087-L4108】
- Importar ficheiros CSV/ICS via `POST /admin/channel-imports/upload` e ver histórico recente.【F:src/modules/backoffice/index.js†L4113-L4139】
- Receber webhooks OTA validados com assinatura segura.【F:server.js†L1658-L1734】
**Entradas:**
- **API:** `/admin/channel-integrations/:key/*`, `/admin/channel-imports/upload`, `/api/ota/webhooks/:channelKey`
- **UI:** Tab “Channel Manager” em `/admin`
- **CLI:** —
**Módulos principais:** `src/modules/backoffice/index.js` (canal manager), `src/services/channel-integrations.js`, `server.js` (webhooks/schedulers).【F:src/modules/backoffice/index.js†L2035-L3717】【F:server.js†L1631-L1755】  
**Dependências relevantes:** `ExcelJS` para importações, `multer` para uploads, agendamentos `setInterval` para sync automático.  
**Exemplo real:** _“O revenue manager ativa as credenciais da Booking.com, lança uma sincronização manual e observa o resumo com reservas inseridas, conflitos e alertas na mesma página.”_  
**Notas/Riscos:** Sincronizações falhadas mostram aviso contextual; webhooks exigem segredo partilhado e falham com 401 se assinatura não coincidir.【F:server.js†L1658-L1704】

### Portal de Proprietários
**O que é:** Área `/owners` dedicada que agrega métricas de receita, ocupação, reservas pendentes e distribuição por canal apenas para propriedades autorizadas, com filtros e listas de próximas estadias.【F:src/modules/owners/index.js†L4-L248】  
**O que o utilizador consegue fazer:**
- Entrar com permissão `owners.portal.view` e selecionar propriedade específica.【F:src/modules/owners/index.js†L17-L88】
- Visualizar resumo de receita 30 dias, ocupação e check-ins semanais.【F:src/modules/owners/index.js†L89-L239】
- Ver próximas reservas até 90 dias e canais com maior peso.【F:src/modules/owners/index.js†L200-L239】
- Filtrar por propriedade quando tem múltiplas unidades atribuídas.【F:src/modules/owners/index.js†L224-L260】
**Entradas:**
- **API:** —
- **UI:** `/owners`
- **CLI:** —
**Módulos principais:** `src/modules/owners/index.js`, `src/services/notifications.js` (partilha de métricas) e base de dados de bookings.  
**Dependências relevantes:** `dayjs`, `Intl.NumberFormat` PT-PT para percentagens.  
**Exemplo real:** _“Um proprietário seleciona ‘Quinta Azul’ e verifica que 3 reservas confirmadas entrarão na próxima semana, com 60% da receita vindo da Booking.com.”_  
**Notas/Riscos:** Garante isolamento através de `property_owners`; utilizadores sem permissão recebem 403.【F:src/modules/owners/index.js†L17-L83】

### Motor de Automações Operacionais
**O que é:** Engine que corre regras por trigger, avalia condições e executa ações (email, notificações, criação de tarefas, overrides de preço), expondo dashboards e exportações CSV com métricas de execução.【F:server/automations/engine.js†L1-L176】【F:src/modules/backoffice/index.js†L1914-L4048】  
**O que o utilizador consegue fazer:**
- Consultar painel de automações com alertas, sugestões e blocos gerados automaticamente.【F:src/modules/backoffice/index.js†L1914-L3092】
- Exportar CSV operacional via `/admin/automation/export.csv` com filtros e métricas.【F:src/modules/backoffice/index.js†L3940-L4052】
- Atualizar dados em tempo real via `/admin/automation/operational.json` para gráficos e indicadores.【F:src/modules/backoffice/index.js†L3940-L3944】
- Acompanhar métricas de receita futura, ocupação e recomendações de bloqueios/ tarifas.【F:src/modules/backoffice/index.js†L1914-L3092】
**Entradas:**
- **API:** `GET /admin/automation/operational.json`, `GET /admin/automation/export.csv`
- **UI:** Secção “Automação” no dashboard `/admin`
- **CLI:** —
**Módulos principais:** `server/automations/engine.js` (execução), `server.js` (drivers e agendamentos), `src/modules/backoffice/index.js` (UI).【F:server.js†L1622-L1775】  
**Dependências relevantes:** `ExcelJS` para ações, `dayjs`, drivers customizados (email, notify, xlsx, housekeeping, price override, log).【F:server.js†L1611-L1638】  
**Exemplo real:** _“O motor deteta baixa ocupação, gera sugestão tarifária e exporta CSV com alertas para análise numa reunião operacional.”_  
**Notas/Riscos:** Triggers falhados lançam erros capturados e registados; exportações sempre em UTF-8 com BOM para compatibilidade.【F:src/modules/backoffice/index.js†L3946-L4052】【F:server/automations/engine.js†L70-L125】

### Assistente de Decisão Comercial
**O que é:** Serviço batch que analisa reservas futuras, ocupação e ritmo de vendas para gerar sugestões automáticas (ajustar preço, campanhas, rever políticas), executado no arranque e diariamente às 03h10.【F:server/decisions/assistant.js†L1-L205】【F:server.js†L1737-L1778】  
**O que o utilizador consegue fazer:**
- Receber sugestões armazenadas em `decision_suggestions` (ex.: baixar tarifa 10%).【F:server/decisions/assistant.js†L38-L134】
- Aproveitar recomendações de promoções e políticas com contexto (ocupação, pace, pedidos especiais).【F:server/decisions/assistant.js†L134-L205】
- Integrar automaticamente com automação/dashboards (dados expostos nas métricas de automação).【F:src/modules/backoffice/index.js†L1914-L3073】
**Entradas:**
- **API:** —
- **UI:** Integrado no dashboard de automação (sem rota própria)
- **CLI:** Jobs agendados via `scheduleDailyTask`
**Módulos principais:** `server/decisions/assistant.js`, `server.js` (agendamento), tabelas `decision_suggestions`.【F:server.js†L1737-L1778】  
**Dependências relevantes:** `dayjs`, `randomUUID`, estatísticas de bookings.  
**Exemplo real:** _“Às 03h10 o assistente marca uma sugestão ‘Baixar tarifa 10% (Suite Vista Rio)’ porque a ocupação nas próximas duas semanas caiu para 35%.”_  
**Notas/Riscos:** Atualiza sugestões existentes para evitar duplicados; apenas corre quando `SKIP_SERVER_START` não está ativo.【F:server/decisions/assistant.js†L118-L205】【F:server.js†L1631-L1778】

### Chatbot de Apoio à Reserva
**O que é:** Router HTMX que mantém sessões de chatbot via cookie, processa mensagens com “brain” interno, regista histórico e recolhe feedback útil/inútil, integrando no frontoffice como widget.【F:server/chatbot/router.js†L1-L120】【F:server.js†L3249-L3254】  
**O que o utilizador consegue fazer:**
- Abrir widget no site público e enviar perguntas sobre disponibilidade.【F:src/modules/frontoffice/index.js†L620-L794】【F:server/chatbot/router.js†L17-L83】
- Receber respostas ricas com HTML e botões, armazenadas na sessão do chatbot.【F:server/chatbot/router.js†L58-L93】
- Avaliar resposta (👍/👎) via `/chatbot/feedback`, guardando notas e melhorando conteúdo.【F:server/chatbot/router.js†L94-L120】
**Entradas:**
- **API:** `POST /chatbot/message`, `POST /chatbot/feedback`
- **UI:** Widget incluído no layout do frontoffice
- **CLI:** —
**Módulos principais:** `server/chatbot/router.js`, `server/chatbot/service.js`, `src/modules/frontoffice/index.js` (inclusão do widget).【F:src/modules/frontoffice/index.js†L620-L711】【F:server/chatbot/router.js†L1-L120】  
**Dependências relevantes:** `express`, `htmx` via markup, base de conhecimento (tabelas `kb_*`).  
**Exemplo real:** _“Um visitante pergunta ‘Há disponibilidade em novembro?’ e o chatbot responde com cartões de suites e botões ‘Reservar agora’, pedindo feedback de utilidade.”_  
**Notas/Riscos:** Cookies não são `httpOnly` para permitir HTMX; validação CSRF protege endpoints mesmo nas chamadas assíncronas.【F:server/chatbot/router.js†L13-L46】

### Reindexação da Base de Conhecimento
**O que é:** Serviço utilitário `createKbReindexer` que recompila perguntas e artigos publicados para a tabela `kb_index`, permitindo atualização rápida do motor de busca/FAQ através de scripts externos ou jobs manuais.【F:server/kb/reindex.js†L1-L37】  
**O que o utilizador consegue fazer:**
- Apagar índice atual e reimportar Q&A e artigos publicados com tags normalizadas.【F:server/kb/reindex.js†L8-L35】
- Integrar em tarefa CLI/manual para manter respostas do chatbot e ajuda sempre atualizadas.【F:server/kb/reindex.js†L1-L37】
**Entradas:**
- **API:** —
- **UI:** —
- **CLI:** Função `reindexAll()` exposta para scripts Node
**Módulos principais:** `server/kb/reindex.js`, base de dados `kb_*`.  
**Dependências relevantes:** `better-sqlite3` (prepared statements).  
**Exemplo real:** _“Após publicar novos artigos, o operador executa um script que chama `createKbReindexer({ db }).reindexAll()` para atualizar o motor de FAQ do chatbot.”_  
**Notas/Riscos:** Exige base de dados com tabelas `kb_qas`, `kb_articles` e `kb_index`; operação corre dentro de transação para consistência.【F:server/kb/reindex.js†L8-L33】

---

## Verificação de Duplicados
- Resultado: **Nenhuma duplicação encontrada.**
- Chaves geradas: `[autenticacao-backoffice-e-sessoes, seguranca-de-conta-e-2fa, motor-de-reservas-publico, calendario-operacional-e-reagendamento, gestao-de-tarefas-de-limpeza, gestao-de-propriedades-e-unidades, gestao-de-reservas-no-backoffice, gestao-de-tarifas-e-bloqueios, centro-de-reviews-e-respostas, relatorios-e-kpis-exportaveis, channel-manager-e-integracoes-ota, portal-de-proprietarios, motor-de-automacoes-operacionais, assistente-de-decisao-comercial, chatbot-de-apoio-a-reserva, reindexacao-da-base-de-conhecimento]`
- Entradas únicas por funcionalidade: **OK**
