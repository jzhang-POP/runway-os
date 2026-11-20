// update an element to match new HTML, touching only what changed: no flashing, images don't reload, scroll and hover stay.
// Elements marked data-live (e.g. a hover preview video) are left alone.
export function morph(el, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  morphKids(el, tpl.content);
}

const isLive = n => n.nodeType === 1 && n.hasAttribute("data-live");
// children with a stable identity are paired by it (a job row stays the same element when a new job is added above it);
// the rest are paired by position among the unkeyed ones
const keyOf = n => {
  if (n.nodeType !== 1) return null;
  const k = n.getAttribute("data-id") ?? n.getAttribute("data-nt-item") ?? n.getAttribute("data-mref") ?? n.getAttribute("data-col") ?? n.getAttribute("data-key") ?? (n.id || null);
  return k == null ? null : n.nodeName + "#" + k;
};
// move a node that is already in the page: moveBefore keeps focus, playing media and running animations where it can
const put = (parent, node, before) => {
  if (node.isConnected && parent.moveBefore) { try { parent.moveBefore(node, before); return; } catch {} }
  parent.insertBefore(node, before);
};

export function morphKids(a, b) {
  const old = [...a.childNodes].filter(n => !isLive(n)), neu = [...b.childNodes];
  // pair each new child with an old one: by key (several old nodes may share one, used in order), else by position
  const byKey = new Map(), loose = [];
  for (const n of old) {
    const k = keyOf(n);
    if (k == null) loose.push(n);
    else { const q = byKey.get(k); q ? q.push(n) : byKey.set(k, [n]); }
  }
  let li = 0;
  const match = neu.map(nb => {
    const k = keyOf(nb);
    if (k != null) return byKey.get(k)?.shift() || null;
    return li < loose.length ? loose[li++] : null;
  });
  // drop the unpaired old nodes first, so the ones that stay don't have to move past them
  const kept = new Set(match.filter(Boolean));
  for (const n of old) if (!kept.has(n)) n.remove();
  let cur = a.firstChild;
  neu.forEach((nb, i) => {
    while (cur && isLive(cur)) cur = cur.nextSibling;
    const m = match[i];
    if (m && m === cur) { cur = cur.nextSibling; morphNode(m, nb); return; }
    put(a, m ? morphNode(m, nb) : nb, cur);
  });
}
// returns the node that ends up in the page (b itself when a had to be replaced)
export function morphNode(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return b; }
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return a; }
  const aa = a.attributes, ba = b.attributes;
  for (let i = aa.length - 1; i >= 0; i--) { const n = aa[i].name; if (!b.hasAttribute(n)) a.removeAttribute(n); }
  for (let i = 0; i < ba.length; i++) { const { name, value } = ba[i]; if (a.getAttribute(name) !== value) a.setAttribute(name, value); }
  if (a.tagName === "VIDEO" || a.tagName === "AUDIO" || a.tagName === "TEXTAREA") return a;
  if (a.tagName === "INPUT" && document.activeElement !== a && a.value !== b.value) a.value = b.value;
  morphKids(a, b);
  return a;
}
