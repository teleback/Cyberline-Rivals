# Cyberline Rivals

## Premissa
Em uma cidade futurista dominada por luzes de neon, as corridas clandestinas são a única forma de conquistar fama e respeito. Enfrente pilotos habilidosos em disputas eletrizantes, onde velocidade, reflexos e estratégia fazem toda a diferença. Supere seus adversários e prove que você tem o que é preciso para chegar ao topo. Ligue os motores, desafie seus rivais e acelere rumo à glória!

## Universo do jogo
Em uma metrópole futurista dominada por grandes corporações, tecnologia de ponta e luzes neon, as corridas clandestinas tornaram-se o maior espetáculo da cidade. Nesse cenário noturno e competitivo, vias urbanas, viadutos e bairros tecnológicos transformam-se em circuitos perigosos. Para os pilotos, acelerar por esses cenários é a única forma de conquistar dinheiro, fama e respeito.

## Referências
O jogo é inspirado em clássicos de corrida arcade, como:

Barbie:Super Model

Fast like a fox

Neon Rider

Trazendo uma jogabilidade simples e divertida. A estética é baseada no gênero Cyberpunk, com cidades iluminadas por neon, carros futuristas e atmosfera noturna, além de gráficos em pixel art.

## Objetivos
- Proporcionar partidas rápidas e divertidas entre dois jogadores.
- Completar 3 voltas antes do adversário.
- Vencer seus amigos no modo multiplayer.
- Realizar uma corrida perfeita, sem bater em obstáculos.

## Personagens
O jogo não possui personagens jogáveis tradicionais, mas sim pilotos representados por carros futuristas. Cada carro possui uma aparência única inspirada no universo cyberpunk, permitindo que os jogadores escolham seu veículo favorito.

## Artefatos

*  Carros futuristas em pixel art.
*  Pistas urbanas com estética cyberpunk e iluminação neon.
*  Cenários compostos por prédios, hologramas e placas luminosas.
*  **Placas Boost** que aumentam temporariamente a velocidade do veículo.
*  **Barreiras** que penalizam colisões, reduzindo a velocidade do carro.
*  **Zonas de Óleo** que diminuem a aderência e dificultam.
* **Interface (HUD) com:**

  * Velocidade do veículo.
  * Volta atual.
  * Posição na corrida.
  * Mini mapa da pista.
  * Botões virtuais para acelerar, frear e virar (dispositivos móveis).

## Condução

Seta para cima acelera; para baixo freia e, mantendo pressionada depois de
parar, engata a ré. Freio e direção juntos em velocidade iniciam um drift;
solte o freio e acelere para recuperar a aderência na saída da curva. Shift
com aceleração aciona o turbo. O freio tem prioridade se ambos forem apertados.

O controle padrão usa direção analógica; o controle SNES usa o D-pad e os
botões L (aceleração) e R (turbo). No celular, aponte o joystick fixo para
onde quer ir na tela: esquerda, direita, cima, baixo ou diagonais. O carro
acelera e se orienta nessa direção; segurar o gesto mantém o rumo sem girar
continuamente. Centralizar ou soltar encerra a aceleração e o giro.
Use os pedais **ACELERAR**, **FREIO/RÉ** e **TURBO** à direita; mantenha
FREIO/RÉ pressionado para recuar. Puxar o joystick para baixo aponta o carro
para baixo. O mesmo polegar pode deslizar entre os pedais. A direção tem mais
aderência, reduz a velocidade nas curvas fechadas e não inicia drift ao frear.
Comece o gesto no círculo do canto inferior esquerdo. Os ajustes de aceleração,
pneus, frenagem, resposta direcional e ré ficam em `js/objects/CarHandling.js`.

As colisões com meio-fio conservam o movimento ao longo da parede e aplicam
um recuo pequeno. Os pontos do mapa formam superfícies contínuas, e os
contatos são verificados ao longo do deslocamento para impedir que um boost
atravesse paredes finas. Barris desviam o carro nas batidas frontais e têm
uma animação curta de impacto, sem reduzir repetidamente toda a velocidade.

## Tijolinhos e resultado da corrida

- Cada tijolinho coletado na pista vale **1 tijolinho**. A coleta é compartilhada: quando um piloto pega, o outro não pode pegar o mesmo tijolinho naquela volta.
- Completar uma volta válida, passando por todos os checkpoints: **+10 tijolinhos**.
- Terminar as três voltas: **+20 tijolinhos**.
- Vencer a corrida: **+50 tijolinhos**, somente para o primeiro colocado.

Os tijolinhos da pista reaparecem por volta, mantendo um único dono por tijolinho e por volta. As coletas são confirmadas pelo coordenador da partida e sincronizadas entre os dois jogadores, inclusive em caso de mensagens repetidas.

O resultado mostra os dois carros animados, o primeiro e o segundo colocado, o tempo de cada piloto e os tijolinhos ganhos com a coleta e as recompensas. O menor tempo decide o vencedor; não há multiplicador de pontuação por tempo. Os valores das recompensas ficam em `js/objects/RaceRewards.js`.
