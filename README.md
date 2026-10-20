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
Após a batida, somente o barril atingido deixa de bloquear o carro por
0,7 segundo. Se o carro ainda estiver sobre ele, a colisão só volta depois
que sair, evitando travamentos. As paredes e os demais barris continuam sólidos.

As batidas entre pilotos consideram o movimento relativo dos dois carros,
inclusive durante o boost. Raspadas preservam a maior parte da velocidade;
batidas frontais têm mais peso. A separação respeita os muros da pista e não
reposiciona o rival recebido pela rede. Faíscas, um pulso curto e um som grave
em volume baixo marcam o impacto, com intervalo para evitar efeitos repetidos.
O som acompanha o volume geral e a tecla **M**.

A garagem tem **6 carros**, incluindo **AMBER GT** (grafite/âmbar) e
**ION INTERCEPTOR** (branco/ciano), com modelos próprios e a mesma física.
Os novos sprites já vêm no tamanho final de 102 × 166 pixels e pesam cerca
de 15 KB cada. A escolha vale também para a corrida, o rival e o resultado.
Os nicks dos dois jogadores usam placas compactas com borda na cor do carro.

A linha de largada/chegada bloqueia a passagem no sentido contrário, tanto
de ré quanto com o carro virado. A passagem no sentido da corrida fica livre
para largar e completar as voltas.

## Tijolinhos e resultado da corrida

- Cada tijolinho coletado na pista vale **1 tijolinho**. A coleta é compartilhada: quando um piloto pega, o outro não pode pegar o mesmo tijolinho naquela volta.
- Completar uma volta válida, passando por todos os checkpoints: **+10 tijolinhos**.
- Terminar as três voltas: **+20 tijolinhos**.
- Vencer a corrida: **+50 tijolinhos**, somente para o primeiro colocado.

Os tijolinhos da pista reaparecem por volta, mantendo um único dono por tijolinho e por volta. As coletas são confirmadas pelo coordenador da partida e sincronizadas entre os dois jogadores, inclusive em caso de mensagens repetidas.

O resultado mostra os dois carros animados, o primeiro e o segundo colocado, o tempo de cada piloto e os tijolinhos ganhos com a coleta e as recompensas. O menor tempo decide o vencedor; não há multiplicador de pontuação por tempo. Os valores das recompensas ficam em `js/objects/RaceRewards.js`.

O campeão fica em destaque dourado, com o detalhamento dos ganhos e o total de tijolinhos em cada cartão. Ao terminar a contagem, aparece **VOLTAR AO MENU**, disponível por toque, clique, Enter, Espaço, Esc ou uma nova confirmação no controle. A saída libera a presença na sala e permite iniciar outra partida sem recarregar a página.

Há **10 salas**, com limite de **2 pilotos por sala** e ocupação ao vivo.
Salas completas mostram **PARTIDA EM ANDAMENTO** e bloqueiam outra entrada.
A lista usa páginas para manter os cartões legíveis no celular; toque nas
setas ou deslize para ver as outras salas. Teclado e controle também navegam
entre as páginas. A entrada aguarda a verificação da ocupação.

No celular, o turbo usa um perfil visual mais leve, com menos partículas e rastros, sem os filtros de tela nem a sombra animada do canvas. O impulso e o consumo do turbo continuam com as mesmas regras.

As placas de boost têm acabamento metálico, bordas ciano/violeta e três setas
que acendem em sequência no sentido do impulso. Ao passar por elas, uma
onda dupla se expande pelo asfalto, com faíscas direcionais e um rastro
elétrico curto atrás do carro. Os efeitos são reutilizados; no celular,
o pulso usa uma onda e menos partículas e rastros. As oito placas mantêm
as mesmas posições, dimensões e regras de aceleração.


## Desempenho e iluminação

O cenário reaproveita os blocos visíveis até a câmera mudar de área e pula
as partes vazias das camadas. O cache de luzes só é atualizado ao mudar de
bloco, mantendo uma margem para o movimento e o zoom. Luzes de carros fora
da tela ficam suspensas até seus faróis se aproximarem da câmera.

A pista tem menos escurecimento e halos mais suaves. O turbo mantém uma
mudança discreta de cor no computador, com a pista nítida; no celular,
fumaça e marcas de pneu também usam limites menores e objetos reutilizados.
Os refletores de borda são gravados uma vez em blocos de textura de meia
resolução; somente os blocos próximos da câmera ficam visíveis. Os impactos
reutilizam emissores e imagens, com até 8 faíscas por batida no celular.

O cenário respeita os deslocamentos definidos no Tiled. Prédios, contêineres,
sucata, cercas, arbustos e postes foram ajustados para liberar o asfalto ao
longo de todo o circuito. Nas ilhas estreitas, as propriedades
`sceneryScaleX` e `sceneryScaleY` ajustam a arte uma vez no carregamento;
os letreiros e suas luzes acompanham o tamanho e a posição da fachada.

Verificação automatizada: `node --test tests/*.test.mjs`.
