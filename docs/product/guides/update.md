# Update Portta

## Updating

Run the installer again.

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash
```

It finds the existing installation, keeps every answer already recorded, pulls
the new images, and recreates. It never regenerates the panel database
password, the session signing secret, the ACME material or the Tailscale
identity, and it never overwrites `.env`, `state/`, `config/tls/`, or a file
that already exists in `config/traefik/dynamic/`. Panel accounts live in the
database, which an update never touches.

To see what would change without changing it:

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash -s -- --pull-only
```
