# Documento de Design de Jogo (GDD)
**Revisão:** 0.0.1
**Modelo de GDD escrito por:** Benjamin “HeadClot” Stanley

## Visão Geral

### Tema / Ambientação / Gênero
* **Tema:** Corridas clandestinas, busca por fama, respeito e competição urbana no submundo tecnológico.
* **Ambientação:** Metrópole futurista cyberpunk, luzes de néon, hologramas, e bairros tecnológicos.
* **Gênero:** Corrida Arcade 2D (Pixel Art) / Multiplayer Competitivo.

### Resumo das Mecânicas Principais de Gameplay
* **Pilotagem Arcade:** Controle de aceleração, frenagem e curvas precisas para manter o veículo na pista.
* **Sistema de Turbo/Boost:** Aumento temporário de velocidade ao passar por placas Boost espalhadas pelo circuito.
* **Punição por Hazards (Obstáculos):** Perda de velocidade ao colidir com barreiras e perda de aderência/controle ao passar por Zonas de Óleo.
* **Acúmulo de Recompensas ("Tijolinhos"):** Sistema de pontuação/moeda ganho por desempenho técnico (volta perfeita, liderança mantida, uso de boosts, vitória).

### Plataformas Alvo
* Dispositivos Móveis (Android / iOS) — indicado pelos botões virtuais na HUD, Web.

### Modelo de Monetização
* **Monetização:** Gratuito para Jogar (Free-to-Play) com moeda do jogo ("Tijolinhos") conquistada ao cumprir metas de pilotagem, que pode ser usada para desbloquear novos carros futuristas ou cosméticos.

## Escopo do Projeto
* **Tempo de Jogo:** Corridas rápidas de 1 a 3 minutos (3 voltas por partida).
* **Tempo de Desenvolvimento:** 3 meses.
* **Custo Total:** R$0,00 ( Ferramentas Gratuitas).
* **Equipe:** 3 Desenvolvedores (Game Design, Programação, Pixel Art e Marketing).
* **Ferramentas:** gitHub e áudios gratuitos.

## INFLUÊNCIAS
* **Influência #1:** Jogos: (Top Gear, Out Run, Super Mario Kart)
* **Influência #2:** Mídia: Estética Cyberpunk / Ficção Científica

## Pitch de Elevador
**Pitch:** "Um jogo de corrida arcade em pixel art com estética cyberpunk onde dois jogadores disputam rachas clandestinas em cidades iluminadas por neon, onde cada curva perfeita e cada boost contam para conquistar a glória no topo das pistas."

## Descrição do Projeto (Resumida)
O projeto é um jogo de corrida arcade 2D em pixel art ambientado em uma metrópole cyberpunk noturna. Focado em partidas rápidas e competitivas entre dois jogadores, o título combina a nostalgia dos grandes clássicos do gênero com uma estética futurista marcante, repleta de iluminação em neon, hologramas espalhados pelas vias urbanas.

O objetivo principal é completar três voltas no circuito antes do adversário. A jogabilidade exige reflexos rápidos e precisão para dominar as curvas, aproveitar as placas de boost espalhadas pelo trajeto e desviar de perigos como barreiras e poças de óleo. Além da vitória, o jogo premia a pilotagem técnica através de um sistema de conquistas em tempo real.

## Descrição do Projeto (Detalhada)
O jogo transporta os jogadores para o submundo das corridas clandestinas de uma cidade futurista dominada por um sistema cibernético. Neste cenário, as ruas iluminadas por neon se transformam em pistas perigosas onde pilotos disputam fama, respeito e recursos. A estética em pixel art resgata o charme dos jogos retrô, enriquecida por uma atmosfera vibrante com hologramas e arquitetura cyberpunk.

A experiência central é projetada para disputas diretas entre dois jogadores em uma mesma pista. O diferencial do confronto é o sistema de multiplayer em modo "fantasma": os dois carros compartilham o mesmo traçado simultaneamente, mas não colidem um com o outro. Isso elimina batidas acidentais ou trapaças por empurrões, fazendo com que o resultado dependa exclusivamente da maestria do jogador no controle do veículo.

O loop de gameplay gira em torno de completar três voltas na pista no menor tempo possível. A dinâmica das corridas é diretamente influenciada por elementos interativos no chão do circuito. Os pilotos precisam buscar as Placas Boost para ganhar aceleração temporária em trechos chave, enquanto desviam de Zonas de Óleo que fazem o carro derrapar e de Barreiras que reduzem drasticamente a velocidade ao haver colisão.

Para aumentar a vontade de jogar várias vezes e o engajamento, o projeto conta com o sistema de recompensas por desempenho ("Tijolinhos"). Durante a corrida, os jogadores ganham pontos/moedas por ações de alta precisão, como realizar voltas perfeitas sem bater, liderar a corrida inteira ou passar longe do óleo. Essa mecânica transforma cada racha em um desafio constante de superação técnica.

## O que faz este projeto se destacar?
* **Multiplayer Sem Colisão (Modo Fantasma):** Os dois jogadores correm no mesmo traçado sem se chocar. Isso elimina batidas acidentais e garante que o vencedor seja definido 100% pela habilidade e precisão de pilotagem.
* **Sistema de Recompensas por Precisão ("Tijolinhos"):** A corrida não premia apenas o primeiro a cruzar a linha de chegada, mas também recompensa o piloto por ações técnicas (voltas sem bater, desvio de óleo, uso de boosts).
* **Pistas Dinâmicas Interativas:** O traçado é repleto de elementos que alteram a velocidade e a aderência instantaneamente (placas boost, barreiras e poças de óleo), exigindo constante adaptação.
* **Nostalgia Arcade Cyberpunk:** Mistura a jogabilidade simples e viciante dos clássicos em pixel art 2D com uma atmosfera futurista envolvente de iluminação neon.

## Mecânicas Principais de Gameplay (Detalhado)
* **Botões de Direção (Esquerda e Direita):** Localizados no canto inferior esquerdo da tela (no HUD mobile). São responsáveis por alterar o vetor de direção do veículo. A resposta ao toque é imediata, alterando o ângulo do carro gradativamente para criar curvas suaves ou desvios bruscos, dependendo do tempo em que o botão é pressionado.
* **Aceleração Contínua (Gás):** O botão de acelerar (canto inferior direito) aumenta a velocidade do veículo de acordo com uma curva de aceleração própria de cada carro, até atingir a velocidade máxima (Top Speed).
* **Freio / Derrapagem (Brake / Drift):** Pressionar o freio reduz rapidamente a velocidade. Se acionado simultaneamente a um Botão de Direção (Esquerda ou Direita) enquanto o carro estiver em alta velocidade, o veículo entra em estado de derrapagem (Drift), permitindo fazer curvas fechadas sem perder toda a inércia, mas exigindo compensação no volante para não rodar na pista.

### 8.2. Física e Comportamento do Veículo
* **A física do jogo:** Não é realista, mas sim focada em diversão (Arcade Physics).
* **Aderência (Grip):** O carro tem tração perfeita na pista limpa. Soltar o acelerador causa uma desaceleração natural lenta (fricção do ar e do pneu).
* **Inércia e Peso:** Ao bater Colisão Frontal e Lateral, o veículo acaba tendo uma redução

### 8.3. Interações Dinâmicas com a Pista
O domínio da pista depende de como o jogador reage aos artefatos espalhados pelo circuito.
* **Sistema de Placas Boost:** Ao passar com os pneus sobre a placa neon, o veículo recebe um multiplicador instantâneo de velocidade (ex: 130% da velocidade máxima) por 2.5 segundos. Durante o Boost, a capacidade de fazer curvas fechadas (Handling) diminui ligeiramente, exigindo antecipação do jogador através dos botões de Esquerda/Direita.
* **Sistema de Zonas de Óleo:** Funciona como um modificador negativo de fricção. Ao tocar no óleo, a aderência cai para 20%. Se o jogador estiver pressionando os botões direcionais (Esquerda/Direita) nesse momento, o carro deslizará incontrolavelmente para a lateral, podendo bater nas barreiras. A estratégia é soltar os direcionais e passar reto sobre o óleo.
* **Penalidade de Barreiras:** Bater nos limites da pista ou em obstáculos físicos reduz a velocidade atual em 60% instantaneamente e bloqueia o uso de Boosts por 1 segundo, simulando a recuperação do motor.

## História e Jogabilidade
Na metrópole cyberpunk de Neon City, o mundo cibernético controla a sociedade, mas o asfalto pertence aos pilotos do submundo. As corridas clandestinas noturnas são a única forma de ascender, conquistar prestígio e desafiar o sistema.

### História (Detalhada)
Ano de 2099. Neon City é uma megalópole vertical onde a elite corporativa vive acima das nuvens e a classe trabalhadora sobrevive sob a penumbra das luzes de neon. Sem perspectivas de ascensão social pelos meios legais, a juventude e os mercenários das ruas encontraram nas Corridas Clandestinas Noturnas um ritual de liberdade e poder.

Os circuitos acontecem em vias expressas desativadas. Apenas a busca pela vitória. Vencer significa conquistar Tijolinhos (a moeda digital descentralizada das ruas), garantir o respeito das gangues locais e provar que nenhum algoritmo corporativo pode superar o reflexo e a ousadia de um verdadeiro piloto.

### Jogabilidade (Resumida)
Corrida arcade 2D estilo 1 contra 1 com 3 voltas. O jogador usa botões de direção (Esquerda/Direita), acelerador e freio para desviar de óleo, acertar placas de aceleração (boost) e evitar barreiras para cruzar a linha de chegada em primeiro lugar.

### Jogabilidade (Detalhada)
O jogador compete contra um rival em tempo real ao longo de 3 voltas dinâmicas num circuito cyberpunk. O objetivo primário é vencer a corrida, enquanto o objetivo secundário é executar manobras limpas para maximizar o ganho de Tijolinhos.
* **Início e Arranque:** Contagem regressiva de 3 segundos (som também) com mecânica de largada perfeita (pressionar acelerador no tempo correto concede uma pequena aceleração inicial).
* **Navegação e Controles:**
    * **Esquerda / Direita:** Ajusta a trajetória do veículo na pista para desviar de obstáculos ou alinhar com itens.
    * **Acelerar / Frear:** Gerenciam a velocidade. Frear junto com uma curva ativa a mecânica de derrapagem.
* **Gestão de Pista:**
    * Buscar Placas de Aceleração (Boost) para ultrapassagens estratégicas.
    * Evitar Zonas de Óleo ajustando a direção com antecedência para não perder o controle do veículo.
    * Evitar colisões contra as Barreiras, que causam grande perda de velocidade.
* **Final da Corrida:** Vitória definida por quem cruza a linha de chegada na 3ª volta. A tela de estatísticas detalha os tijolinhos acumulados com base na precisão e no desempenho.

## Ativos Necessários (Assets)

### 2D
* **Sprites de Veículos:** modelos de carros futuristas em Pixel Art visão superior com variação de cores.
* **Texturas de Pista:** Asfalto escuro, linhas de marcação neon, linha de chegada holográfica.
* **Obstáculos e Interativos:** Sprites de Placa de Aceleração (acesa/apagada), Zonas de Óleo e Barreiras laterais/físicas.
* **Fundos (Parallax):** Camadas de paralaxe com prédios futuristas, iluminação neon, outdoors corporativos e chuva digital.
* **Interface de Usuário (HUD/UI):** Velocímetro digital, botões virtuais (Esquerda, Direita, Acelerar, Frear), ícones de minimapa, fontes estilo neon e quadros de pontuação.

### 3D
Não é aplicável. O jogo é focado no estilo clássico arcade em 2D/Pixel Art.

### Áudio
* **Trilha Sonora:** 2 a 3 faixas de Synthwave / Retrowave de alta energia.
* **Efeitos Sonoros (SFX):**
    * Ronco do motor (Aceleração e Parado).
    * Som de atrito / derrapagem (Pneus deslizando no asfalto/óleo).
    * Efeito sonoro de ativação do Impulso (Aceleração futurista).
    * Som de impacto/colisão com Barreiras.
    * Sinal sonoro de contagem regressiva (3, 2, 1, VAI!).

### Código
* **Sistema de Física Arcade:** Controle de aceleração, velocidade máxima, desaceleração e fricção.
* **Mecânica de Entrada (Input):** Resposta aos botões virtuais de direção (Esquerda/Direita) e pedais de acelerador/freio.
* **Lógica de Pista:** Colisões com barreiras, gatilhos de áreas (Aceleração / Óleo) e cálculo de aderência.
* **Gerenciador de Corrida:** Contagem de voltas, detecção de ordem dos pontos de checagem (checkpoints), minimapa em tempo real e sistema de ajuste de velocidade relativo (efeito elástico).
* **Sistema Econômico:** Leitura das conquistas durante a prova para cálculo da concessão dos Tijolinhos.

### Animação
* **Carros:** Animação das rodas girando, chama neon saindo do escapamento ao ativar a aceleração e animação de inclinação ao virar (Esquerda/Direita).
* **Cenário:** Animações sutis em outdoors neon, hologramas piscando e chuva caindo no fundo.
* **Pista:** Animação de pulso luminoso nas Placas de Aceleração.
* **Interface:** Animação de transição de telas, efeito de brilho nos botões e números subindo no contador de tijolinhos.

## Cronograma

### Objetivo 1 - Protótipo Base e Controles
* **Escala de Tempo (Time Scale):** Semanas 1 a 3 (Mês 1)
* Programação da física do carro e implementação dos controles via botões virtuais (Acelerar, Frear, Virar).
* Criação da primeira pista de testes usando blocos temporários (placeholders) e configuração da câmera.

### Objetivo 2 - Elementos de Pista e Core Loop
* **Escala de Tempo (Time Scale):** Semanas 4 a 6 (Meses 1 e 2)
* Implementação e programação das Placas Boost, Zonas de Óleo e Barreiras de colisão.
* Criação do sistema de corrida completo (cronômetro, detecção de linha de chegada e limite de 3 voltas).

### Objetivo 3 - Multiplayer e Sistema de Recompensas
* **Escala de Tempo (Time Scale):** Semanas 7 a 9 (Mês 2)
* Integração do sistema de rede para conectar dois jogadores na mesma corrida no formato "Modo Fantasma".
* Programação do sistema de monitoramento de desempenho e cálculo de recompensas de "Tijolinhos" ao final da partida.

### Objetivo 4 - Arte Final, Som e Polimento (Lançamento)
* **Escala de Tempo (Time Scale):** Semanas 10 a 12 (Mês 3)
* Substituição de todas as artes temporárias pelos assets finais em Pixel Art Cyberpunk (carros, luzes, hologramas, interface).
* Implementação da trilha sonora e efeitos de áudio, bateria de testes para correção de bugs e lançamento do jogo.
