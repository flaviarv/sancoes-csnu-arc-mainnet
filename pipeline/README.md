# Pipeline de Dados — criptokyc.tech

## Estrutura

```
pipeline/
├── config.py          ← caminhos dos parquets (único lugar para alterar paths)
├── sources/
│   ├── csnu.py        ← ingestão da lista CSNU (nomes)
│   └── wallets.py     ← ingestão das listas de carteiras (6 jurisdições)
├── transforms/
│   └── normalize.py   ← normalização de nomes e endereços
└── loaders/
    ├── csnu_loader.py     ← interface CsnuLoader usada pela API
    └── wallets_loader.py  ← interface WalletsLoader usada pela API
```

## Como adicionar uma nova fonte de dados

### Nova jurisdição de carteiras (ex: Tornado Cash)

1. Adicione o parquet em `data/raw/carteiras/tornado_cash.parquet`
2. Registre em `pipeline/config.py`:
   ```python
   WALLET_PARQUETS = {
       ...
       "Tornado_Cash": DATA_RAW / "carteiras" / "tornado_cash.parquet",
   }
   ```
3. O `WalletsLoader` carrega automaticamente na próxima inicialização.

### Nova lista de nomes (ex: OFAC SDN nomes)

1. Adicione o parquet em `data/raw/`
2. Adicione o path em `pipeline/config.py`
3. Crie `pipeline/sources/novo_produto.py` (modelo: `csnu.py`)
4. Crie `pipeline/loaders/novo_loader.py` (modelo: `csnu_loader.py`)
5. Registre o loader em `main_docker.py`

## Regras importantes

- **Não altere** `frontend/src/config/business-rules.ts` neste pipeline.
- `pipeline/config.py` contém apenas caminhos e parâmetros técnicos — sem preços, endereços de contrato ou treasury.
- Os parquets em `data/raw/` são atualizados externamente (AWS/GitHub Actions) — nunca pelo pipeline em runtime.
