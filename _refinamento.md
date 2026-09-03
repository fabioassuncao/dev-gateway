# Refatoração geral de UX/UI, identidade visual e experiência operacional do Portta

Quero que você faça uma **revisão ampla, criteriosa e executável da experiência do Portta**, seguida da implementação das melhorias necessárias.

Esta não é apenas uma tarefa de "embelezamento".

O objetivo é transformar o Portta em um **centro de controle de desenvolvimento realmente útil**, no qual eu consiga acompanhar projetos, ambientes, serviços, tarefas, agentes e recursos do host, tomar decisões rapidamente e executar ações diretamente pelo painel.

O Portta está evoluindo para ser meu ambiente integrado de desenvolvimento e operação de projetos. Eu posso estar trabalhando com diversos projetos simultaneamente, localmente ou remotamente, deixando agentes executando tarefas enquanto acompanho tudo pelo notebook, tablet ou outro dispositivo.

A interface atual funciona, mas ainda parece:

- excessivamente genérica;
- visualmente rudimentar;
- pouco diferenciada;
- pobre em hierarquia visual;
- com algumas informações importantes distantes ou escondidas;
- com poucas ações contextuais;
- com visualizações do tipo "lista" pouco úteis;
- com áreas que parecem apenas agrupamentos de componentes, e não um produto coeso.

A implementação precisa melhorar **funcionalidade + ergonomia + consistência + identidade visual**, sem transformar o projeto em algo visualmente extravagante.

---

# 1. Objetivo principal

Ao final desta implementação, quero que o Portta pareça e funcione como um produto maduro.

A experiência deve se aproximar conceitualmente de ferramentas como:

- Linear;
- Jira;
- GitHub;
- Notion;
- ClickUp;
- Railway;
- Vercel;
- Coolify;
- Dokploy;

não para copiá-las visualmente, mas para adotar princípios que essas ferramentas executam bem:

- alta densidade de informação sem poluição;
- hierarquia visual clara;
- ações próximas do contexto em que são necessárias;
- estados visuais consistentes;
- tabelas realmente úteis;
- menus contextuais;
- feedback imediato;
- pouca fricção;
- navegação previsível;
- boa experiência em desktop e tablet.

A interface deve continuar relativamente sóbria e compacta.

Evite transformar o Portta em dashboard de marketing, interface cheia de cards gigantes, gradientes desnecessários ou gráficos decorativos sem utilidade.

---

# 2. Antes de implementar

Antes de alterar código:

1. Analise a estrutura atual da aplicação.
2. Identifique:
   - design system existente;
   - componentes compartilhados;
   - componentes duplicados;
   - tokens de cores;
   - tipografia;
   - espaçamentos;
   - bordas;
   - badges;
   - tabelas;
   - menus;
   - dropdowns;
   - modais;
   - tooltips;
   - componentes de status;
   - componentes de métricas;
   - componentes de projeto;
   - componentes de tarefas.
3. Analise todas as telas relacionadas ao escopo.
4. Verifique quais padrões já existem e podem ser consolidados em vez de substituídos.
5. Evite criar soluções específicas isoladas quando um componente compartilhado fizer mais sentido.
6. Identifique inconsistências visuais entre páginas.
7. Identifique elementos que existem, mas estão mal posicionados ou com baixa relevância visual.
8. Identifique informações importantes que hoje exigem navegação excessiva.

Não faça uma reconstrução completa do frontend.

Faça uma **evolução do que existe**.

---

# 3. Criar uma identidade visual consistente para o Portta

Atualmente a aplicação parece demasiadamente genérica.

Quero uma identidade visual reconhecível, porém discreta.

Defina ou refine um sistema consistente para:

- cores;
- background;
- superfícies;
- cards;
- tabelas;
- bordas;
- radius;
- shadows;
- estados de hover;
- estados ativos;
- estados selecionados;
- estados de foco;
- tipografia;
- pesos tipográficos;
- espaçamentos;
- ícones;
- badges;
- chips;
- botões;
- inputs;
- dropdowns;
- menus contextuais;
- tooltips;
- alerts;
- empty states;
- skeletons/loading;
- erros;
- success states.

Não quero simplesmente "colocar mais cor".

Quero que as cores tenham função semântica.

Exemplo:

- neutro → informações estruturais;
- azul → ação/estado ativo;
- verde → saudável/concluído/executando;
- amarelo/âmbar → atenção;
- vermelho → erro/bloqueio/ação destrutiva;
- violeta ou outra cor secundária → estados específicos quando necessário.

A paleta precisa funcionar em todos os contextos previstos pela aplicação.

Se houver dark mode, a mesma lógica precisa funcionar adequadamente nele.

---

# 4. Hierarquia visual

Melhore a hierarquia de informação.

Cada tela deve deixar claro:

1. onde estou;
2. o que estou vendo;
3. o que está acontecendo;
4. o que precisa da minha atenção;
5. quais ações posso executar.

Evite utilizar o mesmo peso visual para tudo.

Informações primárias, secundárias e auxiliares precisam ser visualmente distintas.

---

# 5. Sidebar

Analise a sidebar existente.

Ela não precisa ser radicalmente refeita, porém deve fazer parte da identidade do produto.

Melhore quando necessário:

- spacing;
- estados ativos;
- agrupamentos;
- legibilidade;
- identificação do Portta;
- host atual;
- versão;
- status;
- ícones;
- footer;
- controles auxiliares.

O usuário precisa compreender visualmente que a sidebar pertence ao mesmo design system do restante da aplicação.

Não crie uma sidebar exageradamente grande.

Continue priorizando espaço para conteúdo.

---

# 6. Visão geral / Overview

A página de visão geral é uma das áreas que mais precisam de refinamento.

Ela deve funcionar como um verdadeiro **cockpit do ambiente de desenvolvimento**.

Ao abrir essa página, eu quero conseguir responder rapidamente:

- O host está saudável?
- Existe alguma coisa exigindo atenção?
- Quais tarefas estão em andamento?
- Quais agentes estão trabalhando?
- Quais projetos estão ativos?
- Quais ambientes estão consumindo recursos?
- Existe algum serviço com problema?
- Tenho recursos suficientes no host?
- Existe pressão de CPU, memória, GPU, disco ou temperatura?
- Há alguma ação imediata que eu deveria tomar?

A página não pode exigir que eu role até o fim apenas para descobrir o estado da máquina.

---

# 7. Resumo do host na parte superior

As informações do host precisam ganhar mais relevância.

Hoje elas ficam excessivamente distantes.

Crie na região superior da página uma representação compacta do host atual.

Exibir, quando disponível:

- hostname;
- sistema operacional;
- arquitetura;
- CPU;
- uso atual de CPU;
- memória utilizada/total;
- armazenamento;
- GPU;
- utilização da GPU;
- memória da GPU, se disponível;
- temperatura;
- bateria;
- estado da bateria;
- alimentação;
- uptime;
- load average;
- atualização das métricas;
- conectividade;
- status do gateway.

Nem todo host disponibilizará todas essas métricas.

A interface deve ser adaptativa.

### Exemplos

Em um MacBook / Apple Silicon podem existir:

- bateria;
- temperatura;
- GPU integrada;
- pressão de memória;
- energia.

Em uma VPS provavelmente não haverá bateria e talvez nem GPU.

Não exiba componentes vazios simplesmente porque determinada métrica não existe.

---

# 8. Pequenos gráficos úteis

Quero melhorar visualmente a página Overview com pequenos gráficos, mas eles precisam ter utilidade.

Considere sparkline ou série temporal curta para:

- CPU;
- RAM;
- GPU;
- disco;
- network;
- load average;
- temperatura.

Esses gráficos podem mostrar, por exemplo, os últimos:

- 5 minutos;
- 15 minutos;
- ou outro intervalo coerente com a coleta existente.

Eles precisam ser:

- discretos;
- rápidos;
- legíveis;
- compactos;
- consistentes.

Não transformar o Portta em uma solução de observabilidade.

O objetivo não é competir com Grafana.

Essas métricas existem para permitir uma decisão operacional rápida.

---

# 9. Pressão do host

Se possível com os dados atualmente disponíveis, apresente uma interpretação simples da situação.

Exemplos:

- Normal
- Atenção
- Sob pressão
- Crítico

Considere recursos como:

- CPU;
- RAM;
- GPU;
- temperatura;
- armazenamento;
- load;
- quantidade de environments em execução.

Não inventar métricas sem fundamento.

Se for necessário alterar backend/API/coleta para suportar os dados necessários, faça isso de maneira consistente com a arquitetura existente.

---

# 10. Trabalho atual

A área que apresenta tarefas em andamento, revisão e bloqueadas é útil.

Refine-a.

Quero conseguir identificar rapidamente:

- tarefa;
- projeto;
- repository;
- responsável/agente;
- status;
- prioridade;
- tipo;
- tempo em execução;
- bloqueio;
- última atualização.

Não precisa necessariamente exibir tudo ao mesmo tempo.

Use progressive disclosure, tooltips ou informações secundárias quando apropriado.

Clique na tarefa deve levá-la diretamente para seu contexto/detalhes.

---

# 11. Sessões / agentes

A área de sessões precisa ser realmente informativa quando houver agentes trabalhando.

Exibir, quando disponível:

- agente/provider;
- projeto;
- repository;
- tarefa;
- início da sessão;
- duração;
- atividade atual;
- branch;
- commits relacionados;
- estado.

Se não houver nenhuma sessão:

crie um empty state pequeno e elegante.

Não desperdice uma grande área da interface apenas para dizer que não há sessões.

---

# 12. Precisa de atenção

Esta seção deve reunir somente coisas realmente acionáveis.

Exemplos:

- container unhealthy;
- environment degradado;
- task bloqueada;
- gateway com erro;
- domínio inconsistente;
- serviço parado inesperadamente;
- conflito;
- recurso do host sob pressão;
- configuração pendente;
- reinicialização necessária.

Se nada estiver errado:

mostrar um estado positivo compacto.

Não deixar uma seção enorme vazia.

---

# 13. Projetos no Overview

A lista resumida de projetos deve continuar existindo, mas precisa ser útil.

Priorize projetos relevantes:

- ativos;
- com tarefas abertas;
- com agentes trabalhando;
- com problemas;
- com environments rodando;
- recentemente modificados.

Permitir acesso rápido ao projeto.

Considere ações rápidas contextuais quando fizer sentido.

---

# 14. Código / commits recentes

Refine o bloco de código/commits.

Melhore hierarquia entre:

- repository;
- branch;
- commit;
- autor;
- tempo;
- alterações não commitadas;
- divergência em relação ao remote.

Evite repetição visual desnecessária.

Quando houver vários repositories dentro do mesmo Project, a interface precisa deixar isso claro.

---

# 15. Personalização da página Overview

Avalie implementar uma estrutura que futuramente permita reorganização dos widgets.

Se for simples e seguro agora, implemente drag-and-drop para reorganização.

Se isso gerar complexidade excessiva, pelo menos estruture o código para que a disposição dos widgets não fique completamente rígida.

Uma possível estrutura:

- Host summary
- Trabalho
- Sessões
- Atenção
- Projetos
- Código
- Uso de recursos
- Ambientes

Mas escolha a composição com base em UX e nos dados existentes.

Não implemente drag-and-drop apenas por implementar.

A prioridade é utilidade.

---

# 16. Página de Projetos

A página de Projects precisa deixar de ser simplesmente uma coleção passiva de cards.

Quero conseguir **agir sobre os projetos diretamente da listagem**.

---

# 17. Visualização Cards

Manter a visualização em cards.

Porém cada projeto deve possuir ações contextuais.

Por exemplo através de:

- botão `...`;
- context menu;
- hover actions;
- seleção;
- ações rápidas.

Dependendo do estado do projeto, permitir ações como:

- abrir;
- iniciar environments;
- parar environments;
- reiniciar;
- parar todos os containers;
- abrir tarefas;
- abrir repositories;
- abrir environments;
- acessar serviços;
- configurações;
- remover;
- excluir.

Ações destrutivas devem exigir confirmação adequada.

Não apresentar ações inválidas para o estado atual.

Exemplo:

se nenhum environment estiver rodando, "Parar projeto" não deve aparecer como ação principal ativa.

---

# 18. Informações dos cards de projeto

Revise a composição dos cards.

Quero enxergar rapidamente:

- nome;
- descrição;
- repositories;
- environments;
- tarefas abertas;
- tarefas em andamento;
- bloqueadas;
- agentes/sessões;
- estado operacional;
- atividade recente.

Não é obrigatório exibir tudo.

Organize a informação por relevância.

Evite excesso de badges pequenos espalhados.

Use status semântico.

---

# 19. Visualização Lista deve virar Tabela

Este é um requisito importante.

A atual visualização "Lista" deve deixar de ser apenas uma lista linear e se tornar uma **Table View real**.

O padrão global deve ser:

- Board/Card quando aplicável;
- Table.

Em vez de:

- Card;
- lista simplificada.

---

# 20. Tabela de Projetos

A tabela pode conter colunas como:

- seleção;
- nome;
- estado;
- repositories;
- environments;
- tarefas;
- em andamento;
- bloqueadas;
- agentes;
- branch/recent activity;
- última atividade;
- ações.

Implemente uma arquitetura que permita futuramente:

- ocultar/exibir colunas;
- reordenar colunas;
- ordenar;
- filtrar;
- selecionar múltiplos registros.

Se for simples e compatível com o projeto atual, já implemente pelo menos:

- sort;
- filtros;
- column visibility;
- seleção múltipla;
- ações em lote.

A tabela deve continuar utilizável em viewport menor.

---

# 21. Bulk actions para projetos

Quando múltiplos projetos forem selecionados, avaliar ações como:

- iniciar;
- parar;
- reiniciar;
- remover.

Somente ofereça ações que façam sentido e que possam ser executadas com segurança.

Ações destrutivas precisam ser confirmadas.

---

# 22. Padrão de Table View global

Analise outras telas da aplicação que atualmente possuam alternância entre:

- cards;
- lista.

Quando o modo "lista" representar entidades estruturadas, avalie substituí-lo por tabela.

Principalmente:

- Projects;
- Tasks;
- Services;
- Environments;
- outras entidades equivalentes.

Não faça substituição mecânica.

Use tabela apenas onde houver ganho real.

---

# 23. Tarefas

O módulo de tarefas precisa evoluir significativamente.

A experiência precisa lembrar ferramentas maduras de gerenciamento de trabalho, mas continuar compatível com o escopo do Portta.

---

# 24. Board de tarefas

Manter o Board.

Estados existentes precisam ser representados em colunas coerentes.

Exemplo:

- Backlog
- A fazer
- Em andamento
- Revisão
- Bloqueada
- Concluída

Utilize exatamente os estados suportados pelo domínio atual da aplicação.

Não crie estados arbitrários sem revisar backend/modelos.

---

# 25. Drag-and-drop obrigatório

No Board:

**implementar drag-and-drop de tarefas entre status.**

Fluxo esperado:

1. usuário começa a arrastar a tarefa;
2. os destinos válidos ficam visualmente claros;
3. usuário solta em outra coluna;
4. interface atualiza imediatamente;
5. backend persiste o novo status;
6. falha de persistência deve reverter visualmente a alteração;
7. mostrar feedback de erro;
8. atualizar contadores.

A experiência precisa ser suave.

Evite refresh completo da página.

Considere optimistic update se a arquitetura atual permitir.

---

# 26. Reordenação dentro da mesma coluna

Avalie se o domínio atual suporta ordenação manual.

Se houver suporte ou for simples introduzir:

permitir reordenação dentro da mesma coluna.

Caso não haja:

não criar uma ordenação falsa apenas no frontend.

---

# 27. Table View de tarefas

A visualização "Lista" das tarefas também deve virar uma tabela real.

Possíveis colunas:

- ID;
- título;
- Project;
- repository;
- status;
- prioridade;
- tipo;
- labels;
- responsável;
- agente;
- prazo;
- última atualização;
- ações.

A tabela deve trabalhar em conjunto com os filtros existentes.

---

# 28. Status das tarefas

Padronizar cores e representação visual de status.

Cada status deve possuir:

- cor;
- label;
- ícone opcional;
- comportamento visual consistente.

A mesma tarefa precisa aparecer com o mesmo estilo de status em:

- Overview;
- Board;
- Table;
- Task Detail;
- Project Overview;
- qualquer outro local.

Não duplique mapas de cores em vários componentes.

Centralize.

---

# 29. Prioridades

Padronizar prioridades.

Exemplo conceitual:

- baixa;
- média;
- alta;
- urgente.

Defina:

- labels;
- cores;
- ordenação;
- representação.

Utilize os valores reais suportados pelo sistema.

---

# 30. Tipos de tarefa

Analise o modelo atual.

Descubra se `type` é:

- texto livre;
- enum;
- entidade configurável.

Defina um comportamento coerente.

Evite manter um campo estrutural importante como texto arbitrário se isso estiver criando inconsistência.

Mas também não faça uma grande migração sem necessidade.

Exemplos possíveis:

- feature;
- bug;
- improvement;
- chore;
- research;
- documentation.

A decisão deve estar alinhada à arquitetura atual.

---

# 31. Labels

Refine labels.

Precisamos de:

- consistência;
- boa legibilidade;
- cores previsíveis;
- criação/seleção fácil;
- não poluir visualmente as listas.

Se labels possuírem cores configuráveis, respeitar isso.

Caso não possuam, utilizar estratégia visual consistente.

---

# 32. Detalhes da tarefa

Refine a interface de visualização/edição da tarefa.

Quero conseguir compreender claramente:

- título;
- descrição;
- status;
- prioridade;
- tipo;
- labels;
- responsável;
- agente;
- repository;
- environment;
- service;
- prazo;
- atividade;
- comentários;
- anexos;
- ações relacionadas à execução.

Evitar interface visualmente pesada.

Separar:

- conteúdo;
- metadados;
- atividade;
- ações.

---

# 33. Ações "Iniciar tarefa" / "Concluir"

Analise o comportamento atual desses botões.

Hoje o significado não é suficientemente claro.

Precisamos distinguir:

### Estado da tarefa

Ex.:

- backlog;
- todo;
- in progress;
- review;
- blocked;
- done.

### Execução por agente

Ex.:

- atribuir agente;
- iniciar execução;
- interromper execução;
- retomar;
- cancelar.

Não misturar conceitos diferentes em um único botão.

Se "Iniciar tarefa" significa alterar status:

o texto deve refletir isso.

Se significa iniciar um agente:

deve deixar claro qual agente será iniciado.

Refatore labels, tooltips e comportamento conforme necessário.

---

# 34. Anexos em tarefas

Implementar suporte a anexos em tarefas.

Quero conseguir anexar arquivos relacionados à demanda.

Exemplos:

- screenshots;
- documentos;
- arquivos de texto;
- logs;
- JSON;
- PDFs;
- imagens;
- arquivos relacionados ao problema.

A implementação deve permitir:

- upload;
- listagem;
- download/abertura;
- identificação de tipo;
- tamanho;
- data;
- remoção quando permitido.

Se possível:

- drag-and-drop;
- colar imagem da área de transferência.

Considere limites adequados e segurança.

Não armazene arquivos de maneira improvisada.

Analise a arquitetura atual para definir local/persistência.

---

# 35. Serviços

Revise a página Services.

Quero conseguir responder rapidamente:

- que serviços existem;
- de qual projeto/environment são;
- estão rodando?;
- estão saudáveis?;
- endereço;
- porta;
- protocolo;
- exposição;
- consumo;
- ações.

Melhore a Table/Card View conforme aplicável.

Ações possíveis:

- abrir;
- restart;
- stop;
- logs;
- acesso;
- copiar endpoint;
- detalhes.

---

# 36. Docker

Revise a experiência da área Docker.

A interface precisa facilitar diagnóstico rápido.

Possíveis dados:

- container;
- project;
- environment;
- image;
- status;
- health;
- CPU;
- RAM;
- uptime;
- ports;
- network.

Ações:

- logs;
- restart;
- stop;
- inspect;
- acessar serviço relacionado.

Não transformar em clone do Portainer.

Oferecer somente o necessário para desenvolvimento.

---

# 37. Rede / Acesso / Gateway

Revise essas áreas visualmente.

O usuário precisa entender facilmente:

- por onde determinado serviço pode ser acessado;
- local;
- LAN;
- Tailscale/VPN;
- IP público;
- domínio;
- Cloudflare Tunnel;
- Traefik;
- autenticação;
- SSL.

Links utilizáveis devem ser clicáveis.

Endereços copiáveis devem possuir ação de copiar.

Estados devem ser claramente representados.

---

# 38. Configurações

A área de Settings precisa ser mais autoexplicativa.

Cada configuração precisa responder:

- o que é;
- para que serve;
- qual impacto possui;
- estado atual;
- quando exige restart;
- como acessar o recurso depois de ativado;
- possíveis riscos.

Use:

- descriptions;
- help text;
- tooltips;
- links;
- status;
- mensagens de configuração pendente.

Evite configurações que simplesmente apresentam um toggle sem contexto.

---

# 39. Ações contextuais

Como princípio geral:

se uma entidade puder receber uma ação frequentemente utilizada, não obrigar o usuário a abrir três páginas até chegar nessa ação.

Utilize context menu ou quick actions para:

- Projects;
- environments;
- services;
- tasks;
- repositories;
- sessions;
- containers.

Não sobrecarregue visualmente os elementos com dezenas de botões.

Preferir:

- ação principal visível;
- ações secundárias em menu `...`.

---

# 40. Feedback das ações

Todas as ações assíncronas precisam possuir feedback.

Exemplos:

- loading;
- success;
- error;
- progress;
- optimistic update;
- rollback quando necessário.

Nunca deixar o usuário clicando sem saber se algo aconteceu.

---

# 41. Confirmações

Ações destrutivas precisam de confirmação contextual.

Exemplos:

- remover Project;
- excluir environment;
- parar todos os containers;
- deletar anexos;
- remover integração.

A confirmação precisa informar exatamente o impacto.

Evite modal genérico:

> Tem certeza?

Prefira algo como:

> Parar Demo Shop?
> Isso interromperá 5 containers deste environment.

---

# 42. Tablet e viewport intermediário

Um dos objetivos é conseguir utilizar o Portta confortavelmente em tablet.

Teste especialmente larguras equivalentes a:

- desktop grande;
- notebook;
- tablet landscape;
- tablet portrait.

A interface não precisa virar experiência mobile completa caso isso não seja objetivo atual, mas deve continuar navegável.

Cuidado com:

- tabelas;
- sidebars;
- dialogs;
- action menus;
- toolbars;
- filtros;
- Board horizontal.

---

# 43. Empty states

Melhore os estados vazios.

Eles devem explicar:

- o que é a seção;
- por que está vazia;
- qual ação fazer quando aplicável.

Mas não ocupar áreas gigantes desnecessariamente.

---

# 44. Loading states

Garanta loading states adequados.

Preferir:

- skeletons;
- feedback localizado;
- transições discretas.

Evitar bloquear a página inteira para pequenas atualizações.

---

# 45. Erros

Erros operacionais devem ser úteis.

Exemplo ruim:

> Something went wrong

Exemplo melhor:

> Não foi possível parar o environment Demo Shop.
> O Docker retornou erro ao interromper o container `api`.

Forneça detalhes técnicos quando apropriado, sem comprometer a usabilidade.

---

# 46. Tooltips

Adicionar tooltips onde ícones ou indicadores não forem autoexplicativos.

Especialmente:

- status;
- recursos;
- health;
- Git;
- rede;
- ações.

Não usar tooltip para compensar uma UI inteira mal desenhada.

---

# 47. Consistência de componentes

Evite componentes visualmente diferentes realizando a mesma função.

Centralize componentes como:

- StatusBadge;
- PriorityBadge;
- HealthBadge;
- ProjectState;
- AgentState;
- Metric;
- ResourceUsage;
- ContextMenu;
- DataTable;
- EmptyState;
- ConfirmDialog;
- ActionButton.

Utilize os nomes adequados à arquitetura existente.

---

# 48. DataTable compartilhada

Se a aplicação ainda não possui uma abstração adequada de tabela, considere criar uma.

Ela pode oferecer:

- column definitions;
- sorting;
- filtering;
- column visibility;
- selection;
- bulk actions;
- pagination quando necessário;
- responsive behavior.

Use bibliotecas já existentes no projeto sempre que possível.

Não introduza dependência pesada sem necessidade.

---

# 49. Performance

Não comprometer a responsividade da aplicação.

Especialmente:

- Overview;
- métricas;
- Tables;
- Board;
- drag-and-drop;
- gráficos.

Evite rerenders excessivos.

Evite polling agressivo.

Utilize o mecanismo atual de atualização sempre que possível.

---

# 50. Acessibilidade

Garanta:

- navegação por teclado;
- foco visível;
- labels;
- aria quando necessário;
- contraste adequado;
- menus acessíveis;
- dialogs acessíveis;
- drag-and-drop com comportamento minimamente acessível quando suportado.

---

# 51. Navegação por teclado

Onde fizer sentido, melhore atalhos básicos.

Por exemplo:

- `Esc` fechar menus/modais;
- `Enter` confirmar ações;
- setas em menus;
- foco coerente.

Não introduza dezenas de atalhos novos sem necessidade.

---

# 52. O que NÃO faz parte desta implementação

Existem evoluções que quero futuramente, mas não devem desviar esta tarefa.

Por exemplo:

- file explorer completo;
- edição arbitrária dos arquivos do projeto;
- upload direto para qualquer diretório do repository;
- IDE web;
- terminal completo;
- editor de código;
- observabilidade avançada;
- Grafana embutido;
- substituto do Portainer.

Você pode estruturar a arquitetura sem bloquear essas evoluções futuras, mas **não transformar esta demanda em implementação dessas funcionalidades**.

---

# 53. Ordem sugerida de execução

Organize a implementação em etapas.

## Fase 1 — Auditoria e Design System

- mapear componentes;
- consolidar tokens;
- corrigir inconsistências;
- identidade visual;
- badges;
- buttons;
- tables;
- cards;
- menus;
- estados.

## Fase 2 — Overview

- hierarquia;
- host summary;
- métricas;
- gráficos;
- sessões;
- trabalho;
- atenção;
- projetos;
- código.

## Fase 3 — Projects

- cards;
- context menu;
- ações;
- Table View;
- seleção;
- filtros;
- bulk actions.

## Fase 4 — Tasks

- Board;
- drag-and-drop;
- Table View;
- status;
- prioridade;
- tipo;
- labels;
- task detail;
- anexos;
- clareza das ações.

## Fase 5 — Infraestrutura

- Services;
- Docker;
- Network;
- Access;
- Gateway;
- Settings.

## Fase 6 — Refinamento

- responsividade;
- tablet;
- empty states;
- loading;
- errors;
- tooltips;
- acessibilidade;
- performance.

Essa ordem é uma referência.

Se dependências técnicas exigirem outra organização, adapte.

---

# 54. Preserve o domínio existente

Não altere conceitos centrais sem necessidade.

O Portta possui conceitos como:

- Project;
- Repository;
- Environment;
- Service;
- Container;
- Task;
- Agent/Session;
- Host.

Antes de alterar nomes ou relacionamentos:

entenda o modelo atual.

Não use atalhos conceituais que voltem a misturar Project, repository e environment.

---

# 55. Dados reais

Não crie visualizações que dependam de informações fictícias em produção.

Se a interface exigir um dado novo:

1. identifique sua origem;
2. implemente o suporte necessário;
3. trate indisponibilidade;
4. apresente somente quando houver informação real.

Mocks são permitidos exclusivamente para desenvolvimento/testes quando claramente isolados.

---

# 56. Não apagar funcionalidades existentes

Esta é uma melhoria incremental.

Não remover recursos atuais simplesmente para simplificar a UI.

Se algo precisar ser reorganizado:

preserve sua funcionalidade.

---

# 57. Branch e Git

Trabalhe exclusivamente na branch:

`develop`

Regras:

- não criar branch nova;
- atualizar `develop` antes de começar;
- não trabalhar na `main`;
- não fazer merge para `main`;
- não criar release;
- não criar tag;
- não fazer deploy.

Faça commits consistentes e semanticamente organizados.

Evite um commit gigantesco contendo toda a refatoração.

Exemplos de agrupamento:

- design system;
- overview;
- projects table;
- tasks board;
- task attachments;
- infrastructure UX;
- responsive refinements.

Siga as convenções já existentes no repository.

---

# 58. Testes

Não execute testes desnecessários ou a suíte inteira repetidamente.

Durante o desenvolvimento:

execute testes direcionados às áreas alteradas.

Precisamos validar principalmente:

### Overview

- carregamento;
- métricas;
- ausência de métricas;
- host local;
- VPS;
- estados vazios;
- erro de coleta.

### Projects

- card;
- table;
- filtros;
- sorting;
- seleção;
- context menu;
- ações;
- confirmação;
- estados.

### Tasks

- board;
- drag-and-drop;
- atualização de status;
- rollback em falha;
- table;
- filtros;
- task detail;
- anexos;
- status;
- prioridade.

### Infra

- services;
- containers;
- ações;
- links;
- estados.

### Responsividade

- desktop;
- notebook;
- tablet.

Utilize testes automatizados existentes e Playwright quando adequado.

Não transforme esta implementação em projeto de expansão da suíte de testes.

Crie ou atualize testes somente quando forem realmente relevantes para evitar regressão.

---

# 59. Testes visuais

Utilize Playwright ou a ferramenta visual já adotada no projeto para validar as páginas alteradas.

Analise visualmente:

- alinhamentos;
- spacing;
- overflow;
- truncation;
- tooltips;
- dialogs;
- dropdowns;
- table;
- Board;
- tablet;
- dark/light mode se aplicável.

Não considere a tarefa concluída apenas porque o build passou.

---

# 60. Screenshots

Ao terminar:

atualize os screenshots oficiais/documentais da plataforma para refletirem a nova versão da interface.

Os screenshots precisam mostrar as telas principais já refinadas.

Exemplos:

- Overview;
- Projects Cards;
- Projects Table;
- Task Board;
- Task Table;
- Task Detail;
- Services;
- outras telas relevantes alteradas.

Remova screenshots obsoletos quando forem substituídos.

---

# 61. Critérios de aceite — Overview

Considerar concluído somente se:

- informações do host estiverem claramente acessíveis;
- CPU/RAM/disk estiverem representados adequadamente;
- GPU aparecer quando disponível;
- temperatura/bateria aparecerem quando disponíveis;
- gráficos forem úteis e discretos;
- estados vazios não criarem grandes espaços mortos;
- sessões forem mais informativas;
- área "Precisa de atenção" for acionável;
- projetos e código tiverem melhor hierarquia;
- página estiver visualmente mais coesa.

---

# 62. Critérios de aceite — Projects

Considerar concluído somente se:

- Card View continuar funcional;
- cards tiverem ações contextuais;
- usuário conseguir executar ações sem sempre abrir o Project;
- modo Lista tiver sido transformado em Table View real;
- tabela possuir colunas úteis;
- filtros funcionarem;
- sorting funcionar quando implementado;
- context menu funcionar;
- seleção múltipla funcionar quando implementada;
- ações destrutivas tiverem confirmação.

---

# 63. Critérios de aceite — Tasks

Considerar concluído somente se:

- Board estiver visualmente refinado;
- tarefas puderem ser arrastadas entre estados;
- mudança for persistida;
- erro fizer rollback;
- Table View substituir a lista simplificada;
- status forem consistentes;
- prioridades forem consistentes;
- tipo e labels forem tratados adequadamente;
- detalhes da tarefa estiverem mais claros;
- significado das ações de execução estiver claro;
- anexos funcionarem;
- filtros continuarem funcionando.

---

# 64. Critérios de aceite — Identidade

A melhoria precisa ser perceptível.

Eu devo conseguir comparar antes/depois e perceber:

- produto mais maduro;
- identidade própria;
- menos aparência genérica;
- melhor hierarquia;
- componentes mais coerentes;
- menos espaço desperdiçado;
- melhor uso das cores;
- melhor interação.

Mas sem transformar o Portta em algo extravagante.

---

# 65. Critérios de aceite — Tablet

A interface precisa continuar funcional em tablet.

Verificar:

- sidebar;
- Overview;
- Projects;
- Table;
- Board;
- Task Detail;
- dialogs;
- context menus.

Não aceitar layout quebrado, overflow acidental ou controles inacessíveis.

---

# 66. Resultado esperado

Quando essa implementação terminar, eu quero abrir o Portta e sentir que estou diante de um **ambiente de desenvolvimento integrado e centro de controle**, e não apenas diante de uma coleção de páginas administrativas.

Preciso conseguir:

- entender o estado do host;
- acompanhar recursos;
- identificar problemas;
- ver agentes trabalhando;
- acompanhar tarefas;
- mover tarefas;
- agir em projetos;
- parar/iniciar ambientes;
- abrir serviços;
- verificar código;
- consultar atividades;
- operar pelo tablet;
- tomar decisões rapidamente.

Tudo isso mantendo:

- clareza;
- velocidade;
- sobriedade;
- densidade adequada;
- consistência.

---

# 67. Entrega final obrigatória

Ao concluir:

1. garanta que todas as alterações estejam na `develop`;
2. verifique `git status`;
3. garanta que não existam mudanças importantes esquecidas;
4. execute os testes direcionados relevantes;
5. execute os testes visuais relevantes;
6. valide as principais telas;
7. atualize os screenshots;
8. faça os commits necessários;
9. não faça deploy;
10. não faça merge para `main`;
11. não crie tag;
12. não crie release.

Depois apresente um relatório final contendo:

### Implementado
- lista objetiva das melhorias realizadas.

### UX/UI
- alterações de identidade e design system;
- mudanças de interação;
- mudanças de layout.

### Overview
- mudanças realizadas.

### Projects
- mudanças realizadas.

### Tasks
- mudanças realizadas.

### Infraestrutura
- mudanças realizadas.

### Dados/backend
- alterações necessárias para suportar novas informações.

### Testes
- testes executados;
- resultado.

### Screenshots
- arquivos atualizados.

### Commits
- hashes e descrições dos commits.

### Pendências
- somente aquilo que realmente ficou fora do escopo ou depende de trabalho futuro.

Não finalize apenas dizendo que a implementação terminou.

A implementação deve ser realmente validada.