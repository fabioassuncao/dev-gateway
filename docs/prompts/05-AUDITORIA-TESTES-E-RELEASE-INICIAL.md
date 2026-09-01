# Prompt 05 — Auditoria, testes e release inicial

Continue no repositório `fabioassuncao/portta`.

As etapas anteriores devem ter construído:

- núcleo Traefik;
- rede compartilhada;
- perfis macOS/VPS;
- Tailscale;
- DNS/TLS;
- adaptação desacoplada de projetos;
- paralelismo;
- acesso TCP a bancos/Redis;
- automações;
- documentação.

Agora faça uma revisão completa antes de considerar a versão inicial pronta.

---

## 1. Não adicionar novas features sem necessidade

Esta etapa é prioritariamente:

- auditoria;
- simplificação;
- correções;
- segurança;
- testes;
- documentação;
- ergonomia;
- release.

Não amplie o escopo apenas porque encontrou tecnologias interessantes.

---

## 2. Revisar o princípio de desacoplamento

Garanta que não exista:

- caminho hardcoded para Base Empresarial;
- código específico do Brasil Data Hub;
- clone automático de consumidor;
- volume de aplicação dentro do Portta;
- Compose central contendo serviços dos consumidores;
- ownership indevido de containers externos;
- lógica que execute `down` em projetos consumidores;
- remoção de volumes externos;
- `docker system prune`;
- requisito de estrutura específica de monorepo.

Fixtures/examples devem ser genéricos.

---

## 3. Revisar ownership

Todo recurso criado pelo Portta deve ter labels claras.

Exemplo conceitual:

```text
portta.managed=true
portta.component=...
```

Antes de remover qualquer container/rede/recurso, confirmar ownership.

Recursos consumidores nunca devem ser removidos pelo gateway.

A rede global `portta` não deve ser removida automaticamente de forma perigosa.

---

## 4. Segurança

Audite:

- Docker socket;
- socket proxy;
- permissões;
- secrets;
- `.env`;
- logs;
- ACME;
- Tailscale state;
- auth keys;
- Cloudflare tokens;
- binds;
- dashboards;
- portas públicas;
- TCP bridges;
- SSH;
- command injection em scripts;
- interpolação de nomes;
- uso de `eval`;
- temporary files;
- permissões de arquivos.

Use ferramentas automatizadas adequadas quando possível.

---

## 5. Imagens e supply chain

Garanta:

- nenhuma dependência crítica usa `latest` sem justificativa;
- versões documentadas;
- estratégia de atualização;
- imagens oficiais ou fontes confiáveis;
- scanner de vulnerabilidades no CI quando viável;
- licenças compatíveis.

Não fixe digest arbitrariamente sem documentar processo de atualização.

---

## 6. Teste de cenário completo local

Automatize uma suíte E2E.

Subir simultaneamente:

```text
demo-a
demo-b
demo-a-issue-1
demo-a-issue-2
```

Cada um com:

```text
web: 3000
api: 8000
postgres: 5432
redis: 6379
```

Validar:

- todas as webs;
- todas as APIs;
- hostnames únicos;
- sem host port de web/API quando gateway é usado;
- nenhum conflito;
- Postgres independentes;
- Redis independentes;
- volumes independentes;
- redes privadas independentes.

---

## 7. Teste TCP

Abrir bridges para os quatro Postgres simultaneamente.

Cada um deve receber porta loopback diferente.

Fazer conexão real e consulta simples.

Fazer o mesmo com Redis.

Fechar individualmente.

Garantir que os bancos continuam executando.

---

## 8. Teste de lifecycle

Validar:

### Restart do gateway

Aplicações continuam executando.

Depois do restart, Traefik redescobre as rotas.

### Down do gateway

Aplicações continuam executando.

### Up do gateway

Rotas retornam.

### Down de consumidor

Gateway permanece saudável.

### Worktree removido

Somente bridges órfãos gerenciados podem ser limpos.

---

## 9. Teste remoto

Quando houver ambiente/credenciais disponíveis:

- VPS privada;
- Tailscale;
- HTTP privado;
- túnel para Postgres;
- túnel para Redis;
- wildcard privado;
- TLS;
- public opt-in;
- public disable.

Quando não houver credenciais:

- validar configuração até o limite;
- fornecer checklist de smoke test;
- nunca afirmar que foi validado externamente.

---

## 10. Testes de exposição

Crie testes/regra de CI para impedir regressões óbvias.

Falhar se configuração padrão publicar:

- Docker socket;
- socket proxy;
- Traefik dashboard;
- PostgreSQL;
- MySQL;
- Redis;
- MongoDB;

em `0.0.0.0`.

O perfil público deve continuar expondo apenas o necessário.

---

## 11. CLI

Revise consistência.

Objetivo aproximado:

```text
portta bootstrap
portta up
portta down
portta status
portta doctor
portta urls

portta analyze
portta init

portta services

portta access open
portta access list
portta access close

portta db open
portta db psql
portta redis open
portta redis cli

portta remote bootstrap
portta remote access

portta public enable
portta public disable

portta dns status
portta update
```

Não mantenha comandos redundantes sem valor.

Mensagens devem ser curtas e claras.

Suportar `--help`.

Considere `--json` para automação.

---

## 12. Doctor

Faça do `doctor` uma das melhores ferramentas do projeto.

Ele deve diagnosticar:

- versão;
- runtime;
- Compose;
- rede;
- Traefik;
- Docker provider;
- Tailscale;
- DNS;
- TLS;
- binds;
- rotas;
- services;
- bridges;
- conflitos;
- segurança básica;
- configuração;
- atualizações.

Deve sugerir correções sem executá-las destrutivamente.

---

## 13. Install/bootstrap

Revise experiência numa máquina limpa.

Ideal:

```bash
git clone git@github.com:fabioassuncao/portta.git
cd portta
cp .env.example .env
./bin/portta bootstrap
./bin/portta up local
./bin/portta doctor
```

Evitar preparação manual longa.

Para VPS, fornecer caminho igualmente previsível.

---

## 14. Documentação final

Revise o README como entrada principal.

Estrutura sugerida:

1. What/Why;
2. arquitetura;
3. requisitos;
4. quick start local;
5. VPS;
6. integrar um projeto;
7. paralelismo/worktrees;
8. URLs HTTP;
9. bancos e Redis;
10. Tailscale;
11. acesso público;
12. TLS;
13. comandos;
14. segurança;
15. troubleshooting;
16. arquitetura/ADRs.

Remover documentação duplicada e contraditória.

---

## 15. Guia mínimo para projetos consumidores

Garanta template curto, por exemplo:

`templates/project/PORTTA.md`

Deve explicar somente:

- como integrar overlay;
- namespace;
- como subir;
- URLs;
- como acessar banco;
- como acessar Redis;
- como trabalhar em paralelo.

Não transformar cada projeto consumidor em cópia da documentação central.

---

## 16. Agent guidelines

Revise o documento para agentes.

Ele deve ser adequado para uso em qualquer repositório.

Regras essenciais:

- preserve execuções paralelas;
- não mate containers alheios;
- não altere portas internas;
- não destrua volumes;
- use namespace;
- use gateway para HTTP;
- use bridge/túnel para TCP;
- VPN para serviços remotos sensíveis;
- `doctor` antes de improvisar infraestrutura.

---

## 17. Performance

Meça overhead básico:

- memória do Traefik;
- socket proxy;
- Tailscale;
- forwarder parado/ativo;
- tempo de bootstrap;
- tempo de discovery.

Não otimize prematuramente, mas elimine containers permanentes desnecessários.

Bridges temporários não devem permanecer sem motivo.

---

## 18. Compatibilidade

Documente matriz:

- macOS + OrbStack;
- macOS + Docker Desktop;
- Ubuntu/Debian + Docker Engine;
- arquitetura ARM64/AMD64 quando suportada.

Não alegar suporte não testado.

---

## 19. CI final

CI deve incluir, quando possível:

- shell lint;
- Compose validation;
- unit tests;
- integration tests;
- E2E local;
- security checks;
- secret scan;
- image/config checks.

Manter execução razoável.

---

## 20. Versionamento e release

Defina SemVer.

Prepare `CHANGELOG.md`.

Crie uma versão inicial somente quando a suíte estiver saudável.

Sugestão:

`v0.1.0`

se o projeto ainda for experimental.

Crie GitHub Release com:

- objetivo;
- quick start;
- capacidades;
- limitações;
- segurança;
- compatibilidade.

Não chamar de estável/production-ready se ainda não for.

---

## 21. Revisão final

Antes do release:

```text
git status
git diff
git log
```

Executar toda validação.

Verificar README e links.

Verificar ausência de secrets.

Confirmar que o repositório continua genérico.

Push para `origin/main`.

Criar tag/release somente depois de tudo aprovado pelos testes.

---

## Critério final

O projeto está pronto para sua primeira release quando uma pessoa pode:

1. instalar o Portta uma vez;
2. manter seus projetos onde já estão;
3. adaptar cada projeto com mudança mínima;
4. rodar diversos projetos simultaneamente;
5. rodar vários worktrees do mesmo projeto;
6. usar as mesmas portas internas;
7. acessar web/API por hostname;
8. acessar múltiplos bancos locais sem conflito;
9. acessar bancos da VPS pela VPN;
10. habilitar domínio público wildcard quando realmente quiser;
11. desligar o gateway sem derrubar as aplicações;
12. operar tudo com documentação e comandos previsíveis.
