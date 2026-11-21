# Publicar o criptokyc-mcp (o que só você pode fazer)

O pacote está pronto e testado. Para qualquer pessoa instalar com `npx -y criptokyc-mcp install`,
faltam duas ações que dependem das suas contas.

## 1. Colocar o gateway no ar com URL pública

O pacote usa por padrão `https://agents.criptokyc.tech` (em `config.ts`). Siga `../agent-gateway/DEPLOY.md`:
registro DNS A, `docker compose -f docker-compose.agents.yml up -d --build` e HTTPS (Nginx + Certbot, ou Caddy).

Confirme: `curl https://agents.criptokyc.tech/health` deve responder `{"status":"ok","mode":"testnet"}`.

Se preferir outro endereço, mude `DEFAULT_API_URL` em `config.ts` e rode `npm run build` de novo.

## 2. Publicar no npm

Precisa só de **Node 18 ou superior e npm**. Não precisa de Bun e funciona no Windows, Mac e Linux.

```powershell
cd mcp-server
npm install          # instala as ferramentas de build (esbuild, typescript)
npm login            # sua conta npm (ative o 2FA)
npm publish          # o build roda sozinho antes de publicar
```

O nome `criptokyc-mcp` estava livre no npm em 21/11/2026. Se o `npm install` mostrar um aviso sobre
"install-scripts" do esbuild, pode ignorar: o build funciona do mesmo jeito.

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

## Segurança da publicação (leia antes do `npm publish`)

- **Ative a verificação em duas etapas (2FA) na conta npm** e use um token de publicação restrito. Quem controla
  essa conta controla o código que roda ao lado da carteira de cada usuário.
- **O `install` fixa a versão** na configuração do cliente (`criptokyc-mcp@x.y.z`): uma versão nova no npm
  nunca roda sozinha na máquina de quem já instalou. Para atualizar, o usuário roda
  `npx -y criptokyc-mcp@latest install`, que troca a versão fixada e mantém o backup original da configuração.
- **O pacote só paga para o endereço da treasury** (`EXPECTED_PAY_TO` em `config.ts`). Se você trocar a carteira
  treasury (por exemplo, ao rotacionar a chave), **publique uma versão nova com o endereço novo**, e os usuários
  precisam atualizar. Versões antigas recusam pagar o endereço novo, de propósito.
