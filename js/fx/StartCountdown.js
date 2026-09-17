/**
 * StartCountdown — "3, 2, 1, VAI!" na tela depois que o carro pousa.
 *
 * Os tempos em BEAT_TIMES não são um chute: foram medidos direto na forma
 * de onda do áudio (assets/images/audio/countdown.mp3, já recortado do arquivo
 * original só com a sequência de bips). Cada número aparece no instante
 * exato em que o bip correspondente toca — sem isso, texto e som andam
 * juntos só por sorte e desalinham no primeiro dispositivo mais lento.
 *
 * `onGo` é chamado no mesmo instante em que "VAI!" aparece — é esse
 * callback que a RaceScene usa pra destravar `car.controlsEnabled`.
 */
const BEAT_TIMES = [0.12, 1.12, 2.10, 3.12]; // segundos, medidos no áudio
const LABELS = ['3', '2', '1', 'VAI!'];
const COLORS = ['#00e5ff', '#00e5ff', '#00e5ff', '#ff2d55'];

export default class StartCountdown {
    constructor(scene) {
        this.scene = scene;
        const { width, height } = scene.scale;

        this.text = scene.add.text(width / 2, height / 2, '', {
            fontFamily: 'monospace',
            fontSize: '108px',
            fontStyle: 'bold',
            color: '#00e5ff',
            stroke: '#0a0c14',
            strokeThickness: 12
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(3000)
            .setAlpha(0);

        // É um elemento de tela (HUD), não do mundo: some da câmera
        // principal (que carrega os filtros de turbo) e só existe na uiCam.
        scene.cameras.main.ignore(this.text);
    }

    /** Toca a sequência inteira; chama onGo() no instante do "VAI!". */
    play(onGo) {
        const scene = this.scene;

        try {
            if (scene.cache.audio.exists('countdown')) {
                this.sound = scene.sound.add('countdown');
                this.sound.play();
            }
        } catch (e) {
            // Som é enfeite: se falhar (autoplay bloqueado, decode etc.), a
            // contagem visual e a liberação dos controles seguem normais.
            console.error('StartCountdown: falha ao tocar o áudio', e);
        }

        BEAT_TIMES.forEach((t, i) => {
            scene.time.delayedCall(t * 1000, () => this.showBeat(i));
        });

        const goTime = BEAT_TIMES[BEAT_TIMES.length - 1];
        scene.time.delayedCall(goTime * 1000, () => { if (onGo) onGo(); });
        scene.time.delayedCall((goTime + 0.9) * 1000, () => this.hide());
    }

    showBeat(i) {
        try {
            const label = LABELS[i];
            this.text.setText(label).setColor(COLORS[i]).setAlpha(1).setScale(1.5);

            this.scene.tweens.add({
                targets: this.text,
                scale: 1,
                duration: 220,
                ease: 'Back.easeOut'
            });

            // "VAI!" pisca a tela de leve — é o mesmo tipo de pontuação que o
            // TurboFX usa no acionamento do turbo, só que mais sutil aqui.
            if (label === 'VAI!') {
                this.scene.cameras.main.flash(180, 0, 229, 255);
            }
        } catch (e) {
            console.error('StartCountdown: falha ao mostrar número', e);
        }
    }

    hide() {
        if (!this.text.active) return;
        this.scene.tweens.add({
            targets: this.text,
            alpha: 0,
            duration: 280,
            onComplete: () => this.text.destroy()
        });
    }
}
