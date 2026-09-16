import config from './config.js';
import MenuInicial from './scenes/MenuInicialScene.js';
import MenuJogar from './scenes/MenuJogarScene.js';
import Preloader from './scenes/PreloaderScene.js';
import Race from './scenes/RaceScene.js';

class Game extends Phaser.Game {
    constructor() {
        super(config);

        this.scene.add('MenuInicial', MenuInicial);
        this.scene.add('MenuJogar', MenuJogar);
        this.scene.add('Preloader', Preloader);
        this.scene.add('Race', Race);

        this.scene.start('MenuInicial');
    }
}

window.onload = () => {
    const game = new Game();
};
