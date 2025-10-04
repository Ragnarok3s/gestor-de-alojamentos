# Verificação manual: Escape de campos de reserva

## Objetivo
Confirmar que os campos de texto provenientes de reservas são apresentados como texto literal no portal de frontoffice, sem interpretar etiquetas HTML fornecidas pelo utilizador.

## Pré-requisitos
- Aplicação em execução (`npm start`).
- Base de dados com pelo menos uma unidade disponível para reserva.

## Passos
1. Aceda a `http://localhost:3000/` e realize uma pesquisa válida para encontrar uma unidade disponível.
2. Prossiga com o processo de reserva preenchendo os campos com caracteres especiais, por exemplo:
   - **Nome**: `Alice <b>Walker</b>`
   - **Email**: `alice+test@example.com`
   - **Telefone**: `+351 <script>alert(1)</script>`
   - **Nacionalidade**: `PT & Amigos`
   - **Agência** (se aplicável): `Best & Co <img src=x onerror=alert(1)>`
3. Finalize a reserva.
4. Na página de confirmação, verifique que os valores introduzidos aparecem literalmente (por exemplo, `Alice <b>Walker</b>` deve ser mostrado com os caracteres `<` e `>` visíveis, sem aplicar negrito nem executar scripts).

## Resultado esperado
- Todos os campos listados (nome, email, telefone, nacionalidade, agência, propriedade e unidade) devem aparecer sem interpretação de HTML.
- Não devem ser exibidos elementos inesperados nem surgir erros de consola no navegador relacionados com a renderização da página.

Se o comportamento corresponder ao esperado, a verificação manual está concluída com sucesso.
