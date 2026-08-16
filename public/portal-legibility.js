/**
 * Guarantee the words stay readable once the boxes are gone.
 *
 * portal-dissolve.css removes the card fills so content merges with the
 * backdrop. That is fine for the light-on-dark majority, but some text was
 * only readable *because* of the fill it sat on — "Step 1: Open Official
 * Google Form" is near-black type that lived on a gold panel, and with the
 * panel gone it measured 18 against a background of 12. Invisible.
 *
 * CSS cannot express "an element whose own colour is too close to what is now
 * behind it", so this measures. It walks the text in an open portal, works out
 * the effective background for each node, and recolours only the ones that
 * actually fail. Everything already legible is left exactly as the designer
 * set it.
 *
 * It runs on open and again after content arrives, because most sections are
 * filled by fetch and the first pass would otherwise measure an empty shell.
 */
(function (global) {
  'use strict';

  /* Below this difference in perceived luminance, text stops being readable
     against its background. Deliberately generous: a shader frame moves, so a
     node that is merely borderline while the beam is elsewhere becomes
     unreadable a second later. */
  var MIN_CONTRAST = 62;

  var LIGHT = '#eaf0fb';   // for dark text stranded on the dark surface
  var DARK  = '#0b1020';   // for light text stranded on a light chip

  function luminance(colour) {
    var m = String(colour || '').match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    // A fully transparent colour tells us nothing about what is behind it.
    if (m.length >= 4 && parseFloat(m[3]) === 0) return null;
    return 0.299 * (+m[0]) + 0.587 * (+m[1]) + 0.114 * (+m[2]);
  }

  /**
   * The luminance actually behind an element: the first ancestor that paints
   * something. Falling back to the surface wash, which is what the dissolve
   * stylesheet leaves at the top of every section.
   */
  function backdropLuminance(el, root) {
    var node = el;
    while (node && node !== root) {
      var l = luminance(global.getComputedStyle(node).backgroundColor);
      if (l !== null) return l;
      node = node.parentElement;
    }
    return 14; // the wash, rgba(4,7,16,.62) over a dark shader
  }

  /** Elements that hold their own visible text, not just wrap other elements. */
  function hasOwnText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  }

  var SELECTOR = 'h1,h2,h3,h4,h5,p,span,li,a,td,th,label,b,strong,em,small,div,dt,dd';

  function fix(root) {
    if (!root) return 0;
    var fixed = 0;
    var nodes = root.querySelectorAll(SELECTOR);

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!hasOwnText(el)) continue;
      if (el.dataset.tenLegible === '1') continue;      // already handled

      var cs = global.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;

      var fg = luminance(cs.color);
      if (fg === null) continue;
      var bg = backdropLuminance(el, root);

      if (Math.abs(fg - bg) >= MIN_CONTRAST) continue;

      /* Move the text away from its background rather than towards a fixed
         colour: dark-on-dark goes light, light-on-light goes dark. Keeping the
         hue would be nicer, but the failures here are greys and near-blacks
         where hue carries no meaning. */
      el.style.setProperty('color', bg < 128 ? LIGHT : DARK, 'important');
      el.dataset.tenLegible = '1';
      fixed++;
    }
    return fixed;
  }

  /**
   * Watch a portal while its content loads. Most sections are populated by
   * fetch after the modal opens, so a single pass would measure an empty
   * shell; this re-checks as nodes arrive and stops once the section settles.
   */
  function watch(root, ms) {
    if (!root) return;
    fix(root);
    if (!global.MutationObserver) return;

    var pending = null;
    var observer = new global.MutationObserver(function () {
      if (pending) return;                     // coalesce bursts of insertions
      pending = global.setTimeout(function () {
        pending = null;
        fix(root);
      }, 120);
    });
    observer.observe(root, { childList: true, subtree: true });

    global.setTimeout(function () {
      observer.disconnect();
      if (pending) { global.clearTimeout(pending); pending = null; }
      fix(root);
    }, ms || 6000);
  }

  global.PortalLegibility = { fix: fix, watch: watch, MIN_CONTRAST: MIN_CONTRAST };
})(window);
