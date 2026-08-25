import config from './config.js';
import Start from './scenes/StartScene.js';
import Preloader from './scenes/PreloaderScene.js';
import Race from './scenes/RaceScene.js';

class Game extends Phaser.Game {
    constructor() {
        super(config);

        this.scene.add('Start', Start);
        this.scene.add('Preloader', Preloader);
        this.scene.add('Race', Race);

        this.scene.start('Start');
    }
}

window.onload = () => {
    const game = new Game();
};
