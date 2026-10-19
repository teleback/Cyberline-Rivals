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
   rastro fica mais intenso, o assobio sobe de tom, o volante fica mais
   pesado. Você sente que está carregando alguma coisa.
3. **A conta.** Esvaziou o tanque → **superaquece**: turbo travado por 1.8s,
   recarga pela metade, tela pisca vermelha, tranco forte. Bater na parede em
   pleno turbo também mata a turbina e queima parte do tanque.

O item 3 é o que transforma o turbo numa decisão. Sem custo, o correto é segurar
SHIFT o tempo todo — e aí o efeito vira papel de parede.

## Pós-processamento

No computador com WebGL, a câmera usa apenas uma matriz de cor suave:
a saturação sobe até 0,18 e o brilho até 4%. A matriz é reaproveitada enquanto
a intensidade permanece na mesma faixa. O glow do carro também ficou menor.
O turbo mantém o zoom, a antecipação da câmera, as chamas e os rastros, com a
pista nítida e sem os passes de blur, distorção e vinheta.

No renderizador Canvas, a matriz de cor é pulada e os demais efeitos continuam
funcionando.

No celular (ou com `?touch=1`), os filtros de câmera e o glow por shader são
pulados mesmo em WebGL. As partículas têm limites menores, os rastros usam
quatro sprites reutilizados sem criar tweens, e a sombra CSS animada fica
desativada. O som é preparado durante a entrada do carro e usa o contexto de
áudio do jogo, liberando seus nós ao voltar ao menu.

**O HUD fica numa segunda câmera**, com os textos e o minimapa livres dos
efeitos de cor da corrida.

## Ajustes que talvez você queira mexer

Tudo concentrado no topo de `Car.js`:

- `turboKick` (120) — força do soco inicial. É o que mais muda a "pegada".
- `turboSpoolPerSec` (1.1) — velocidade da rampa. Menor = turbina mais preguiçosa.
- `overheatDuration` (1800ms) — o tamanho da punição.
- `turboDrainPerSec` / `turboRechargePerSec` — o ritmo do recurso.

No `TUNING` do `TurboFX.js`, `zoomOut` controla a abertura da câmera,
`streakAlpha` controla a opacidade dos riscos, `glow` controla o brilho do
carro e `saturation`/`brightness` controlam a mudança suave de cor.

O som liga e desliga com **M**.
