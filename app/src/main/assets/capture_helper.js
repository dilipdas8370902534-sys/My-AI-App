(function () {
    "use strict";

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

    window.__capScroll = function (y) {
        try { sc.scrollTop = y; } catch (e) {}
        try { window.scrollTo(0, y); } catch (e) {}
    };

    window.__capMetrics = function () {
        var isDoc = (sc === document.scrollingElement || sc === document.body || sc === document.documentElement);
        var sh = sc.scrollHeight;
        var r;
        if (isDoc) {
            sh = Math.max(sh,
                document.body ? document.body.scrollHeight : 0,
                document.documentElement ? document.documentElement.scrollHeight : 0);
            r = { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
        } else {
            var b = sc.getBoundingClientRect();
            r = { top: b.top, left: b.left, width: b.width, height: b.height };
        }
        return { sh: sh, ch: sc.clientHeight || window.innerHeight, top: r.top, left: r.left, w: r.width, h: r.height };
    };
})();
