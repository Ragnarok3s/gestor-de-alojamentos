# Plano de Testes de Segurança

Este documento descreve como executar o conjunto de verificações de segurança adicionadas ao projeto e como interpretar os respetivos resultados.

## Pré-requisitos

* Docker instalado (necessário para o _baseline scan_ do OWASP ZAP).
* `nmap`, `curl`, `detect-secrets`, `semgrep` e `npx` disponíveis no _PATH_.
* Credenciais de dois utilizadores de teste:
  * Perfil "user" com permissões limitadas (por exemplo, função `rececao`).
  * Perfil "manager" com permissões elevadas (por exemplo, função `direcao`).
* Variáveis de ambiente configuradas antes de executar os testes RBAC:
* (Opcional) Para executar ESLint com as regras de segurança configure `npm install -D eslint eslint-plugin-security`.

```bash
export API_BASE="https://staging.minha-app.com"
export SEC_BASE_URL="https://staging.minha-app.com"
export SEC_USER_EMAIL="utilizador.limitado"
export SEC_USER_PASS="palavra-passe"
export SEC_MANAGER_EMAIL="gestor"
export SEC_MANAGER_PASS="palavra-passe"
```

> Nota: o campo `EMAIL` corresponde ao _username_ utilizado no formulário de login.

## Scripts npm disponíveis

| Comando | Descrição |
| --- | --- |
| `npm run security:semgrep` | Executa SAST Semgrep com a regra _OWASP Top 10_ (`--error` falha em findings _High/Critical_). |
| `npm run security:secrets` | Executa `detect-secrets` e envia o _scan_ também para `stderr` para facilitar integração CI. |
| `npm run security:headers` | Verifica os cabeçalhos de segurança expostos em `https://staging.minha-app.com`. |
| `npm run security:nmap` | Executa um _nmap_ não intrusivo (`-sC -sV`). |
| `npm run security:zap` | Corre o OWASP ZAP baseline em modo _docker_, gerando `zap-report.json`. |
| `npm run security:parse-zap` | Lê `zap-report.json` e imprime um resumo em Markdown com a contagem por severidade. |
| `npm run security:rbac` | Executa os testes de autorização descritos abaixo. |

Comandos de apoio adicionais:

### Sequência recomendada (local)

```bash
npm run security:semgrep
npm run security:secrets
npm run security:zap && npm run security:parse-zap
npm run security:headers
npm run security:nmap
npm run security:rbac
```

Ferramentas auxiliares opcionais:

```bash
npm audit --audit-level=moderate
npx depcheck
```

### Execução em CI

O workflow `security-ci.yml` automatiza:

```text
npm ci
npm run security:semgrep
npm audit --audit-level=moderate
npm run security:secrets
npm run security:nmap
npm run security:zap && npm run security:parse-zap
jq -e '.site[0].alerts[] | select(.riskdesc|test("High"))' zap-report.json >/dev/null && exit 1
npm run security:rbac
```

Os artefactos publicados são apenas ficheiros de texto (`zap-report.json`, `zap-baseline.log`, `zap-summary.md`, `nmap.txt`, `rbac-report.md`).

## Semgrep

1. Assegure-se de que o repositório está limpo e execute `npm run security:semgrep`.
2. O comando falha caso existam findings _High_ ou _Critical_.
3. Analise os resultados no terminal e mitigue as vulnerabilidades reportadas.

## Gestão de segredos

* `detect-secrets scan > .secrets.baseline` gera/atualiza a baseline.
* `npm run security:secrets` permite reavaliar em pipelines; o comando deve ser limpo (sem novos segredos) antes do _merge_.

## Testes dinâmicos (DAST)

1. `npm run security:zap` executa o _baseline scan_ contra o ambiente de _staging_.
2. Após a conclusão, utilize `npm run security:parse-zap` para obter um resumo em Markdown:
   * A tabela apresenta contagens por severidade e o total de alertas.
   * _Acceptance_: não podem existir findings com severidade **High**.
3. Em CI, o passo `jq` falha o workflow caso exista qualquer alerta _High_.
4. Os artefactos relevantes são apenas textuais (`zap-report.json`, `zap-baseline.log`, `zap-summary.md`).

### Cabeçalhos e TLS

Execute `npm run security:headers` e confirme:

* `Content-Security-Policy` com `default-src 'self'` (e restantes diretivas relevantes).
* `Strict-Transport-Security` com pelo menos 1 ano e `includeSubDomains`.
* `X-Frame-Options` configurado para `DENY`.
* `X-Content-Type-Options: nosniff`.
* `Referrer-Policy` definido (`strict-origin-when-cross-origin`).
* `Permissions-Policy` a negar sensores sensíveis.

O comando imprime recomendações caso algum cabeçalho falte ou esteja mal configurado.

### Varredura de portas

`npm run security:nmap` corre um `nmap -sC -sV` contra `staging.minha-app.com`. Analise a saída e valide se apenas os serviços esperados estão expostos.

## Testes de autorização (RBAC)

O script `scripts/rbac-check.ts` autentica os dois perfis definidos e executa as seguintes verificações:

| Cenário | Esperado |
| --- | --- |
| _User_ acede a `/admin/api/reviews` | Resposta `403` |
| _Manager_ acede a `/admin/api/reviews` | Resposta `200` |
| _User_ tenta alterar o papel de outro utilizador | Resposta `403` |

Para correr o teste:

```bash
npm run security:rbac
```

O resultado é uma tabela Markdown com `PASS/FAIL` por cenário. O comando devolve _exit code_ `1` se algum passo falhar (útil para automação).

## Hardening aplicado

* Cabeçalhos de segurança aplicados manualmente (CSP `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `img-src 'self' data:`, `script-src 'self'`, `connect-src 'self'` + exceções configuráveis, `frame-ancestors 'none'`, `font-src 'self' data:`).
* `Strict-Transport-Security` apenas quando o servidor está atrás de HTTPS (produção ou `FORCE_SECURE_COOKIE`).
* `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` restritiva e `X-Frame-Options: DENY`.
* Controlo de CORS personalizado limitado às origens configuradas (staging e `localhost`) com suporte para pré-pedidos `OPTIONS`.
* _Rate limiting_ nativo aplicado especificamente sobre `/login`, `/auth/*`, `/admin/*`, `/api/auth*` e outros endpoints sensíveis.
* Cookies de sessão e CSRF forçados com `HttpOnly`, `Secure` (quando aplicável) e `SameSite` (`lax`).
* Scripts de segurança (Semgrep, detect-secrets, ZAP, headers, nmap, RBAC) documentados e integrados em CI.

## Critérios de aprovação

* Semgrep: 0 findings _High/Critical_.
* ZAP: 0 alertas _High_ (o `jq` em CI falha em caso contrário).
* RBAC: utilizador limitado recebe sempre `403` nas rotas administrativas e `manager` obtém o `200` esperado.
* Cabeçalhos: presença de CSP, HSTS (quando aplicável), XFO, XCTO, Referrer-Policy e Permissions-Policy com valores seguros.
* Cookies sensíveis configurados com `Secure`, `HttpOnly` e `SameSite` adequado.
