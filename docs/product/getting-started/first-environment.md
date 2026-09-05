# Configure your first environment

Use a local gateway and an existing Compose application you own. Install Portta first using [Install Portta](install.md).

## Choose a namespace

In your application checkout, set `COMPOSE_PROJECT_NAME=demo-shop-development` in its `.env`. Use a different namespace for each checkout. Do not reuse another environment's database volume.

## Check the integration

```bash
portta analyze .
portta init . --project demo-shop --dry-run
```

Review the generated overlay. HTTP services join the shared gateway network; databases remain on the application's private network. Remove application host-port publications only after checking how the application is accessed.

## Start and verify

```bash
portta init . --project demo-shop
docker compose -f compose.yaml -f compose.portta.yaml up -d
portta doctor
portta urls --project demo-shop-development
```

Use the URLs printed by Portta. A service named `web` under local hostname mode uses `demo-shop-development-web.localhost`.

## Next step

[Add your first project](first-project.md) to understand the relationship between the running environment and its Project.
