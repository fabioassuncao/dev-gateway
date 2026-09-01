Quero implementar no **Portta** um fluxo oficial de instalação e atualização simples, amigável e previsível, inspirado em ferramentas como **Dokploy, Coolify e similares**.

A ideia principal é que o usuário consiga instalar ou atualizar o Portta executando um único comando, sem precisar clonar ou manter uma cópia local do repositório.

O repositório continuará sendo a fonte do código, mas **não deve ser necessário para executar o Portta em uma instalação normal**.

## Objetivo principal

Quero chegar a uma experiência próxima de:

```bash
curl -fsSL <URL_DO_PORTTA>/install.sh | bash
```

Esse mesmo fluxo deve servir tanto para:

* primeira instalação;
* atualização de uma instalação existente;
* recuperação ou reconciliação de configuração;
* preparação de uma VPS;
* preparação de uma máquina local de desenvolvimento.

A instalação deve ser baseada principalmente em **imagens Docker previamente compiladas e publicadas**, evitando builds locais e evitando que uma instalação fique presa a uma versão antiga do repositório clonado.

---

## 1. Analise soluções existentes antes da implementação

Antes de implementar, analise como projetos como:

* Dokploy;
* Coolify;
* e outras ferramentas semelhantes;

tratam:

* instalação via Shell;
* atualização;
* diretório de dados;
* Docker Compose;
* volumes;
* persistência;
* variáveis de ambiente;
* detecção do ambiente;
* exposição do painel;
* autenticação;
* VPN;
* idempotência;
* segurança;
* recuperação de erros;
* atualização de imagens;
* experiência do usuário.

Use essas soluções apenas como referência arquitetural.

A implementação deve respeitar a arquitetura atual do Portta e evitar complexidade desnecessária.

---

## 2. Não clonar o repositório durante uma instalação normal

O fluxo padrão **não deve clonar todo o repositório do Portta**.

A instalação deve utilizar:

* imagens Docker já buildadas;
* releases públicas;
* arquivos mínimos necessários para execução;
* configurações geradas pelo próprio instalador.

As imagens devem vir do registro público utilizado pelo projeto, dentro do namespace:

```text
fabioassuncao/portta
```

ou outros componentes relacionados dentro de:

```text
fabioassuncao/*
```

quando fizer sentido para a arquitetura.

O instalador deve baixar somente o que for realmente necessário para executar a aplicação.

Exemplos:

```text
compose.yaml
.env
configurações do proxy
configurações geradas
metadados da instalação
scripts auxiliares mínimos
```

Não mantenha código-fonte da aplicação no diretório de execução se ele não for necessário.

---

## 3. Diretório de trabalho do Portta

Durante a instalação, o usuário deve poder escolher onde os arquivos persistentes do Portta ficarão armazenados.

O instalador deve perguntar algo equivalente a:

```text
Onde você deseja armazenar os dados e configurações do Portta?

[Enter para utilizar o diretório padrão]
```

O usuário poderá informar um diretório existente, por exemplo:

```text
/home/fabio/workspace
/opt/portta
/srv/portta
/root/projects
```

Se nenhuma resposta for fornecida, utilize um diretório padrão seguro e previsível.

Defina o melhor padrão de acordo com o ambiente e sistema operacional.

Exemplos possíveis:

```text
~/.portta
/opt/portta
/var/lib/portta
```

Avalie tecnicamente qual é o mais adequado.

O mais importante é que exista um diretório central conhecido pelo Portta contendo tudo o que precisar ser mantido localmente.

---

## 4. Estrutura do diretório

Defina uma estrutura organizada e previsível.

Algo conceitualmente semelhante a:

```text
<PORTTA_HOME>/
├── config/
├── data/
├── logs/
├── runtime/
├── compose/
└── .env
```

Essa estrutura não precisa ser exatamente essa.

Primeiro analise a arquitetura atual e defina uma organização adequada.

O diretório escolhido deve permitir:

* manutenção simples;
* backup;
* restauração;
* atualização;
* migração para outra máquina;
* inspeção manual;
* troubleshooting;
* remoção do Portta sem afetar outros projetos.

---

## 5. Estratégia de persistência e volumes Docker

Analise cuidadosamente como devem ser tratados os dados persistentes.

Quero uma decisão técnica fundamentada entre bind mounts, named volumes do Docker ou uma estratégia híbrida.

Avalie:

* portabilidade;
* backup;
* restore;
* upgrades;
* permissões;
* segurança;
* desempenho;
* manutenção;
* compatibilidade entre Linux/macOS;
* facilidade de troubleshooting;
* risco de remoção acidental;
* facilidade de migração entre máquinas.

O objetivo é que a instalação seja **fácil de manter, atualizar, controlar e transportar**.

Documente brevemente a decisão adotada.

---

## 6. Imagens Docker como fonte de execução

Todos os componentes que fazem parte do runtime normal do Portta devem ser distribuídos como imagens Docker previamente buildadas.

Isso inclui, quando aplicável:

* painel web;
* API;
* Traefik/reverse proxy;
* serviços internos;
* workers;
* componentes auxiliares.

A instalação normal não deve executar builds.

O fluxo deverá basicamente ser:

```text
detectar ambiente
↓
preparar diretórios
↓
baixar configurações mínimas
↓
baixar imagens
↓
configurar ambiente
↓
configurar acesso ao painel
↓
executar Docker Compose
↓
verificar health checks
↓
apresentar resultado
```

---

## 7. Atualização

Executar novamente o instalador em uma máquina que já possui Portta deve atualizar a instalação existente.

O fluxo deve ser idempotente.

Conceitualmente:

```text
detectar instalação existente
↓
preservar dados e configurações
↓
baixar configurações compatíveis
↓
docker compose pull
↓
aplicar migrations se necessário
↓
docker compose up -d
↓
validar health checks
```

Não destruir dados, credenciais, volumes ou preferências durante uma atualização normal.

---

## 8. Detecção automática do ambiente

O instalador deve pedir ao usuário **o mínimo possível de informações**.

Antes de perguntar qualquer coisa, tente descobrir automaticamente:

* sistema operacional;
* distribuição;
* arquitetura;
* usuário atual;
* HOME;
* hostname;
* IP local;
* IP público, quando necessário;
* interfaces de rede;
* disponibilidade de portas;
* Docker;
* Docker Compose;
* Git;
* Node.js;
* NPM;
* NPX;
* GitHub CLI;
* Tailscale.

Não peça hostname, IP, usuário ou outras informações que o próprio sistema possa detectar.

---

## 9. Detecção de Tailscale e VPN

O **Tailscale deve ser considerado a VPN padrão suportada pelo Portta para ambientes de desenvolvimento**.

Durante a instalação, verifique automaticamente:

```text
tailscale instalado?
serviço ativo?
máquina autenticada?
Tailnet disponível?
IP Tailscale disponível?
```

Sempre que possível, utilize comandos seguros e somente de leitura para obter essas informações.

Exemplo conceitual:

```text
Tailscale
✓ instalado
✓ conectado
✓ 100.x.x.x
```

ou:

```text
Tailscale
⚠ instalado, mas não conectado
```

ou:

```text
Tailscale
⚠ não encontrado
```

A ausência do Tailscale **não deve impedir a instalação do Portta**.

O instalador não deve iniciar automaticamente processos de autenticação ou alterar uma configuração existente do Tailscale sem solicitação explícita do usuário.

---

## 10. Como o painel do Portta será acessado

Durante a primeira instalação, o usuário deve escolher **como deseja acessar o painel administrativo do Portta**.

Devem existir pelo menos três possibilidades:

### 1. Acesso público

O painel poderá ser acessado diretamente pelo IP público da máquina através de uma porta publicada.

Exemplo conceitual:

```text
http://203.0.113.10:PORTA
```

Esse deve ser o **modo sugerido/padrão durante a instalação**, por ser o caminho mais simples para colocar rapidamente uma VPS de desenvolvimento em funcionamento.

### 2. Tailscale / VPN

Se o Tailscale estiver instalado e conectado, permita que o painel seja disponibilizado somente através da rede Tailscale.

Exemplo conceitual:

```text
http://100.x.x.x:PORTA
```

Nesse cenário, não é necessário publicar a porta do painel na interface pública da VPS.

### 3. Acesso local / túnel SSH

Permita também manter o painel restrito à própria máquina.

Nesse caso, o serviço deverá ficar ligado apenas a uma interface segura, preferencialmente:

```text
127.0.0.1
```

e o usuário poderá acessá-lo através de um túnel SSH.

Exemplo:

```bash
ssh -L 3000:127.0.0.1:<PORTA_DO_PORTTA> usuario@servidor
```

e então acessar:

```text
http://localhost:3000
```

O instalador deve mostrar a instrução correspondente ao final.

---

## 11. Fluxo de escolha do acesso ao painel

A experiência pode ser semelhante a:

```text
Como você deseja acessar o painel do Portta?

1. Público — IP do servidor + porta [padrão]
2. Tailscale — somente através da VPN
3. Local — somente localhost / túnel SSH

Escolha [1]:
```

Se o usuário simplesmente pressionar Enter, utilize:

```text
1. Público
```

Caso Tailscale não esteja disponível, informe isso de forma amigável.

Por exemplo:

```text
2. Tailscale — indisponível (Tailscale não conectado)
```

Não tente instalar ou autenticar automaticamente o Tailscale apenas para habilitar essa opção.

---

## 12. Autenticação obrigatória quando o painel for público

Se o usuário escolher disponibilizar o painel publicamente, **o painel não pode ficar exposto sem autenticação**.

Utilize o Traefik ou o mecanismo de reverse proxy já existente para aplicar uma camada de autenticação antes que a requisição chegue ao painel.

Inicialmente, uma solução simples como **Basic Auth via middleware do Traefik** é suficiente, caso seja compatível com a arquitetura atual.

Durante a instalação, solicite opcionalmente:

```text
Usuário do painel [admin]:
Senha do painel [gerar automaticamente]:
```

O usuário poderá informar suas próprias credenciais.

Se ele simplesmente pressionar Enter:

```text
username = admin
password = <senha forte gerada aleatoriamente>
```

A senha padrão **nunca deve ser uma senha fixa conhecida**, como:

```text
admin
password
portta
123456
```

Gere uma senha criptograficamente segura.

Ao final, apresente claramente:

```text
Painel público configurado

URL:
http://203.0.113.10:PORTA

Usuário:
admin

Senha:
<senha-gerada>
```

A senha deve ser exibida de maneira clara na primeira instalação para que o usuário possa armazená-la.

Não registre a senha em logs de instalação desnecessariamente.

Persista somente a representação necessária para autenticação, preferencialmente hash compatível com o mecanismo utilizado pelo Traefik, evitando armazenar senha em texto puro quando não houver necessidade.

---

## 13. Segurança do painel público

Mesmo sendo o modo padrão de instalação, o instalador deve informar claramente quando o painel estiver sendo exposto à internet.

Exemplo:

```text
⚠ O painel do Portta será acessível através do IP público deste servidor.
  A autenticação será obrigatória.
```

Se HTTPS ainda não estiver configurado e o acesso estiver acontecendo diretamente por IP + porta, informe também que as credenciais estarão protegidas por autenticação, mas a conexão poderá não possuir TLS.

Quando existir domínio e HTTPS disponíveis, prefira automaticamente HTTPS.

Não esconda do usuário essa diferença de segurança.

---

## 14. Alteração posterior da forma de acesso

A opção selecionada durante a instalação não deve ser permanente.

O usuário deverá conseguir posteriormente trocar entre:

```text
public
tailscale
local
```

através:

* do painel;
* da CLI `npx portta`;
* ou de ambos.

Exemplo conceitual:

```bash
npx portta config set panel.access public
npx portta config set panel.access tailscale
npx portta config set panel.access local
```

A implementação concreta deve seguir a arquitetura da API/configuração já existente.

---

## 15. O instalador configura somente o acesso ao painel

É importante separar dois conceitos:

### Acesso ao painel do Portta

É responsabilidade do instalador definir inicialmente se o painel ficará:

```text
público
Tailscale
local/túnel
```

### Exposição das aplicações gerenciadas pelo Portta

**Não é responsabilidade do instalador decidir isso.**

Cada projeto ou serviço poderá ter sua própria política de exposição, configurada posteriormente através do painel ou da CLI.

Uma aplicação poderá, por exemplo, ser:

```text
somente local
somente Tailscale
rede local
publicamente acessível
publicamente acessível com autenticação
publicamente acessível com domínio próprio
publicamente acessível através de domínio automático
```

Essa decisão pertence ao projeto/serviço e não à instalação global do Portta.

Não exponha automaticamente todas as aplicações simplesmente porque o painel foi configurado como público.

---

## 16. Diagnóstico do ambiente de desenvolvimento

Além do Portta, quero que o sistema apresente um diagnóstico útil da máquina.

Verifique:

```text
git
gh
docker
docker compose
node
npm
npx
tailscale
```

Para Git:

```bash
git config --global user.name
git config --global user.email
```

Para GitHub:

```bash
gh auth status
```

Separe claramente:

```text
requisitos obrigatórios
```

de:

```text
ferramentas recomendadas
```

A ausência de ferramentas opcionais não deve interromper a instalação.

---

## 17. Detectar agentes de desenvolvimento por IA

Como o Portta será frequentemente utilizado como ambiente de desenvolvimento assistido por agentes, tente identificar as principais CLIs disponíveis.

Verifique, quando possível:

* Claude Code;
* OpenAI Codex CLI;
* Cursor Agent / Cursor CLI;
* Antigravity;
* outras CLIs relevantes.

Tente identificar:

```text
instalado?
versão?
executável disponível?
autenticado?
pronto para utilização?
```

Isso deve ser somente diagnóstico.

Não instale, autentique ou modifique automaticamente essas ferramentas.

---

## 18. CLI oficial do Portta

A CLI deve ser utilizável preferencialmente através de:

```bash
npx portta
```

Ela deve funcionar como cliente da instância instalada do Portta.

Sempre que possível, as operações devem acontecer através da API oficial.

Exemplos conceituais:

```bash
npx portta status
npx portta doctor
npx portta config
npx portta projects
npx portta services
```

A CLI poderá também alterar posteriormente configurações como:

```text
acesso ao painel
porta
domínio
autenticação
configurações de rede
```

sem precisar reinstalar o sistema.

---

## 19. Compatibilidade entre CLI e servidor

É essencial que:

```text
npx portta
```

saiba com qual versão do Portta está se comunicando.

A API deve expor versão do servidor e versão da API.

A CLI deve identificar incompatibilidades e orientar a atualização quando necessário.

---

## 20. Domínio base e exposição pública

Permita configurar opcionalmente um domínio base para os serviços.

Exemplo:

```text
fabioassuncao.dev
```

Aplicações poderiam posteriormente receber:

```text
app.fabioassuncao.dev
api.fabioassuncao.dev
mail.fabioassuncao.dev
projeto-x.fabioassuncao.dev
```

Essa configuração pertence ao mecanismo de publicação dos projetos e poderá ser realizada pelo painel ou CLI.

---

## 21. Domínio automático para VPS

Analise suporte a serviços como:

```text
sslip.io
nip.io
```

e alternativas equivalentes.

Quando o usuário quiser tornar uma aplicação pública sem possuir domínio, o Portta poderá gerar automaticamente um endereço baseado no IP da VPS.

Essa funcionalidade deverá ser configurável **por projeto/serviço**, e não obrigatoriamente durante a instalação inicial.

---

## 22. HTTPS

Quando possível, serviços públicos devem utilizar HTTPS automaticamente.

Considere:

```text
domínio próprio
domínio automático baseado em IP
```

Integre com ACME/Let's Encrypt através do proxy existente.

Quando TLS automático não puder ser configurado, informe claramente o motivo.

---

## 23. Experiência esperada do instalador

Um fluxo possível seria:

```text
Portta Installer

Environment

✓ Ubuntu 24.04
✓ amd64
✓ Docker
✓ Docker Compose
✓ IP público detectado
✓ Hostname detectado

VPN

✓ Tailscale instalado
✓ conectado
✓ 100.x.x.x

Portta Home

Onde deseja armazenar os dados?
[/opt/portta]:

Panel Access

Como deseja acessar o painel?

1. Público — IP + porta [padrão]
2. Tailscale — somente VPN
3. Local — localhost / túnel SSH

Escolha [1]:

Public Authentication

Usuário [admin]:
Senha [gerar automaticamente]:

Installing Portta

✓ Diretórios preparados
✓ Configurações geradas
✓ Imagens baixadas
✓ Containers iniciados
✓ Proxy configurado
✓ Autenticação configurada
✓ Health checks concluídos

Portta está pronto.

Painel:
http://203.0.113.10:PORTA

Usuário:
admin

Senha:
<senha-gerada>

CLI:
npx portta

Development Environment

✓ Git
✓ GitHub CLI
✓ GitHub autenticado
✓ Node.js
✓ NPX
✓ Tailscale

AI Development Agents

✓ Claude Code — autenticado
✓ Codex — autenticado
⚠ Cursor Agent — não encontrado
⚠ Antigravity — não encontrado
```

Se o usuário escolher Tailscale, o resultado deverá mostrar o endereço Tailscale.

Se escolher acesso local, o resultado deverá mostrar claramente o comando de túnel SSH necessário.

---

## 24. Modo não interativo

O instalador também deve funcionar em automações.

Projete suporte futuro ou imediato, conforme fizer sentido, para parâmetros equivalentes a:

```text
--yes
--non-interactive
--install-dir
--panel-access
--panel-port
--panel-user
--domain
--version
```

Credenciais sensíveis não devem ser incentivadas como argumentos de linha de comando quando isso puder expô-las no histórico do shell ou na lista de processos.

Prefira variáveis de ambiente, arquivos temporários seguros ou geração automática para senhas.

---

## 25. Operações futuras

Estruture o sistema pensando em:

```text
install
update
doctor
status
repair
uninstall
backup
restore
```

Priorize especialmente:

```bash
npx portta doctor
```

para concentrar diagnóstico de:

* Docker;
* rede;
* Tailscale;
* Git;
* GitHub;
* Node;
* agentes de IA;
* Portta;
* containers;
* proxy;
* acesso ao painel.

---

## 26. Testes obrigatórios

Valide pelo menos:

1. máquina limpa;
2. instalação padrão;
3. instalação em diretório personalizado;
4. atualização;
5. reinstalação;
6. preservação de dados;
7. painel público;
8. painel público com credenciais informadas;
9. painel público com senha gerada;
10. painel via Tailscale;
11. Tailscale ausente;
12. Tailscale instalado mas desconectado;
13. painel somente localhost;
14. acesso através de túnel SSH;
15. mudança posterior entre public/Tailscale/local;
16. health checks;
17. atualização das imagens;
18. `npx portta`;
19. `npx portta doctor`;
20. máquina sem agentes de IA;
21. máquina com Claude Code/Codex/etc.;
22. modo não interativo;
23. execução repetida do instalador.

Garanta especialmente que:

```text
painel público ≠ aplicações públicas
```

A configuração de acesso do painel não deve modificar automaticamente a exposição dos projetos.

---

## Resultado esperado

Quero que uma VPS ou máquina local possa passar rapidamente de:

```text
máquina preparada
```

para:

```text
Portta instalado
↓
imagens Docker atualizadas
↓
dados persistentes organizados
↓
containers executando
↓
proxy configurado
↓
Tailscale detectado quando existir
↓
acesso ao painel configurado
↓
autenticação configurada quando pública
↓
painel acessível
↓
CLI disponível
↓
ambiente diagnosticado
↓
pronto para desenvolvimento
```

utilizando basicamente:

```bash
curl -fsSL <URL_DO_PORTTA>/install.sh | bash
```

Executar esse mesmo comando novamente deve ser também a maneira simples e suportada de atualizar o Portta.

A prioridade é criar um fluxo **real, funcional, idempotente, seguro e simples**, sem overengineering.

Primeiro analise a arquitetura existente e as referências de Dokploy/Coolify. Depois tome e documente brevemente as decisões sobre persistência, diretórios, rede, autenticação e atualização. Em seguida, implemente o fluxo completo e teste os cenários descritos.


Faça os testes completos da instalação e atualização do **Portta** utilizando ambientes reais, respeitando rigorosamente as regras de segurança abaixo.

## 1. Testes em servidor descartável na Hetzner

Para validar o fluxo do início ao fim, utilize o **Hetzner Cloud CLI (`hcloud`)** para criar um novo servidor exclusivamente para testes.

O contexto correto já está configurado:

```text
➜  ~ hcloud context list
ACTIVE   NAME
         Codions
         Powertech
         Cena2
         Conex
         JornalPequeno
         BrasilDataHub
*        Testes
```

### Regra absoluta

Utilize **exclusivamente o contexto `Testes`**.

Antes de qualquer operação, confirme:

```bash
hcloud context active
```

O resultado deve ser:

```text
Testes
```

Se não for exatamente `Testes`, **não execute nenhuma operação na Hetzner**.

Não altere o contexto automaticamente para outro ambiente.

### Contextos proibidos

Não realize nenhuma operação nos contextos:

```text
Codions
Powertech
Cena2
Conex
JornalPequeno
BrasilDataHub
```

Isso inclui:

* criar servidores;
* alterar servidores;
* reiniciar;
* desligar;
* excluir;
* alterar redes;
* alterar firewalls;
* alterar volumes;
* alterar IPs;
* alterar SSH keys;
* alterar load balancers;
* alterar DNS;
* ou qualquer outro recurso.

Esses ambientes estão completamente fora do escopo.

## 2. Permissões no contexto `Testes`

Dentro do contexto `Testes`, sua permissão é deliberadamente limitada.

Você pode:

* consultar os recursos necessários para compreender o ambiente;
* criar **um novo servidor descartável** para os testes;
* configurar esse servidor;
* reiniciar o servidor criado por você quando necessário;
* instalar dependências nele;
* executar o instalador do Portta;
* executar os ciclos de instalação, atualização e diagnóstico;
* realizar todos os testes necessários dentro desse novo servidor.

Você **não deve modificar servidores existentes**, mesmo dentro do contexto `Testes`, salvo se forem recursos criados por você especificamente nesta execução.

Principalmente:

**não exclua o servidor criado ao final dos testes.**

Ele deve permanecer ativo e acessível para que eu possa posteriormente executar testes manuais.

## 3. Servidor descartável

Crie um servidor novo e claramente identificável como ambiente de teste do Portta.

Utilize uma configuração suficiente para executar:

* Docker;
* Docker Compose;
* Portta;
* Traefik;
* painel;
* API;
* serviços auxiliares;
* testes de rede;
* testes de instalação e atualização.

Não superdimensione o servidor desnecessariamente.

Utilize uma distribuição Linux oficialmente suportada pelo instalador, preferencialmente Ubuntu LTS se essa for a plataforma principal definida pelo projeto.

O nome do servidor deve deixar evidente que se trata de um recurso de teste temporário do Portta.

## 4. Teste completo em máquina limpa

Esse servidor deve representar o cenário de uma máquina nova.

Utilize-o para validar o ciclo completo:

```text
servidor limpo
↓
download do installer
↓
detecção do ambiente
↓
instalação das dependências necessárias
↓
preparação do PORTTA_HOME
↓
download das imagens Docker
↓
configuração
↓
Docker Compose
↓
Portta iniciado
↓
proxy configurado
↓
painel acessível
↓
health checks
↓
CLI funcionando
```

Teste especialmente o fluxo oficial:

```bash
curl -fsSL <URL_DO_INSTALLER_DO_PORTTA> | bash
```

O objetivo é garantir que um usuário realmente consiga utilizar esse comando em uma VPS limpa.

## 5. Testar atualização

Depois da primeira instalação, execute novamente o fluxo para validar atualização e idempotência.

Garanta que:

* o instalador reconheça uma instalação existente;
* configurações sejam preservadas;
* credenciais sejam preservadas;
* volumes e dados sejam preservados;
* novas imagens sejam baixadas quando necessário;
* `docker compose pull` funcione corretamente;
* containers sejam recriados somente quando necessário;
* migrations sejam executadas corretamente, quando existirem;
* nenhum dado persistente seja perdido.

Executar novamente:

```bash
curl -fsSL <URL_DO_INSTALLER_DO_PORTTA> | bash
```

deve ser um fluxo suportado para atualizar o Portta.

## 6. Testar os modos de acesso ao painel

No servidor descartável, valide também os modos de acesso implementados.

### Público

Teste:

```text
IP público + porta
```

e valide a autenticação configurada no proxy.

Confirme que o painel **nunca fique público sem autenticação**.

### Tailscale

Caso seja apropriado para o teste e esteja disponível, valide a detecção e o comportamento relacionado ao Tailscale.

### Local / túnel SSH

Valide também que o painel possa ficar restrito a:

```text
127.0.0.1
```

e ser acessado através de túnel SSH.

## 7. Testar a CLI

Valide:

```bash
npx portta
npx portta status
npx portta doctor
```

e os demais comandos já implementados.

Confirme que a CLI:

* encontra a instância;
* consegue se comunicar com a API;
* identifica a versão do servidor;
* trata incompatibilidades de versão;
* funciona em uma instalação real.

## 8. Diagnóstico

Execute e valide o diagnóstico das ferramentas disponíveis.

Inclua, quando aplicável:

```text
Git
GitHub CLI
Docker
Docker Compose
Node.js
NPM
NPX
Tailscale
Claude Code
Codex
Cursor Agent
Antigravity
```

Ferramentas opcionais ausentes não devem causar falha na instalação.

## 9. Não excluir o servidor de teste

Ao concluir todos os testes automatizados:

**não destrua o servidor.**

Não execute:

```bash
hcloud server delete ...
```

Nem qualquer operação equivalente.

Deixe o servidor:

* ligado;
* com o Portta instalado;
* com os containers funcionando;
* com o painel acessível;
* pronto para meus testes manuais.

Ao final, informe:

* nome do servidor;
* IP público;
* sistema operacional;
* modo de acesso configurado;
* URL do painel;
* usuário do painel, quando aplicável;
* onde localizar a senha gerada, sem expô-la desnecessariamente em logs;
* `PORTTA_HOME`;
* versão instalada;
* resultado dos health checks;
* qualquer observação relevante.

---

# 10. Teste adicional no meu servidor real de desenvolvimento

Além do servidor descartável, existe um servidor real de desenvolvimento na **Netcup**.

Ele já está preparado para meu uso cotidiano e deve ser tratado com muito mais cautela.

O acesso está configurado no meu SSH config:

```bash
ssh g1351942l-vps
```

A autenticação SSH já funciona através da minha chave pública.

Esse servidor já possui configurações importantes de desenvolvimento, incluindo Git e ferramentas/agentes que utilizo no dia a dia.

Utilize-o para validar como o Portta se comporta em um **servidor real já configurado**, mas somente depois que o fluxo tiver sido validado com sucesso no servidor descartável.

## 11. Regra de segurança para o servidor da Netcup

O servidor `g1351942l-vps` **não é descartável**.

Não realize alterações invasivas ou destrutivas.

Antes de modificar qualquer coisa:

1. inspecione o estado atual;
2. identifique possíveis conflitos;
3. verifique Docker, redes, containers, volumes e portas existentes;
4. verifique os diretórios que já existem;
5. verifique se a alteração pode afetar ferramentas ou projetos existentes;
6. escolha a abordagem com menor impacto possível.

Não:

* remova containers existentes;
* remova imagens necessárias a outros projetos;
* execute `docker system prune`;
* remova volumes;
* altere configurações globais do Docker sem necessidade;
* altere SSH;
* altere Git global;
* altere credenciais;
* remova ferramentas;
* sobrescreva configurações existentes;
* altere firewall sem necessidade;
* altere Tailscale sem necessidade;
* altere serviços do sistema sem compreender o impacto.

Se existir conflito, preserve o ambiente atual e adapte o Portta.

## 12. Portta isolado no servidor real

A instalação do Portta na Netcup deve ficar isolada dentro do `PORTTA_HOME` definido para ele.

Não espalhe arquivos desnecessariamente pelo sistema.

Os componentes do Portta devem ser facilmente identificáveis e separáveis dos demais projetos.

Utilize nomes previsíveis para:

* containers;
* networks;
* volumes;
* arquivos;
* diretórios;
* configurações.

Isso deve permitir identificar claramente o que pertence ao Portta.

## 13. Ferramentas já configuradas

No servidor da Netcup, aproveite para validar o diagnóstico do ambiente real.

Verifique, sem modificar desnecessariamente:

* Git;
* configuração global do Git;
* GitHub CLI;
* autenticação do GitHub;
* Docker;
* Docker Compose;
* Node.js;
* NPM;
* NPX;
* Tailscale;
* Claude Code;
* Codex;
* demais agentes detectáveis.

Essas ferramentas já podem estar instaladas e autenticadas.

O Portta deve apenas detectar e reportar corretamente o estado delas.

Não refaça autenticações existentes.

## 14. Ordem obrigatória dos testes

Siga esta ordem:

```text
1. Analisar implementação atual
2. Executar testes locais disponíveis
3. Confirmar contexto hcloud = Testes
4. Criar novo servidor descartável
5. Testar instalação limpa
6. Corrigir problemas encontrados
7. Repetir instalação limpa quando necessário
8. Testar atualização
9. Testar idempotência
10. Testar painel
11. Testar proxy/autenticação
12. Testar CLI
13. Testar doctor/diagnóstico
14. Confirmar estabilidade
15. Somente então acessar g1351942l-vps
16. Inspecionar o servidor real
17. Instalar/configurar Portta de maneira não invasiva
18. Testar integração no ambiente real
19. Executar validações finais
20. Deixar ambos os ambientes disponíveis para testes manuais
```

Não utilize o servidor real da Netcup como ambiente para descobrir bugs básicos do instalador.

Esses problemas devem ser encontrados primeiro no servidor descartável.

## 15. Resultado esperado

Ao final quero ter:

### Hetzner — ambiente de teste

```text
novo servidor criado no contexto Testes
Portta instalado do zero
instalação validada
atualização validada
idempotência validada
painel funcionando
autenticação funcionando
CLI funcionando
health checks funcionando
servidor mantido ativo
```

### Netcup — ambiente real de desenvolvimento

```text
ambiente existente preservado
Portta instalado de maneira isolada
nenhuma configuração importante quebrada
ferramentas existentes corretamente detectadas
painel funcionando
CLI funcionando
ambiente pronto para uso real
```

## Regra final

Priorize sempre:

```text
segurança
↓
preservação dos ambientes existentes
↓
isolamento
↓
reprodutibilidade
↓
validação real
```

O servidor criado através do `hcloud` pode ser utilizado livremente para experimentar e corrigir o instalador, desde que permaneça restrito ao contexto **`Testes`**.

O servidor `g1351942l-vps`, por outro lado, deve ser tratado como **ambiente real e persistente**.

Em nenhuma hipótese utilize, modifique ou experimente nos demais contextos da Hetzner.
