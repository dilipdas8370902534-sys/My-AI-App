(function(){
"use strict";
if(window.__xExtRunning){ return; }
window.__xExtRunning = true;

var CS = '\uE000', CE = '\uE001';
var MS = '\uE002', ME = '\uE003';

var CODE_SEL = 'pre, code-block, md-code-block, .code-block, [class*="code-block" i], [class*="codeBlock" i], .highlight';
var LINENUM_SEL = '.line-numbers-rows, .hljs-ln-numbers, .hljs-ln-n, .CodeMirror-linenumber, .cm-lineNumbers, .gutter, [class*="line-number" i], [class*="lineNumber" i], [data-line-number]';
var JUNK_SEL = 'script, style, noscript, iframe, input, select, textarea, button, nav, header, footer, [role="button"], [class*="copy" i], [class*="share" i], [class*="toolbar" i], [class*="feedback" i], [class*="tooltip" i]';

var MAX_IMG_W = 1000;
var IMG_BUDGET = 7 * 1024 * 1024;
var imgBytes = 0;

var EXPAND_TEXT = /(show\s*more|read\s*more|see\s*more|view\s*more|show\s*full|show\s*all|show\s*original|expand|continue\s*reading|load\s*more|click\s*to\s*expand|tap\s*to\s*expand|আরও|আরো|সম্পূর্ণ|বিস্তারিত|দেখুন|展开|更多|全部|もっと見る|더\s*보기)/i;
var BLOCK_TEXT = /(show\s*less|see\s*less|collapse|hide|delete|remove|share|export|download|sign\s*out|log\s*out|logout|regenerate|retry|edit|copy|new\s*chat|settings|upgrade|收起|删除)/i;

var CAND_SEL = 'button, [role="button"], summary, [aria-expanded="false"], [class*="more" i], [class*="expand" i], [class*="truncat" i], [class*="clamp" i], [class*="collaps" i], [class*="fold" i]';
var SAFE_ZONE = '[data-message-author-role], [class*="message" i], [class*="chat" i], [class*="prompt" i], [class*="bubble" i], article, main';

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

function injectStyle(){
  try{
    if(document.getElementById('__x_exp_style')) return;
    var st = document.createElement('style');
    st.id = '__x_exp_style';
    st.textContent = '[class*="truncat" i], [class*="clamp" i], [class*="collaps" i], [class*="fold" i], ' +
      '[class*="ellipsis" i], [class*="show-more" i], [class*="showmore" i], [class*="line-limit" i], ' +
      '[style*="line-clamp"], [style*="max-height"] { ' +
      'max-height: none !important; -webkit-line-clamp: unset !important; ' +
      '-webkit-mask-image: none !important; overflow: visible !important; text-overflow: clip !important; }';
    (document.head || document.documentElement).appendChild(st);
  }catch(e){}
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
      if(!isVisible(el)) continue;
      if(el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      var inSafe = false;
      try{ if(el.closest(SAFE_ZONE)) inSafe = true; }catch(e){}
      if(!inSafe) continue;
      var label = '';
      try{ label = (el.innerText || el.value || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase(); }catch(e){}
      if(label.length > 90) label = label.slice(0, 90);
      var cls = '';
      try{ cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : ''; }catch(e){}
      var ok = false;
      if(EXPAND_TEXT.test(label) && !BLOCK_TEXT.test(label)) ok = true;
      else if(el.getAttribute('aria-expanded') === 'false' && label.length > 2 &&
              /(more|expand|truncat|clamp)/.test(label + ' ' + cls) && !BLOCK_TEXT.test(label)) ok = true;
      if(ok){ try{ el.click(); n++; }catch(e){} }
    }
  }catch(e){}
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

function imgToData(img){
  var w = img.naturalWidth || img.width || 0;
  var h = img.naturalHeight || img.height || 0;
  if(w < 1 || h < 1) return null;
  var src = img.src || '';
  if(imgBytes > IMG_BUDGET) return src ? {type:'img', data:src, w:w, h:h} : null;
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
  if(src) return {type:'img', data:src, w:w, h:h};
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
        if(el.width < 1 || el.height < 1) return null;
        var du = el.toDataURL('image/png');
        if(du && du.length > 100){ imgBytes += du.length; return {type:'img', data:du, w:el.width, h:el.height}; }
      }catch(e){}
      return null;
    }
    if(tag === 'svg'){
      var rect = el.getBoundingClientRect();
      if(rect.width < 10 || rect.height < 10) return null;
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

function cleanText(node){
  var i, j;
  try{
    var MEDIA_SEL = 'img, svg, canvas, mjx-container, math, picture, figure';
    var mediaNodes = node.querySelectorAll(MEDIA_SEL);
    var mediaList = [], mediaTagged = [];
    for(i=0; i<mediaNodes.length; i++){
      var m = mediaNodes[i], skip = false;
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

    // LaTeX/Math fix
    var kx = clone.querySelectorAll('.katex, mjx-container');
    for(i=0; i<kx.length; i++){
      var tex = kx[i].querySelector('annotation[encoding="application/x-tex"]');
      var rep = tex ? ('$' + (tex.textContent||'').trim() + '$') : (kx[i].innerText || '');
      kx[i].parentNode.replaceChild(document.createTextNode(' ' + rep + ' '), kx[i]);
    }
    var hid = clone.querySelectorAll('.katex-mathml, .sr-only, .visually-hidden, [hidden], [style*="display:none"], [style*="display: none"]');
    for(i=0; i<hid.length; i++){ if(hid[i].parentNode) hid[i].parentNode.removeChild(hid[i]); }

    var junk = clone.querySelectorAll(JUNK_SEL);
    for(i=0; i<junk.length; i++){
      var el = junk[i];
      if(!el.parentNode) continue;
      if(el.textContent && (el.textContent.indexOf(CS) !== -1 || el.textContent.indexOf(MS) !== -1)) continue;
      el.parentNode.removeChild(el);
    }

    var inline = clone.querySelectorAll('code');
    for(i=0; i<inline.length; i++){
      var it = (inline[i].textContent || '').trim();
      if(it) inline[i].parentNode.replaceChild(document.createTextNode('`' + it + '`'), inline[i]);
    }

    // List numbering & links
    var lis = clone.querySelectorAll('li');
    for(i=0; i<lis.length; i++){
      var par = lis[i].parentNode;
      var pre = '• ';
      if(par && par.tagName && par.tagName.toLowerCase() === 'ol'){
        var n = 1, s = lis[i].previousElementSibling;
        while(s){ if(s.tagName.toLowerCase()==='li') n++; s = s.previousElementSibling; }
        pre = n + '. ';
      }
      lis[i].insertBefore(document.createTextNode(pre), lis[i].firstChild);
    }
    var as = clone.querySelectorAll('a[href]');
    for(i=0; i<as.length; i++){
      var hrefv = as[i].getAttribute('href') || '';
      var atxt = (as[i].textContent || '').trim();
      if(hrefv && hrefv.indexOf('http') === 0 && atxt && hrefv.indexOf(atxt) === -1){
        as[i].appendChild(document.createTextNode(' (' + hrefv + ')'));
      }
    }

    var brs = clone.querySelectorAll('br');
    for(i=0; i<brs.length; i++) brs[i].parentNode.replaceChild(document.createTextNode('\n'), brs[i]);
    var cells = clone.querySelectorAll('td, th');
    for(i=0; i<cells.length; i++) cells[i].appendChild(document.createTextNode('\t'));
    var blocks = clone.querySelectorAll('p, li, tr, h1, h2, h3, h4, h5, h6, div');
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

function guessRole(node){
  try{
    var cls = '';
    try{ cls = (typeof node.className === 'string') ? node.className : ''; }catch(e){}
    var h = ((node.getAttribute('data-message-author-role') || '') + ' ' +
             (node.getAttribute('data-testid') || '') + ' ' +
             (node.getAttribute('data-role') || '') + ' ' + cls + ' ' + (node.id || '')).toLowerCase();
    if(/(user|human|prompt|question|outgoing|my-message)/.test(h)) return 'user';
    if(/(assistant|bot|model|answer|response|incoming|ai-message|gpt|qwen|gemini|deepseek|claude|copilot|grok)/.test(h)) return 'ai';
  }catch(e){}
  return '';
}

function pushMsg(list, role, text, media){
  text = text || ''; media = media || [];
  if(text.replace(/[\s\uE000-\uE003]/g, '').length < 1 && media.length === 0) return;
  if(list.length && list[list.length-1].role === role){
    var last = list[list.length-1];
    var offset = last.media.length;
    var shiftedNewText = shiftMarkers(text, offset);
    last.text += '\n' + shiftedNewText;
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

// Incremental Collector — Virtual Scrolling Fix
var collected = [], seen = {};

function hashStr(s){ var h=5381,i; for(i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))|0; } return String(h); }

var SITE_SEL = '[data-message-author-role], user-query, model-response, ' +
  '[data-testid="user-message"], [class*="font-user-message" i], [class*="font-claude-message" i], ' +
  '[class*="ds-markdown" i], [class*="chat-message" i], [class*="message-bubble" i], ' +
  '[class*="conversation-turn" i], [class*="chat-turn" i]';

var _sc = null;
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
function getScroller(){
  try{ if(_sc && document.contains(_sc)) return _sc; }catch(e){}
  _sc = findScroller();
  return _sc;
}
function absY(el){
  try{
    var sc = getScroller();
    var r = el.getBoundingClientRect();
    if(!sc || sc === document.body || sc === document.documentElement || sc === document.scrollingElement){
      return r.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
    }
    var sr = sc.getBoundingClientRect();
    return (r.top - sr.top) + (sc.scrollTop || 0);
  }catch(e){ return 0; }
}

function getMessageNodes(){
  var all = Array.prototype.slice.call(document.querySelectorAll(SITE_SEL));
  var out = all.filter(function(n){
    if(!isVisible(n)) return false;
    for(var i=0; i<all.length; i++){ if(all[i]!==n && all[i].contains(n)) return false; }
    return true;
  });
  out.sort(byDocOrder);
  return out;
}

function roleOf(el){
  var r = (el.getAttribute('data-message-author-role')||'').toLowerCase();
  if(r) return (r === 'user') ? 'user' : 'ai';
  var tag = el.tagName.toLowerCase();
  if(tag === 'user-query') return 'user';
  if(tag === 'model-response') return 'ai';
  return guessRole(el) || 'ai';
}

function quickKey(el){
  var id = el.getAttribute('data-message-id') || el.getAttribute('data-id') || el.id;
  if(id) return 'i:' + id;
  var t = (el.innerText || el.textContent || '').replace(/\s+/g,' ').trim();
  return 'h:' + hashStr(t.slice(0,60)) + ':' + t.length.toString().slice(0,2);
}

function collectPass(){
  var nodes = getMessageNodes(), i;
  for(i=0; i<nodes.length; i++){
    var el = nodes[i];
    var k = quickKey(el);
    var curLen = (el.innerText || '').length;
    var y = absY(el);
    var rec = seen[k];
    if(rec && curLen <= rec.len) continue;
    if(rec && Math.abs(y - rec.y) > 900){
      k = k + '@' + Math.round(y / 300);
      rec = seen[k];
    }
    var res = cleanText(el);
    res = dedupeMedia(res.text, res.media);
    if(res.text.replace(/[\s\uE000-\uE003]/g,'').length < 1 && !res.media.length) continue;
    var item = { role: roleOf(el), text: res.text, media: res.media, y: y };
    if(rec){ collected[rec.idx] = item; rec.len = curLen; rec.y = y; }
    else { seen[k] = { idx: collected.length, len: curLen, y: y }; collected.push(item); }
  }
}

function finishFromCollected(){
  if(!collected.length){ sendResult([]); return; }
  // Sort by Y position (top to bottom)
  var sorted = collected.slice().sort(function(a, b){ return (a.y || 0) - (b.y || 0); });
  var out = [];
  for(var i=0; i<sorted.length; i++){
    pushMsg(out, sorted[i].role, sorted[i].text, sorted[i].media);
  }
  sendResult(out);
}

function loadHistory(cb){
  var sc = getScroller(), tries = 0, lastH = -1, stable = 0;
  function step(){
    var h = 0;
    try{ h = sc.scrollHeight || 0; }catch(e){}
    if(h === lastH) stable++; else{ stable = 0; lastH = h; }
    expandOnce();
    try{ collectPass(); }catch(e){}
    if(stable >= 3 || tries > 60){ cb(); return; }
    tries++;
    status('পুরোনো মেসেজ লোড ' + tries);
    try{ sc.scrollTop = 0; }catch(e){}
    try{ window.scrollTo(0, 0); }catch(e){}
    setTimeout(step, 400);
  }
  step();
}

function sweepDown(cb){
  var sc = getScroller(), y = 0, guard = 0;
  var stepH = Math.max(200, (sc.clientHeight || 500) - 200);
  function step(){
    guard++;
    expandOnce();
    try{ collectPass(); }catch(e){}
    try{ sc.scrollTop = y; }catch(e){}
    try{ window.scrollTo(0, y); }catch(e){}
    var total = 0;
    try{ total = sc.scrollHeight || 0; }catch(e){}
    if(guard % 4 === 0) status('স্ক্যান ' + Math.min(99, Math.round(y * 100 / Math.max(1, total))) + '%');
    y += stepH;
    if(y >= total + stepH || guard > 400){
      setTimeout(function(){ try{ collectPass(); }catch(e){} cb(); }, 400);
      return;
    }
    setTimeout(step, 260);
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
    if(pending === 0 || Date.now() - t0 > 12000) cb();
    else setTimeout(chk, 300);
  }
  chk();
}

try{
  expandAllPasses(3, 250, function(){
    loadHistory(function(){
      sweepDown(function(){
        waitImages(function(){
          expandAllPasses(4, 400, function(){
            try{ collectPass(); }catch(e){}
            status('PDF বানানো হচ্ছে');
            finishFromCollected();
          });
        });
      });
    });
  });
}catch(e){ sendResult([]); }
})();
