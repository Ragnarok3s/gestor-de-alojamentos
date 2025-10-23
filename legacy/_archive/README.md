# Arquivo de módulos legacy

Os ficheiros dentro desta pasta foram migrados para preservar histórico sem afetar o runtime.

- `modules/payments/index.js`
- `services/ownerPush.js`

Data da migração: 2025-10-23.

Motivo: funcionalidades substituídas pelos módulos administrativos actuais; mantidas apenas como referência histórica.

Para recuperar algum módulo, copie o ficheiro de volta para `src/` e execute a bateria de testes (`npm test`) antes de reactivar em produção.
