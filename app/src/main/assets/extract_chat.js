(function(){
    "use strict";

    var NOW_T = Date.now();
    if(window.__xExtRunning && (NOW_T - (window.__xExtStart || 0) < 900000)){ return; }
    window.__xExtRunning = true;
    window.__xExtStart = NOW_T;

    var CS = '\uE000', CE = '\uE001';
    var MS = '\uE002', ME = '\uE003';

    var CODE_SEL = 'pre, code-block, md-code-block, .code-block, [class*="code-block" i], [class*="codeBlock" i], .highlight';
    var LINENUM_SEL = '.line-numbers-rows, .hljs-ln-numbers, .hljs-ln-n, .CodeMirror-linenumber, .cm-lineNumbers, .gutter, [class*="line-number" i], [class*="lineNumber" i], [data-line-number]';

    var JUNK_HARD = 'script, style, noscript, iframe, template, input, select, textarea';
    var JUNK_SOFT = 'button, [role="button"], nav, [class*="copy" i], [class*="share" i], [class*="toolbar" i], [class*="feedback" i], [class*="tooltip" i], [class*="thumbs" i], [aria-label*="copy" i]';
    var SOFT_MAX = 120;

    var MAX_IMG_W = 1000;
    var IMG_BUDGET = 6 * 1024 * 1024;
    var imgBytes = 0;

    var EXPAND_TEXT = /(show\s*more|read\s*more|see\s*more|view\s*more|show\s*full|show\s*all|show\s*original|expand|continue\s*reading|load\s*more|click\s*to\s*expand|tap\s*to\s*expand|full\s*text|আরও\s*দেখুন|আরো\s*দেখুন|展开|显示更多|查看更多|全部显示|もっと見る|더\s*보기)/i;
    var BLOCK_TEXT = /(show\s*less|see\s*less|collapse|hide|delete|remove|share|export|download|sign\s*out|log\s*out|logout|regenerate|retry|stop|send|submit|edit|copy|new\s*chat|settings|upgrade|subscribe|收起|隐藏|删除|分享|停止|发送)/i;

    var CAND_SEL = 'button, [role="button"], summary, [aria-expanded="false"], [class*="more" i], [class*="expand" i], [class*="truncat" i], [class*="clamp" i], [class*="collaps" i], [class*="fold" i]';
    var SAFE_ZONE = '[data-message-author-role], user-query, model-response, [data-testid="user-message"], [class*="message" i], [class*="chat" i], [class*="prompt" i], [class*="bubble" i], [class*="markdown" i], article, main';

    function status(s){
        try{ if(window.AndroidPdfExporter && window.AndroidPdfExporter.reportStatus){ window.AndroidPdfExporter.reportStatus(String(s)); } }catch(e){}
    }

    function isVisible(el){
        if(!el || el.nodeType !== 1) return true;
        try{
            var rect = el.getBoundingClientRect();
            return !!(rect.width || rect.height || el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        }catch(e){ return true; }
    }

    function quickTextOf(node){
        var t = '';
        try{ t = node.innerText || node.textContent || ''; }catch(e){ t = ''; }
        return t.replace(/\s+/g, ' ').trim();
    }

    function injectStyle(){
        try{
            if(document.getElementById('__x_exp_style')) return;
            var st = document.createElement('style');
            st.id = '__x_exp_style';
            st.textContent =
                '[class*="truncat" i], [class*="clamp" i], [class*="collaps" i], [class*="fold" i], ' +
                '[class*="ellipsis" i], [class*="show-more" i], [class*="showmore" i], [class*="line-limit" i], ' +
                '[style*="line-clamp"], [style*="max-height"] { ' +
                'max-height: none !important; -webkit-line-clamp: unset !important; ' +
                '-webkit-mask-image: none !important; mask-image: none !important; ' +
                'overflow: visible !important; text-overflow: clip !important; }';
            (document.head || document.documentElement).appendChild(st);
        }catch(e){}
    }

    function unclampAll(){
        var n = 0;
        try{
            var zones = document.querySelectorAll(SAFE_ZONE);
            for(var zi=0; zi<zones.length; zi++){
                var zone = zones[zi];
                var all = zone.querySelectorAll('*');
                if(all.length > 4000) continue;
                for(var ai=0; ai<all.length; ai++){
                    var e2 = all[ai];
                    if(!e2 || e2.__xUnclamped) continue;
                    var sh = 0, ch = 0;
                    try{ sh = e2.scrollHeight; ch = e2.clientHeight; }catch(err){ continue; }
                    if(!(sh > ch + 4 && ch > 0)) continue;
                    var cs;
                    try{ cs = getComputedStyle(e2); }catch(err){ continue; }
                    var clamped = false;
                    try{
                        clamped = (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') ||
                                  cs.overflowY === 'hidden' || cs.overflow === 'hidden' ||
                                  cs.textOverflow === 'ellipsis' ||
                                  (cs.maxHeight && cs.maxHeight !== 'none' && parseFloat(cs.maxHeight) < sh);
                    }catch(err){}
                    if(clamped){
                        try{
                            e2.style.setProperty('max-height', 'none', 'important');
                            e2.style.setProperty('-webkit-line-clamp', 'unset', 'important');
                            e2.style.setProperty('overflow', 'visible', 'important');
                            e2.style.setProperty('text-overflow', 'clip', 'important');
                            e2.__xUnclamped = true;
                            n++;
                        }catch(err){}
                    }
                }
            }
        }catch(e){}
        return n;
    }

    function expandOnce(){
        var n = 0, i;
        try{
            var det = document.querySelectorAll('details:not([open])');
            for(i=0; i<det.length; i++){ try{ det[i].setAttribute('open', ''); n++; }catch(e){} }
        }catch(e){}

        try{
            injectStyle();
            var nodes = document.querySelectorAll(CAND_SEL);
            for(i=0; i<nodes.length; i++){
                var el = nodes[i];
                if(!el || el.__xClicked) continue;
                if(!isVisible(el)) continue;
                if(el.disabled || el.getAttribute('aria-disabled') === 'true') continue;

                var inSafe = false;
                try{ if(el.closest(SAFE_ZONE)) inSafe = true; }catch(e){}
                if(!inSafe) continue;

                var label = '';
                try{ label = (el.innerText || el.value || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''); }catch(e){}
                label = String(label).toLowerCase();
                if(label.length > 90) label = label.slice(0, 90);

                var ok = false;
                if(EXPAND_TEXT.test(label) && !BLOCK_TEXT.test(label)) ok = true;
                else if(el.getAttribute('aria-expanded') === 'false' && label.length < 30 && !BLOCK_TEXT.test(label) && label.length > 0) ok = true;

                if(ok){
                    try{ el.__xClicked = true; el.click(); n++; }catch(e){}
                }
            }
        }catch(e){}

        n += unclampAll();
        return n;
    }

    function expandAllPasses(times, delay, cb){
        var pass = 0;
        function step(){
            var c = 0;
            try{ c = expandOnce(); }catch(e){}
            pass++;
            if(c > 0 && pass < times) setTimeout(step, delay);
            else cb();
        }
        step();
    }

    function getCodeText(box){
        try{
            var codeEl = box.querySelector('code') || box;
            var hide = codeEl.querySelectorAll(LINENUM_SEL + ', button, svg');
            var saved = [], i;
            for(i=0; i<hide.length; i++){ saved.push(hide[i].style.display); hide[i].style.display = 'none'; }
            var txt = codeEl.innerText;
            if(!txt || !txt.length) txt = codeEl.textContent || '';
            for(i=0; i<hide.length; i++){ hide[i].style.display = saved[i]; }
            return txt.replace(/\u00a0/g, ' ').replace(/[\t]+$/gm, '').replace(/^\n+|\n+$/g, '');
        }catch(e){ return ''; }
    }

    function isJunkHolder(el){
        try{
            return !!el.closest('button, [role="button"], nav, header, [class*="copy" i], [class*="toolbar" i], [class*="action" i], [class*="avatar" i], [class*="icon" i]');
        }catch(e){ return false; }
    }

    function imgToData(img){
        var w = img.naturalWidth || img.width || 0;
        var h = img.naturalHeight || img.height || 0;
        var src = img.src || img.currentSrc || '';
        if(w < 24 && h < 24) return null;
        if(isJunkHolder(img)) return null;
        if(w < 1 || h < 1){
            if(src.indexOf('http') === 0) return {type:'img', data:src, w:0, h:0};
            return null;
        }
        if(imgBytes > IMG_BUDGET){
            return (src.indexOf('http') === 0) ? {type:'img', data:src, w:w, h:h} : null;
        }
        try{
            var scale = Math.min(1, MAX_IMG_W / w);
            var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            var c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            c.getContext('2d').drawImage(img, 0, 0, cw, ch);
            var d = c.toDataURL('image/png');
            if(d && d.length > 250000){ try{ var j = c.toDataURL('image/jpeg', 0.85); if(j && j.length < d.length) d = j; }catch(e){} }
            if(d && d.length > 100){ imgBytes += d.length; return {type:'img', data:d, w:cw, h:ch}; }
        }catch(e){}
        if(src.indexOf('http') === 0) return {type:'img', data:src, w:w, h:h};
        return null;
    }

    function extractMediaData(el){
        if(!el) return null;
        try{
            var tag = el.tagName.toLowerCase();
            if(tag === 'mjx-container' || tag === 'math' || tag === 'figure' || tag === 'picture'){
                var inner = el.querySelector('svg') || el.querySelector('img') || el.querySelector('canvas');
                if(inner) return extractMediaData(inner);
                return null;
            }
            if(tag === 'img') return imgToData(el);
            if(tag === 'canvas'){
                try{
                    if(el.width < 24 || el.height < 24) return null;
                    if(isJunkHolder(el)) return null;
                    var du = el.toDataURL('image/png');
                    if(du && du.length > 100){ imgBytes += du.length; return {type:'img', data:du, w:el.width, h:el.height}; }
                }catch(e){}
                return null;
            }
            if(tag === 'svg'){
                var rect = el.getBoundingClientRect();
                if(rect.width < 28 || rect.height < 28) return null;
                if(isJunkHolder(el)) return null;
                var cls = '';
                try{ cls = (el.className && typeof el.className.baseVal === 'string') ? el.className.baseVal.toLowerCase() : ((typeof el.className === 'string') ? el.className.toLowerCase() : ''); }catch(e){}
                if(cls.indexOf('icon') !== -1 || cls.indexOf('copy') !== -1 || cls.indexOf('thumb') !== -1 || cls.indexOf('feedback') !== -1) return null;
                var serializer = new XMLSerializer();
                var svgStr = serializer.serializeToString(el);
                if(svgStr.length > 400000) return null;
                if(svgStr.indexOf('xmlns=') === -1) svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
                return {type:'svg', data:svgStr, w:rect.width, h:rect.height};
            }
        }catch(e){}
        return null;
    }

    function mathTex(el){
        try{
            var a = el.querySelector('annotation[encoding="application/x-tex"]');
            if(a && a.textContent && a.textContent.trim()) return a.textContent.trim();
            var d = el.getAttribute('data-latex') || el.getAttribute('data-formula') || el.getAttribute('alt');
            if(d && String(d).trim()) return String(d).trim();
        }catch(e){}
        return '';
    }

    function cleanText(node){
        var i, j;
        try{
            var texList = [], texTagged = [];
            try{
                var mnodes = node.querySelectorAll('.katex, mjx-container, math');
                for(i=0; i<mnodes.length; i++){
                    var mm = mnodes[i], skT = false;
                    for(j=0; j<texTagged.length; j++){ if(texTagged[j].contains(mm)){ skT = true; break; } }
                    if(skT) continue;
                    var tex = mathTex(mm);
                    if(!tex) continue;
                    mm.setAttribute('data-tx', String(texList.length));
                    texTagged.push(mm);
                    texList.push(tex);
                }
            }catch(e){}

            var MEDIA_SEL = 'img, svg, canvas, mjx-container, math, picture, figure';
            var mediaNodes = node.querySelectorAll(MEDIA_SEL);
            var mediaList = [], mediaTagged = [];
            for(i=0; i<mediaNodes.length; i++){
                var m = mediaNodes[i], skip = false;
                try{ if(m.getAttribute('data-tx') !== null || m.closest('[data-tx]')) continue; }catch(e){}
                for(j=0; j<mediaTagged.length; j++){ if(mediaTagged[j].contains(m)){ skip = true; break; } }
                if(skip) continue;
                var data = extractMediaData(m);
                if(!data) continue;
                var idx = mediaList.length;
                mediaList.push(data);
                m.setAttribute('data-mx', String(idx));
                mediaTagged.push(m);
            }

            var boxes = node.querySelectorAll(CODE_SEL);
            var codes = [], tagged = [];
            for(i=0; i<boxes.length; i++){
                var b = boxes[i], skip2 = false;
                for(j=0; j<tagged.length; j++){ if(tagged[j].contains(b)){ skip2 = true; break; } }
                if(skip2) continue;
                var t = getCodeText(b);
                if(!t) continue;
                b.setAttribute('data-cx', String(codes.length));
                tagged.push(b);
                codes.push(t);
            }

            var clone = node.cloneNode(true);
            for(i=0; i<tagged.length; i++){ try{ tagged[i].removeAttribute('data-cx'); }catch(e){} }
            for(i=0; i<mediaTagged.length; i++){ try{ mediaTagged[i].removeAttribute('data-mx'); }catch(e){} }
            for(i=0; i<texTagged.length; i++){ try{ texTagged[i].removeAttribute('data-tx'); }catch(e){} }

            var tmarks = clone.querySelectorAll('[data-tx]');
            for(i=0; i<tmarks.length; i++){
                var tidx = parseInt(tmarks[i].getAttribute('data-tx'), 10);
                if(!isNaN(tidx) && tidx >= 0 && tidx < texList.length){
                    var tnT = document.createTextNode(' $' + texList[tidx] + '$ ');
                    tmarks[i].parentNode.replaceChild(tnT, tmarks[i]);
                }
            }

            var marks = clone.querySelectorAll('[data-cx]');
            for(i=0; i<marks.length; i++){
                var cidx = parseInt(marks[i].getAttribute('data-cx'), 10);
                if(!isNaN(cidx) && cidx >= 0 && cidx < codes.length){
                    var tn = document.createTextNode('\n' + CS + codes[cidx] + CE + '\n');
                    marks[i].parentNode.replaceChild(tn, marks[i]);
                }
            }
            var mmarks = clone.querySelectorAll('[data-mx]');
            for(i=0; i<mmarks.length; i++){
                var midx = parseInt(mmarks[i].getAttribute('data-mx'), 10);
                if(!isNaN(midx) && midx >= 0 && midx < mediaList.length){
                    var tn2 = document.createTextNode('\n' + MS + midx + ME + '\n');
                    mmarks[i].parentNode.replaceChild(tn2, mmarks[i]);
                }
            }

            var junkHard = clone.querySelectorAll(JUNK_HARD);
            for(i=0; i<junkHard.length; i++){
                var elH = junkHard[i];
                if(!elH.parentNode) continue;
                if(elH.textContent && (elH.textContent.indexOf(CS) !== -1 || elH.textContent.indexOf(MS) !== -1)) continue;
                elH.parentNode.removeChild(elH);
            }

            var junkSoft = clone.querySelectorAll(JUNK_SOFT);
            for(i=0; i<junkSoft.length; i++){
                var elS = junkSoft[i];
                if(!elS.parentNode) continue;
                var txtS = elS.textContent || '';
                if(txtS.indexOf(CS) !== -1 || txtS.indexOf(MS) !== -1) continue;
                if(txtS.trim().length > SOFT_MAX) continue;
                elS.parentNode.removeChild(elS);
            }

            var srOnly = clone.querySelectorAll('.sr-only, .visually-hidden, .screen-reader-only, [class*="sr-only" i]');
            for(i=0; i<srOnly.length; i++){
                var elR = srOnly[i];
                if(!elR.parentNode) continue;
                var txtR = elR.textContent || '';
                if(txtR.indexOf(CS) !== -1 || txtR.indexOf(MS) !== -1) continue;
                elR.parentNode.removeChild(elR);
            }

            var inline = clone.querySelectorAll('code');
            for(i=0; i<inline.length; i++){
                var it = (inline[i].textContent || '').trim();
                if(it) inline[i].parentNode.replaceChild(document.createTextNode('`' + it + '`'), inline[i]);
            }
            var brs = clone.querySelectorAll('br');
            for(i=0; i<brs.length; i++) brs[i].parentNode.replaceChild(document.createTextNode('\n'), brs[i]);
            var cells = clone.querySelectorAll('td, th');
            for(i=0; i<cells.length; i++) cells[i].appendChild(document.createTextNode('\t'));
            var blocks = clone.querySelectorAll('p, li, tr, h1, h2, h3, h4, h5, h6, div, section, article, blockquote');
            for(i=0; i<blocks.length; i++) blocks[i].appendChild(document.createTextNode('\n'));

            var out = clone.textContent || '';
            return { text: out.replace(/\u00a0/g, ' ').replace(/[\t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), media: mediaList };
        }catch(e){
            return { text: '', media: [] };
        }
    }

    function dedupeMedia(text, allMedia){
        if(!allMedia || !allMedia.length) return { text: text, media: allMedia || [] };
        var out = [], map = {};
        var newText = text.replace(new RegExp(MS + '(\\d+)' + ME, 'g'), function(_, d){
            var i = parseInt(d, 10);
            if(isNaN(i) || i < 0 || i >= allMedia.length) return '';
            if(!(i in map)){ map[i] = out.length; out.push(allMedia[i]); }
            return MS + map[i] + ME;
        });
        return { text: newText, media: out };
    }

    function shiftMarkers(text, offset){
        if(!offset) return text;
        return (text || '').replace(new RegExp(MS + '(\\d+)' + ME, 'g'), function(_, d){
            return MS + (parseInt(d, 10) + offset) + ME;
        });
    }

    function byDocOrder(a, b){
        if(a === b) return 0;
        try{ return (a.compareDocumentPosition(b) & 4) ? -1 : 1; }catch(e){ return 0; }
    }

    function alignRole(node){
        try{
            var p = node.parentElement;
            if(!p) return '';
            var pr = p.getBoundingClientRect();
            var nr = node.getBoundingClientRect();
            if(pr.width < 200 || nr.width < 40) return '';
            if(nr.width > pr.width * 0.82) return '';
            var pc = pr.left + pr.width / 2;
            var nc = nr.left + nr.width / 2;
            if(nc > pc + pr.width * 0.06) return 'user';
        }catch(e){}
        return '';
    }

    function guessRole(node){
        try{
            var cls = '';
            try{ cls = (typeof node.className === 'string') ? node.className : ''; }catch(e){}
            var h = ((node.getAttribute('data-message-author-role') || '') + ' ' +
                     (node.getAttribute('data-testid') || '') + ' ' +
                     (node.getAttribute('data-role') || '') + ' ' +
                     (node.getAttribute('data-content') || '') + ' ' +
                     (node.tagName || '') + ' ' +
                     cls + ' ' + (node.id || '')).toLowerCase();
            if(/(user|human|prompt|question|outgoing|my-message|sender)/.test(h)) return 'user';
            if(/(assistant|bot|model|answer|response|incoming|ai-message|markdown|gpt|qwen|gemini|deepseek|claude|copilot|grok)/.test(h)) return 'ai';
        }catch(e){}
        return alignRole(node);
    }

    function roleAttr(n){ return ((n.getAttribute('data-message-author-role') || '').toLowerCase() === 'user') ? 'user' : 'ai'; }
    function roleGemini(n){ return (n.tagName || '').toLowerCase() === 'user-query' ? 'user' : 'ai'; }
    function roleClaude(n){ return (n.getAttribute('data-testid') === 'user-message') ? 'user' : 'ai'; }
    function roleCopilot(n){ return ((n.getAttribute('data-content') || '').indexOf('user') !== -1) ? 'user' : 'ai'; }

    var GROUPS = [
        { sel: '[data-message-author-role]', role: roleAttr, leaf: false },
        { sel: 'user-query, model-response', role: roleGemini, leaf: false },
        { sel: '[data-testid="user-message"], .font-claude-message', role: roleClaude, leaf: false },
        { sel: '[data-content="user-message"], [data-content="ai-message"]', role: roleCopilot, leaf: false },
        { sel: '[class*="message-bubble" i], [class*="messageBubble" i], [class*="chat-message" i], [class*="conversation-turn" i], [class*="chat-turn" i], [data-testid*="turn" i]', role: null, leaf: true },
        { sel: '[data-message-id], [id^="message-"], [class*="msg-item" i], [class*="chat-item" i], [class*="message" i], article', role: null, leaf: true },
        { sel: null, role: null, leaf: false }
    ];

    var structKids = null;

    function structuralTurns(){
        if(structKids && structKids.length && structKids[0].isConnected) return structKids;
        var res = [];
        try{
            var sc = findScroller();
            if(!sc) return res;
            var scLen = quickTextOf(sc).length;
            if(scLen < 20) return res;
            var cands = [sc];
            var inner = sc.querySelectorAll('div, main, section, ol, ul');
            for(var i=0; i<inner.length && i<500; i++) cands.push(inner[i]);
            var best = null, bestLen = 0;
            for(var c=0; c<cands.length; c++){
                var el = cands[c];
                if(!el || !el.children || el.children.length < 2) continue;
                if(el.children.length > 400) continue;
                var kids = [], tot = 0;
                for(var k=0; k<el.children.length; k++){
                    var ch = el.children[k];
                    var tl = quickTextOf(ch).length;
                    var hasM = false;
                    try{ hasM = !!ch.querySelector('img, svg, canvas'); }catch(e){}
                    if(tl > 1 || hasM){ kids.push(ch); tot += tl; }
                }
                if(kids.length < 2) continue;
                if(tot < scLen * 0.5) continue;
                if(tot > bestLen * 1.05){ best = kids; bestLen = tot; }
            }
            if(best) res = best;
        }catch(e){}
        structKids = res;
        return res;
    }

    var chosenGroup = -1;

    function collectGroup(g){
        var nodes = [];
        try{
            if(g.sel === null) nodes = structuralTurns().slice(0);
            else nodes = Array.prototype.slice.call(document.querySelectorAll(g.sel));
        }catch(e){ return []; }
        var ok = [];
        for(var i=0; i<nodes.length; i++){
            var n = nodes[i];
            if(!n || n.nodeType !== 1) continue;
            if(!isVisible(n)) continue;
            ok.push(n);
        }
        if(g.leaf && g.sel){
            var leafs = [];
            for(var j=0; j<ok.length; j++){
                var inner = 0;
                try{ inner = ok[j].querySelectorAll(g.sel).length; }catch(e){}
                if(inner === 0) leafs.push(ok[j]);
            }
            ok = leafs;
        } else {
            var outer = [];
            for(var p=0; p<ok.length; p++){
                var contained = false;
                for(var q=0; q<ok.length; q++){
                    if(p === q) continue;
                    try{ if(ok[q].contains(ok[p])){ contained = true; break; } }catch(e){}
                }
                if(!contained) outer.push(ok[p]);
            }
            ok = outer;
        }
        try{ ok.sort(byDocOrder); }catch(e){}
        return ok;
    }

    function pickGroup(){
        var i, g, nodes;
        if(chosenGroup >= 0){
            g = GROUPS[chosenGroup];
            nodes = collectGroup(g);
            if(nodes.length) return { nodes: nodes, role: g.role };
        }
        for(i=0; i<GROUPS.length; i++){
            g = GROUPS[i];
            nodes = collectGroup(g);
            if(nodes.length >= 1){ chosenGroup = i; return { nodes: nodes, role: g.role }; }
        }
        return null;
    }

    var collected = [];
    var keyIndex = {};

    function keyOf(role, q){
        return role + '#' + q.length + '#' + q.slice(0, 150) + '#' + q.slice(-80);
    }

    function findNearDup(role, q){
        var start = collected.length - 1;
        var stop = Math.max(0, collected.length - 60);
        for(var i=start; i>=stop; i--){
            var c = collected[i];
            if(c.role !== role) continue;
            if(c.q === q) return i;
            if(q.length > 40 && c.q.length > 40){
                if(c.q.indexOf(q) === 0 || q.indexOf(c.q) === 0) return i;
            }
        }
        return -1;
    }

    function harvest(finalPass){
        var g = pickGroup();
        if(!g) return;
        var nodes = g.nodes;
        var expectUser = true;
        for(var i=0; i<nodes.length; i++){
            var n = nodes[i];
            if(!finalPass && n.__xDone) continue;
            var q = quickTextOf(n);
            var hasMedia = false;
            try{ hasMedia = !!n.querySelector('img, svg, canvas'); }catch(e){}
            if(q.length < 1 && !hasMedia){ n.__xDone = true; continue; }

            var role;
            if(g.role) role = g.role(n);
            else {
                role = guessRole(n) || (expectUser ? 'user' : 'ai');
            }
            expectUser = (role !== 'user');

            var k = keyOf(role, q);
            if(!finalPass && (k in keyIndex)){ n.__xDone = true; continue; }

            var res = cleanText(n);
            res = dedupeMedia(res.text, res.media);
            n.__xDone = true;

            if(k in keyIndex){
                var e0 = collected[keyIndex[k]];
                if(res.text.length >= e0.text.length || res.media.length > e0.media.length){
                    e0.text = res.text; e0.media = res.media; e0.q = q;
                }
                continue;
            }

            var dup = findNearDup(role, q);
            if(dup >= 0){
                var ex = collected[dup];
                if(q.length > ex.q.length || res.media.length > ex.media.length){
                    ex.q = q; ex.text = res.text; ex.media = res.media;
                    keyIndex[k] = dup;
                }
                continue;
            }

            if(res.text.replace(/[\s\uE000-\uE003]/g, '').length < 1 && res.media.length === 0) continue;
            keyIndex[k] = collected.length;
            collected.push({ role: role, q: q, text: res.text, media: res.media });
        }
    }

    function pushMsg(list, role, text, media){
        text = text || ''; media = media || [];
        if(text.replace(/[\s\uE000-\uE003]/g, '').length < 1 && media.length === 0) return;
        if(list.length && list[list.length-1].role === role){
            var last = list[list.length-1];
            var offset = last.media.length;
            last.text += '\n' + shiftMarkers(text, offset);
            last.media = last.media.concat(media || []);
            return;
        }
        list.push({ role: role, text: text, media: media });
    }

    function sendResult(messages){
        try{
            var payload = JSON.stringify({ title: document.title || 'Chat Export', url: location.href, messages: messages || [] });
            var chunkSize = 50000;
            if(window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChunk){
                for(var i=0; i<payload.length; i+=chunkSize){
                    var chunk = payload.substring(i, i+chunkSize);
                    var last = (i+chunkSize >= payload.length) ? 1 : 0;
                    window.AndroidPdfExporter.receiveChunk(chunk, last);
                }
            } else if(window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChatData){
                window.AndroidPdfExporter.receiveChatData(payload);
            }
        }catch(e){
            try{
                if(window.AndroidPdfExporter && window.AndroidPdfExporter.receiveChatData){
                    window.AndroidPdfExporter.receiveChatData(JSON.stringify({ title:'Error', url:'', messages:[] }));
                }
            }catch(e2){}
        } finally {
            try{ window.__xExtRunning = false; }catch(e){}
        }
    }

    function bodyFallback(messages){
        try{
            var res3 = cleanText(document.body);
            res3 = dedupeMedia(res3.text, res3.media);
            var whole = res3.text;
            var media3 = res3.media;
            if(whole && whole.length > 2){
                var chunks = whole.split(/\n\n+/);
                var eu = true;
                var mre = new RegExp(MS + '(\\d+)' + ME, 'g');
                for(var i=0; i<chunks.length; i++){
                    var t = chunks[i].trim();
                    if(t.length < 3) continue;
                    var chunkMedia = [];
                    var chunkText = t.replace(mre, function(_, d){
                        var mi = parseInt(d, 10);
                        if(isNaN(mi) || mi < 0 || mi >= media3.length) return '';
                        var newIdx = chunkMedia.length;
                        chunkMedia.push(media3[mi]);
                        return MS + newIdx + ME;
                    });
                    pushMsg(messages, eu ? 'user' : 'ai', chunkText, chunkMedia);
                    eu = !eu;
                }
            }
        }catch(e){}
    }

    function buildAndSend(){
        var messages = [];
        for(var i=0; i<collected.length; i++){
            pushMsg(messages, collected[i].role, collected[i].text, collected[i].media);
        }
        if(!messages.length) bodyFallback(messages);
        status('PDF তৈরি হচ্ছে...');
        sendResult(messages);
    }

    function findScroller(){
        try{
            var best = document.scrollingElement || document.body, bestH = 0;
            var all = document.querySelectorAll('div, main, section');
            for(var i=0; i<all.length; i++){
                var el = all[i];
                if(el.clientHeight > 200 && el.scrollHeight > el.clientHeight + 200){
                    var oy = getComputedStyle(el).overflowY;
                    if((oy === 'auto' || oy === 'scroll') && el.scrollHeight > bestH){ bestH = el.scrollHeight; best = el; }
                }
            }
            return best;
        }catch(e){ return document.body; }
    }

    function loadHistory(cb){
        var sc = findScroller(), tries = 0, lastH = -1, stable = 0;
        function step(){
            var h = 0;
            try{ h = sc.scrollHeight || 0; }catch(e){}
            if(h === lastH) stable++; else{ stable = 0; lastH = h; }
            expandOnce();
            if(stable >= 3 || tries > 60){ cb(); return; }
            tries++;
            status('পুরনো চ্যাট লোড ' + tries);
            try{ sc.scrollTop = 0; }catch(e){}
            try{ window.scrollTo(0, 0); }catch(e){}
            setTimeout(step, 400);
        }
        step();
    }

    function sweepDown(cb){
        var sc = findScroller(), y = 0, guard = 0;
        var stepH = Math.max(200, (sc.clientHeight || 500) - 200);
        function step(){
            guard++;
            try{ sc.scrollTop = y; }catch(e){}
            try{ window.scrollTo(0, y); }catch(e){}
            expandOnce();
            try{ harvest(false); }catch(e){}
            var total = 0;
            try{ total = sc.scrollHeight || 0; }catch(e){}
            if(guard % 3 === 0) status('স্ক্যান ' + Math.min(99, Math.round(y * 100 / Math.max(1, total))) + '%');
            y += stepH;
            if(y >= total + stepH || guard > 500){ cb(); return; }
            setTimeout(step, 280);
        }
        step();
    }

    function waitImages(cb){
        var t0 = Date.now();
        function chk(){
            var pending = 0;
            try{
                var imgs = document.images;
                for(var i=0; i<imgs.length; i++){
                    if(!imgs[i].complete && (imgs[i].src || '').indexOf('data:') !== 0) pending++;
                }
            }catch(e){}
            if(pending === 0 || Date.now() - t0 > 12000) cb(); else setTimeout(chk, 300);
        }
        chk();
    }

    try{
        status('প্রস্তুতি...');
        expandAllPasses(3, 250, function(){
            loadHistory(function(){
                sweepDown(function(){
                    waitImages(function(){
                        expandAllPasses(4, 400, function(){
                            try{ harvest(false); }catch(e){}
                            expandAllPasses(2, 400, function(){
                                status('শেষ চেক...');
                                try{ harvest(true); }catch(e){}
                                buildAndSend();
                            });
                        });
                    });
                });
            });
        });
    }catch(e){
        sendResult([]);
    }
})();
