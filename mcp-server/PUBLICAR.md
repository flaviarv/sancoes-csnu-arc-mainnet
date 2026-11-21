# Publicar o criptokyc-mcp (o que só você pode fazer)

O pacote está pronto e testado. Para qualquer pessoa instalar com `npx -y criptokyc-mcp install`,
faltam duas ações que dependem das suas contas.

## 1. Colocar o gateway no ar com URL pública

O pacote usa por padrão `https://agents.criptokyc.tech` (em `config.ts`). Siga `../agent-gateway/DEPLOY.md`:
registro DNS A, `docker compose -f docker-compose.agents.yml up -d --build`, Caddy com HTTPS.

Confirme: `curl https://agents.criptokyc.tech/health` deve responder `{"status":"ok","mode":"testnet"}`.

Se preferir outro endereço, mude `DEFAULT_API_URL` em `config.ts` e rode `bun run build` de novo.

## 2. Publicar no npm

```bash
cd mcp-server
bun install
bun run build
npm login            # sua conta npm (use 2FA)
npm publish          # o nome criptokyc-mcp estava livre no npm em 21/11/2026
```

- O campo `license` está como `UNLICENSED`. Troque pela licença que você quiser antes de publicar.
- O pacote publicado contém só `dist/cli.js`, `README.md` e `package.json` (nenhum código-fonte, teste ou chave).
- Para novas versões: aumente `version` no `package.json` e rode `npm publish` de novo.

## 3. Teste final numa máquina limpa

```bash
npx -y criptokyc-mcp install
# envie USDC de teste ao endereço mostrado (https://faucet.circle.com, Arc Testnet)
npx -y criptokyc-mcp deposit 1
npx -y criptokyc-mcp status
```
Reinicie o Claude ou o Cursor e pergunte por "Noor Wali Mehsud".

## O que ainda gera atrito (e por quê)

- **USDC de teste:** o faucet público exige uma ação manual do usuário. Só some em mainnet ou com um faucet seu.
- **Clientes reais:** a instalação automática foi testada com arquivos de configuração simulados, não dentro do
  Claude Desktop, Cursor ou Claude Code de verdade. Teste em cada um antes de divulgar.
- **Windows:** o instalador usa `cmd /c npx` por precaução; confirme num Windows real.
- **Mainnet:** continua desabilitada de propósito.
