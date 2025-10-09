# Funcionalidades Principais da Aplicação

A aplicação cobre todo o ciclo de operações de um gestor de alojamentos. A lista abaixo resume cada funcionalidade com uma explicação e um exemplo de utilização no mundo real.

- **Gestão de utilizadores com perfis e permissões** – O servidor define perfis como receção, gestão, direção e limpeza, atribuindo automaticamente as permissões adequadas a cada função para controlar o acesso ao calendário, reservas, automatizações e limpezas.【F:server.js†L160-L225】  
  *Exemplo real*: A equipa de limpeza inicia sessão e só vê as tarefas que precisa de executar, enquanto a direção consegue exportar relatórios financeiros completos.

- **Pesquisa e reserva por propriedade** – A página pública agrupa as unidades por propriedade, aplica filtros de datas, capacidade e disponibilidade e gera orçamentos quando existe uma pesquisa activa.【F:src/modules/frontoffice/index.js†L109-L236】  
  *Exemplo real*: Um hóspede escolhe “16/10/2025 - 22/10/2025” para duas pessoas e recebe a lista das unidades disponíveis na quinta pretendida com o preço calculado.

- **Validação de pedidos e criação de reservas pendentes** – O frontoffice valida contactos, datas e capacidade antes de inserir a reserva. As reservas submetidas por hóspedes entram com estado `PENDING`, enquanto colaboradores autorizados continuam a confirmar de imediato.【F:src/modules/frontoffice/index.js†L39-L105】【F:src/modules/frontoffice/index.js†L851-L862】  
  *Exemplo real*: Um pedido directo feito pelo site fica marcado como “pendente” até que a equipa de reservas analise a disponibilidade final e aprove o pedido.

- **Envio automático de emails transaccionais configuráveis** – Os modelos para emails de reserva pendente e confirmada podem ser editados no backoffice, e o serviço gera e envia mensagens automáticas aos hóspedes quando uma reserva é criada ou passa a confirmada.【F:src/services/email-templates.js†L1-L200】【F:src/services/booking-emails.js†L24-L90】【F:src/modules/backoffice/index.js†L3377-L3386】  
  *Exemplo real*: Após confirmar uma estadia, o gestor envia automaticamente um email personalizado com as datas e link para consulta sem precisar copiar mensagens manualmente.

- **Notificações internas sobre reservas pendentes e alertas operacionais** – O painel de notificações procura reservas a aguardar confirmação e outras alertas operacionais, mostrando-os apenas aos utilizadores com permissões adequadas.【F:src/services/notifications.js†L19-L168】  
  *Exemplo real*: A receção recebe um aviso “Reserva a aguardar confirmação” quando entra um novo pedido pela app, garantindo resposta rápida ao hóspede.

- **Mapa de reservas com reagendamento via arrastar-e-largar e visão mobile optimizada** – O backoffice apresenta um calendário semanal com filtros, legenda por estado, suporte a arrastar para reagendar e uma visão móvel em formato tabela para evitar cortes em ecrãs pequenos.【F:src/modules/frontoffice/index.js†L1016-L1692】  
  *Exemplo real*: Um gestor usa um tablet para arrastar uma reserva confirmada dois dias para a frente quando o hóspede solicita alteração de datas.

- **Gestão completa de tarefas de limpeza** – Existem páginas específicas para listar pendentes, em curso e concluídas, criar novas tarefas, actualizar progresso e reabrir limpezas, respeitando as permissões de cada perfil.【F:src/modules/backoffice/index.js†L976-L1831】  
  *Exemplo real*: A governanta adiciona uma limpeza urgente após um check-out antecipado e marca a tarefa como concluída quando a equipa termina a preparação do quarto.

- **Painel de revenue com métricas, gráficos e tabela diária** – O separador “Revenue” consolida receita confirmada e pendente, previsões automáticas, repartição por canal e gera gráficos interactivos e uma tabela diária com ADR, RevPAR, ocupação e booking pace.【F:src/modules/backoffice/index.js†L3189-L3460】【F:src/modules/backoffice/scripts/revenue-dashboard.js†L1-L200】  
  *Exemplo real*: A direção analisa o gráfico de receita dos últimos 30 dias para comparar o desempenho entre semanas e perceber em que dias a ocupação caiu.

- **Integrações com canais externos e uploads manuais** – O serviço de integrações conhece Booking.com, Airbnb, i-escape e Splendia, importando ficheiros CSV/XLSX/ICS, agendando sincronizações automáticas e registando histórico de lotes. O backoffice inclui cartões de configuração, upload manual e histórico de importações.【F:src/services/channel-integrations.js†L6-L200】【F:src/modules/backoffice/index.js†L3310-L3338】
  *Exemplo real*: O gestor descarrega o CSV diário da Booking.com e carrega-o na nova página “Integrações” para criar rapidamente as reservas no sistema.

- **Channel Manager oficial no backoffice** – Um separador dedicado no backoffice reúne métricas de integrações, alertas operacionais, histórico de importações e atalhos para sincronizações manuais ou automáticas dos canais OTA suportados.【F:src/modules/backoffice/index.js†L3440-L3492】
  *Exemplo real*: Ao iniciar o turno, a equipa de revenue abre o “Channel Manager” para confirmar que todas as integrações auto-sync correram bem e identificar rapidamente um alerta de credenciais expiradas antes que afecte novas reservas.

- **Área de Proprietários fora do backoffice** – A rota `/owners` mostra cartões de receita, ocupação, reservas pendentes, próximas chegadas e distribuição por canal apenas para as propriedades associadas ao utilizador, permitindo que os proprietários consultem dados actualizados sem depender da direção.【F:src/modules/owners/index.js†L1-L207】【F:src/modules/owners/index.js†L252-L460】
  *Exemplo real*: Um proprietário entra na nova área e confirma que a sua casa tem duas reservas pendentes e três chegadas confirmadas para a próxima semana, percebendo de imediato que a maioria veio da Booking.com e que a receita das últimas quatro semanas superou as expectativas.

- **Resumo operacional e estatísticas com exportação** – O dashboard reúne métricas de ocupação, unidades com melhor desempenho e permite exportar os dados operacionais em CSV, respeitando filtros de propriedade e período.【F:src/modules/backoffice/index.js†L3342-L3520】
  *Exemplo real*: Antes de uma reunião semanal, o gestor exporta o relatório operacional com ocupação e top unidades para partilhar com a equipa.

- **Personalização de identidade visual e gestão de utilizadores** – O backoffice inclui secções para ajustar cores, branding e gerir contas de utilizadores, garantindo que a experiência pública segue a imagem da marca.【F:src/modules/backoffice/index.js†L3389-L3432】  
  *Exemplo real*: Ao abrir um novo alojamento, a equipa altera rapidamente as cores do portal e cria acessos distintos para receção e direção.

