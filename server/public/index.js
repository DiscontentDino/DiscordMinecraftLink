// @ts-check
(() => {
    /**
     * Changes the visibility of an icon.
     * @param {HTMLElement | SVGElement} icon
     * @param {"visible" | "hidden"} visibility
     * @return {void}
     */
    const changeIconVisibility = (icon, visibility) => {
        if (visibility === 'visible') {
            icon.classList.add('opacity-100', 'blur-none', 'scale-100');
            icon.classList.remove('opacity-0', 'blur-xs', 'scale-50');
        } else {
            icon.classList.add('opacity-0', 'blur-xs', 'scale-50');
            icon.classList.remove('opacity-100', 'blur-none', 'scale-100');
        }
    };

    /**
     * Displays a message in the message container.
     * @param {HTMLElement} container
     * @param {string} message
     * @return {void}
     */
    const displayMessage = (container, message) => {
        container.textContent = message;
        container.classList.remove('hidden');
    };

    /**
     * Hides the message container.
     * @param {HTMLElement} container
     * @return {void}
     */
    const hideMessage = (container) => {
        container.textContent = '';
        container.classList.add('hidden');
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
        const submitButton = /** @type {HTMLButtonElement} */ (
            document.getElementById('submitButton')
        );
        const forwardArrowIcon = /** @type {HTMLElement} */ (
            document.getElementById('forwardArrowIcon')
        );
        const loaderIcon = /** @type {HTMLElement} */ (
            document.getElementById('loaderIcon')
        );
        const inputBox = /** @type {HTMLInputElement} */ (
            document.getElementById('codeInput')
        );
        const messageContainer = /** @type {HTMLElement} */ (
            document.getElementById('messageContainer')
        );

        submitButton.addEventListener('click', async () => {
            submitButton.disabled = true;
            inputBox.disabled = true;

            // Hide any previous messages
            hideMessage(messageContainer);

            // Show loader icon and hide forward arrow icon
            changeIconVisibility(forwardArrowIcon, 'hidden');
            changeIconVisibility(loaderIcon, 'visible');

            const code = inputBox.value.trim();

            const response = await Promise.all([
                makeRPCRequest('getDiscordOAuthLink', { linkingCode: code }),
                new Promise((resolve) => setTimeout(resolve, 1000)),
            ]).then((results) => results[0]);
            if (response.type === 'error') {
                displayMessage(
                    messageContainer,
                    `Request failed: ${response.error}`,
                );
                changeIconVisibility(forwardArrowIcon, 'visible');
                changeIconVisibility(loaderIcon, 'hidden');
                submitButton.disabled = false;
                inputBox.disabled = false;
                return;
            }

            const result = response.value;

            if (result.success) {
                displayMessage(messageContainer, 'Success! Redirecting...');
                window.location.href = result.value.oauthURL;
            } else {
                displayMessage(messageContainer, `Error: ${result.error}`);
                changeIconVisibility(forwardArrowIcon, 'visible');
                changeIconVisibility(loaderIcon, 'hidden');
                submitButton.disabled = false;
                inputBox.disabled = false;
            }
        });
    };

    document.addEventListener('DOMContentLoaded', main);
})();
