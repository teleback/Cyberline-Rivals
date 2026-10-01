// Tela de identificação local antes da seleção do carro. O nome fica disponível
// nas próximas cenas e poderá ser usado como identificação visual no multiplayer MQTT.
class NicknameScene extends Phaser.Scene {
    constructor() {
        super('Nickname');
        this.nicknameElement = null;
    }

    create() {
        const { width, height } = this.scale;
        this.cameras.main.setBackgroundColor('#05060a');
        this.add.rectangle(width / 2, height / 2, width, height, 0x05060a);
        this.add.rectangle(width / 2, height * 0.23, width * 0.72, 2, 0x00e5ff, 0.8);
        this.add.rectangle(width / 2, height * 0.77, width * 0.72, 2, 0xff3355, 0.5);

        this.add.text(width / 2, height * 0.30, 'IDENTIFICAÇÃO DO PILOTO', {
            fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold',
            color: '#ffffff', stroke: '#00e5ff', strokeThickness: 1,
            align: 'center', wordWrap: { width: width * 0.85 }
        }).setOrigin(0.5);
        this.add.text(width / 2, height * 0.40, 'DIGITE SEU NICK PARA COMPETIR', {
            fontFamily: 'monospace', fontSize: '12px', color: '#8ea0b5'
        }).setOrigin(0.5);

        const overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:500', 'display:flex',
            'flex-direction:column', 'align-items:center', 'justify-content:center',
            'gap:12px', 'pointer-events:none', 'font-family:monospace'
        ].join(';');

        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 16;
        input.autocomplete = 'nickname';
        input.placeholder = 'SeuNick';
        input.setAttribute('aria-label', 'Nick do jogador');
        input.value = this.getSavedNickname();
        input.style.cssText = [
            'pointer-events:auto', 'box-sizing:border-box', 'width:min(320px,75vw)',
            'padding:12px 14px', 'background:#0a1020', 'color:#ffffff',
            'border:2px solid #00e5ff', 'outline:none', 'border-radius:3px',
            'font: bold 18px monospace', 'text-align:center',
            'box-shadow:0 0 18px rgba(0,229,255,.22)', 'touch-action:auto',
            'user-select:text', '-webkit-user-select:text'
        ].join(';');

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'CONTINUAR  ›';
        button.style.cssText = [
            'pointer-events:auto', 'padding:10px 22px', 'background:#101722',
            'color:#00e5ff', 'border:1px solid #00e5ff', 'border-radius:3px',
            'font:bold 14px monospace', 'cursor:pointer', 'touch-action:manipulation'
        ].join(';');

        const error = document.createElement('div');
        error.style.cssText = 'color:#ff6688;font:12px monospace;min-height:16px;text-align:center';
        error.setAttribute('role', 'alert');
        overlay.append(input, button, error);
        document.body.appendChild(overlay);
        this.nicknameElement = overlay;

        const continueToCars = () => {
            const nick = input.value.trim().replace(/\s+/g, ' ');
            if (!nick) {
                error.textContent = 'DIGITE UM NICK PARA CONTINUAR';
                input.focus();
                return;
            }
            if (nick.length < 2) {
                error.textContent = 'O NICK PRECISA TER PELO MENOS 2 CARACTERES';
                input.focus();
                return;
            }
            const safeNick = nick.slice(0, 16);
            try { localStorage.setItem('cyberlinePlayerNick', safeNick); } catch (_) {}
            this.scene.start('RoomSelection', { playerNick: safeNick });
        };

        button.addEventListener('click', continueToCars);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                continueToCars();
            }
        });
        input.addEventListener('input', () => { error.textContent = ''; });

        this.events.once('shutdown', () => {
            if (this.nicknameElement && this.nicknameElement.parentNode) {
                this.nicknameElement.parentNode.removeChild(this.nicknameElement);
            }
            this.nicknameElement = null;
        });
        this.time.delayedCall(100, () => input.focus());
    }

    getSavedNickname() {
        try { return localStorage.getItem('cyberlinePlayerNick') || ''; }
        catch (_) { return ''; }
    }
}

export default NicknameScene;
