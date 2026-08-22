(function () {
    "use strict";

    var CS = '\uE000', CE = '\uE001';   // কোড ব্লকের শুরু/শেষ মার্কার

    var CODE_SEL = 'pre, code-block, md-code-block, .code-block, [class*="code-block"], [class*="codeBlock"], .highlight';
    var LINENUM_SEL = '.line-numbers-rows,.hljs-ln-numbers,.hljs-ln-n,.CodeMirror-linenumber,.cm-lineNumbers,.gutter,[class*="line-number"],[class*="lineNumber"],[data-line-number]';
    var JUNK_SEL = 'script,style,noscript,svg,canvas,iframe,input,textarea,select,button,nav,header,footer,[role="button"],[class*="copy"],[class*="Copy"],[class*="share"],[class*="toolbar"],[class*="Toolbar"],[class*="feedback"],[class*="tooltip"]';

    function isVisible(el) {
        if (!el || el.nodeType !== 1) return true;
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    // লাইভ DOM থেকে কোড পড়ি — innerText লাইন ব্রেক ঠিক রাখে
    function getCodeText(box) {
        var codeEl = box.querySelector('code') || box;
        var hide = codeEl.querySelectorAll(LINENUM_SEL + ',button,svg');
        var saved = [], i;
        for (i = 0; i < hide.length; i++) { saved.push(hide[i].style.display); hide[i].style.display = 'none'; }
        var txt = codeEl.innerText;
        if (!txt || !txt.length) txt = codeEl.textContent || '';
        for (i = 0; i < hide.length; i++) { hide[i].style.display = saved[i]; }
        return txt.replace(/\u00a0/g, ' ').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
    }

    function cleanText(node) {
        var i, j;

        // ধাপ ১: জাঙ্ক মোছার আগেই কোড ব্লক আলাদা করে সেভ করি
        var boxes = node.querySelectorAll(CODE_SEL);
        var codes = [], tagged = [];
        for (i = 0; i < boxes.length; i++) {
            var b = boxes[i], skip = false;
            for (j = 0; j < tagged.length; j++) { if (tagged[j].contains(b)) { skip = true; break; } }
            if (skip) continue;
            var t = getCodeText(b);
            if (!t) continue;
            b.setAttribute('data-cx', String(codes.length));
            tagged.push(b);
            codes.push(t);
        }

        var clone = node.cloneNode(true);
        for (i = 0; i < tagged.length; i++) tagged[i].removeAttribute('data-cx');

        // ধাপ ২: ক্লোনে কোডের জায়গায় মার্কারসহ টেক্সট বসাই
        var marks = clone.querySelectorAll('[data-cx]');
        for (i = 0; i < marks.length; i++) {
            var idx = parseInt(marks[i].getAttribute('data-cx'), 10);
            var tn = document.createTextNode('\n' + CS + codes[idx] + CE + '\n');
            marks[i].parentNode.replaceChild(tn, marks[i]);
        }

        // ধাপ ৩: এখন জাঙ্ক সরাই (কোড আর হারাবে না)
        var junk = clone.querySelectorAll(JUNK_SEL);
        for (i = 0; i < junk.length; i++) {
            var el = junk[i];
            if (!el.parentNode) continue;
            if (el.textContent && el.textContent.indexOf(CS) !== -1) continue; // কোড ধরে রাখা র‍্যাপার বাদ দেই না
            el.parentNode.removeChild(el);
        }

        // ইনলাইন কোড ব্যাকটিকে
        var inline = clone.querySelectorAll('code');
        for (i = 0; i < inline.length; i++) {
            var it = (inline[i].textContent || '').trim();
            if (it) inline[i].parentNode.replaceChild(document.createTextNode('`' + it + '`'), inline[i]);
        }

        var brs = clone.querySelectorAll('br');
        for (i = 0; i < brs.length; i++) brs[i].parentNode.replaceChild(document.createTextNode('\n'), brs[i]);

        var cells = clone.querySelectorAll('td, th');
        for (i = 0; i < cells.length; i++) cells[i].appendChild(document.createTextNode('\t'));

        var blocks = clone.querySelectorAll('p, li, tr, h1, h2, h3, h4, h5, h6, div');
        for (i = 0; i < blocks.length; i++) blocks[i].appendChild(document.createTextNode('\n'));

        var out = clone.textContent || '';
        return out.replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function byDocOrder(a, b) {
        if (a === b) return 0;
        return (a.compareDocumentPosition(b) & 4) ? -1 : 1;
    }

    function guessRole(node) {
        var cls = '';
        try { cls = (typeof node.className === 'string') ? node.className : ''; } catch (e) {}
        var h = ((node.getAttribute('data-message-author-role') || '') + ' ' +
                 (node.getAttribute('data-testid') || '') + ' ' +
                 (node.getAttribute('data-role') || '') + ' ' +
                 cls + ' ' + (node.id || '')).toLowerCase();
        if (/(user|human|prompt|question|outgoing|my-message)/.test(h)) return 'user';
        if (/(assistant|bot|model|answer|response|incoming|ai-message|gpt|qwen|gemini|deepseek|claude|copilot|grok)/.test(h)) return 'ai';
        return '';
    }

    function pushMsg(list, role, text) {
        if (!text || text.length < 2) return;
        if (list.length && list[list.length - 1].text === text) return;
        if (list.length && list[list.length - 1].role === role) list[list.length - 1].text += '\n' + text;
        else list.push({ role: role, text: text });
    }

    function extract() {
        var messages = [], i, t, r;

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

        if (!messages.length) {
            var sel = '[class*="message"],[class*="msg-item"],[class*="chat-item"],[class*="chat-message"],[class*="conversation-turn"],[class*="chat-turn"],[data-testid*="turn"],article';
            var nodes = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (n) {
                return n.querySelectorAll(sel).length === 0 && isVisible(n);
            });
            nodes.sort(byDocOrder);
            var expectUser = true;
            for (i = 0; i < nodes.length; i++) {
                t = cleanText(nodes[i]);
                if (t.length < 2) continue;
                r = guessRole(nodes[i]) || (expectUser ? 'user' : 'ai');
                pushMsg(messages, r, t);
                expectUser = (r !== 'user');
            }
        }

        // শেষ উপায়: পুরো বডি, তবু কোড ব্লক আলাদা করে রেখেই
        if (!messages.length) {
            var whole = cleanText(document.body);
            var chunks = whole.split(/\n\n+/);
            var eu = true;
            for (i = 0; i < chunks.length; i++) {
                t = chunks[i].trim();
                if (t.length < 3) continue;
                pushMsg(messages, eu ? 'user' : 'ai', t);
                eu = !eu;
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
    }

    // লম্বা চ্যাট virtualize করা থাকে — আগে স্ক্রল করে সব লোড করিয়ে নিই
    function findScroller() {
        var best = document.scrollingElement || document.body, bestH = 0;
        var all = document.querySelectorAll('div,main,section');
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.clientHeight > 200 && el.scrollHeight > el.clientHeight + 200) {
                var oy = getComputedStyle(el).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el; }
            }
        }
        return best;
    }

    var sc = findScroller();
    var startTop = sc.scrollTop, y = 0, guard = 0;
    sc.scrollTop = 0;
    var timer = setInterval(function () {
        guard++;
        y += Math.max(300, sc.clientHeight - 80);
        sc.scrollTop = y;
        if (y >= sc.scrollHeight || guard > 80) {
            clearInterval(timer);
            setTimeout(function () {
                sc.scrollTop = startTop;
                try { extract(); } catch (e) {
                    if (window.AndroidPdfExporter) window.AndroidPdfExporter.receiveChatData(JSON.stringify({ title: document.title, url: location.href, messages: [] }));
                }
            }, 500);
        }
    }, 120);
})();
