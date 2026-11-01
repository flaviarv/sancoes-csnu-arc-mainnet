# AWS EventBridge Setup — Sanctions List Auto-Update

Daily update flow: **EventBridge → Lambda → download lists → rsync to Hostinger → /reload-data**

---

## Prerequisites

- AWS account with permissions for Lambda, EventBridge, IAM, and Secrets Manager
- Hostinger VPS running with Docker container up
- SSH key pair for the Hostinger server

---

## Step 1 — Create the Lambda function

1. Open **AWS Console → Lambda → Create function**
2. Settings:
   - Name: `sanctions-updater`
   - Runtime: **Python 3.12**
   - Architecture: x86_64
3. In **Code source**, upload a zip with:
   - `scripts/update_sanctions_lists.py` (rename to `lambda_function.py`)
   - `scripts/deploy_to_hostinger.sh`
   - `pipeline/` directory (for imports)
4. **Handler:** `lambda_function.lambda_handler`
5. **Timeout:** 5 minutes (the download + rsync takes ~2-3 min)
6. **Memory:** 512 MB

### Lambda dependencies layer

Create a Lambda Layer with:
```
pandas, pyarrow, requests, openpyxl, odfpy, lxml
```

```bash
pip install pandas pyarrow requests openpyxl odfpy lxml -t python/
zip -r sanctions-layer.zip python/
```
Upload the zip as a Layer and attach to the function.

---

## Step 2 — Store SSH key in Secrets Manager

1. Open **Secrets Manager → Store a new secret**
2. **Secret type:** Other type of secret → Plaintext
3. Paste the contents of your Hostinger SSH private key
4. **Secret name:** `hostinger-ssh-key`
5. Copy the ARN — you'll use it in Step 3

---

## Step 3 — Set Lambda environment variables

In the Lambda function → **Configuration → Environment variables**:

| Variable | Value |
|---|---|
| `HOSTINGER_HOST` | Your server IP (e.g. `123.45.67.89`) |
| `HOSTINGER_USER` | `root` |
| `HOSTINGER_SSH_KEY` | `/tmp/id_rsa` (Lambda writes secret here at runtime) |
| `HOSTINGER_DEPLOY_DIR` | `/root/sancoes-csnu-arc-mainnet` |
| `RELOAD_SECRET` | A strong random string (e.g. `openssl rand -hex 32`) |
| `APP_URL` | `http://YOUR_SERVER_IP` |

For `RELOAD_SECRET`, use the same value you set in `.env` on the Hostinger server.

---

## Step 4 — Grant Lambda permission to read the SSH key from Secrets Manager

Attach this inline policy to the Lambda execution role:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:hostinger-ssh-key*"
  }]
}
```

Add this code to the Lambda function to write the key to `/tmp/id_rsa` at runtime:

```python
import boto3, os, stat

def get_ssh_key():
    client = boto3.client("secretsmanager")
    secret = client.get_secret_value(SecretId="hostinger-ssh-key")["SecretString"]
    key_path = "/tmp/id_rsa"
    with open(key_path, "w") as f:
        f.write(secret)
    os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)  # chmod 600
    return key_path
```

Call `get_ssh_key()` at the start of `lambda_handler`.

---

## Step 5 — Create the EventBridge rule

1. Open **EventBridge → Rules → Create rule**
2. Settings:
   - Name: `sanctions-lists-daily-update`
   - Event bus: default
   - Rule type: **Schedule**
3. Schedule pattern: **Cron expression**
   ```
   cron(0 3 * * ? *)
   ```
   This runs every day at **03:00 UTC**.
4. **Target:** Lambda function → `sanctions-updater`
5. **Input:** Constant JSON → `{"list": "all"}`
6. Click **Create rule**

---

## Step 6 — Set RELOAD_SECRET on the Hostinger server

SSH into the server and add to `.env`:

```bash
echo "RELOAD_SECRET=your_strong_random_secret" >> /root/sancoes-csnu-arc-mainnet/.env
docker compose restart
```

---

## Step 7 — Test manually

Invoke the Lambda manually:

```bash
aws lambda invoke \
  --function-name sanctions-updater \
  --payload '{"list":"ofac"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/output.json && cat /tmp/output.json
```

Expected output:
```json
{"started":"...","finished":"...","results":{"ofac":"ok"}}
```

---

## Monitoring

- **Lambda logs:** CloudWatch → Log groups → `/aws/lambda/sanctions-updater`
- **EventBridge history:** EventBridge → Rules → `sanctions-lists-daily-update` → Metrics
- **Server reload:** check Docker logs after each run:
  ```bash
  docker logs csnu-checker --tail 20
  ```
  Look for: `[reload-data] CSNU reloaded: 1387 names.`
