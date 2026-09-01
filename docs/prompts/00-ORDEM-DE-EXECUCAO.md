# Portta — Ordem de execução dos prompts

## Contexto

Repositório de trabalho:

- Local: `/Users/fabioassuncao/Projects/fabioassuncao/portta`
- GitHub: `https://github.com/fabioassuncao/portta`
- SSH: `git@github.com:fabioassuncao/portta.git`

O repositório já existe e deve ser usado como ponto de partida.

## Princípio arquitetural inegociável

O **Portta é uma infraestrutura completamente desacoplada dos projetos consumidores**.

Ele:

- não hospeda código de Base Empresarial, Base Eleições, Issue Flow ou qualquer outro projeto;
- não move projetos de seus diretórios atuais;
- não passa a ser o Docker Compose "pai" desses projetos;
- não passa a gerenciar o ciclo de vida das aplicações consumidoras;
- não assume propriedade sobre volumes, bancos, caches ou redes privadas dos projetos;
- não exige que os projetos sejam clonados para dentro dele;
- não deve ter caminhos absolutos hardcoded para projetos consumidores;
- não deve destruir, parar ou recriar containers de outros projetos;
- não deve depender especificamente do Brasil Data Hub.

Cada projeto continua sendo executado em seu próprio diretório e com seu próprio Docker Compose.

A integração deve ocorrer apenas através de um **contrato de rede e metadados**, preferencialmente por um overlay Compose específico de desenvolvimento, por exemplo:

`compose.portta.yaml`

O Portta disponibiliza infraestrutura compartilhada, descoberta, roteamento, DNS/TLS, VPN e ferramentas auxiliares.

## Objetivo final

Permitir executar simultaneamente, no mesmo Mac ou VPS:

- vários projetos diferentes;
- vários monorepos;
- múltiplos worktrees do mesmo projeto;
- múltiplos agentes trabalhando em paralelo;
- APIs usando a mesma porta interna;
- aplicações web usando a mesma porta interna;
- bancos PostgreSQL/MySQL usando as portas padrão;
- Redis, OpenSearch, RabbitMQ e outros serviços usando suas portas padrão.

Nenhum agente deve precisar "liberar porta" matando containers de outro ambiente.

## Arquitetura esperada

### HTTP/HTTPS

`cliente -> Traefik -> rede externa portta -> serviço HTTP do projeto`

### Serviços privados do projeto

`aplicação -> rede privada do Compose -> postgres/redis/etc`

### Acesso humano local a serviços TCP

`TablePlus/DBeaver/redis-cli -> 127.0.0.1:<porta dinâmica> -> bridge temporário -> rede privada do projeto -> serviço`

### Acesso humano remoto a serviços TCP

Padrão preferencial:

`cliente -> Tailscale/VPN -> túnel seguro -> bridge TCP no VPS -> rede privada do projeto -> serviço`

Modo persistente opcional:

`cliente -> Tailscale Service/TailVIP -> forwarder privado -> rede privada do projeto -> serviço`

Bancos, Redis e serviços equivalentes não devem ser publicados diretamente na Internet.

## Prompts

Execute os arquivos na sequência:

1. `01-FUNDACAO-E-ARQUITETURA.md`
2. `02-MACOS-VPS-TAILSCALE-DNS-TLS.md`
3. `03-ADAPTACAO-DE-PROJETOS-E-PARALELISMO.md`
4. `04-ACESSO-TCP-BANCOS-REDIS-E-SERVICOS.md`
5. `05-AUDITORIA-TESTES-E-RELEASE-INICIAL.md`

Cada prompt deve ser executado **a partir do repositório `portta`**.

Antes de iniciar um prompt posterior, o agente deve:

1. ler o estado atual do repositório;
2. revisar os commits anteriores;
3. executar os testes existentes;
4. compreender as decisões arquiteturais/ADRs já registradas;
5. preservar decisões válidas;
6. corrigir decisões anteriores apenas quando houver evidência técnica clara.

## Regra para pesquisa técnica

Sempre que uma implementação depender de comportamento de versões atuais de Docker, Docker Compose, Traefik, Tailscale, OrbStack, Cloudflare ou ACME, consultar primeiro a documentação oficial atual.

Não assumir que exemplos antigos ainda são recomendados.

Não usar `latest` para componentes críticos quando for possível fixar uma versão estável explícita.

## Git

Este é um repositório novo.

Trabalhar diretamente na `main`, salvo instrução posterior em contrário.

Usar Conventional Commits e commits pequenos, coerentes e reversíveis.

Não misturar várias etapas independentes no mesmo commit.

## Resultado esperado

Depois dos cinco prompts, o Portta deve ser uma ferramenta reutilizável que possa ser instalada uma única vez por host e atender qualquer quantidade de projetos Docker compatíveis sem acoplamento a eles.
