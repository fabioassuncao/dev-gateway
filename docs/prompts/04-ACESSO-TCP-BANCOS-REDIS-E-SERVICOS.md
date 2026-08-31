# Prompt 04 — Acesso a bancos, Redis e outros serviços TCP

Continue no repositório `fabioassuncao/dev-gateway`.

Esta etapa é crítica.

HTTP/HTTPS já possui Traefik e hostnames.

Agora resolva de maneira **genérica, segura, portátil e desacoplada** o acesso humano a serviços que não são HTTP, principalmente:

- PostgreSQL;
- MySQL/MariaDB;
- Redis;
- OpenSearch quando usado via TCP/HTTP conforme caso;
- RabbitMQ;
- SMTP;
- MongoDB;
- Memcached;
- outros serviços TCP;
- eventualmente UDP, documentando limitações.

---

# 1. Não tente tratar todo protocolo como HTTP

Não assuma que DNS + hostname permite multiplexar qualquer protocolo em uma única porta.

Pesquise e documente as limitações de:

- Traefik TCP routers;
- HostSNI;
- TLS/SNI;
- protocolos TCP sem TLS;
- clientes PostgreSQL/Redis/MySQL;
- roteamento por hostname em protocolos que não carregam hostname na conexão.

Traefik TCP pode ser útil em casos específicos, mas não deve ser usado como solução mágica para compartilhar `5432` entre bancos raw TCP sem uma análise correta do protocolo.

---

# 2. Modelo de acesso

Implemente quatro níveis.

## Nível A — aplicação para serviço

Permanece totalmente privado.

Exemplo:

```text
api -> postgres:5432
api -> redis:6379
```

Isso ocorre na rede privada do projeto.

Dev Gateway não interfere.

---

## Nível B — host local para serviço local

Exemplo:

- TablePlus no Mac;
- DBeaver;
- DataGrip;
- `psql`;
- `redis-cli`.

Objetivo:

permitir acesso a qualquer Postgres/Redis sem reservar uma porta fixa por projeto.

Implemente um **TCP Access Bridge** sob demanda.

Interface desejada:

```bash
./bin/dev-gateway access open \
  --project base-empresarial \
  --service postgres \
  --port 5432
```

Resultado conceitual:

```text
Access opened

Project: base-empresarial
Service: postgres
Protocol: tcp
Target: postgres:5432
Local: 127.0.0.1:55431

postgresql://127.0.0.1:55431/...
```

A porta local deve ser escolhida automaticamente quando não for informada.

---

# 3. Implementação do TCP Access Bridge

Prefira solução containerizada.

Avalie imagem/ferramenta pequena e mantida, por exemplo um forwarder TCP baseado em `socat`, HAProxy, Envoy ou implementação própria mínima, escolhendo a opção mais simples e segura.

O forwarder deve:

1. ser criado pelo Dev Gateway;
2. conectar-se temporariamente à rede privada do projeto alvo;
3. conseguir resolver o service/alias do alvo;
4. encaminhar para `service:container_port`;
5. publicar somente em `127.0.0.1`;
6. usar porta dinâmica por padrão;
7. receber nome único;
8. possuir labels indicando ownership;
9. poder ser removido sem afetar o projeto;
10. nunca montar volumes do projeto;
11. nunca alterar o container do banco;
12. nunca alterar o Compose consumidor.

O Dev Gateway pode inspecionar as redes Docker existentes para identificar `<project>_default`.

Não hardcode nomes quando puder descobrir via labels Compose.

---

# 4. Segurança do bridge

Por padrão:

`127.0.0.1:<dynamic-port>`

Nunca:

`0.0.0.0:<port>`

para bancos/cache.

Permitir bind diferente somente com flag explícita e aviso forte.

Nunca expor credenciais.

Nunca ler `.env` do projeto e imprimir senha para "ajudar".

Pode mostrar template de connection string sem segredo.

---

# 5. Gerenciamento das sessões

Implemente:

```bash
./bin/dev-gateway access open ...
./bin/dev-gateway access list
./bin/dev-gateway access close <id>
./bin/dev-gateway access close --project <project>
./bin/dev-gateway access inspect <id>
./bin/dev-gateway access gc
```

`gc` só pode remover bridges pertencentes ao Dev Gateway e claramente órfãos.

Nunca remover containers consumidores.

Considere TTL opcional:

```bash
--ttl 2h
```

Não imponha TTL por padrão se isso prejudicar ferramentas GUI.

---

# 6. Descoberta

Permita:

```bash
./bin/dev-gateway services
./bin/dev-gateway services --project base-empresarial
```

Detectar:

- Compose project;
- service;
- redes;
- portas internas;
- tipo provável;
- se HTTP;
- se TCP;
- se há host port;
- se existe bridge ativo.

Não depender apenas do nome da imagem.

Quando houver ambiguidade, exigir `--port`.

---

# 7. Atalhos específicos

Depois da camada genérica, forneça ergonomia:

```bash
./bin/dev-gateway db open base-empresarial postgres
./bin/dev-gateway redis open base-empresarial redis
```

Eles devem reutilizar `access open`, não criar arquiteturas diferentes.

Opcional:

```bash
./bin/dev-gateway db url ...
```

Sem incluir senha.

---

# 8. OrbStack

No macOS, pesquise os recursos atuais do OrbStack para acesso direto a containers através de seus domínios/IPs.

Pode oferecer otimização:

```text
direct
```

quando OrbStack permitir acesso confiável sem publicação de porta.

Mas:

- não torne isso o padrão arquitetural obrigatório;
- o TCP Access Bridge deve continuar funcionando com qualquer Docker runtime;
- mantenha comportamento consistente entre Mac e Linux.

O comando pode informar:

```text
Direct OrbStack address available: ...
Portable bridge address: 127.0.0.1:...
```

quando útil.

---

# 9. VPS — acesso remoto sob demanda

No VPS, o bridge continua bindado em loopback da VPS.

Não transforme a porta dinâmica em porta pública.

Crie fluxo para acessar pelo Mac através da VPN/Tailscale.

Opção padrão recomendada:

```text
Mac localhost
    |
SSH/Tailscale SSH tunnel
    |
VPS 127.0.0.1:<bridge>
    |
forwarder
    |
Docker private network
    |
postgres/redis
```

Implemente uma interface simples.

Exemplo:

```bash
./bin/dev-gateway remote access open \
  user@dev-vps \
  --project base-empresarial \
  --service postgres \
  --port 5432
```

O fluxo deve:

1. executar/solicitar bridge remoto;
2. descobrir porta loopback remota;
3. abrir túnel SSH seguro;
4. escolher porta local disponível;
5. manter processo/túnel observável;
6. mostrar endereço local para TablePlus/DBeaver;
7. permitir encerramento limpo.

Exemplo de resultado:

```text
Remote service available locally

Remote: base-empresarial/postgres:5432
Via: dev-vps over Tailscale
Local: 127.0.0.1:55432
```

Usar host verification normal.

Não desabilitar segurança SSH.

---

# 10. Tailscale Services — acesso persistente

Pesquise a implementação atual de **Tailscale Services**.

Avalie-a como modo opcional para recursos privados persistentes.

Objetivo conceitual:

```text
svc:base-empresarial-postgres
  TailVIP
  tcp:5432
      |
Tailscale
      |
forwarder do Dev Gateway
      |
rede privada do projeto
      |
postgres:5432
```

Isso é particularmente interessante porque serviços distintos podem ter identidades/IPs virtuais distintos e conservar a porta padrão.

Exemplos desejados:

```text
svc:base-empresarial-postgres:5432
svc:base-eleicoes-postgres:5432
svc:base-empresarial-redis:6379
```

Valide as capacidades atuais antes de implementar.

---

# 11. Arquitetura de forwarders persistentes

Se Tailscale Services for adotado:

- não conectar o container central de Tailscale indiscriminadamente a todas as redes privadas;
- criar forwarder dedicado por recurso;
- forwarder entra na rede privada do projeto e numa rede de acesso privada do Dev Gateway;
- o forwarder recebe alias único na rede de acesso;
- Tailscale aponta para o forwarder;
- nenhuma rede privada de projeto é mesclada com outra.

Exemplo:

```text
project-a_default
    postgres
       |
 forwarder-a-db
       |
dev-gateway-access
       |
   Tailscale
```

Outro projeto:

```text
project-b_default
    postgres
       |
 forwarder-b-db
       |
dev-gateway-access
```

Os bancos nunca compartilham a mesma rede privada.

---

# 12. ACLs / grants

Documente política deny-by-default.

Para Tailscale Services:

- use identidade/tag apropriada;
- documente grants;
- permita restringir acesso ao desenvolvedor/grupo;
- não criar regras permissivas `* -> *` como exemplo padrão.

Não alterar a policy real do usuário sem ação explícita.

Forneça snippet/template.

---

# 13. Serviços persistentes vs temporários

Defina:

### `access open`

Acesso temporário/on-demand.

Bom para:

- debugging;
- TablePlus;
- redis-cli;
- inspeções.

### `service publish --private`

Acesso persistente via Tailscale Service.

Bom para:

- banco remoto usado frequentemente;
- tooling compartilhado na tailnet;
- endereço estável.

Exemplo de CLI:

```bash
./bin/dev-gateway service publish \
  --private \
  --project base-empresarial \
  --service postgres \
  --port 5432
```

Implementação deve permanecer totalmente fora do Compose do projeto quando possível.

---

# 14. Não publicar TCP sensível na Internet

O Dev Gateway deve proibir por padrão publicação pública de:

- PostgreSQL;
- MySQL;
- Redis;
- MongoDB;
- Docker API;
- RabbitMQ management/TCP quando não intencional;
- Elasticsearch/OpenSearch TCP/admin;
- qualquer serviço classificado como sensível.

Se existir mecanismo de override futuro, deve exigir opção extremamente explícita.

A documentação padrão deve recomendar VPN.

---

# 15. Traefik TCP

Documente quando utilizar Traefik TCP:

- protocolo apropriado;
- entrypoint dedicado;
- TLS/SNI quando aplicável;
- necessidade real de proxy persistente.

Não usar Traefik TCP para substituir o Access Bridge genérico.

Explique que raw TCP sem informação roteável na conexão normalmente exige:

- porta distinta;
- IP distinto;
- TailVIP distinto;
- túnel;
- ou proxy específico do protocolo.

---

# 16. UDP

Analise limitações.

Não prometa suporte genérico se não estiver implementado.

Se houver necessidade:

- documentar Docker UDP;
- Tailscale layer 3/subnet routing;
- Traefik UDP quando apropriado.

Marcar claramente como capacidade separada.

---

# 17. Clientes GUI

Documente exemplos sem segredo para:

### TablePlus / DBeaver / DataGrip

Local:

```text
Host: 127.0.0.1
Port: <porta retornada pelo Dev Gateway>
```

Remoto:

mesma experiência local, com túnel criado pelo Dev Gateway.

O usuário não precisa conhecer IP do container.

---

# 18. CLI clients containerizados

Crie toolbox opcional:

```bash
./bin/dev-gateway db psql --project ... --service ...
./bin/dev-gateway redis cli --project ...
```

Esses comandos podem executar um cliente efêmero dentro da rede privada do projeto sem publicar qualquer porta.

Isso é ideal para agentes autônomos.

Exemplo conceitual:

```text
toolbox psql container
      |
project_default
      |
postgres:5432
```

O container efêmero deve ser removido ao terminar.

---

# 19. Agent guidelines

Atualize `docs/agent-guidelines.md`.

Adicionar:

- agentes devem preferir `docker compose exec` ou toolbox para operações rápidas;
- acesso humano usa Access Bridge;
- nunca publicar `5432:5432` para conveniência se isso causar acoplamento;
- nunca expor DB em `0.0.0.0`;
- nunca matar outro banco para liberar `5432`;
- nunca reutilizar volume de outro workspace;
- usar túnel VPN para VPS.

---

# 20. Testes

Crie testes automáticos.

Execute simultaneamente:

- dois PostgreSQL na porta 5432;
- dois Redis na porta 6379.

Prove:

1. nenhum publica 5432/6379 diretamente;
2. ambos funcionam;
3. `access open` cria portas locais distintas;
4. clientes conseguem conectar;
5. fechar bridge A não afeta B;
6. remover projeto encerra/identifica bridge órfão sem afetar outros;
7. binds são loopback;
8. nenhum banco fica na rede HTTP `dev-gateway` salvo decisão explícita de teste;
9. nenhum banco aparece como público.

Teste também tunneling remoto na medida possível.

---

# 21. Documentação

Criar/atualizar:

```text
docs/tcp-access.md
docs/database-access.md
docs/redis-access.md
docs/remote-tunnels.md
docs/tailscale-services.md
docs/security.md
docs/troubleshooting.md
docs/agent-guidelines.md
```

Documente claramente:

- acesso aplicação -> banco;
- host -> banco local;
- agente -> banco;
- host -> banco VPS;
- Tailscale Service persistente;
- encerramento;
- diagnóstico;
- segurança.

---

# 22. Git

Conventional Commits.

Revisão completa.

Testes completos.

Push para `origin/main`.

---

## Critério de conclusão

A etapa termina quando for possível manter, por exemplo:

```text
base-empresarial/postgres:5432
base-eleicoes/postgres:5432
base-escolar/postgres:5432
project-x/postgres:5432

base-empresarial/redis:6379
base-eleicoes/redis:6379
```

todos simultaneamente, sem conflito de portas no host, e ainda assim:

- acessar qualquer banco localmente;
- acessar qualquer Redis localmente;
- acessar equivalentes no VPS pela VPN;
- oferecer endereço privado persistente quando configurado;
- sem alterar a porta interna;
- sem tornar os serviços públicos;
- sem mover os projetos;
- sem acoplar seus dados ao Dev Gateway.
