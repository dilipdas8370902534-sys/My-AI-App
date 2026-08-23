(function () {
    "use strict";

    var CS = '\uE000', CE = '\uE001';
    var MS = '\uE002', ME = '\uE003';

    var CODE_SEL = 'pre, code-block, md-code-block, .code-block, [class*="code-block"], [class*="codeBlock"], .highlight';
    var LINENUM_SEL = '.line-numbers-rows,.hljs-ln-numbers,.hljs-ln-n,.CodeMirror-linenumber,.cm-lineNumbers,.gutter,[class*="line-number"],[class*="lineNumber"],[data-line-number]';
    var JUNK_SEL = 'script,style,noscript,iframe,input,textarea,select,button,nav,header,footer,[role="button"],[class*="copy"],[class*="Copy"],[class*="share"],[class*="toolbar"],[class*="Toolbar"],[class*="feedback"],[class*="tooltip"]';

    function sendResult(messages) {
        try {
            var payload = JSON.stringify({
                title: document.title || 'Chat Export',
                url: location.href,
                messages: messages || []
            });
            if (window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChatData) {
                window.AndroidPdfExporter.receiveChatData(payload);
            }
        } catch (e) {
            try {
                if (window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChatData) {
                    window.AndroidPdfExporter.receiveChatData(JSON.stringify({ title: 'Error', url: '', messages: [] }));
                }
            } catch (e2) {}
        }
    }

    function isVisible(el) {
        if (!el || el.nodeType !== 1) return true;
        try {
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        } catch (e) { return true; }
    }

    function getCodeText(box) {
        try {
            var codeEl = box.querySelector('code') || box;
            var hide = codeEl.querySelectorAll(LINENUM_SEL + ',button,svg');
            var saved = [], i;
            for (i = 0; i < hide.length; i++) { saved.push(hide[i].style.display); hide[i].style.display = 'none'; }
            var txt = codeEl.innerText;
            if (!txt || !txt.length) txt = codeEl.textContent || '';
            for (i = 0; i < hide.length; i++) { hide[i].style.display = saved[i]; }
            return txt.replace(/\u00a0/g, ' ').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
        } catch (e) { return ''; }
    }

    function extractMediaData(el) {
        if (!el) return null;
        try {
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
                var w = img.naturalWidth || img.width || 100;
                var h = img.naturalHeight || img.height || 100;
                if (img.src && img.src.startsWith('data:image')) {
                    return { type: 'img', data: img.src, w: w, h: h };
                }
                if (img.src) {
                    try {
                        var c = document.createElement('canvas');
                        c.width = w;
                        c.height = h;
                        if (c.width > 0 && c.height > 0) {
                            var ctx = c.getContext('2d');
                            ctx.drawImage(img, 0, 0, c.width, c.height);
                            var dataUrl = c.toDataURL('image/png');
                            if (dataUrl && dataUrl.length > 10) {
                                return { type: 'img', data: dataUrl, w: c.width, h: c.height };
                            }
                        }
                    } catch (e) {}
                    return { type: 'img', data: img.src, w: w, h: h };
                }
            } else if (tag === 'svg') {
                try {
                    var rect = el.getBoundingClientRect();
                    if (rect.width < 10 || rect.height < 10) return null;
                    var cls = '';
                    try {
                        cls = (el.className && typeof el.className.baseVal === 'string') ? el.className.baseVal.toLowerCase() : ((typeof el.className === 'string') ? el.className.toLowerCase() : '');
                    } catch (e) {}
                    if (cls.indexOf('icon') !== -1 || cls.indexOf('copy') !== -1 || cls.indexOf('thumb') !== -1 || cls.indexOf('feedback') !== -1) return null;

                    var serializer = new XMLSerializer();
                    var svgStr = serializer.serializeToString(el);
                    if (svgStr.indexOf('xmlns=') === -1) {
                        svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
                    }
                    return { type: 'svg', data: svgStr, w: rect.width, h: rect.height };
                } catch (e) {}
            } else if (tag === 'canvas') {
                try {
                    var dataUrl = el.toDataURL('image/png');
                    if (dataUrl && dataUrl.length > 10) {
                        return { type: 'img', data: dataUrl, w: el.width, h: el.height };
                    }
                } catch (e) {}
            }
        } catch (e) {}
        return null;
    }

    function cleanText(node) {
        var i, j;
        try {
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
                var b = boxes[i], skip2 = false;
                for (j = 0; j < tagged.length; j++) { if (tagged[j].contains(b)) { skip2 = true; break; } }
                if (skip2) continue;
                var t = getCodeText(b);
                if (!t) continue;
                b.setAttribute('data-cx', String(codes.length));
                tagged.push(b);
                codes.push(t);
            }

            var clone = node.cloneNode(true);
            for (i = 0; i < tagged.length; i++) { try { tagged[i].removeAttribute('data-cx'); } catch(e){} }

            var marks = clone.querySelectorAll('[data-cx]');
            for (i = 0; i < marks.length; i++) {
                var cidx = parseInt(marks[i].getAttribute('data-cx'), 10);
                if (!isNaN(cidx) && cidx >= 0 && cidx < codes.length) {
                    var tn = document.createTextNode('\n' + CS + codes[cidx] + CE + '\n');
                    marks[i].parentNode.replaceChild(tn, marks[i]);
                }
            }

            var mmarks = clone.querySelectorAll('[data-mx]');
            for (i = 0; i < mmarks.length; i++) {
                var midx = parseInt(mmarks[i].getAttribute('data-mx'), 10);
                if (!isNaN(midx) && midx >= 0 && midx < mediaList.length) {
                    var tn2 = document.createTextNode('\n' + MS + midx + ME + '\n');
                    mmarks[i].parentNode.replaceChild(tn2, mmarks[i]);
                }
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
        } catch (e) {
            return { text: '', media: [] };
        }
    }

    function byDocOrder(a, b) {
        if (a === b) return 0;
        try {
            return (a.compareDocumentPosition(b) & 4) ? -1 : 1;
        } catch (e) { return 0; }
    }

    function guessRole(node) {
        try {
            var cls = '';
            try { cls = (typeof node.className === 'string') ? node.className : ''; } catch (e) {}
            var h = ((node.getAttribute('data-message-author-role') || '') + ' ' +
                     (node.getAttribute('data-testid') || '') + ' ' +
                     (node.getAttribute('data-role') || '') + ' ' +
                     cls + ' ' + (node.id || '')).toLowerCase();
            if (/(user|human|prompt|question|outgoing|my-message)/.test(h)) return 'user';
            if (/(assistant|bot|model|answer|response|incoming|ai-message|gpt|qwen|gemini|deepseek|claude|copilot|grok)/.test(h)) return 'ai';
        } catch (e) {}
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

        try {
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
        } catch (e) {}

        if (!messages.length) {
            try {
                var sel = '[class*="message"],[class*="msg-item"],[class*="chat-item"],[class*="chat-message"],[class*="conversation-turn"],[class*="chat-turn"],[data-testid*="turn"],article';
                var nodes = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (n) {
                    try { return n.querySelectorAll(sel).length === 0 && isVisible(n); } catch(e) { return false; }
                });
                nodes.sort(byDocOrder);
                var expectUser = true;
                for (i = 0; i < nodes.length; i++) {
                    var res2 = cleanText(nodes[i]);
                    t = res2.text;
                    var media2 = res2.media;
                    if (t.length < 2 && media2.length === 0) continue;
                    r = guessRole(nodes[i]) || (expectUser ? 'user' : 'ai');
                    pushMsg(messages, r, t, media2);
                    expectUser = (r !== 'user');
                }
            } catch (e) {}
        }

        if (!messages.length) {
            try {
                var res3 = cleanText(document.body);
                var whole = res3.text;
                var media3 = res3.media;
                if (whole && whole.length > 2) {
                    var chunks = whole.split(/\n\n+/);
                    var eu = true;
                    for (i = 0; i < chunks.length; i++) {
                        t = chunks[i].trim();
                        if (t.length < 3 && media3.length === 0) continue;
                        pushMsg(messages, eu ? 'user' : 'ai', t, media3);
                        eu = !eu;
                    }
                }
            } catch (e) {}
        }

        sendResult(messages);
    }

    function findScroller() {
        try {
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
        } catch (e) {
            return document.body;
        }
    }

    // === MAIN EXECUTION ===
    try {
        var sc = findScroller();
        var needsScroll = false;
        try {
            if (sc && sc.scrollHeight && sc.clientHeight && sc.scrollHeight > sc.clientHeight + 50) {
                needsScroll = true;
            }
        } catch (e) {}

        if (needsScroll) {
            var startTop = sc.scrollTop, y = 0, guard = 0;
            try { sc.scrollTop = 0; } catch(e) {}
            var timer = setInterval(function () {
                guard++;
                y += Math.max(300, sc.clientHeight - 80);
                try { sc.scrollTop = y; } catch(e) {}
                if (y >= sc.scrollHeight || guard > 80) {
                    clearInterval(timer);
                    setTimeout(function () {
                        try { sc.scrollTop = startTop; } catch(e) {}
                        extract();
                    }, 400);
                }
            }, 100);
        } else {
            // No scroll needed - extract immediately
            setTimeout(function () { extract(); }, 300);
        }
    } catch (e) {
        sendResult([]);
    }
})();
