export const GOOGLE_CLIENT_ID = '331191695151-ku8mdhd76pc2k36itas8lm722krn0u64.apps.googleusercontent.com';
export const CREDIT_ENDPOINT = 'https://feira-de-jogos.dev.br/api/v2/credit';
// TODO: alterar o product para o identificador definitivo do jogo na API.
export const CREDIT_PRODUCT = 'cyberline-rivals';

let libraryPromise;
let initializedIdentity;
let activeSignIn;
let signInSequence = 0;

// Load only when a player chooses to redeem; a blocked SDK never delays the game.
export function loadGoogleIdentity() {
    if (globalThis.google?.accounts?.id) return Promise.resolve(globalThis.google.accounts.id);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const finish = error => {
            clearTimeout(timeout);
            script.onload = script.onerror = null;
            if (error) {
                script.remove();
                reject(error);
            } else resolve(globalThis.google.accounts.id);
        };
        const timeout = setTimeout(() => finish(new Error('Google indisponível. Tente novamente.')), 15000);
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => finish(globalThis.google?.accounts?.id ? null
            : new Error('Não foi possível carregar o login com Google.'));
        script.onerror = () => finish(new Error('Não foi possível carregar o login com Google. Verifique sua conexão.'));
        document.head.appendChild(script);
    }).catch(error => {
        libraryPromise = null;
        throw error;
    });
    return libraryPromise;
}

export function mountGoogleSignIn(identity, container, callback) {
    if (initializedIdentity !== identity) {
        identity.initialize({
            client_id: GOOGLE_CLIENT_ID,
            auto_select: false,
            ux_mode: 'popup',
            use_fedcm_for_button: true,
            callback: response => {
                // Ignore a popup belonging to a closed dialog or a previous race.
                if (activeSignIn && activeSignIn.state === response.state) activeSignIn.callback(response);
            },
        });
        initializedIdentity = identity;
    }
    const signIn = { state: `credit-${++signInSequence}`, callback };
    activeSignIn = signIn;
    identity.renderButton(container, {
        type: 'standard', theme: 'outline', size: 'large', text: 'signin_with',
        locale: 'pt-BR', width: 240, state: signIn.state,
    });
    return () => { if (activeSignIn === signIn) activeSignIn = null; };
}

export async function redeemCredit(token, value) {
    if (typeof token !== 'string' || !token.trim()) throw new Error('Entre com sua conta Google para resgatar.');
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Não há tijolinhos para resgatar.');
    const response = await fetch(CREDIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ product: CREDIT_PRODUCT, value }),
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error('Login não autorizado. Entre novamente com o Google.');
        }
        throw new Error('Não foi possível resgatar o crédito. Tente novamente.');
    }
}
