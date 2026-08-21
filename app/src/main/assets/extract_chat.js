(function () {
    "use strict";
    var LINE_NUMBER_SELECTOR = [
        '.line-number', '.line-numbers', '.line-numbers-rows', '.linenumber',
        '.lineNumber', '.hljs-ln-numbers', '.hljs-ln-n',
        '.hljs-ln-line[data-line-number]', '[class*="line-number"]',
        '[class*="hljs-ln"]', '.token-line-number', '.gutter',
        '.cm-lineNumbers', '.CodeMirror-linenumber', '[data-line-number]',
        '[aria-hidden="true"]'
    ].join(',');

    var TURN_SELECTORS = [
        '[data-testid="user-turn"]', '[data-testid="conversation-turn"]',
        '[data-testid*="turn"]', '[data-message-author-role]',
        '.chat-message', '.message', 'article'
    ];

    var USER_HINTS = ['user', 'human', 'you', 'prompt'];
    var AI_HINTS = ['assistant', 'ai', 'claude', 'model', 'bot', 'response'];

    function textIndicatesRole(el, hints) {
        var haystack = (
            (el.className && (typeof el.className === 'string' ? el.className : '')) + ' ' +
            (el.getAttribute && (el.getAttribute('data-message-author-role') || '')) + ' ' +
            (el.getAttribute && (el.getAttribute('data-testid') || ''))
        ).toLowerCase();
        for (var i = 0; i < hints.length; i++) {
            if (haystack.indexOf(hints[i]) !== -1) return true;
        }
        return false;
    }

    function cleanText(node) {
        var clone = node.cloneNode(true);
        var junk = clone.querySelectorAll(LINE_NUMBER_SELECTOR);
        for (var i = 0; i < junk.length; i++) {
            if (junk[i] && junk[i].parentNode) {
                junk[i].parentNode.removeChild(junk[i]);
            }
        }
        var text = clone.innerText || clone.textContent || '';
        return text.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }

    function findTurns() {
        for (var s = 0; s < TURN_SELECTORS.length; s++) {
            var found = document.querySelectorAll(TURN_SELECTORS[s]);
            if (found && found.length > 0) return Array.prototype.slice.call(found);
        }
        return [];
    }

    var turns = findTurns();
    var messages = [];
    var lastRoleGuess = 'ai';

    for (var i = 0; i < turns.length; i++) {
        var turn = turns[i];
        var text = cleanText(turn);
        if (!text) continue;

        var role;
        if (textIndicatesRole(turn, USER_HINTS)) {
            role = 'user';
        } else if (textIndicatesRole(turn, AI_HINTS)) {
            role = 'ai';
        } else {
            role = (lastRoleGuess === 'ai') ? 'user' : 'ai';
        }
        lastRoleGuess = role;

        messages.push({ role: role, text: text });
    }

    var payload = JSON.stringify(messages);

    if (window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChatData) {
        window.AndroidPdfExporter.receiveChatData(payload);
    }
})();
