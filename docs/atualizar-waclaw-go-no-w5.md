# Atualizar waclaw-go no W5

Runbook para deployar uma nova versão do `packages/waclaw-go` no servidor W5
(`100.66.83.22`) depois de um `git push` em `main`.

## Layout no W5

- **Source**: `/home/orcabot/src/zapi-pwa/` (git clone do repo)
- **Runtime**: `/home/orcabot/waclaw-go/` (bin/, sessions/, avatars/, .env)
- **Systemd**: `waclaw-go.service` (`WorkingDirectory=/home/orcabot/waclaw-go`)

## Comando único

```bash
ssh root@100.66.83.22 'cd /home/orcabot/src/zapi-pwa \
  && sudo -u orcabot git pull \
  && cd packages/waclaw-go \
  && sudo -u orcabot make build \
  && systemctl stop waclaw-go \
  && install -o orcabot -g orcabot -m 0755 bin/waclaw-go /home/orcabot/waclaw-go/bin/waclaw-go \
  && systemctl start waclaw-go'
```

## Verificar deploy

```bash
ssh root@100.66.83.22 'journalctl -u waclaw-go -n 20 --no-pager | tail -20'
```

Procure por:
- `"auto-connect complete"` com `paired` igual ao número de instâncias ativas
- `"whatsapp connected"` para cada sessão pareada
- Nada com `"level":"error"`

## Gotchas

- **Tag `sqlite_fts5` é obrigatória.** O Makefile já usa; se compilar manualmente
  fora do Makefile, passar `-tags sqlite_fts5`, senão INSERT em
  `messages_fts` falha com `no such module: fts5`.
- **`systemctl stop` antes de trocar o binário.** Senão `install` falha com
  "Text file busy" (binário mapeado na memória pelo processo ativo).
- **`install` preserva owner/perms corretos.** Não usar `cp` direto — o
  systemd unit roda como `orcabot` e precisa de permissão de execução.
- **Source fora de git.** Se o `git pull` falhar com "not a git repository",
  o diretório foi mexido manualmente — re-clonar:
  ```bash
  ssh root@100.66.83.22 'rm -rf /home/orcabot/src/zapi-pwa \
    && sudo -u orcabot git clone https://github.com/andrefogelman/zapi-pwa.git /home/orcabot/src/zapi-pwa'
  ```

## Rollback

Se o novo binário crashar em loop:

```bash
ssh root@100.66.83.22 'systemctl stop waclaw-go \
  && cd /home/orcabot/src/zapi-pwa \
  && sudo -u orcabot git log --oneline -5 \
  && sudo -u orcabot git checkout <commit-anterior> -- packages/waclaw-go \
  && cd packages/waclaw-go \
  && sudo -u orcabot make build \
  && install -o orcabot -g orcabot -m 0755 bin/waclaw-go /home/orcabot/waclaw-go/bin/waclaw-go \
  && systemctl start waclaw-go'
```

## Senha root do W5

Está salva em memória local (memory/feedback ou equivalente). Não commitar
aqui.
