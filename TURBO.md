# Feedback do turbo — o que mudou

Só os arquivos alterados/novos estão neste zip. É só descompactar por cima do
projeto, mantendo a estrutura de pastas. Não precisa mexer no `index.html`, no
`config.js` nem no `PreloaderScene.js`, e nenhum asset novo foi adicionado —
todas as texturas de partícula são geradas em tempo de execução, e o som é
sintetizado com WebAudio.

```
js/fx/TurboFX.js        (novo)      efeitos visuais
js/fx/TurboAudio.js     (novo)      som sintetizado
js/objects/Car.js       (alterado)  máquina de estados do turbo
js/scenes/RaceScene.js  (alterado)  ligação, HUD, câmera de UI
js/scenes/StartScene.js (alterado)  tela de controles
style.css               (alterado)  brilho da moldura
```

## A ideia

O turbo antigo era binário: segurou SHIFT, o carro anda mais rápido e uma barra
muda de cor. Isso é *informação*, não é *sensação*.

O novo turbo gira em torno de um único número, `car.turboIntensity`, que vai de
0 a 1, sobe rápido e desce devagar. Nada no jogo lê "turbo ligado/desligado" —
tudo lê esse número contínuo. É isso que faz o efeito parecer físico em vez de
parecer um interruptor.

Três fases, e cada uma tem um som e uma imagem próprios:

1. **O soco.** No frame do acionamento, um impulso instantâneo de velocidade,
   flash, shake curto, explosão de faíscas e um chiado seco.
2. **A rampa.** A turbina "enche" ao longo de ~0.9s. O empurrão cresce, a
   imagem entorta cada vez mais, o assobio sobe de tom, o volante fica mais
   pesado. Você sente que está carregando alguma coisa.
3. **A conta.** Esvaziou o tanque → **superaquece**: turbo travado por 1.8s,
   recarga pela metade, tela pisca vermelha, tranco forte. Bater na parede em
   pleno turbo também mata a turbina e queima parte do tanque.

O item 3 é o que transforma o turbo numa decisão. Sem custo, o correto é segurar
SHIFT o tempo todo — e aí o efeito vira papel de parede.

## Pós-processamento

Quatro filtros na câmera principal (API de Filters do Phaser 4), todos com o
parâmetro amarrado à intensidade:

| Filtro | O que faz |
|---|---|
| Barrel | estufa a imagem; a periferia corre mais que o centro |
| Blur direcional | borrão no eixo do movimento, crescendo de forma quadrática |
| ColorMatrix | satura, clareia e puxa o matiz — o mundo acende |
| Vignette | fecha e tinge as bordas de magenta; vira túnel |

Exigem WebGL. Se o renderer cair pra Canvas, essa camada é pulada e o resto
continua funcionando.

**O HUD ficou numa segunda câmera**, sem filtro. Era o ponto mais fácil de
errar: se o HUD passasse pelo mesmo pipeline, o texto entortaria com o barrel e
borraria com o blur justamente na hora em que você mais precisa ler o tanque.

## Ajustes que talvez você queira mexer

Tudo concentrado no topo de `Car.js`:

- `turboKick` (120) — força do soco inicial. É o que mais muda a "pegada".
- `turboSpoolPerSec` (1.1) — velocidade da rampa. Menor = turbina mais preguiçosa.
- `overheatDuration` (1800ms) — o tamanho da punição.
- `turboDrainPerSec` / `turboRechargePerSec` — o ritmo do recurso.

E no `update()` do `TurboFX.js`, os tetos de cada efeito (`0.16` do barrel,
`1.6` do blur, `0.075` do zoom). Se quiser algo mais agressivo, o barrel e o
zoom são os que dão mais retorno; o blur é o que suja a imagem mais rápido.

O som liga e desliga com **M**.
