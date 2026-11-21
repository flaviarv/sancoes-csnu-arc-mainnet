# Varredura de segurança — 21/11/2026

Escopo: `agent-gateway/`, `mcp-server/`, `docker-compose.agents.yml`, dependências do site e histórico do git.

## Resultado

| Área | Achado | Ação |
|---|---|---|
| Segredos | Nenhuma chave, token ou `.env` nos arquivos nem no histórico (só hash de transação pública) | nenhuma |
| Dependências do gateway e do MCP | 0 vulnerabilidades conhecidas | nenhuma |
| Dependências do site | 43 alertas (17 altos), todos de pacotes `@circle-fin/*` e `@openzeppelin` que o código não importa | pacotes removidos: 43 para 11 alertas (3 altos), restantes internos do wagmi |
| Gateway: memória | Mapa de limite por IP crescia sem limite (esgotamento de RAM com muitos IPs) | poda por minuto e teto de 50.000 IPs |
| Gateway: cache | Respostas de consulta sem `Cache-Control` | `no-store`, `nosniff`, `no-referrer` |
| API interna | Sem autenticação própria; item sem limite de tamanho | `INTERNAL_TOKEN` obrigatório no compose e limite de 200 caracteres por item |
| Containers | Rodavam com capabilities padrão e disco gravável | somente leitura, `cap_drop: ALL`, `no-new-privileges`, limite de processos |
| MCP: destino do pagamento | Pagaria qualquer destino anunciado pelo serviço (domínio sequestrado redirecionaria dinheiro) | só paga o endereço da treasury |
| MCP: instalação nos clientes | Backup era sobrescrito a cada execução; escrita não atômica; versão não fixada (risco de cadeia de suprimentos) | backup preservado, escrita atômica, versão fixada |
| MCP: carteira | Permissão frouxa de arquivo existente não era corrigida | corrigida para 600 ao iniciar |
| Repositório | `frontend/node_modules/` fora do `.gitignore` | adicionado ao `.gitignore` |

## Testes após as correções

- Gateway em containers endurecidos: 402 sem pagamento, 400 sem cobrança, API interna sem token = 401,
  pagamento real em testnet, 400 IPs distintos sem queda (63 MB de memória).
- Pacote MCP instalado do zero em Node puro: 12 testes funcionais e 15 de segurança.
- Site: imagem de produção reconstruída e testada (frontend, 401 sem sessão, dados carregados).

## Riscos que permanecem (aceitos ou fora do código)

- **Pagamento cobrado e falha depois:** o gateway checa a API interna antes de cobrar, mas existe uma janela
  pequena (segundos) em que ela pode cair entre a checagem e a resposta; o agente paga e recebe 502.
- **Repetição de uma assinatura de pagamento (replay):** a proteção é do Circle Gateway (nonce da autorização);
  não foi testada de forma independente.
- **11 alertas no site** em dependências internas do `wagmi`, usadas apenas no navegador.
- **Chave do agente em disco:** protegida por permissão 600, mas legível por qualquer programa do mesmo usuário.
  Use carteira dedicada e saldo pequeno. No Windows as permissões de arquivo não se aplicam da mesma forma.
- **Congelamento do USDC pelo emissor** (contrato de escrow da mainnet, versão antiga).
- **Conta npm:** quem a controla controla o código distribuído. Use 2FA.
- Esta varredura é interna e **não substitui uma auditoria profissional independente**.
