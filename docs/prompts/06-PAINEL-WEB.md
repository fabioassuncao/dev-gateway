Implemente um **painel web de administração do Portta**, voltado exclusivamente para facilitar o desenvolvimento local e remoto por humanos e agentes de IA.

O painel deve ser simples, rápido, amigável e totalmente containerizado. Não deve se transformar em uma plataforma complexa de administração de infraestrutura ou gerenciamento geral de Docker.

## Objetivo

Permitir que o usuário visualize e gerencie, de forma simples, tudo que está conectado ao Portta:

* projetos ativos;
* containers e serviços;
* URLs locais;
* URLs pela VPN/Tailscale;
* URLs públicas, quando habilitadas;
* domínios e DNS utilizados;
* status do Traefik/Portta;
* redes;
* bridges/túneis ativos;
* serviços TCP como PostgreSQL e Redis;
* configurações principais do gateway.

Além disso, o painel deve também permitir **visualizar todos os demais containers Docker em execução no host**, mesmo que não estejam conectados à rede do Portta.

Esses containers externos devem aparecer principalmente para fins de:

* diagnóstico;
* identificação de conflitos;
* inspeção rápida;
* entendimento do que está consumindo recursos;
* descoberta de containers esquecidos;
* apoio durante desenvolvimento paralelo.

O painel deve complementar a CLI existente, não substituí-la.

CLI e painel devem operar sobre as mesmas regras e capacidades do Portta.

---

# Tecnologias

Utilize tecnologias simples, maduras e fáceis de manter.

Preferência:

### Frontend

* React;
* TypeScript;
* Vite ou ferramenta equivalente simples;
* Tailwind CSS;
* biblioteca madura de componentes compatível com Tailwind, como shadcn/ui ou equivalente.

Pesquise as versões estáveis atuais antes de implementar.

Não utilize framework full-stack complexo sem necessidade.

### Backend

Preferencialmente:

* Node.js;
* TypeScript;
* Hono ou framework HTTP pequeno equivalente.

Referência:

https://hono.dev/

O backend deve funcionar como uma camada fina entre a interface e as capacidades já existentes do Portta.

Não duplique lógica que já exista em:

`./bin/portta`

ou nos scripts internos do projeto.

Sempre que possível, reutilize as mesmas funções/bibliotecas internas utilizadas pela CLI, evitando executar comandos shell de maneira insegura.

---

# Arquitetura

Estruture aproximadamente:

```text
Browser
   |
React UI
   |
HTTP API
   |
Portta Core
   |
Docker / Traefik / Tailscale
```

O painel deve executar como parte do próprio Portta, mas continuar completamente desacoplado dos projetos consumidores.

Projetos externos não devem precisar instalar dependências do painel.

---

# Sem autenticação

Neste primeiro momento, não implemente:

* login;
* cadastro;
* usuários;
* sessões;
* RBAC;
* OAuth;
* permissões complexas.

O painel é uma ferramenta de desenvolvimento.

Por segurança, ele deve ficar acessível somente por interfaces confiáveis por padrão:

* `127.0.0.1` em ambiente local;
* Tailscale/VPN no VPS.

Nunca publique o painel automaticamente na Internet.

Caso posteriormente seja permitido acesso público, isso deverá ser explicitamente configurado.

---

# Dashboard

A tela inicial deve responder rapidamente:

* Portta está funcionando?
* Quantos projetos estão ativos?
* Quantos serviços estão ativos?
* Quantos estão saudáveis?
* Quais URLs estão disponíveis?
* Existe Tailscale ativo?
* Existe domínio público configurado?
* Existem problemas detectados?
* Quantos containers Docker estão rodando no host?
* Quantos pertencem ao Portta?
* Quantos estão fora do Portta?

Evite dashboards cheios de gráficos desnecessários.

Priorize informação operacional útil.

---

# Projetos

Agrupe containers gerenciados através do `COMPOSE_PROJECT_NAME`.

Exemplo:

```text
Base Empresarial
├── web
├── api
├── postgres
└── redis

Base Eleições
├── web
├── api
├── postgres
└── redis
```

O usuário deve enxergar **projetos e serviços**, não uma lista desorganizada de containers Docker.

Para cada projeto, mostrar quando disponível:

* project name;
* status;
* serviços;
* health;
* redes;
* URLs;
* perfil local/VPN/public;
* tempo de execução;
* worktree/namespace quando identificável.

---

# Containers fora do Portta

O painel também deve possuir uma visão simples dos **demais containers Docker existentes no host**, mesmo que:

* não estejam conectados à rede `portta`;
* não possuam labels Traefik;
* não pertençam a um projeto integrado;
* tenham sido iniciados manualmente;
* pertençam a outra aplicação ou experimento.

Essa visão existe apenas para facilitar desenvolvimento e diagnóstico.

Exemplos:

```text
Other Docker Containers

legacy-postgres
redis-test
mailpit
temporary-api
some-old-container
```

Mostrar informações básicas como:

* nome;
* imagem;
* status;
* health;
* tempo de execução;
* portas publicadas;
* redes;
* Compose project, se identificável;
* labels relevantes;
* consumo básico de recursos somente se isso for simples de obter;
* se pertence ou não ao Portta.

Use indicação visual clara:

```text
Portta
External
Standalone
```

ou nomenclatura equivalente.

Não misture visualmente containers externos com projetos oficialmente integrados.

---

# Ações em containers externos

O painel não deve virar uma ferramenta avançada de gerenciamento Docker.

Para containers que não pertencem ao Portta, permitir no máximo operações simples:

* visualizar detalhes básicos;
* visualizar logs recentes;
* restart;
* stop;
* start;
* remover container.

Antes de remover:

* mostrar confirmação clara;
* informar nome e imagem;
* avisar se possui volumes/mounts;
* não remover volumes automaticamente;
* não remover redes;
* não remover imagens;
* não executar prune.

Nunca oferecer ações como:

* recriar Compose;
* editar configuração;
* alterar rede;
* alterar volumes;
* executar comandos arbitrários;
* editar environment variables;
* clonar container;
* criar stacks;
* gerenciamento avançado de Docker.

A finalidade é somente diagnóstico e operações simples.

---

# Serviços

Para cada serviço do Portta mostrar informações úteis como:

* nome;
* imagem;
* status;
* health;
* porta interna;
* rede;
* endereço local;
* endereço VPN;
* endereço público, se existente;
* tipo provável: HTTP, PostgreSQL, Redis etc.

Não exponha detalhes internos desnecessários na tela principal.

Utilize detalhes expansíveis quando necessário.

---

# URLs e DNS

Um dos principais objetivos do painel é facilitar a descoberta dos endereços.

Exemplos:

```text
Local
https://base-empresarial-web.localhost

VPN
https://base-empresarial-web.vpn.dev.example.com

Public
https://base-empresarial-web.dev.example.com
```

Permitir copiar URLs facilmente.

Mostrar claramente a diferença entre:

* Local;
* VPN;
* Público.

O painel deve obter essas informações através do estado real do Portta/Traefik, evitando manter uma segunda fonte de verdade.

---

# PostgreSQL, Redis e serviços TCP

O painel também deve facilitar acesso a serviços que não são HTTP.

Para PostgreSQL, Redis e equivalentes, mostrar:

* serviço;
* projeto;
* porta interna;
* status;
* bridges ativos.

Permitir iniciar um TCP Access Bridge utilizando as capacidades existentes do Portta.

Exemplo:

```text
PostgreSQL
base-empresarial/postgres

[ Open local access ]
```

Após abrir:

```text
127.0.0.1:55431
```

Oferecer:

* copiar host;
* copiar porta;
* copiar connection string sem senha;
* fechar acesso.

Não publicar permanentemente `5432`, `6379` etc.

No VPS, quando aplicável, mostrar informações sobre acesso pela VPN/túnel.

---

# Ações

O painel pode oferecer operações simples e seguras.

Para serviços integrados:

* restart;
* stop;
* start;
* visualizar logs.

Para containers:

* restart;
* stop;
* start;
* remover quando seguro.

Para projetos:

* restart de serviços;
* visualizar status;
* abrir URLs;
* visualizar serviços.

Para o Portta:

* restart;
* status;
* doctor;
* atualizar configuração;
* visualizar logs.

## Segurança

Antes de ações destrutivas como remover container:

* mostrar confirmação;
* identificar claramente o recurso;
* identificar se pertence ao Portta ou é externo;
* preservar volumes;
* não remover recursos relacionados automaticamente.

Nunca oferecer diretamente:

* `docker system prune`;
* remoção global de volumes;
* remoção global de redes;
* `docker compose down -v`;
* reset de banco;
* remoção em massa de containers.

---

# Logs

Permitir visualizar logs recentes de:

* Traefik;
* Portta;
* containers integrados;
* containers externos;
* Tailscale;
* bridges.

Não tente construir uma plataforma completa de observabilidade.

Forneça:

* últimas linhas;
* atualização em tempo real quando simples;
* busca/filtro básico;
* copiar conteúdo.

---

# Visão geral do Docker Host

Crie uma área simples, por exemplo:

```text
Docker Host
```

Ela deve permitir entender rapidamente:

```text
Containers: 18 running
Portta: 11
External: 7

Networks: 14
Portta network: healthy

Published ports:
3001
8080
9200
...
```

Essa área é especialmente útil para identificar:

* conflito de porta;
* containers esquecidos;
* serviços iniciados fora do padrão;
* containers que poderiam ser migrados posteriormente para Portta.

Não transformar essa página em gerenciamento completo de Docker.

---

# Filtros

Permitir filtros simples:

```text
All
Portta
External
Running
Stopped
Unhealthy
```

E busca por:

* container;
* projeto;
* imagem;
* serviço.

Isso deve permitir que humanos e agentes localizem rapidamente um recurso.

---

# Configurações

O painel deve permitir editar as configurações mais comuns do Portta.

Exemplos:

* domínio local;
* domínio VPN;
* domínio público;
* habilitar/desabilitar modo público;
* Tailscale;
* TLS;
* DNS provider;
* configurações do Traefik;
* opções do painel.

Não exponha secrets diretamente.

Tokens e credenciais devem:

* permanecer ocultos;
* nunca ser retornados completos pela API;
* nunca aparecer em logs;
* utilizar o mecanismo seguro já adotado pelo Portta.

Antes de aplicar mudanças:

1. salvar;
2. validar;
3. aplicar;
4. reiniciar somente componentes necessários;
5. confirmar health.

---

# Persistência

Antes de adicionar banco, analise se realmente existe estado que precisa ser armazenado.

Prefira inicialmente:

1. configuração existente do Portta;
2. arquivos estruturados;
3. SQLite somente quando houver necessidade real.

Não mantenha em banco informações que podem ser descobertas dinamicamente pelo Docker/Traefik.

Exemplos que devem ser obtidos em tempo real:

* containers ativos;
* containers externos;
* status;
* redes;
* routers;
* URLs;
* portas;
* health.

Se houver configurações adicionais do painel, utilize JSON/YAML ou SQLite conforme a solução mais simples.

---

# API

Crie uma API interna pequena e organizada.

Exemplos conceituais:

```text
GET  /api/status

GET  /api/projects
GET  /api/projects/:project

GET  /api/services
GET  /api/services/:id
GET  /api/services/:id/logs

GET  /api/docker/containers
GET  /api/docker/containers/:id
GET  /api/docker/containers/:id/logs

POST /api/docker/containers/:id/start
POST /api/docker/containers/:id/stop
POST /api/docker/containers/:id/restart
DELETE /api/docker/containers/:id

POST /api/access
DELETE /api/access/:id

GET  /api/config
PATCH /api/config

POST /api/gateway/restart
POST /api/gateway/doctor
```

Não adote REST rigidamente se outra estrutura for mais simples.

Utilize validação de entrada.

Nunca monte comandos shell diretamente com valores fornecidos pela UI.

Nunca crie endpoint genérico para executar comandos Docker arbitrários.

---

# Atualização em tempo real

Avalie SSE como primeira opção.

Utilize WebSocket somente quando houver necessidade real.

A interface deve perceber automaticamente:

* container iniciado;
* container parado;
* container externo iniciado;
* container removido;
* health alterado;
* novo projeto;
* projeto removido;
* nova URL;
* bridge aberto/fechado.

Prefira Docker Events quando adequado.

Evite polling agressivo.

---

# UX

O painel deve parecer uma ferramenta profissional de desenvolvimento.

Características:

* interface limpa;
* rápida;
* responsiva;
* tema claro/escuro;
* hierarquia visual simples;
* ações importantes facilmente encontráveis;
* bom uso de badges/status;
* sem excesso de cards;
* sem animações desnecessárias;
* sem estética genérica de dashboard gerado por IA.

O foco é que o usuário consiga alternar entre muitos projetos rapidamente.

Priorize desktop, mantendo responsividade básica.

---

# Navegação

Uma estrutura simples pode ser:

```text
Overview
Projects
Services
Docker
Network
Access
Gateway
Settings
```

## Overview

Visão geral.

## Projects

Projetos integrados ao Portta.

## Services

Serviços pertencentes aos projetos integrados.

## Docker

Todos os containers Docker do host, incluindo externos.

## Network

DNS, domínios, Traefik, Tailscale e redes.

## Access

TCP bridges, bancos, Redis e túneis.

## Gateway

Status, doctor, logs e versão.

## Settings

Configuração.

Ajuste se encontrar uma estrutura mais simples.

---

# Docker

Frontend e backend devem ser executados em containers.

O painel deve integrar-se ao Compose do próprio Portta.

Preferencialmente oferecer um único endpoint para o usuário, com backend servindo os assets do frontend em produção, se isso simplificar a arquitetura.

No desenvolvimento, HMR pode utilizar containers separados quando conveniente.

Não exigir Node instalado no host.

---

# Desenvolvimento

Forneça comandos simples.

Exemplo:

```bash
./bin/portta web
./bin/portta web open
./bin/portta web logs
./bin/portta web restart
```

ou nomenclatura melhor.

Integre ao CLI existente.

---

# Segurança da Docker API

O painel precisa enxergar containers externos, portanto precisa consultar informações globais do Docker host.

Isso NÃO significa conceder acesso irrestrito ao Docker socket.

Reutilize a arquitetura segura existente do Portta.

O backend deve possuir somente as capacidades necessárias para:

* listar;
* inspecionar dados básicos;
* consultar logs;
* start;
* stop;
* restart;
* remover container.

Não permita:

* criar containers arbitrários via API;
* montar volumes arbitrários;
* executar `docker exec` genérico pela interface;
* acessar filesystem do host;
* acessar secrets;
* criar redes arbitrárias;
* executar comandos Docker arbitrários.

Se o socket proxy atual precisar de permissões adicionais, documente e conceda somente endpoints estritamente necessários.

---

# Diferenciação visual

É importante distinguir claramente:

### Managed by Portta

Serviços e projetos integrados ao Portta.

Podem apresentar:

* URLs;
* DNS;
* VPN;
* bridges;
* ações de gateway.

### External Docker

Containers presentes no Docker host, mas fora do Portta.

Mostrar somente:

* diagnóstico;
* informações;
* logs;
* ações básicas.

Evite dar ao usuário a impressão de que o Portta gerencia a configuração desses containers.

---

# Testes

Adicione:

* testes unitários;
* testes da API;
* testes dos componentes importantes;
* integração com Docker;
* E2E básico;
* Playwright quando adequado.

Teste:

* múltiplos projetos;
* containers integrados;
* containers externos;
* classificação correta;
* filtros;
* status;
* restart;
* stop/start;
* remoção segura;
* logs;
* URLs;
* TCP bridge;
* configurações;
* Docker Events;
* container desaparecendo durante uma ação;
* erro de permissão Docker.

Teste especialmente que remover um container externo:

* não remove volume;
* não remove rede;
* não afeta projeto diferente.

---

# Documentação

Crie:

```text
docs/web-ui.md
```

Inclua:

* arquitetura;
* tecnologias;
* como iniciar;
* como desenvolver;
* acesso local;
* acesso via VPN;
* containers integrados;
* containers externos;
* ações disponíveis;
* configurações;
* segurança;
* troubleshooting.

Atualize README com seção curta sobre o painel.

---

# Fora de escopo

Não implementar agora:

* autenticação;
* multiusuário;
* RBAC;
* billing;
* métricas históricas complexas;
* monitoramento avançado;
* Kubernetes;
* gerenciamento de produção;
* deploy de aplicações;
* editor de Docker Compose;
* terminal web;
* IDE;
* gerenciamento completo de Docker;
* gerenciamento de imagens;
* gerenciamento avançado de volumes;
* gerenciamento avançado de redes;
* criação arbitrária de containers;
* substituto para Portainer/Docker Desktop.

O painel existe apenas para facilitar o uso cotidiano do Portta.

---

# Critério de conclusão

Considere a primeira versão concluída quando o usuário puder:

1. verificar se o Portta está saudável;
2. visualizar todos os projetos integrados;
3. visualizar seus serviços;
4. identificar URLs local/VPN/public;
5. copiar URLs;
6. visualizar bancos e Redis;
7. abrir/fechar acesso TCP;
8. visualizar logs;
9. restartar serviços;
10. visualizar todos os demais containers Docker do host;
11. identificar claramente quais pertencem ou não ao Portta;
12. restartar/parar/iniciar um container externo;
13. remover um container externo com segurança e confirmação;
14. identificar possíveis conflitos de portas;
15. alterar configurações básicas do gateway;
16. executar diagnóstico;
17. alternar entre vários projetos em desenvolvimento sem precisar matar outros ambientes.

A prioridade é entregar uma ferramenta **pequena, funcional, previsível, rápida e fácil de manter**.

O painel deve tornar o Portta mais agradável para humanos e agentes de IA sem tentar substituir ferramentas completas de administração Docker.

Evite overengineering.
