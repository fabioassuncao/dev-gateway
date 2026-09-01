# Prompt 02 — macOS, VPS, Tailscale, DNS wildcard e TLS

Continue no repositório `fabioassuncao/portta`.

Leia primeiro a implementação, ADRs e testes existentes.

Implemente agora os perfis portáveis de execução local e remota.

Mantenha o princípio central:

> O Portta é instalado uma vez no host e permanece completamente desacoplado dos projetos consumidores.

Nenhum projeto deve ser movido para dentro deste repositório.

---

## 1. Perfis que devem existir

Projete perfis explícitos:

1. `local`
2. `remote-private`
3. `remote-public`

Pode usar Compose overlays/profiles se essa for a abordagem mais limpa.

Evite duplicação grande entre arquivos.

---

# Parte A — macOS

## 2. Runtime local

Suporte oficialmente:

1. OrbStack como experiência recomendada no Mac;
2. Docker Desktop ou runtime Docker compatível como alternativa.

O Portta não pode exigir API proprietária do OrbStack para funcionar.

Recursos do OrbStack podem ser usados como otimização opcional.

---

## 3. DNS local

Use `.localhost` como padrão local quando tecnicamente adequado.

Exemplos:

- `base-empresarial-web.localhost`
- `base-empresarial-api.localhost`
- `issue-flow-web.localhost`

Objetivo:

- nenhuma edição manual de `/etc/hosts`;
- nenhum dnsmasq obrigatório;
- nenhum DNS daemon obrigatório apenas para desenvolvimento local.

Se houver limitação real, documente.

---

## 4. HTTPS local

HTTP local deve funcionar sem configuração adicional.

Ofereça HTTPS local opcional.

Pesquise a abordagem atual mais segura para certificados locais.

Se usar uma CA local:

- automatize geração;
- mantenha arquivos do Portta em diretório adequado;
- nunca commite chaves;
- documente a instalação da CA no Keychain;
- peça autorização para qualquer operação privilegiada;
- forneça forma clara de remover a CA.

Se `mkcert` ou ferramenta semelhante for útil, prefira executá-la de forma containerizada quando possível, lembrando que confiar a CA no sistema operacional é uma operação do host.

Não torne HTTPS local requisito para usar o gateway.

---

# Parte B — VPS Ubuntu privado

## 5. Objetivo

O mesmo Portta deve executar em uma VPS Ubuntu.

No modo privado:

- projetos ficam inacessíveis pela Internet pública;
- usuário acessa pela VPN/Tailscale;
- somente infraestrutura necessária é exposta;
- bancos e serviços internos permanecem privados.

Arquitetura desejada:

```text
Mac/cliente
   |
Tailscale
   |
VPS
   |
Traefik
   |
portta network
   |
serviços HTTP dos projetos
```

---

## 6. Tailscale container-first

Priorize Tailscale em container.

Valide documentação oficial atual sobre:

- imagem Docker oficial;
- versão estável;
- `TS_STATE_DIR`;
- `TS_AUTHKEY`;
- `TS_AUTH_ONCE`;
- OAuth/client credentials quando adequado;
- tags;
- ACL/grants;
- `TS_USERSPACE`;
- kernel networking;
- `/dev/net/tun`;
- healthchecks;
- `TS_SERVE_CONFIG`;
- Tailscale Services.

Fixe versão quando possível.

Persistir a identidade do node entre restarts.

Nunca guardar auth keys no Git.

---

## 7. Arquitetura do Tailscale

Analise duas opções:

### A. Tailscale containerizado junto ao Portta

Preferência inicial por portabilidade.

### B. Tailscale instalado no host

Manter como alternativa documentada caso exista vantagem técnica concreta para:

- subnet routing;
- SSH;
- firewall;
- desempenho;
- acesso a recursos do host.

Escolha um padrão e registre ADR.

Não force containerização quando isso tornar o sistema objetivamente mais frágil, mas justifique qualquer dependência host-native.

---

## 8. Domínio privado

Suporte opcional a um namespace privado configurável:

`*.vpn.dev.example.com`

Exemplos:

- `base-empresarial-web.vpn.dev.example.com`
- `base-eleicoes-api.vpn.dev.example.com`

Não hardcode domínio pessoal.

Analise estratégias:

### Estratégia simples

Wildcard DNS apontando para o IP Tailscale da VPS, quando o provedor DNS e o modelo de acesso permitirem.

### Estratégia split-DNS

CoreDNS ou solução equivalente em container, integrado ao Tailscale.

Escolha a opção padrão mais simples e reproduzível.

Documente a alternativa.

---

# Parte C — acesso público opcional

## 9. Domínio wildcard público

Implemente suporte opcional:

`*.dev.example.com`

Exemplos:

- `base-empresarial-web.dev.example.com`
- `base-empresarial-api.dev.example.com`
- `issue-flow-web.dev.example.com`

O modo público deve estar DESABILITADO por padrão.

Exposição pública deve ser intencional e auditável.

---

## 10. Comandos públicos

Crie interface equivalente a:

```bash
./bin/portta public status
./bin/portta public enable
./bin/portta public disable
```

Antes de habilitar:

- mostrar domínio;
- interfaces;
- portas;
- IP de destino;
- componentes que ficarão expostos.

Nunca abrir banco ou Redis publicamente.

---

## 11. Cloudflare DNS

Crie integração opcional de referência com Cloudflare.

Não torne Cloudflare requisito arquitetural.

Usar API Token com menor privilégio possível.

Nunca usar Global API Key como recomendação.

Automatizar, quando possível:

```bash
./bin/portta dns check
./bin/portta dns setup
./bin/portta dns status
```

Suportar wildcard.

Não registrar tokens em logs.

---

## 12. TLS remoto

Implementar HTTPS real para acesso remoto.

Para wildcard:

- usar ACME DNS-01;
- persistir estado ACME;
- proteger permissões;
- suportar renovação;
- healthcheck/status;
- não depender de HTTP-01 para wildcard.

Configuração deve permitir DNS provider diferente no futuro.

Cloudflare pode ser provider de referência.

---

## 13. Segurança

No modo público:

- dashboard Traefik não pode ficar público;
- nenhuma Docker API pode ficar pública;
- socket proxy não pode ficar público;
- somente 80/443 quando realmente necessários;
- serviços consumidores precisam declarar explicitamente que são públicos, caso o modelo diferencie private/public;
- considerar middleware de autenticação para ambientes de desenvolvimento.

Implemente pelo menos um mecanismo opcional simples de proteção, mas não acople o gateway a um único IdP.

---

## 14. Firewall

Documente configurações mínimas para Ubuntu.

Não alterar UFW silenciosamente.

Crie diagnóstico que mostre:

- interfaces;
- binds;
- IP público;
- IP Tailscale;
- portas abertas;
- listeners;
- containers relevantes.

Comando sugerido:

```bash
./bin/portta network status
```

---

## 15. Bootstrap remoto

Implemente uma maneira segura de preparar uma VPS.

Exemplo conceitual:

```bash
./bin/portta remote bootstrap user@host
```

ou interface melhor.

Deve ser capaz de:

1. detectar distribuição/arquitetura;
2. verificar Docker/Compose;
3. oferecer instalação quando explicitamente solicitado;
4. clonar ou atualizar `portta`;
5. criar rede global;
6. preparar estado;
7. configurar perfil solicitado;
8. iniciar;
9. executar doctor;
10. mostrar URLs.

Não sobrescrever `.env` existente.

Não transportar secrets implicitamente.

Não usar `curl | sudo bash` como única estratégia.

---

## 16. SSH

Como macOS e Linux possuem SSH amplamente disponível, ele pode ser utilizado para operações remotas.

Ainda assim:

- encapsule automações no CLI;
- permita usar Tailscale SSH quando configurado;
- permita SSH tradicional;
- documente chaves e host verification;
- nunca usar `StrictHostKeyChecking=no` como padrão.

Um toolbox container com cliente SSH pode ser fornecido quando útil.

---

## 17. Atualização

Implemente:

```bash
./bin/portta update
```

O processo deve:

- verificar releases/versões;
- validar Compose antes;
- preservar estado;
- preservar ACME;
- preservar Tailscale;
- atualizar somente componentes necessários;
- executar healthcheck;
- permitir rollback/documentar recuperação.

Não usar `latest` como estratégia de atualização.

---

## 18. Observabilidade

`status` deve mostrar de forma compacta:

- perfil;
- versão;
- Traefik;
- Tailscale;
- domínio local;
- domínio privado;
- domínio público;
- TLS;
- número de routers/services descobertos;
- estado da rede.

`doctor` deve fazer diagnóstico mais profundo.

---

## 19. Documentação obrigatória

Atualize/crie:

```text
docs/local-development.md
docs/remote-development.md
docs/tailscale.md
docs/dns-and-tls.md
docs/public-access.md
docs/cloudflare.md
docs/security.md
docs/remote-bootstrap.md
docs/troubleshooting.md
```

Explique passo a passo:

### Mac

- instalação/uso com OrbStack;
- alternativa Docker Desktop;
- bootstrap;
- start;
- DNS local;
- HTTPS opcional;
- troubleshooting.

### VPS

- pré-requisitos;
- Docker;
- Tailscale;
- secrets;
- DNS;
- TLS;
- VPN-only;
- public opt-in;
- firewall;
- atualização;
- backup dos estados do gateway.

---

## 20. Testes

Teste automaticamente tudo que não exigir credenciais reais.

Para integrações externas:

- validar configuração;
- mockar apenas onde fizer sentido;
- fornecer smoke test documentado;
- nunca marcar como testado algo que não foi executado.

Teste especialmente que o perfil privado NÃO publica serviços em interface pública.

---

## 21. Git

Use Conventional Commits.

Revise diff, testes e documentação.

Envie para `origin/main` somente depois das validações.

---

## Critério de conclusão

Ao fim desta etapa, uma instalação do Portta deve poder ser usada:

- no Mac local;
- numa VPS acessada apenas por Tailscale;
- numa VPS com wildcard público opcional;
- com TLS automatizado;
- sem incorporar nenhum projeto consumidor ao repositório.
