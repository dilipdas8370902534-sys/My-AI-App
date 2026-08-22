(function () {
    "use strict";

    var JUNK = [
        'button', 'svg', 'nav', 'header', 'footer', 'script', 'style', 'noscript',
        'input', 'textarea', 'select', 'iframe',
        '[class*="copy"]', '[class*="Copy"]', '[class*="share"]',
        '[class*="line-number"]', '[class*="lineNumber"]', '[class*="linenumber"]',
        '.line-numbers', '.line-numbers-rows', '.hljs-ln-numbers', '.hljs-ln-n',
        '.gutter', '.cm-lineNumbers', '.CodeMirror-linenumber', '[data-line-number]'
    ].join(',');

    function isVisible(el) {
        if (!el || el.nodeType !== 1) return true;
        if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return true;
        return false;
    }

    function cleanText(node) {
        var clone = node.cloneNode(true);

        // অদৃশ্য ও জাঙ্ক এলিমেন্ট বাদ দেই
        var junk = clone.querySelectorAll(JUNK);
        for (var j = 0; j < junk.length; j++) {
            if (junk[j] && junk[j].parentNode) junk[j].parentNode.removeChild(junk[j]);
        }

        // <br> কে নিউলাইনে রূপান্তর
        var brs = clone.querySelectorAll('br');
        for (var b = 0; b < brs.length; b++) {
            brs[b].parentNode.replaceChild(document.createTextNode('\n'), brs[b]);
        }

        // কোড ব্লক (pre) আগে-পরে নিউলাইন দিয়ে আলাদা রাখি — যেন কোড না হারায়
        var pres = clone.querySelectorAll('pre');
        for (var p = 0; p < pres.length; p++) {
            var codeText = pres[p].textContent || '';
            var marker = document.createTextNode('\n' + codeText.replace(/\n+$/, '') + '\n');
            pres[p].parentNode.replaceChild(marker, pres[p]);
        }

        // প্যারা ও লিস্ট আইটেমের পর নিউলাইন
        var blocks = clone.querySelectorAll('p, li, tr, h1, h2, h3, h4, h5, h6, div');
        for (var k = 0; k < blocks.length; k++) {
            blocks[k].appendChild(document.createTextNode('\n'));
        }

        var t = clone.textContent || '';
        return t.replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function byDocOrder(a, b) {
        if (a === b) return 0;
        var p = a.compareDocumentPosition(b);
        return (p & 4) ? -1 : 1;
    }

    function guessRole(node) {
        var cls = '';
        try { cls = (typeof node.className === 'string') ? node.className : ''; } catch (e) {}
        var h = (
            (node.getAttribute('data-message-author-role') || '') + ' ' +
            (node.getAttribute('data-testid') || '') + ' ' +
            (node.getAttribute('data-role') || '') + ' ' +
            cls + ' ' + (node.id || '')
        ).toLowerCase();
        if (/(user|human|prompt|question|outgoing|my-message)/.test(h)) return 'user';
        if (/(assistant|bot|model|answer|response|incoming|ai-message|gpt|qwen|gemini|deepseek|claude|copilot|grok)/.test(h)) return 'ai';
        return '';
    }

    function pushMsg(list, role, text) {
        if (!text || text.length < 2) return;
        if (list.length && list[list.length - 1].text === text) return; // ডুপ্লিকেট বাদ
        if (list.length && list[list.length - 1].role === role) {
            list[list.length - 1].text += '\n' + text;
        } else {
            list.push({ role: role, text: text });
        }
    }

    var messages = [];
    var i, t, r;

    // ===== ধাপ ১: স্পষ্ট role attribute (ChatGPT ইত্যাদি) =====
    var roleNodes = Array.prototype.slice.call(document.querySelectorAll('[data-message-author-role]'));
    if (roleNodes.length) {
        roleNodes.sort(byDocOrder);
        for (i = 0; i < roleNodes.length; i++) {
            if (!isVisible(roleNodes[i])) continue;
            t = cleanText(roleNodes[i]);
            r = (roleNodes[i].getAttribute('data-message-author-role') || '').toLowerCase() === 'user' ? 'user' : 'ai';
            pushMsg(messages, r, t);
        }
    }

    // ===== ধাপ ২: পরিচিত মেসেজ কন্টেইনার (Qwen, DeepSeek, Gemini ইত্যাদি) =====
    if (!messages.length) {
        var sel = [
            '[class*="message"]', '[class*="msg-item"]', '[class*="chat-item"]',
            '[class*="chat-message"]', '[class*="conversation-turn"]',
            '[class*="chat-turn"]', '[data-testid*="turn"]', 'article'
        ].join(',');
        var nodes = Array.prototype.slice.call(document.querySelectorAll(sel));
        nodes = nodes.filter(function (n) {
            return n.querySelectorAll(sel).length === 0 && isVisible(n);
        });
        nodes.sort(byDocOrder);
        var expectUser = true;
        for (i = 0; i < nodes.length; i++) {
            t = cleanText(nodes[i]);
            if (t.length < 2) continue;
            r = guessRole(nodes[i]);
            if (!r) r = expectUser ? 'user' : 'ai';
            pushMsg(messages, r, t);
            expectUser = (r !== 'user');
        }
    }

    // ===== ধাপ ৩: শেষ উপায় — টেক্সট ব্লকে ভাগ করা =====
    if (!messages.length) {
        var chunks = (document.body.innerText || '').split(/\n\n+/);
        var expectUser2 = true;
        for (i = 0; i < chunks.length; i++) {
            t = chunks[i].trim();
            if (t.length < 3) continue;
            pushMsg(messages, expectUser2 ? 'user' : 'ai', t);
            expectUser2 = !expectUser2;
        }
    }

    var payload = JSON.stringify({
        title: document.title || 'Chat Export',
        url: location.href,
        messages: messages
    });

    if (window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChatData) {
        window.AndroidPdfExporter.receiveChatData(payload);
    }
})();
