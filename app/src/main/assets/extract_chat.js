(function () {
    "use strict";

    if (window.__xExtRunning) { return; }
    window.__xExtRunning = true;

    var CS = '\uE000', CE = '\uE001';
    var MS = '\uE002', ME = '\uE003';

    var CODE_SEL = 'pre, code-block, md-code-block, .code-block, [class="code-block" i], [class="codeBlock" i], .highlight';
    var LINENUM_SEL = '.line-numbers-rows,.hljs-ln-numbers,.hljs-ln-n,.CodeMirror-linenumber,.cm-lineNumbers,.gutter,[class="line-number" i],[class="lineNumber" i],[data-line-number]';
    var JUNK_SEL = 'script,style,noscript,iframe,input,select,button,nav,header,footer,[role="button"],[class="copy" i],[class="share" i],[class="toolbar" i],[class="feedback" i],[class*="tooltip" i]';

    var MAX_IMG_W = 1000;
    var IMG_BUDGET = 7 * 1024 * 1024;
    var imgBytes = 0;

    var EXPAND_TEXT = /(show\smore|read\smore|see\smore|view\smore|show\sfull|show\sall|show\soriginal|expand|continue\sreading|আরও|আরো|সম্পূর্ণ|বিস্তারিত|展开|更多|全部|もっと見る|더\s*보기)/i;
    var BLOCK_TEXT = /(show\sless|see\sless|collapse|hide|delete|remove|share|export|download|sign\sout|log\sout|logout|regenerate|retry|edit|copy|new\s*chat|settings|upgrade|收起|删除)/i;
    var CAND_SEL = 'button,[role="button"],summary,[aria-expanded="false"],[class="more" i],[class="expand" i],[class="truncat" i],[class="clamp" i],[class="collaps" i],[class="fold" i]';
    var SAFE_ZONE = '[data-message-author-role],[class="message" i],[class="chat" i],[class="prompt" i],[class="bubble" i],article,main';

    function status(s) {
        try {
            if (window.AndroidPdfExporter && window.AndroidPdfExporter.reportStatus) {
                window.AndroidPdfExporter.reportStatus(String(s));
            }
        } catch (e) {}
    }

    function isVisible(el) {
        if (!el || el.nodeType !== 1) return true;
        try { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
        catch (e) { return true; }
    }

    function injectStyle() {
        try {
            if (document.getElementById('__x_exp_style')) return;
            var st = document.createElement('style');
            st.id = '__x_exp_style';
            st.textContent =
                '[class*="truncat" i],[class*="clamp" i],[class*="collaps" i],[class*="fold" i],' +
                '[class*="ellipsis" i],[class*="show-more" i],[class*="showmore" i],[class*="line-limit" i],' +
                '[style*="line-clamp"],[style*="max-height"]{' +
                'max-height:none !important;-webkit-line-clamp:unset !important;' +
                '-webkit-mask-image:none !important;overflow:visible !important;text-overflow:clip !important;}';
            (document.head || document.documentElement).appendChild(st);
        } catch (e) {}
    }

    function expandOnce() {
        var n = 0, i;
        try {
            var det = document.querySelectorAll('details:not([open])');
            for (i = 0; i < det.length; i++) {
                try { det[i].setAttribute('open', ''); n++; } catch (e) {}
            }
        } catch (e) {}

        try {
            injectStyle();
            var nodes = document.querySelectorAll(CAND_SEL);
            for (i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                if (!isVisible(el)) continue;
                if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;

                var inSafe = false;
                try {
                    if (el.closest(SAFE_ZONE)) inSafe = true;
                } catch (e) {}
                if (!inSafe) continue;

                var label = '';
                try {
                    label = (el.innerText || el.value || el.textContent ||
                             el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
                } catch (e) {}
                if (label.length > 90) label = label.slice(0, 90);

                var ok = false;
                if (EXPAND_TEXT.test(label) && !BLOCK_TEXT.test(label)) ok = true;
                else if (el.getAttribute('aria-expanded') === 'false' && label.length < 30 && !BLOCK_TEXT.test(label)) ok = true;

                if (ok) {
                    try {
                        el.click();
                        n++;
                    } catch (e) {}
                }
            }
        } catch (e) {}
        return n;
    }

    function expandAllPasses(times, delay, cb) {
        var pass = 0;
        function step() {
            var c = 0;
            try { c = expandOnce(); } catch (e) {}
            pass++;
            if (c > 0 && pass < times) setTimeout(step, delay);
            else cb();
        }
        step();
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

    function imgToData(img) {
        var w = img.naturalWidth || img.width || 0;
        var h = img.naturalHeight || img.height || 0;
        if (w < 1 || h < 1) return null;
        var src = img.src || '';
        if (imgBytes > IMG_BUDGET) return src ? { type: 'img', data: src, w: w, h: h } : null;
        try {
            var scale = Math.min(1, MAX_IMG_W / w);
            var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            var c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            c.getContext('2d').drawImage(img, 0, 0, cw, ch);
            var d = c.toDataURL('image/png');
            if (d && d.length > 250000) {
                try { var j = c.toDataURL('image/jpeg', 0.85); if (j && j.length < d.length) d = j; } catch (e) {}
            }
            if (d && d.length > 100) { imgBytes += d.length; return { type: 'img', data: d, w: cw, h: ch }; }
        } catch (e) {}
        if (src) return { type: 'img', data: src, w: w, h: h };
        return null;
    }

    function extractMediaData(el) {
        if (!el) return null;
        try {
            var tag = el.tagName.toLowerCase();
            if (tag === 'mjx-container' || tag === 'math' || tag === 'figure' || tag === 'picture') {
                var inner = el.querySelector('svg') || el.querySelector('img') || el.querySelector('canvas');
                if (inner) return extractMediaData(inner);
                return null;
            }
            if (tag === 'img') return imgToData(el);
            if (tag === 'canvas') {
                try {
                    if (el.width < 1 || el.height < 1) return null;
                    var du = el.toDataURL('image/png');
                    if (du && du.length > 100) { imgBytes += du.length; return { type: 'img', data: du, w: el.width, h: el.height }; }
                } catch (e) {}
                return null;
            }
            if (tag === 'svg') {
                var rect = el.getBoundingClientRect();
                if (rect.width < 10 || rect.height < 10) return null;
                var cls = '';
                try {
                    cls = (el.className && typeof el.className.baseVal === 'string') ? el.className.baseVal.toLowerCase() : ((typeof el.className === 'string') ? el.className.toLowerCase() : '');
                } catch (e) {}
                if (cls.indexOf('icon') !== -1 || cls.indexOf('copy') !== -1 || cls.indexOf('thumb') !== -1 || cls.indexOf('feedback') !== -1) return null;

                var serializer = new XMLSerializer();
                var svgStr = serializer.serializeToString(el);
                if (svgStr.length > 400000) return null;
                if (svgStr.indexOf('xmlns=') === -1) svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
                return { type: 'svg', data: svgStr, w: rect.width, h: rect.height };
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
            for (i = 0; i < mediaTagged.length; i++) { try { mediaTagged[i].removeAttribute('data-mx'); } catch(e){} }

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

    function dedupeMedia(text, allMedia) {
        if (!allMedia || !allMedia.length) return { text: text, media: allMedia || [] };
        var out = [], map = {};
        var newText = text.replace(new RegExp(MS + '(\\d+)' + ME, 'g'), function (_, d) {
            var i = parseInt(d, 10);
            if (isNaN(i) || i < 0 || i >= allMedia.length) return '';
            if (!(i in map)) { map[i] = out.length; out.push(allMedia[i]); }
            return MS + map[i] + ME;
        });
        return { text: newText, media: out };
    }

    function shiftMarkers(text, offset) {
        if (!offset) return text;
        return (text || '').replace(new RegExp(MS + '(\\d+)' + ME, 'g'), function (_, d) {
            return MS + (parseInt(d, 10) + offset) + ME;
        });
    }

    function byDocOrder(a, b) {
        if (a === b) return 0;
        try { return (a.compareDocumentPosition(b) & 4) ? -1 : 1; } catch (e) { return 0; }
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
        text = text || '';
        media = media || [];
        if (text.replace(/[\s\uE000-\uE003]/g, '').length < 2 && media.length === 0) return;

        if (list.length && list[list.length - 1].role === role) {
            var last = list[list.length - 1];
            var offset = last.media.length;
            var shiftedNewText = shiftMarkers(text, offset);
            last.text += '\n' + shiftedNewText;
            last.media = last.media.concat(media || []);
            return;
        }
        list.push({ role: role, text: text, media: media });
    }

    function sendResult(messages) {
        try {
            var payload = JSON.stringify({
                title: document.title || 'Chat Export',
                url: location.href,
                messages: messages || []
            });
            var chunkSize = 50000;
            if (window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChunk) {
                for (var i = 0; i < payload.length; i += chunkSize) {
                    var chunk = payload.substring(i, i + chunkSize);
                    var last = (i + chunkSize >= payload.length) ? 1 : 0;
                    window.AndroidPdfExporter.receiveChunk(chunk, last);
                }
            } else if (window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChatData) {
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

    function extract() {
        var messages = [], i, t, r;

        try {
            var roleNodes = Array.prototype.slice.call(document.querySelectorAll('[data-message-author-role]'));
            if (roleNodes.length) {
                roleNodes.sort(byDocOrder);
                for (i = 0; i < roleNodes.length; i++) {
                    if (!isVisible(roleNodes[i])) continue;
                    var res = cleanText(roleNodes[i]);
                    res = dedupeMedia(res.text, res.media);
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
                    res2 = dedupeMedia(res2.text, res2.media);
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
                res3 = dedupeMedia(res3.text, res3.media);
                var whole = res3.text;
                if (whole && whole.length > 2) {
                    var chunks = whole.split(/\n\n+/);
                    var eu = true;
                    for (i = 0; i < chunks.length; i++) {
                        t = chunks[i].trim();
                        if (t.length < 3) continue;
                        pushMsg(messages, eu ? 'user' : 'ai', t, []);
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
        } catch (e) { return document.body; }
    }

    function loadHistory(cb) {
        var sc = findScroller(), tries = 0, lastH = -1, stable = 0;
        function step() {
            var h = 0;
            try { h = sc.scrollHeight || 0; } catch (e) {}
            if (h === lastH) stable++; else { stable = 0; lastH = h; }
            expandOnce();
            if (stable >= 3 || tries > 25) { cb(); return; }
            tries++;
            status('পুরনো মেসেজ লোড ' + tries);
            try { sc.scrollTop = 0; } catch (e) {}
            try { window.scrollTo(0, 0); } catch (e) {}
            setTimeout(step, 400);
        }
        step();
    }

    function sweepDown(cb) {
        var sc = findScroller(), y = 0, guard = 0;
        var stepH = Math.max(250, (sc.clientHeight || 500) - 100);
        function step() {
            guard++;
            try { sc.scrollTop = y; } catch (e) {}
            try { window.scrollTo(0, y); } catch (e) {}
            expandOnce();
            var total = 0;
            try { total = sc.scrollHeight || 0; } catch (e) {}
            if (guard % 4 === 0) status('স্ক্যান ' + Math.min(99, Math.round(y * 100 / Math.max(1, total))) + '%');
            y += stepH;
            if (y >= total + stepH || guard > 100) { cb(); return; }
            setTimeout(step, 150);
        }
        step();
    }

    function waitImages(cb) {
        var t0 = Date.now();
        function chk() {
            var pending = 0;
            try {
                var imgs = document.images;
                for (var i = 0; i < imgs.length; i++) {
                    if (!imgs[i].complete && (imgs[i].src || '').indexOf('data:') !== 0) pending++;
                }
            } catch (e) {}
            if (pending === 0 || Date.now() - t0 > 5000) cb(); else setTimeout(chk, 300);
        }
        chk();
    }

    try {
        expandAllPasses(3, 250, function () {
            loadHistory(function () {
                sweepDown(function () {
                    waitImages(function () {
                        expandAllPasses(2, 200, function () {
                            extract();
                        });
                    });
                });
            });
        });
    } catch (e) {
        sendResult([]);
    }
})();
