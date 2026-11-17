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

O controle padrão usa direção analógica; no controle SNES, use **esquerda/direita**
do D-pad para virar, **B** para acelerar, **Y** para turbo e **A** para frear
ou engatar a ré. O botão Y também acelera enquanto o turbo estiver pressionado;
A tem prioridade sobre B e Y. Cima/baixo do D-pad navega nos menus, mas não
controla a aceleração durante a corrida. Se o controle tiver outra numeração
de botões, aperte **T** no teclado durante o jogo para calibrar B, Y e A.
No celular, aponte o joystick fixo para
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
um recuo mais forte nas batidas de frente, sustentado por um instante para
o carro se afastar mesmo com o acelerador pressionado. Freio e ré continuam
disponíveis durante a recuperação. Os pontos do mapa formam superfícies
contínuas, e os contatos são verificados ao longo do deslocamento para impedir que um boost
atravesse paredes finas. Frente e traseira acompanham a rotação do carro,
evitando que a carroceria entre no muro antes do contato. Trechos próximos
do meio-fio se unem mesmo quando estão fora de ordem no editor.
Barris fazem o carro recuar nas batidas frontais e têm uma animação curta
de impacto, sem reduzir repetidamente toda a velocidade. O recuo dura um
instante mesmo segurando o acelerador; freio, ré e direção seguem disponíveis.
Os barris permanecem sólidos após o impacto: o carro recua e uma nova
aproximação provoca outra batida, inclusive durante a recuperação e com turbo.
Freio, ré e direção permitem se afastar ou contornar o obstáculo.

As batidas entre pilotos consideram o movimento relativo dos dois carros,
inclusive durante o boost. Raspadas preservam a maior parte da velocidade;
batidas frontais têm mais peso. A separação respeita os muros da pista e não
reposiciona o rival recebido pela rede. Faíscas, um pulso curto e um som grave
em volume baixo marcam o impacto, com intervalo para evitar efeitos repetidos.
O som acompanha o volume geral e a tecla **M**.

A garagem tem **6 carros** com modelos próprios e a mesma física.
Os nicks dos dois jogadores usam placas compactas com borda na cor do carro.

A linha de largada/chegada bloqueia a passagem no sentido contrário, tanto
de ré quanto com o carro virado. A passagem no sentido da corrida fica livre
para largar e completar as voltas.

## Tijolinhos e resultado da corrida

- Cada tijolinho coletado na pista vale **1 tijolinho**. A coleta é compartilhada: quando um piloto pega, o outro não pode pegar o mesmo tijolinho naquela volta.
- Vencer a corrida: **+40 tijolinhos**, somente para o primeiro colocado.

Completar voltas e cruzar a chegada não concedem tijolinhos extras.

Os tijolinhos da pista reaparecem por volta, mantendo um único dono por tijolinho e por volta. As coletas são confirmadas pelo coordenador da partida e sincronizadas entre os dois jogadores, inclusive em caso de mensagens repetidas.

O resultado mostra os dois carros animados, o primeiro e o segundo colocado, o tempo de cada piloto e os tijolinhos ganhos com a coleta e as recompensas. O menor tempo decide o vencedor; não há multiplicador de pontuação por tempo. Os valores das recompensas ficam em `js/objects/RaceRewards.js`.

Há **10 salas**, com limite de **2 pilotos por sala** e ocupação ao vivo.
Salas completas mostram **PARTIDA EM ANDAMENTO** e bloqueiam outra entrada.
A lista usa páginas para manter os cartões legíveis no celular; toque nas
setas ou deslize para ver as outras salas. Teclado e controle também navegam
entre as páginas. A entrada aguarda a verificação da ocupação.
