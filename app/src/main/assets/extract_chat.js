(function () {
    "use strict";

    var CS = '\uE000', CE = '\uE001';
    var MS = '\uE002', ME = '\uE003';

    var CODE_SEL = 'pre, code-block, md-code-block, .code-block, [class*="code-block"], [class*="codeBlock"], .highlight';
    var LINENUM_SEL = '.line-numbers-rows,.hljs-ln-numbers,.hljs-ln-n,.CodeMirror-linenumber,.cm-lineNumbers,.gutter,[class*="line-number"],[class*="lineNumber"],[data-line-number]';
    var JUNK_SEL = 'script,style,noscript,iframe,input,textarea,select,button,nav,header,footer,[role="button"],[class*="copy"],[class*="Copy"],[class*="share"],[class*="toolbar"],[class*="Toolbar"],[class*="feedback"],[class*="tooltip"]';

    function isVisible(el) {
        if (!el || el.nodeType !== 1) return true;
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

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

    function extractMediaData(el) {
        if (!el) return null;
        var tag = el.tagName.toLowerCase();
        
        if (tag === 'mjx-container' || tag === 'math' || tag === 'figure') {
            var innerSvg = el.querySelector('svg');
            if (innerSvg) return extractMediaData(innerSvg);
            var innerImg = el.querySelector('img');
            if (innerImg) return extractMediaData(innerImg);
            var innerCanvas = el.querySelector('canvas');
            if (innerCanvas) return extractMediaData(innerCanvas);
        }

        if (tag === 'img' || tag === 'picture') {
            var img = (tag === 'picture') ? el.querySelector('img') : el;
            if (!img) return null;
            if (img.src && img.src.startsWith('data:image')) return { type: 'img', data: img.src, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
            if (img.src) {
                try {
                    var c = document.createElement('canvas');
                    c.width = img.naturalWidth || img.width;
                    c.height = img.naturalHeight || img.height;
                    if (c.width > 0 && c.height > 0) {
                        var ctx = c.getContext('2d');
                        ctx.drawImage(img, 0, 0, c.width, c.height);
                        return { type: 'img', data: c.toDataURL('image/png'), w: c.width, h: c.height };
                    }
                } catch(e) {}
                return { type: 'img', data: img.src, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
            }
        } else if (tag === 'svg') {
            try {
                var rect = el.getBoundingClientRect();
                if (rect.width < 30 || rect.height < 30) return null;
                var cls = (el.className && typeof el.className.baseVal === 'string') ? el.className.baseVal.toLowerCase() : ((typeof el.className === 'string') ? el.className.toLowerCase() : '');
                if (cls.indexOf('icon') !== -1 || cls.indexOf('copy') !== -1 || cls.indexOf('thumb') !== -1 || cls.indexOf('feedback') !== -1) return null;
                
                var serializer = new XMLSerializer();
                var svgStr = serializer.serializeToString(el);
                if (svgStr.indexOf('xmlns=') === -1) {
                    svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
                }
                return { type: 'svg', data: svgStr, w: rect.width, h: rect.height };
            } catch(e) {}
        } else if (tag === 'canvas') {
            try {
                return { type: 'img', data: el.toDataURL('image/png'), w: el.width, h: el.height };
            } catch(e) {}
        }
        return null;
    }

    function cleanText(node) {
        var i, j;

        var MEDIA_SEL = 'img, svg, canvas, mjx-container, math, picture, figure';
        var mediaNodes = node.querySelectorAll(MEDIA_SEL);
        var mediaList = [], mediaTagged = [];
        for (i = 0; i < mediaNodes.length; i++) {
            var m = mediaNodes[i], skip = false;
            for (j = 0; j < mediaTagged.length; j++) { if (mediaTagged[j].contains(m)) { skip = true; break; } }
            if (skip) continue;
            var data = extractMediaData(m);
            if (!data) continue;
            var idx = mediaList.length;
            mediaList.push(data);
            m.setAttribute('data-mx', String(idx));
            mediaTagged.push(m);
        }

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

        var marks = clone.querySelectorAll('[data-cx]');
        for (i = 0; i < marks.length; i++) {
            var idx = parseInt(marks[i].getAttribute('data-cx'), 10);
            var tn = document.createTextNode('\n' + CS + codes[idx] + CE + '\n');
            marks[i].parentNode.replaceChild(tn, marks[i]);
        }

        var mmarks = clone.querySelectorAll('[data-mx]');
        for (i = 0; i < mmarks.length; i++) {
            var idx = parseInt(mmarks[i].getAttribute('data-mx'), 10);
            var tn = document.createTextNode('\n' + MS + idx + ME + '\n');
            mmarks[i].parentNode.replaceChild(tn, mmarks[i]);
        }

        var junk = clone.querySelectorAll(JUNK_SEL);
        for (i = 0; i < junk.length; i++) {
            var el = junk[i];
            if (!el.parentNode) continue;
            if (el.textContent && (el.textContent.indexOf(CS) !== -1 || el.textContent.indexOf(MS) !== -1)) continue;
            el.parentNode.removeChild(el);
        }

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
        return {
            text: out.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
            media: mediaList
        };
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

    function pushMsg(list, role, text, media) {
        if ((!text || text.length < 2) && (!media || media.length === 0)) return;
        if (list.length && list[list.length - 1].text === text && (!media || media.length === 0)) return;
        if (list.length && list[list.length - 1].role === role) {
            list[list.length - 1].text += '\n' + text;
            list[list.length - 1].media = list[list.length - 1].media.concat(media || []);
        }
        else list.push({ role: role, text: text || "", media: media || [] });
    }

    function extract() {
        var messages = [], i, t, r;

        var roleNodes = Array.prototype.slice.call(document.querySelectorAll('[data-message-author-role]'));
        if (roleNodes.length) {
            roleNodes.sort(byDocOrder);
            for (i = 0; i < roleNodes.length; i++) {
                if (!isVisible(roleNodes[i])) continue;
                var res = cleanText(roleNodes[i]);
                t = res.text;
                var media = res.media;
                r = (roleNodes[i].getAttribute('data-message-author-role') || '').toLowerCase() === 'user' ? 'user' : 'ai';
                pushMsg(messages, r, t, media);
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
                var res = cleanText(nodes[i]);
                t = res.text;
                var media = res.media;
                if (t.length < 2 && media.length === 0) continue;
                r = guessRole(nodes[i]) || (expectUser ? 'user' : 'ai');
                pushMsg(messages, r, t, media);
                expectUser = (r !== 'user');
            }
        }

        if (!messages.length) {
            var res = cleanText(document.body);
            var whole = res.text;
            var media = res.media;
            var chunks = whole.split(/\n\n+/);
            var eu = true;
            for (i = 0; i < chunks.length; i++) {
                t = chunks[i].trim();
                if (t.length < 3 && media.length === 0) continue;
                pushMsg(messages, eu ? 'user' : 'ai', t, media);
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
    if (sc && sc.scrollHeight > sc.clientHeight + 50) {
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
    } else {
        // পেজ যদি স্ক্রল করার মতো না হয় (Single page), তবে সরাসরি এক্সট্রাক্ট করুন
        try { extract(); } catch (e) {
            if (window.AndroidPdfExporter) window.AndroidPdfExporter.receiveChatData(JSON.stringify({ title: document.title, url: location.href, messages: [] }));
        }
    }
})();
