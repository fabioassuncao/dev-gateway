# Remote tunnels

Reaching a VPS's private services from your machine, without opening a port on
the VPS.

```
your Mac                    VPS
  client                    bridge (127.0.0.1:33077)
    |                          |
127.0.0.1:55432 ----SSH---->   |
                               v
                        project's private network
                               v
                          postgres:5432
```

## Opening one

```bash
dev-gateway remote access open deploy@vps \
  --project base-empresarial --service postgres
```

```
  id        7f2a91
  remote    base-empresarial/postgres:5432
  via       deploy@vps
  local     127.0.0.1:55432
```

Point TablePlus, DBeaver or `psql` at `127.0.0.1:55432`. The client never needs
to know the VPS exists.

```bash
dev-gateway remote access list
dev-gateway remote access close 7f2a91
dev-gateway remote access close --all
```

Closing the tunnel leaves the remote bridge in place, since another tunnel may
be using it, and prints the command to close that too.

## What it actually does

1. Runs `dev-gateway access open` **on the VPS**. That bridge binds the VPS's
   loopback, exactly as a local one does. It is never published.
2. Reads back the port it chose.
3. Opens `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote>`.
4. Prints the local address and records the tunnel under `state/access/tunnels/`.

## Over Tailscale SSH

The same command; the target is a tailnet name:

```bash
dev-gateway remote access open deploy@dev-vps --project base-empresarial --service postgres
```

Authentication and audit come from your tailnet policy instead of
`authorized_keys`, and no SSH port needs to be open on the internet.

## SSH options, and why

`StrictHostKeyChecking=accept-new` records a new host's key on first
connection and still refuses a *changed* one. That is the attack worth defending
against. It is never `no`. Override with `DG_SSH_HOST_KEY_POLICY=yes` if you
pre-populate `known_hosts`.

`ExitOnForwardFailure=yes` means that if the local port turns out to be taken,
SSH exits instead of connecting successfully while forwarding nothing. The failure mode
that flag prevents is a tunnel that looks open and silently does not work.

`ServerAliveInterval=30` keeps the tunnel alive through a NAT idle timeout,
which is what usually kills a long-lived database session.

## Doing it by hand

Nothing here is magic:

```bash
ssh deploy@vps 'cd dev-gateway && ./bin/dev-gateway access open --project base-empresarial --service postgres'
# note the port it prints, say 33077
ssh -N -L 127.0.0.1:55432:127.0.0.1:33077 deploy@vps
```

## Troubleshooting

**"the SSH tunnel exited immediately"** means the local port is taken, or the
host is unreachable. Try `--local-port` with a different number, or `ssh -v`.

**"the remote bridge did not report a port"** means the gateway on the VPS is
not where we looked. Pass `--dir` if it is not in `~/dev-gateway`, and check
`dev-gateway remote status deploy@vps`.

**The tunnel dies after a while.** That is a NAT or firewall idle timeout.
`ServerAliveInterval` covers the usual cases; a very aggressive middlebox may
need a shorter one in your `~/.ssh/config`.

**Connection refused through a working tunnel.** The remote bridge is gone.
`dev-gateway remote exec deploy@vps -- 'cd dev-gateway && ./bin/dev-gateway access list'`.
