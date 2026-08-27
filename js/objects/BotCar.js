import Car from './Car.js';

// Carro-bot: pilota sozinho, sem teclado. Usa "sensores" (pontos
// curtos à frente, na diagonal esquerda e direita) que checam a
// camada de tile "Pista" do mapa — só ali o bot pode andar. Sem tile
// num sensor, é sinal de que aquele lado saiu da pista, e o bot vira
// pro lado que ainda está livre. Isso funciona junto com o collider
// físico contra a camada de objetos "colisao" (igual ao carro do
// jogador, adicionado na RaceScene), que impede o bot de atravessar
// paredes mesmo se a curva for fechada demais pros sensores reagirem
// a tempo.
//
// Rede de segurança contra grama: além dos sensores (que só ajudam o
// bot a NÃO sair da pista), guardamos a última posição/rotação em que
// o próprio carro (não só os sensores) estava de fato sobre a camada
// "Pista". Se por qualquer motivo o corpo do bot acabar saindo da
// pista mesmo assim (curva fechada, empurrão de colisão etc.), ele é
// teleportado de volta pra essa última posição válida com a
// velocidade zerada, em vez de ficar girando sem sair do lugar.
export default class BotCar extends Car {
    constructor(scene, x, y, texture, pistaLayer) {
        super(scene, x, y, texture);

        // O asset "carro" (64x128) é maior e proporcionalmente diferente
        // do "carro1" (64x64) usado pelo Car.js do jogador, então o
        // círculo de colisão herdado (calibrado pro asset do jogador)
        // fica errado aqui. Recalculamos centrado no frame deste asset.
        const frameWidth = this.width;
        const frameHeight = this.height;
        const radius = Math.min(frameWidth, frameHeight) * 0.22;
        this.body.setCircle(radius, frameWidth / 2 - radius, frameHeight / 2 - radius);

        // Camada de tile "Pista": único lugar em que o bot pode andar.
        this.pistaLayer = pistaLayer || null;

        // Distância (px) e abertura (graus) dos sensores em relação à
        // frente do carro.
        this.sensorDist = 50;
        this.sensorAngle = 35;

        // O bot não lê teclado — sobrescrevemos o que o Car.js configurou.
        this.cursors = null;

        // Última posição/rotação em que o CENTRO do bot estava sobre a
        // camada "Pista" (começa no próprio ponto de spawn).
        this.lastGoodX = x;
        this.lastGoodY = y;
        this.lastGoodRotation = this.rotation;
    }

    // Existe tile da camada "Pista" no ponto (px, py)?
    hasTrackTileAt(px, py) {
        if (!this.pistaLayer) {
            // Sem camada de referência, não trava o bot: deixa ele andar.
            return true;
        }
        return !!this.pistaLayer.getTileAtWorldXY(px, py);
    }

    // Existe tile da camada "Pista" no ponto a `angleOffsetDeg` graus de
    // desvio da direção atual do carro, a `this.sensorDist` px de distância?
    isOnTrack(heading, angleOffsetDeg) {
        const angle = heading + Phaser.Math.DegToRad(angleOffsetDeg);
        const px = this.x + Math.cos(angle) * this.sensorDist;
        const py = this.y + Math.sin(angle) * this.sensorDist;
        return this.hasTrackTileAt(px, py);
    }

    // Volta o bot pra última posição válida sobre a pista, zerando
    // velocidade linear e angular — em vez de deixar ele preso girando
    // na grama.
    recoverToTrack() {
        this.setPosition(this.lastGoodX, this.lastGoodY);
        this.setRotation(this.lastGoodRotation);
        this.body.reset(this.lastGoodX, this.lastGoodY);
        this.setAngularVelocity(0);
    }

    update(time, delta) {
        // Se o próprio centro do bot já não está mais sobre a pista, não
        // adianta tentar corrigir com sensor: volta direto pra última
        // posição boa e recomeça a decisão a partir dali.
        if (!this.hasTrackTileAt(this.x, this.y)) {
            this.recoverToTrack();
            return;
        }

        // Mesma correção de -90° do Car.js: a imagem aponta "pra cima".
        const heading = this.rotation - Math.PI / 2;

        const front = this.isOnTrack(heading, 0);
        const left = this.isOnTrack(heading, -this.sensorAngle);
        const right = this.isOnTrack(heading, this.sensorAngle);

        if (!front) {
            // Sensor da frente saiu da pista: vira pro lado que ainda tem
            // pista livre.
            if (left && !right) {
                this.setAngularVelocity(-this.turnSpeed);
            } else if (right && !left) {
                this.setAngularVelocity(this.turnSpeed);
            } else {
                this.setAngularVelocity(this.turnSpeed);
            }
        } else if (!left) {
            this.setAngularVelocity(this.turnSpeed * 0.5);
        } else if (!right) {
            this.setAngularVelocity(-this.turnSpeed * 0.5);
        } else {
            this.setAngularVelocity(0);
        }

        // Acelera sempre pra frente; reduz um pouco enquanto corrige pra
        // não escapar de novo da pista antes de terminar a curva.
        const speedFactor = front ? 1 : 0.5;
        this.scene.physics.velocityFromRotation(
            heading,
            this.acceleration * speedFactor,
            this.body.acceleration
        );

        this.applyGrip(delta);

        // Centro ainda na pista depois de mover: essa posição vira a
        // próxima "última posição boa".
        this.lastGoodX = this.x;
        this.lastGoodY = this.y;
        this.lastGoodRotation = this.rotation;
    }
}
