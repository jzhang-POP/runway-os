// update an element to match new HTML, touching only what changed: no flashing, images don't reload, scroll and hover stay.
// Elements marked data-live (e.g. a hover preview video) are left alone.
export function morph(el, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  morphKids(el, tpl.content);
}
export function morphKids(a, b) {
  const old = [...a.childNodes].filter(n => !(n.nodeType === 1 && n.hasAttribute("data-live"))), neu = [...b.childNodes];
  const anchor = old.length ? old[old.length - 1].nextSibling : a.firstChild;
  neu.forEach((nb, i) => (old[i] ? morphNode(old[i], nb) : a.insertBefore(nb, i && old.length ? null : anchor)));
  for (let i = neu.length; i < old.length; i++) old[i].remove();
}
export function morphNode(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  if (a.tagName === "VIDEO" || a.tagName === "AUDIO" || a.tagName === "TEXTAREA") return;
  if (a.tagName === "INPUT" && document.activeElement !== a && a.value !== b.value) a.value = b.value;
  morphKids(a, b);
}
