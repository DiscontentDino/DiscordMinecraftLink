// @ts-check
(() => {
    /**
     * Changes the visibility of an element.
     * @param {HTMLElement | SVGElement} element
     * @param {"visible" | "hidden"} visibility
     * @return {void}
     */
    const changeVisibility = (element, visibility) => {
        if (visibility === 'visible') {
            element.classList.add('opacity-100', 'blur-none', 'scale-100');
            element.classList.remove('opacity-0', 'blur-xs', 'scale-80');
        } else {
            element.classList.add('opacity-0', 'blur-xs', 'scale-80');
            element.classList.remove('opacity-100', 'blur-none', 'scale-100');
        }
    };

    /**
     * Generate a random UUID.
     */
    const generateUUID = () => {
        if ('crypto' in window && 'randomUUID' in crypto) {
            return crypto.randomUUID();
        } else {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
                /[xy]/g,
                (c) => {
                    const r = (Math.random() * 16) | 0,
                        v = c === 'x' ? r : (r & 0x3) | 0x8;
                    return v.toString(16);
                },
            );
        }
    };

    /**
     * Try and catch.
     *
     * @template T Expected return type.
     * @template E Expected error type.
     *
     * @param {Promise<T>} promise
     * @return {Promise<{ type: "success"; value: T; } | { type: "error"; error: E; }>}
     */
    const tryCatch = async (promise) => {
        try {
            const result = await promise;
            return { type: 'success', value: result };
        } catch (error) {
            return { error: /** @type {E} */ (error), type: 'error' };
        }
    };

    /**
     * Makes an RPC request to the server.
     *
     * @template Params The parameters type.
     * @template Result The result type.
     * @param {string} method
     * @param {Params} params
     * @return {Promise<{ type: "success"; value: Result; } | { type: "error"; error: 'networkError' | 'parseError' | 'rpcParseError' | 'rpcInvalidRequest' | 'rpcMethodNotFound' | 'rpcInvalidParams' | 'rpcInternalError'; }>}
     */
    const makeRPCRequest = async (method, params) => {
        const id = generateUUID();
        const response = await tryCatch(
            fetch('/api/rpc', {
                body: JSON.stringify({
                    id,
                    jsonrpc: '2.0',
                    method,
                    params,
                }),
                headers: {
                    'Content-Type': 'application/json',
                },
                method: 'POST',
            }),
        );
        if (response.type === 'error') {
            return { error: 'networkError', type: 'error' };
        }

        const responseData = await tryCatch(response.value.json());
        if (responseData.type === 'error') {
            return { error: 'parseError', type: 'error' };
        }

        const rpcResponse = responseData.value;
        if ('error' in rpcResponse) {
            const errorCode = rpcResponse.error.code;
            switch (errorCode) {
                case -32700:
                    return { error: 'rpcParseError', type: 'error' };
                case -32600:
                    return { error: 'rpcInvalidRequest', type: 'error' };
                case -32601:
                    return { error: 'rpcMethodNotFound', type: 'error' };
                case -32602:
                    return { error: 'rpcInvalidParams', type: 'error' };
                case -32603:
                    return { error: 'rpcInternalError', type: 'error' };
                default:
                    return { error: 'rpcInternalError', type: 'error' };
            }
        }

        return { type: 'success', value: rpcResponse.result };
    };

    /**
     * Main function to initialize event listeners.
     * @return {Promise<void>}
     */
    const main = async () => {
        const icon = /** @type {HTMLElement} */ (
            document.getElementById('icon')
        );
        const loadingIcon = /** @type {HTMLElement} */ (
            document.getElementById('loadingIcon')
        );
        const successIcon = /** @type {HTMLElement} */ (
            document.getElementById('successIcon')
        );
        const failureIcon = /** @type {HTMLElement} */ (
            document.getElementById('failureIcon')
        );
        const loadingText = /** @type {HTMLElement} */ (
            document.getElementById('loadingText')
        );
        const successText = /** @type {HTMLElement} */ (
            document.getElementById('successText')
        );
        const failureText = /** @type {HTMLElement} */ (
            document.getElementById('failureText')
        );

        const urlParams = new URLSearchParams(window.location.search);
        const state = urlParams.get('state');
        const code = urlParams.get('code');
        const error = urlParams.get('error');

        await new Promise((resolve) => setTimeout(resolve, 200));

        if (error) {
            icon.ariaLabel = `Error: ${error}`;
            changeVisibility(loadingIcon, 'hidden');
            changeVisibility(failureIcon, 'visible');
            changeVisibility(loadingText, 'hidden');
            changeVisibility(failureText, 'visible');
            failureText.textContent = `Error: ${error}`;
            return;
        }

        if (!state || !code) {
            icon.ariaLabel = `Error: Missing state or code parameter.`;
            changeVisibility(loadingIcon, 'hidden');
            changeVisibility(failureIcon, 'visible');
            changeVisibility(loadingText, 'hidden');
            changeVisibility(failureText, 'visible');
            failureText.textContent = `Error: Missing state or code parameter.`;
            return;
        }

        const rpcResponse = await makeRPCRequest('linkDiscordAccount', {
            code,
            state,
        });
        if (rpcResponse.type === 'error') {
            icon.ariaLabel = `Request failed: ${rpcResponse.error}`;
            changeVisibility(loadingIcon, 'hidden');
            changeVisibility(failureIcon, 'visible');
            changeVisibility(loadingText, 'hidden');
            changeVisibility(failureText, 'visible');
            failureText.textContent = `Request failed: ${rpcResponse.error}`;
            return;
        }

        const result = rpcResponse.value;
        if (result.success) {
            icon.ariaLabel = `Success! Linked Discord account ${result.value.discordUsername}.`;
            changeVisibility(loadingIcon, 'hidden');
            changeVisibility(successIcon, 'visible');
            changeVisibility(loadingText, 'hidden');
            changeVisibility(successText, 'visible');
            successText.textContent = `Success! Linked Discord account ${result.value.discordUsername}.`;
        } else {
            icon.ariaLabel = `Error: ${result.error}`;
            changeVisibility(loadingIcon, 'hidden');
            changeVisibility(failureIcon, 'visible');
            changeVisibility(loadingText, 'hidden');
            changeVisibility(failureText, 'visible');
            failureText.textContent = `Error: ${result.error}`;
        }
    };

    document.addEventListener('DOMContentLoaded', main);
})();
