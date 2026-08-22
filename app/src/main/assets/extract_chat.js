(function () {
    "use strict";

    var LINE_NUMBER_SELECTOR = [
        '.line-number',
        '.line-numbers',
        '.line-numbers-rows',
        '.linenumber',
        '.lineNumber',
        '.hljs-ln-numbers',
        '.hljs-ln-n',
        '[class*="line-number"]',
        '[class*="hljs-ln"]',
        '.token-line-number',
        '.gutter',
        '.cm-lineNumbers',
        '.CodeMirror-linenumber',
        '[data-line-number]',
        '[aria-hidden="true"]',
        'button',
        'svg',
        '.copy-button'
    ].join(',');

    function cleanNode(node) {
        var clone = node.cloneNode(true);
        var junks = clone.querySelectorAll(LINE_NUMBER_SELECTOR);
        for (var i = 0; i < junks.length; i++) {
            if (junks[i] && junks[i].parentNode) junks[i].parentNode.removeChild(junks[i]);
        }
        var text = clone.innerText || clone.textContent || '';
        return text.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }

    var TURN_SELECTOR_PRIORITY = [
        '[data-message-author-role]',
        '[data-testid="user-turn"], [data-testid="conversation-turn"]',
        '.message, .chat-message, .msg, .conversation-turn',
        'article',
        '.text-base, .markdown'
    ];

    function findTurns() {
        for (var s = 0; s < TURN_SELECTOR_PRIORITY.length; s++) {
            var found = document.querySelectorAll(TURN_SELECTOR_PRIORITY[s]);
            if (found && found.length > 0) return Array.prototype.slice.call(found);
        }
        return [];
    }

    function keepOutermost(nodes) {
        return nodes.filter(function (node, idx) {
            for (var j = 0; j < nodes.length; j++) {
                if (j !== idx && nodes[j] !== node && nodes[j].contains(node)) return false;
            }
            return true;
        });
    }

    var turns = keepOutermost(findTurns());
    var messages = [];
    var lastRole = 'ai';

    for (var i = 0; i < turns.length; i++) {
        var turn = turns[i];
        var text = cleanNode(turn);
        if (text.length > 2) {
            var hint = (
                (turn.className || '') + ' ' +
                (turn.getAttribute('data-message-author-role') || '') + ' ' +
                (turn.getAttribute('data-testid') || '')
            ).toLowerCase();
            var isUser = hint.indexOf('user') !== -1 || hint.indexOf('human') !== -1 || hint.indexOf('you') !== -1;
            var role = isUser ? 'user' : 'ai';
            messages.push({ role: role, text: text });
        }
    }

    if (messages.length === 0) {
        var bodyText = document.body.innerText;
        var chunks = bodyText.split(/\n\n+/);
        for (var k = 0; k < chunks.length; k++) {
            var chunkText = chunks[k].trim();
            if (chunkText && chunkText.length > 5) {
                lastRole = lastRole === 'ai' ? 'user' : 'ai';
                messages.push({ role: lastRole, text: chunkText });
            }
        }
    }

    var payload = JSON.stringify(messages);
    if (window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChatData) {
        window.AndroidPdfExporter.receiveChatData(payload);
    }
})();
