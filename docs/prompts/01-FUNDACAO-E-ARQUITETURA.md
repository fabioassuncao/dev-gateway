# Prompt 01 — Fundação e arquitetura do Portta

Você está trabalhando no repositório:

- Local: `/Users/fabioassuncao/Projects/fabioassuncao/portta`
- GitHub: `fabioassuncao/portta`
- Branch inicial: `main`

Este repositório será uma infraestrutura independente chamada **Portta**.

Construa a fundação funcional do projeto.

---

## 1. Princípio arquitetural obrigatório: desacoplamento total

O Portta deve ser completamente independente dos projetos que o utilizam.

Projetos consumidores continuarão:

- nos diretórios em que já existem;
- em seus próprios repositórios Git;
- com seus próprios Dockerfiles;
- com seus próprios arquivos Compose;
- com suas próprias redes privadas;
- com seus próprios volumes;
- com seus próprios bancos e caches;
- sendo iniciados e encerrados de dentro de seus próprios diretórios.

O Portta NÃO deve:

- mover projetos;
- clonar projetos automaticamente para dentro do repositório;
- montar diretórios de aplicações no Compose do gateway;
- transformar todos os projetos em um Compose central;
- administrar migrations ou dados de bancos consumidores;
- assumir ownership do ciclo de vida das aplicações;
- parar containers de terceiros;
- executar `docker system prune`;
- remover volumes/redes de projetos consumidores;
- depender especificamente do Brasil Data Hub.

A única integração obrigatória deve ser um contrato pequeno de rede/metadados que qualquer projeto Docker possa adotar.

---

## 2. Problema que deve ser resolvido

Hoje vários ambientes podem tentar publicar simultaneamente:

- web `3000`;
- API `8000`;
- PostgreSQL `5432`;
- Redis `6379`;
- OpenSearch `9200`;
- RabbitMQ;
- SMTP;
- outros serviços.

Isso não deve exigir mudança das portas internas.

Deve ser possível manter simultaneamente:

- projeto A;
- projeto B;
- projeto C;
- dois ou mais worktrees do projeto A;
- múltiplos agentes;
- múltiplos bancos independentes.

Nenhum fluxo normal deve exigir matar containers de outro projeto para liberar portas.

---

## 3. Pesquise antes de implementar

Valide na documentação oficial atual:

- Docker Engine;
- Docker Compose;
- project names;
- redes externas;
- redes internas;
- service discovery;
- dynamic port publishing;
- Traefik Proxy;
- Docker provider do Traefik;
- HTTP routers;
- TCP routers e suas limitações;
- segurança da Docker API/socket;
- OrbStack quando relevante.

Registre decisões arquiteturais importantes em ADRs.

Identifique a versão estável atual do Traefik e fixe uma versão explícita. Não use `latest` como padrão.

Faça o mesmo para componentes auxiliares críticos.

---

## 4. Arquitetura base

Implemente inicialmente:

```text
                    Host
                     |
                80 / 443
                     |
                 Traefik
                     |
             rede portta
                     |
        +------------+------------+
        |            |            |
       web          api       outro HTTP
      projeto A    projeto B    projeto C
```

Cada projeto mantém sua rede privada:

```text
projeto-a_default
  web
  api
  postgres
  redis
```

Somente serviços que realmente precisam receber tráfego do gateway entram também na rede externa:

`portta`

Postgres, Redis e outros serviços internos não entram nessa rede por padrão.

---

## 5. Rede compartilhada

O Portta deve criar e manter uma única rede Docker externa, por padrão:

`portta`

Ela deve ter lifecycle independente dos projetos consumidores.

O bootstrap deve ser idempotente:

- se a rede existe, reutilizar;
- se não existe, criar;
- nunca removê-la automaticamente enquanto houver projetos utilizando-a.

Os consumidores devem poder referenciá-la com algo equivalente a:

```yaml
networks:
  portta:
    external: true
    name: portta
```

Não trate esse exemplo como implementação final sem validar a versão atual do Compose.

---

## 6. Traefik

O Traefik deve executar integralmente em container.

Configurar:

- Docker provider;
- `exposedByDefault=false`;
- entrypoint HTTP;
- entrypoint HTTPS;
- rede Docker padrão do provider apontando para `portta`;
- healthcheck;
- logs;
- access logs configuráveis;
- configuração estática separada da dinâmica quando fizer sentido;
- dashboard desligado por padrão ou estritamente privado;
- nenhuma porta administrativa pública.

Um serviço só pode ser publicado quando declarar explicitamente intenção de participar do gateway.

Use labels Traefik para isso.

---

## 7. Hostnames automáticos

Projete uma convenção previsível, preferencialmente:

`<compose-project>-<service>.<domain>`

Exemplos locais:

- `base-empresarial-web.localhost`
- `base-empresarial-api.localhost`
- `issue-flow-web.localhost`
- `base-empresarial-issue59-web.localhost`

Analise se é possível derivar automaticamente projeto e serviço das labels que o Docker Compose já injeta nos containers.

Evite exigir que cada projeto repita manualmente hostname completo quando o valor puder ser derivado.

Permita override explícito.

Garanta sanitização DNS-safe.

Evite múltiplos níveis de subdomínio desnecessários para manter compatibilidade simples com wildcard TLS.

---

## 8. COMPOSE_PROJECT_NAME

Formalize `COMPOSE_PROJECT_NAME` como namespace principal dos ambientes.

Crie regras e utilitário para gerar nomes previsíveis.

Exemplos:

- `base-empresarial`
- `base-empresarial-issue59`
- `base-empresarial-agent-02`
- `base-empresarial-search`

Evite `container_name` fixo nos projetos consumidores.

O Portta deve detectar e reportar colisões de project name.

---

## 9. Docker socket e segurança

Não finalize a solução simplesmente montando `/var/run/docker.sock` irrestrito no Traefik sem análise.

Avalie a recomendação oficial vigente.

Se utilizar Docker Socket Proxy:

- escolha implementação ativa e mantida;
- fixe versão;
- dê acesso somente aos endpoints necessários;
- coloque proxy em rede de controle privada;
- não exponha proxy no host;
- não conecte proxy à rede pública `portta`;
- Traefik deve ter somente permissões necessárias para discovery.

Registre em ADR a decisão e as limitações de segurança.

---

## 10. Estrutura do repositório

Crie uma organização limpa. Use como referência, adaptando se necessário:

```text
.
├── docker/
│   ├── compose/
│       ├── compose.yaml
│       ├── attach/
│       ├── features/
│       └── profiles/
│   └── examples/
├── .env.example
├── Makefile
├── bin/
│   └── portta
├── config/
│   ├── traefik/
│   ├── tailscale/
│   ├── dns/
│   └── tls/
├── scripts/
│   ├── lib/
│   ├── bootstrap.sh
│   ├── doctor.sh
│   └── install.sh
├── templates/
│   └── project/
├── tests/
└── docs/
    ├── architecture.md
    ├── configuration.md
    ├── networking.md
    ├── security.md
    ├── local-development.md
    ├── remote-development.md
    ├── adopting-projects.md
    ├── troubleshooting.md
    └── adr/
```

Não crie diretórios vazios sem finalidade.

---

## 11. Container-first

Minimize dependências do host.

Objetivo:

### macOS

Obrigatório apenas:

- OrbStack ou Docker Desktop/runtime Docker compatível;
- Git;
- shell padrão.

### Linux/VPS

Obrigatório apenas:

- Docker Engine;
- Docker Compose Plugin;
- Git;
- shell padrão.

Ferramentas como:

- curl especializado;
- jq;
- dig;
- openssl;
- socat;
- mkcert;
- yq;
- clientes de banco;
- ferramentas de diagnóstico;

devem preferencialmente existir em um **toolbox container** mantido pelo Portta quando isso melhorar portabilidade.

Não instale pacotes desnecessários globalmente no host.

Make deve ser conveniência, não dependência obrigatória.

---

## 12. CLI

Crie uma interface principal:

`./bin/portta`

Ela deve ser o contrato operacional estável.

Implemente inicialmente comandos equivalentes a:

```text
bootstrap
up
down
restart
status
logs
doctor
inspect
urls
version
update
```

A sintaxe final pode ser melhorada, mas deve ser simples.

Exemplos desejados:

```bash
./bin/portta bootstrap
./bin/portta up local
./bin/portta status
./bin/portta doctor
./bin/portta urls
```

Crie aliases Make quando útil:

```bash
make bootstrap
make up
make status
make doctor
make test
```

---

## 13. Bootstrap

O bootstrap deve:

1. validar Docker;
2. validar Compose;
3. verificar versões mínimas;
4. criar a rede `portta` se necessário;
5. preparar diretórios de estado;
6. validar `.env`;
7. inicializar componentes necessários;
8. executar healthchecks;
9. executar `doctor`;
10. mostrar próximos passos.

Deve ser idempotente.

Nunca apagar dados do usuário para "corrigir" um problema.

---

## 14. Doctor

Crie diagnóstico profundo para verificar:

- runtime Docker;
- Compose;
- versão do gateway;
- rede compartilhada;
- health do Traefik;
- provider Docker;
- socket proxy;
- portas 80/443;
- binds inseguros;
- DNS;
- TLS quando habilitado;
- rotas descobertas;
- configurações incompatíveis;
- permissões;
- containers órfãos pertencentes ao próprio Portta;
- conflitos de `COMPOSE_PROJECT_NAME`;
- componentes opcionais.

O resultado deve ser legível tanto para humanos quanto para agentes.

Considere saída `--json`.

---

## 15. Configuração

Crie `.env.example` completo e comentado.

Separe conceitos:

- common;
- local;
- remote;
- private/VPN;
- public;
- DNS;
- TLS;
- Tailscale.

Considere variáveis como:

```text
PORTTA_NETWORK
PORTTA_DOMAIN
PORTTA_BIND_ADDRESS
PORTTA_HTTP_PORT
PORTTA_HTTPS_PORT
TAILSCALE_ENABLED
PUBLIC_ENABLED
PUBLIC_DOMAIN
PRIVATE_DOMAIN
TLS_ENABLED
```

Escolha nomes finais consistentes.

Segredos não entram no Git.

---

## 16. Aplicações de demonstração

Crie exemplos independentes do mundo real.

Não use código de nenhum projeto existente.

Crie pelo menos duas stacks demo que:

- usem a mesma porta HTTP interna;
- executem simultaneamente;
- participem do gateway;
- recebam hostnames diferentes;
- não publiquem diretamente a porta da aplicação no host.

Use imagens mínimas e simples.

---

## 17. Testes e CI

Adicione:

- `.editorconfig`;
- `.gitignore`;
- lint de shell;
- validação de Compose;
- testes de scripts;
- smoke tests;
- GitHub Actions;
- healthchecks.

Scripts shell devem usar comportamento seguro e falhar com mensagens claras.

Não simule sucesso quando um teste não puder ser executado.

---

## 18. Documentação

README deve explicar:

1. o problema;
2. o conceito;
3. arquitetura;
4. requisitos;
5. quick start;
6. comandos;
7. como um projeto adere;
8. segurança;
9. links para docs.

Use Mermaid quando útil.

Crie ADRs para decisões relevantes.

---

## 19. Git

Trabalhe na `main`.

Use Conventional Commits.

Faça commits por unidade lógica.

Ao final:

- revise o diff;
- execute todos os testes;
- valide que não há segredos;
- confirme que a demo funciona;
- envie os commits para `origin/main`.

---

## Critério de conclusão

Esta etapa só termina quando:

- o gateway realmente sobe;
- Traefik descobre serviços;
- duas demos com a mesma porta interna funcionam simultaneamente;
- a rede externa está operacional;
- nenhum projeto real foi movido ou incorporado;
- documentação e testes correspondem à implementação.
