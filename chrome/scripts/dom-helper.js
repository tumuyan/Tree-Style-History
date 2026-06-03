/**
 * Minimal DOM helper - replaces MooTools $() and $$() with native wrappers.
 * Not a framework, just ergonomic aliases for the most common DOM operations.
 */

// ID selector (replaces MooTools $())
function $(id) {
    return document.getElementById(id);
}

// CSS selector (replaces MooTools $$())
function $$(selector, context) {
    return (context || document).querySelectorAll(selector);
}

// Create element with attributes and content (replaces MooTools new Element())
function createElement(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
        for (var key in attrs) {
            if (key === 'html') {
                el.innerHTML = attrs[key];
            } else if (key === 'class') {
                el.className = attrs[key];
            } else if (key === 'styles') {
                for (var s in attrs[key]) {
                    el.style[s] = attrs[key][s];
                }
            } else if (key === 'rel') {
                el.setAttribute('rel', attrs[key]);
            } else if (key === 'text') {
                el.textContent = attrs[key];
            } else {
                el.setAttribute(key, attrs[key]);
            }
        }
    }
    return el;
}

// Empty all children from an element
function emptyElement(el) {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

// Get computed style (replaces MooTools getStyle)
function getStyle(el, prop) {
    // Convert CSS property to camelCase for direct style access
    var camelProp = prop.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
    return el.style[camelProp] || window.getComputedStyle(el)[camelProp];
}