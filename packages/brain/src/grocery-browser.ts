/** App-owned outcomes used by the finite preparation reader, never website text. */
export const GROCERY_PAGE_UNAVAILABLE = "The browser is not on an allowed Instacart shopping page. No page contents were read.";
export const GROCERY_LOADING = "The requested Instacart page is still loading or has not reached the requested search.";

/** Grocery is a cart preparation capability. Payment and general web automation are not capabilities here. */
export function groceryUrlAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !["instacart.com", "www.instacart.com"].includes(url.hostname) || url.username || url.password || url.port || url.hash) return false;
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
    if (!/^(?:\/|\/store|\/store\/(?:s|search|cart)|\/store\/items\/[a-zA-Z0-9_-]+|\/products\/[a-zA-Z0-9_-]+|\/store\/[a-zA-Z0-9_-]+\/(?:storefront|search|s))$/.test(path)) return false;
    const keys = new Set(["k", "q", "query", "search_term", "page", "retailer_id", "store_id", "product_id", "region_id", "source", "search_id", "xrs_id"]);
    return [...url.searchParams.keys()].every(key => keys.has(key) || key === "categoryFilter" && url.searchParams.get(key) === "homeTabForYou");
  } catch { return false; }
}

export interface GroceryReadiness {
  readonly url: string;
  readonly readyState: string;
  readonly visibleBusy: boolean;
  readonly hasContent: boolean;
  readonly hasSearchResults: boolean;
}

/** Match the requested destination, retaining retailer/query constraints and tolerating only safe tracking additions. */
export function groceryDestinationMatches(requestedUrl: string, actualUrl: string): boolean {
  if (!groceryUrlAllowed(requestedUrl) || !groceryUrlAllowed(actualUrl)) return false;
  const requested = new URL(requestedUrl), actual = new URL(actualUrl);
  if ((requested.pathname.replace(/\/+$/, "") || "/") !== (actual.pathname.replace(/\/+$/, "") || "/")) return false;
  return [...requested.searchParams.entries()].every(([key, value]) => actual.searchParams.get(key) === value);
}

export function groceryNavigationReady(requestedUrl: string, probe: GroceryReadiness): boolean {
  if (!probe || !groceryDestinationMatches(requestedUrl, probe.url) || !["complete", "interactive"].includes(probe.readyState) || probe.visibleBusy !== false || probe.hasContent !== true) return false;
  const search = new URL(requestedUrl).searchParams;
  return !["k", "q", "query", "search_term"].some(key => search.has(key)) || probe.hasSearchResults === true;
}

/** A finite, read-only observation: a changed URL alone is not a rendered search result. */
export const GROCERY_READINESS_SCRIPT = `(() => {
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const text = (document.body && document.body.innerText) || "";
  const visibleBusy = Array.from(document.querySelectorAll('[role="progressbar"],[aria-busy="true"]')).some(visible);
  const products = Array.from(document.querySelectorAll('a[href*="/products/"],a[href*="/store/items/"],button,[role="button"]')).some(el => visible(el) && (el.matches('a') || /^add\\b/i.test((el.getAttribute("aria-label") || el.innerText || "").trim())));
  const empty = /no (?:search )?results|no products (?:found|match)|couldn.t find (?:any|results)|try another search/i.test(text);
  return JSON.stringify({ url: location.href, readyState: document.readyState, visibleBusy, hasContent: text.trim().length > 0, hasSearchResults: products || empty });
})()`;

/** A cart chooser has repeated button names. Bind each supported choice to its
 * actual nearby retailer heading; neither a generic Continue nor body text is a target. */
export const GROCERY_RETAILER_CONTROLS = `
function __hormesRetailerChoices() {
  const clean = value => String(value || "").replace(/\\s+/g, " ").trim();
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const named = el => clean(el.getAttribute("aria-label") || el.innerText);
  const isChoice = el => (String(el.tagName).toLowerCase() === "button" || el.getAttribute("role") === "button") && named(el).toLowerCase() === "continue shopping" && visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true";
  const choices = [];
  for (const el of Array.from(document.querySelectorAll('button,[role="button"]')).filter(isChoice)) {
    let group = el.parentElement;
    for (let depth = 0; group && depth < 3; depth++, group = group.parentElement) {
      if (!/\\bpersonal cart\\b/i.test(group.innerText || "")) continue;
      const headings = Array.from(group.querySelectorAll("h1,h2,h3,h4")).filter(visible).map(node => clean(node.innerText)).filter(text => text && !/^(?:(?:your|shopping|personal) )?carts?$/i.test(text));
      if (headings.length !== 1 || headings[0].length > 100) continue;
      const buttons = Array.from(group.querySelectorAll('button,[role="button"]')).filter(isChoice);
      if (buttons.length !== 1 || buttons[0] !== el) continue;
      choices.push({ el, retailer: headings[0], label: "Continue Shopping — " + headings[0] });
      break;
    }
  }
  return choices;
}`;

/** The real DOM target, current URL and action are checked in one synchronous browser script. */
export function groceryActionScript(action: "click" | "type", input: Record<string, unknown>, findSource: string): string {
  return `(() => {
    ${findSource}
    ${GROCERY_RETAILER_CONTROLS}
    const allowed = ${groceryUrlAllowed.toString()};
    const deny = reason => JSON.stringify({ refused: reason });
    if (!allowed(location.href)) return deny("Only Instacart product, search and cart pages are available; checkout is manual.");
    const clean = value => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const forbidden = /checkout|check out|place.{0,12}order|buy|pay|purchase|order now|complete.{0,12}order|confirm.{0,12}order|subscribe|membership|sign in|log in|password|credit|debit|billing|address|delivery|tip\\b/;
    const action = ${JSON.stringify(action)}, input = ${JSON.stringify(input)};
    let el, retailerChoice;
    if (action === "click") {
      if (/^continue shopping — /i.test(String(input.text || ""))) {
        if (input.selector) return deny("Use the observed retailer-bound control name without a selector.");
        const choices = __hormesRetailerChoices().filter(choice => clean(choice.label) === clean(input.text));
        if (choices.length !== 1) return deny("The retailer cart choice is missing or ambiguous. Read the cart chooser again.");
        retailerChoice = choices[0]; el = retailerChoice.el;
      } else {
        const found = __jhFind(String(input.text || ""), typeof input.selector === "string" ? input.selector : undefined, true);
        if (found.els.length !== 1) return deny("Choose one visible cart or search control; no action was taken.");
        el = found.els[0];
      }
    } else el = document.activeElement;
    if (!el) return deny("No editable search field is focused.");
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth || el.disabled || el.getAttribute("aria-disabled") === "true") return deny("The target is hidden, disabled or outside the visible page.");
    const label = clean(el.getAttribute("aria-label") || el.innerText || el.value || el.title);
    const metadata = [label, el.innerText, el.getAttribute("aria-label"), el.title, el.name, el.id, el.getAttribute("autocomplete"), el.getAttribute("formaction")].map(clean).join(" ");
    if (forbidden.test(metadata) || retailerChoice && forbidden.test(clean(retailerChoice.retailer))) return deny("Checkout, payment, account and delivery controls require manual review.");
    const tag = clean(el.tagName), type = clean(el.type), role = clean(el.getAttribute("role"));
    const search = tag === "input" && ["search", "text", ""].includes(type) && (type === "search" || role === "searchbox" || /search/.test(clean(el.getAttribute("aria-label") || el.placeholder || el.name)));
    if (action === "type") {
      if (!search || typeof input.text !== "string" || input.text.length > 200 || /[\\r\\n]/.test(input.text) || input.submit === true) return deny("Only a short search query can be typed; submit and keyboard input are unavailable.");
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, input.text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return JSON.stringify({ ok: true, operation: "search typed" });
    }
    if (tag === "a") {
      if (!el.href || !allowed(el.href)) return deny("This link leaves the permitted shopping pages.");
      const url = el.href; location.assign(url);
      return JSON.stringify({ ok: true, operation: "shopping page opened" });
    }
    if (search) { el.focus(); return JSON.stringify({ ok: true, operation: "search focused" }); }
    if (retailerChoice) {
      if (label !== "continue shopping" || el.closest("form")) return deny("Retailer cart selection cannot submit a form.");
      el.click();
      return JSON.stringify({ ok: true, operation: "retailer shopping control clicked", control: retailerChoice.label });
    }
    const cartControl = /^(?:add|add to cart|add (?:\\d+ )?.{1,160} to cart|add \\d+(?:\\.\\d+)? .{1,160}|increase quantity|decrease quantity|remove(?: item)?|view cart|view carts?\\. \\d+ unique items? in your carts?|cart(?: \\(?\\d+\\)?)?|\\+|−|-)$/;
    if (!(tag === "button" || role === "button") || !cartControl.test(label)) return deny("Only explicit add, quantity, remove and cart controls are available.");
    if (el.closest("form") && type !== "button") return deny("Form submission is unavailable during cart preparation.");
    el.click();
    return JSON.stringify({ ok: true, operation: "cart control clicked", control: label });
  })()`;
}
