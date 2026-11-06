import assert from 'node:assert/strict';
import { test } from 'node:test';
import CreditRedemption from '../js/fx/CreditRedemption.js';
import { CREDIT_ENDPOINT, CREDIT_PRODUCT, GOOGLE_CLIENT_ID, loadGoogleIdentity,
    mountGoogleSignIn, redeemCredit } from '../js/services/CreditService.js';

function setGlobal(t, key, value) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else delete globalThis[key];
    });
}

function identityStub() {
    return {
        initializations: [], buttons: [],
        initialize(config) { this.initializations.push(config); this.callback = config.callback; },
        renderButton(container, config) { this.buttons.push({ container, config }); },
        signIn(credential = 'google-id-token', state = this.buttons.at(-1).config.state) {
            this.callback({ credential, state });
        },
    };
}

function element() {
    return {
        hidden: false, disabled: false, open: false, children: [], attributes: {}, listeners: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(key, callback) { this.listeners[key] = callback; },
        appendChild(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
        querySelector(selector) { this.elements ??= {}; return this.elements[selector] ??= element(); },
        showModal() { this.open = true; }, close() { this.open = false; },
        focus() { this.focused = true; }, remove() { this.removed = true; },
    };
}

function setup(t, value = 69) {
    const identity = identityStub();
    const document = { body: element(), head: element(), activeElement: element(), createElement: element };
    setGlobal(t, 'document', document);
    setGlobal(t, 'google', { accounts: { id: identity } });
    let claimed = 0;
    const redemption = new CreditRedemption(value, () => { claimed++; });
    t.after(() => redemption.destroy());
    return { redemption, identity, document, get claimed() { return claimed; } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('credit request sends exactly the product and whole earned total with Google Bearer authentication', async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (...args) => { requests.push(args); return { ok: true, status: 204 }; });
    await redeemCredit('google-id-token', 117);
    assert.equal(requests.length, 1);
    const [url, options] = requests[0];
    assert.equal(url, CREDIT_ENDPOINT);
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer google-id-token' });
    assert.deepEqual(JSON.parse(options.body), { product: CREDIT_PRODUCT, value: 117 });
});

test('missing authentication and invalid brick values never call the API', async t => {
    const fetch = t.mock.method(globalThis, 'fetch');
    for (const token of [undefined, '', ' ', 123]) await assert.rejects(redeemCredit(token, 69), /Google/);
    for (const value of [0, -1, 1.5, NaN, Infinity, '69']) await assert.rejects(redeemCredit('token', value), /tijolinhos/);
    assert.equal(fetch.mock.callCount(), 0);
});

test('HTTP authentication and server failures are not reported as success', async t => {
    const fetch = t.mock.method(globalThis, 'fetch');
    for (const status of [401, 403, 500]) {
        fetch.mock.mockImplementation(async () => ({ ok: false, status }));
        await assert.rejects(redeemCredit('token', 69), status === 500 ? /Tente novamente/ : /não autorizado/);
    }
});

test('Google uses the supplied client ID, initializes once, and ignores stale sign-in dialogs', () => {
    const identity = identityStub(), received = [];
    const detachFirst = mountGoogleSignIn(identity, {}, response => received.push(['first', response]));
    assert.equal(identity.initializations[0].client_id, GOOGLE_CLIENT_ID);
    assert.equal(identity.initializations[0].ux_mode, 'popup');
    const oldState = identity.buttons[0].config.state;
    const detachSecond = mountGoogleSignIn(identity, {}, response => received.push(['second', response]));
    detachFirst();
    identity.signIn('stale', oldState);
    identity.signIn('current');
    assert.equal(identity.initializations.length, 1);
    assert.deepEqual(received.map(([dialog, response]) => [dialog, response.credential]), [['second', 'current']]);
    detachSecond();
    identity.signIn('closed');
    identity.callback({ credential: 'without-button-state' });
    assert.equal(received.length, 1);
});

test('sign-in automatically redeems once, blocks concurrent callbacks, and preserves success on reopen', async t => {
    const state = setup(t);
    let complete, requests = [];
    t.mock.method(globalThis, 'fetch', (...args) => {
        requests.push(args);
        return new Promise(resolve => { complete = resolve; });
    });
    const { redemption, identity } = state;
    redemption.open();
    await flush();
    assert.equal(requests.length, 0, 'opening the dialog alone never redeems');
    identity.signIn();
    identity.signIn();
    assert.equal(redemption.pending, true);
    assert.equal(redemption.closeButton.disabled, true);
    redemption.close();
    assert.equal(redemption.isOpen, true, 'an in-flight resgate keeps its result visible');
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0][1].body).value, 69);
    complete({ ok: true });
    await flush();
    assert.equal(state.claimed, 1);
    assert.equal(redemption.claimed, true);
    assert.match(redemption.status.textContent, /sucesso/);
    redemption.close();
    redemption.open();
    identity.signIn();
    assert.equal(requests.length, 1, 'reopening a claimed race never redeems again');
});

test('failed redemption keeps the earned total and permits an explicit retry', async t => {
    const state = setup(t, 117);
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => ({ ok: ++requests > 1, status: 503 }));
    state.redemption.open();
    await flush();
    state.identity.signIn();
    await flush();
    assert.equal(state.claimed, 0);
    assert.equal(state.redemption.claimed, false);
    assert.equal(state.redemption.pending, false);
    assert.equal(state.redemption.retryButton.hidden, false);
    assert.equal(state.redemption.closeButton.disabled, false);
    assert.equal(requests, 1, 'errors do not automatically repeat a credit request');
    await state.redemption.prepareSignIn();
    state.identity.signIn('new-token');
    await flush();
    assert.equal(state.redemption.value, 117);
    assert.equal(state.claimed, 1);
    assert.equal(requests, 2);
});

test('redeeming the winner does not block the runner-up and each request has its own earnings and token', async t => {
    const { redemption: runnerUp, identity } = setup(t, 19);
    const winner = new CreditRedemption(54);
    t.after(() => winner.destroy());
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ body: JSON.parse(options.body), token: options.headers.Authorization });
        return { ok: true };
    });
    for (const [player, token] of [[winner, 'winner-google-token'], [runnerUp, 'runner-up-google-token']]) {
        player.open();
        await flush();
        identity.signIn(token);
        await flush();
        assert.equal(player.claimed, true);
        player.close();
    }
    assert.deepEqual(requests, [
        { body: { product: CREDIT_PRODUCT, value: 54 }, token: 'Bearer winner-google-token' },
        { body: { product: CREDIT_PRODUCT, value: 19 }, token: 'Bearer runner-up-google-token' },
    ]);
});

test('closing or destroying a dialog ignores late Google callbacks', async t => {
    const { redemption, identity, document } = setup(t);
    const fetch = t.mock.method(globalThis, 'fetch');
    redemption.open();
    await flush();
    redemption.close();
    identity.signIn();
    assert.equal(document.activeElement.focused, true);
    redemption.open();
    await flush();
    redemption.destroy();
    identity.signIn();
    assert.equal(redemption.dialog.removed, true);
    assert.equal(fetch.mock.callCount(), 0);
});

test('destroying the result while a request completes never updates destroyed UI', async t => {
    const state = setup(t);
    let complete;
    t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { complete = resolve; }));
    state.redemption.open();
    await flush();
    state.identity.signIn();
    state.redemption.destroy();
    complete({ ok: true });
    await flush();
    assert.equal(state.claimed, 0);
    assert.equal(state.redemption.dialog.removed, true);
});

test('Google SDK loads on demand, shares loading, and can retry a failed download', async t => {
    setGlobal(t, 'google', undefined);
    const document = { head: element(), createElement: element };
    setGlobal(t, 'document', document);
    const first = loadGoogleIdentity();
    assert.equal(loadGoogleIdentity(), first);
    const script = document.head.children[0];
    assert.equal(script.src, 'https://accounts.google.com/gsi/client');
    script.onerror();
    await assert.rejects(first, /conexão/);
    assert.equal(script.removed, true);
    const retry = loadGoogleIdentity();
    const identity = identityStub();
    globalThis.google = { accounts: { id: identity } };
    document.head.children[1].onload();
    assert.equal(await retry, identity);
});
