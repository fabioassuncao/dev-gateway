# Redis access

Identical in shape to [database access](database-access.md); the details differ
slightly.

## From the application

`redis:6379` over the project's private network. Nothing to change.

## From a GUI or redis-cli on the host

```bash
dev-gateway redis open --project base-empresarial
# -> 127.0.0.1:33078
```

```bash
redis-cli -h 127.0.0.1 -p 33078
```

Or with RedisInsight / TablePlus: host `127.0.0.1`, the printed port.

## From the terminal, or from an agent

```bash
dev-gateway redis cli --project base-empresarial
dev-gateway redis cli --project base-empresarial -- keys 'session:*'
dev-gateway redis cli --project base-empresarial -- info memory
```

Runs inside the project's network. Nothing published, nothing left behind.

## Several Redis instances at once

```bash
dev-gateway redis open --project base-empresarial   # -> :33078
dev-gateway redis open --project base-eleicoes      # -> :33080
```

All still on 6379 internally.

## A project with more than one Redis

Common enough — one for cache, one for queues, often on 6379 and 6380 on the
host today. Name the service:

```bash
dev-gateway access open --project base-empresarial --service redis-cache
dev-gateway access open --project base-empresarial --service redis-queue
```

`dev-gateway services --project base-empresarial` lists what is there.

Both keep 6379 inside their containers. The 6379/6380 split only ever existed
to avoid a host port conflict, and there is no host port any more.

## A word of warning

`FLUSHALL` on the wrong bridge is indistinguishable from `FLUSHALL` on the
right one. Check which one you are on first:

```bash
dev-gateway access list
```

`dev-gateway redis cli --project <name>` is safer for exactly this reason: the
project is in the command.
