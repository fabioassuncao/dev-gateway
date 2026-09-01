# Prompt 03 — Adaptação de projetos e execução paralela

Continue no repositório `fabioassuncao/portta`.

Não modifique nesta etapa nenhum projeto real externo.

A missão é criar o **contrato oficial de adoção**, templates, exemplos, ferramentas e documentação que permitam adaptar Base Empresarial, outros projetos Brasil Data Hub ou qualquer repositório Docker futuro sem acoplá-los ao Portta.

---

## 1. Regra mais importante

O Portta NÃO é um monorepo de infraestrutura dos projetos.

Os projetos continuam exatamente onde estão.

Exemplo:

```text
~/Projects/.../portta
~/Projects/.../base-empresarial
~/Projects/.../base-eleicoes
~/Projects/.../issue-flow
~/Projects/.../outro-projeto
```

Cada um é independente.

O único elemento global compartilhado é a infraestrutura do Portta.

---

## 2. Contrato mínimo de um consumidor

Formalize um contrato que exija apenas o necessário.

Um projeto compatível deve:

1. usar Docker/Compose;
2. ter `COMPOSE_PROJECT_NAME` único;
3. manter sua rede privada;
4. declarar `portta` como rede externa;
5. conectar a ela somente serviços publicados;
6. habilitar Traefik explicitamente;
7. informar porta interna ao Traefik quando necessário;
8. evitar `container_name` fixo;
9. evitar `ports` para HTTP/HTTPS quando o acesso for pelo gateway;
10. não publicar bancos/cache no host por padrão.

---

## 3. Overlay como padrão de integração

Avalie e adote preferencialmente uma abordagem de baixo acoplamento, como:

`compose.portta.yaml`

O Compose principal do projeto deve continuar representando a aplicação.

O overlay contém somente integração com o Portta quando possível.

Exemplo de uso:

```bash
docker compose \
  -f compose.yaml \
  -f compose.portta.yaml \
  up -d
```

Avalie também `COMPOSE_FILE`, profiles e include, conforme suporte atual.

Escolha uma recomendação oficial.

Objetivo:

- projeto funciona com gateway;
- projeto pode continuar funcionando sem gateway quando necessário;
- mudanças são pequenas;
- não duplicar grandes blocos Compose;
- não mover Dockerfiles;
- não mover serviços.

---

## 4. Template de serviços HTTP

Crie templates reais baseados na implementação vigente.

Exemplo conceitual:

```yaml
services:
  web:
    networks:
      - default
      - portta
    labels:
      traefik.enable: "true"
      # demais labels necessárias

  api:
    networks:
      - default
      - portta
    labels:
      traefik.enable: "true"

networks:
  portta:
    external: true
    name: portta
```

Não copie cegamente.

Garanta que a porta interna correta seja configurada.

---

## 5. Portas

Documente de maneira inequívoca:

### Container port

Porta usada dentro da rede Docker.

Pode se repetir em quantos projetos forem necessários.

### Host port

Só existe quando `ports` publica algo no host.

É aqui que normalmente ocorre colisão.

### Regra

Nunca mudar:

- 3000;
- 8000;
- 5432;
- 6379;

apenas para evitar conflito entre projetos.

Resolver o conflito removendo publicação desnecessária ou usando mecanismo de acesso apropriado.

---

## 6. Namespaces

Crie utilitário para gerar `COMPOSE_PROJECT_NAME`.

Ele deve:

- receber projeto/worktree/branch;
- sanitizar;
- remover caracteres inválidos;
- gerar lowercase;
- evitar colisões;
- respeitar limites práticos de DNS/Docker;
- ser determinístico quando possível.

Exemplos:

```text
base-empresarial
base-empresarial-issue59
base-empresarial-agent-02
base-empresarial-feature-search
```

Não derive volumes compartilhados de forma que dois workspaces acabem usando o mesmo banco acidentalmente.

---

## 7. Hostnames

Convenção:

`<compose-project>-<service>.<domain>`

Local:

```text
base-empresarial-web.localhost
base-empresarial-api.localhost
```

Worktree:

```text
base-empresarial-issue59-web.localhost
base-empresarial-issue59-api.localhost
```

VPS:

```text
base-empresarial-web.vpn.dev.example.com
```

Crie:

```bash
./bin/portta urls
```

e, se útil:

```bash
./bin/portta urls --project base-empresarial
```

Descobrir via Docker/Traefik.

Evitar registry manual de projetos.

---

## 8. Monorepos

Crie documentação específica para:

```text
apps/
  web/
  api/

services/
  worker/
  importer/
  ...
```

Um único Portta atende todos.

Cada monorepo continua responsável por seu próprio Compose.

Não centralizar Dockerfiles no Portta.

Não centralizar deploy dos projetos no Portta.

---

## 9. Serviços internos

Deixe explícito:

- PostgreSQL não precisa entrar na rede `portta`;
- Redis não precisa entrar na rede `portta`;
- OpenSearch não precisa entrar;
- filas não precisam entrar.

Eles permanecem na rede privada da aplicação.

A etapa seguinte implementará acesso humano/externo a serviços TCP de forma controlada.

---

## 10. Agentes autônomos

Crie:

`docs/agent-guidelines.md`

Com uma versão longa e uma versão curta copiável para `AGENTS.md`/`CLAUDE.md`.

Incluir regras:

- nunca parar containers de outro projeto para liberar porta;
- nunca executar `docker system prune`;
- nunca remover volumes alheios;
- nunca destruir bancos;
- não alterar porta interna para "resolver" colisão;
- usar namespace único;
- usar Portta;
- respeitar redes privadas;
- usar `doctor`;
- identificar ownership antes de parar/remover um container;
- preservar execuções paralelas;
- não publicar serviços internos sem necessidade;
- não expor bancos na Internet;
- listar URLs após iniciar ambiente.

---

## 11. Analyzer

Implemente ferramenta read-only:

```bash
./bin/portta analyze /path/to/project
```

Deve localizar Compose files e analisar:

- services;
- `ports`;
- `expose`;
- `container_name`;
- networks;
- volumes;
- serviços HTTP prováveis;
- bancos/cache;
- conflitos;
- compatibilidade atual;
- sugestões de adaptação.

Não modificar o projeto.

Suportar saída humana e `--json`.

---

## 12. Init/adapt assistido

Depois do analyzer, avalie:

```bash
./bin/portta init /path/to/project
```

ou:

```bash
./bin/portta adapt /path/to/project
```

Se implementar:

- não editar destrutivamente;
- gerar overlay separado;
- mostrar diff;
- criar backup quando necessário;
- exigir confirmação para escrita;
- preservar estilo existente;
- nunca alterar banco/volumes;
- nunca iniciar projeto automaticamente sem solicitação.

Uma opção `--dry-run` é obrigatória.

---

## 13. Templates

Forneça exemplos para:

1. web única;
2. web + API;
3. web + API + Postgres;
4. web + API + Postgres + Redis;
5. múltiplas APIs;
6. monorepo;
7. worktree;
8. serviço HTTP com porta interna não padrão.

Templates são referências, não runtime central dos projetos.

---

## 14. Teste real de paralelismo

Crie fixtures próprias do Portta:

```text
demo-a
demo-b
demo-a-issue-1
demo-a-issue-2
```

Cada ambiente deve poder conter:

- web `3000`;
- API `8000`;
- Postgres `5432`;
- Redis `6379`.

Todos devem subir simultaneamente.

Não alterar portas internas.

Validar:

- rotas HTTP separadas;
- redes privadas separadas;
- bancos separados;
- Redis separados;
- volumes separados;
- project names separados;
- desligar demo A não afeta demo B;
- restart do Traefik não encerra aplicações.

---

## 15. Testes de isolamento

Automatize verificações:

- banco de projeto A não é resolvível a partir de container privado de B;
- Postgres não aparece como router HTTP;
- Redis não aparece como router HTTP;
- serviço sem `traefik.enable=true` não fica exposto;
- remover um projeto não remove `portta`;
- `down` do Portta não destrói containers consumidores;
- `up` do gateway redescobre consumidores existentes.

---

## 16. Guia de adoção

Crie `docs/adopting-projects.md`.

Fluxo:

1. executar analyzer;
2. identificar project name;
3. identificar HTTP/HTTPS;
4. identificar portas publicadas;
5. identificar bancos/cache;
6. identificar redes;
7. identificar container names;
8. criar overlay;
9. conectar apenas serviços HTTP;
10. remover host ports desnecessárias do perfil gateway;
11. subir;
12. listar URLs;
13. testar;
14. testar worktree paralelo;
15. documentar no projeto consumidor.

Inclua checklist.

---

## 17. Documentação que o projeto consumidor deve receber

Crie template curto que possa ser copiado para cada projeto contendo:

- pré-requisito: Portta ativo;
- comando para subir;
- namespace;
- URLs;
- como acessar banco;
- como acessar Redis;
- como trabalhar em worktree;
- troubleshooting.

Não copie a documentação inteira do Portta para cada projeto.

O Portta continua sendo a fonte central das regras.

---

## 18. CI

Teste os templates e fixtures no Linux.

Quando macOS/OrbStack não puder ser reproduzido em CI, forneça smoke test manual realista.

---

## 19. Git

Conventional Commits.

Testes completos.

Revisar documentação.

Push para `origin/main`.

---

## Critério de conclusão

A etapa termina quando outro agente consegue receber um repositório Docker desconhecido e, seguindo somente a documentação/ferramentas deste Portta, adaptá-lo sem mover o projeto e sem depender de portas exclusivas no host.
