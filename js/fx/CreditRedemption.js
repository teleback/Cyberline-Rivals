import { loadGoogleIdentity, mountGoogleSignIn, redeemCredit } from '../services/CreditService.js';

/** Optional Google sign-in, scoped to the local player's final race total. */
export default class CreditRedemption {
    constructor(value, onClaimed) {
        this.value = value;
        this.onClaimed = onClaimed;
        this.claimed = false;
        this.pending = false;
        this.destroyed = false;
    }

    get isOpen() { return this.dialog?.open === true; }

    open() {
        if (this.destroyed || this.isOpen || typeof document === 'undefined') return;
        if (!this.dialog) this.createDialog();
        this.previousFocus = document.activeElement;
        this.dialog.showModal();
        this.closeButton.focus();
        if (this.claimed) this.showSuccess();
        else this.prepareSignIn();
    }

    createDialog() {
        const dialog = document.createElement('dialog');
        dialog.className = 'credit-redemption';
        dialog.setAttribute('aria-labelledby', 'credit-title');
        dialog.innerHTML = `
            <h2 id="credit-title">RESGATAR CRÉDITO</h2>
            <p class="credit-amount"></p>
            <p>Vencedor e segundo colocado podem resgatar. Entre com sua conta Google para receber os seus tijolinhos desta partida.</p>
            <div class="credit-google-button"></div>
            <p class="credit-status" role="status" aria-live="polite"></p>
            <button type="button" class="credit-retry" hidden>Tentar novamente</button>
            <button type="button" class="credit-close">Voltar ao resultado</button>`;
        this.dialog = dialog;
        this.googleButton = dialog.querySelector('.credit-google-button');
        this.status = dialog.querySelector('.credit-status');
        this.retryButton = dialog.querySelector('.credit-retry');
        this.closeButton = dialog.querySelector('.credit-close');
        dialog.querySelector('.credit-amount').textContent = `${this.value.toLocaleString('pt-BR')} TIJOLINHOS`;
        this.closeButton.addEventListener('click', () => this.close());
        this.retryButton.addEventListener('click', () => this.prepareSignIn());
        dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        // Keep Enter, Space, Escape and clicks inside the login UI out of Phaser.
        dialog.addEventListener('keydown', event => event.stopPropagation());
        dialog.addEventListener('pointerdown', event => event.stopPropagation());
        document.body.appendChild(dialog);
    }

    async prepareSignIn() {
        if (this.destroyed || !this.isOpen || this.pending || this.claimed) return;
        const attempt = this.signInAttempt = (this.signInAttempt || 0) + 1;
        this.detachSignIn?.();
        this.googleButton.replaceChildren();
        this.googleButton.hidden = false;
        this.retryButton.hidden = true;
        this.status.textContent = 'Carregando login com Google...';
        try {
            const identity = await loadGoogleIdentity();
            if (this.destroyed || !this.isOpen || attempt !== this.signInAttempt) return;
            this.detachSignIn = mountGoogleSignIn(identity, this.googleButton, response => this.submit(response));
            this.status.textContent = 'Após o login, seu crédito será resgatado automaticamente.';
        } catch (error) {
            if (this.destroyed || !this.isOpen || attempt !== this.signInAttempt) return;
            this.status.textContent = error.message;
            this.retryButton.hidden = false;
        }
    }

    async submit(response) {
        if (this.destroyed || !this.isOpen || this.pending || this.claimed) return;
        this.pending = true;
        this.googleButton.hidden = true;
        this.retryButton.hidden = true;
        this.closeButton.disabled = true;
        this.dialog.setAttribute('aria-busy', 'true');
        this.status.textContent = 'Resgatando seu crédito...';
        try {
            await redeemCredit(response?.credential, this.value);
            this.claimed = true;
            if (!this.destroyed) {
                this.showSuccess();
                this.onClaimed?.();
            }
        } catch (error) {
            if (!this.destroyed) {
                this.status.textContent = error instanceof TypeError
                    ? 'Falha de conexão ao resgatar. Verifique sua conexão e tente novamente.' : error.message;
                this.retryButton.hidden = false;
            }
        } finally {
            this.pending = false;
            if (!this.destroyed) {
                this.closeButton.disabled = false;
                this.dialog.setAttribute('aria-busy', 'false');
            }
        }
    }

    showSuccess() {
        this.detachSignIn?.();
        this.googleButton.hidden = true;
        this.retryButton.hidden = true;
        this.status.textContent = 'Crédito resgatado com sucesso!';
    }

    close() {
        if (this.pending || !this.isOpen) return;
        this.detachSignIn?.();
        this.signInAttempt++;
        this.dialog.close();
        this.previousFocus?.focus?.();
    }

    destroy() {
        this.destroyed = true;
        this.detachSignIn?.();
        this.dialog?.close();
        this.dialog?.remove();
    }
}
