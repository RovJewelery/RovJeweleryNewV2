const API_VERSION = "2026-04";
const CART_STORAGE_KEY = "rovjewelery-shopify-cart-id";
const COLLECTIONS = ["chains", "necklaces", "bracelets", "watches", "moissanite"];
const PRODUCTS_PER_PAGE = 6;
const config = window.SHOPIFY_CONFIG || {};
const storeDomain = normalizeStoreDomain(config.SHOPIFY_STORE_URL);
const storefrontToken = String(config.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "").trim();
const isConfigured = Boolean(
  storeDomain &&
  storefrontToken &&
  !storeDomain.includes("PASTE_") &&
  !storefrontToken.includes("PASTE_")
);

const state = {
  activeCategory: "all",
  products: { all: [], chains: [], necklaces: [], bracelets: [], watches: [], moissanite: [] },
  currentPage: 1,
  cart: null,
  selectedProduct: null,
  selectedVariantId: null
};

const productGrid = document.querySelector("#product-grid");
const filters = document.querySelectorAll(".filter");
const filterRow = document.querySelector(".filter-row");
const filterScroll = document.querySelector(".filter-scroll");
const pagination = document.querySelector("#pagination");
const bagCount = document.querySelector(".bag-count");
const cartDrawer = document.querySelector(".cart-drawer");
const cartLines = document.querySelector("#cart-lines");
const cartFooter = document.querySelector("#cart-footer");
const checkoutButton = document.querySelector("#checkout-button");
const productModal = document.querySelector(".product-modal");
const storyModal = document.querySelector(".story-modal");
const modalVariant = document.querySelector("#product-modal-variant");
const modalQuantity = document.querySelector("#product-modal-quantity");
const modalAddButton = document.querySelector("#product-modal-add");
const modalComparePrice = document.querySelector("#product-modal-compare-price");
const modalMedia = document.querySelector("#product-modal-image");
const modalMediaThumbnails = document.querySelector("#product-media-thumbnails");
const toast = document.querySelector(".toast");
let toastTimer;

function normalizeStoreDomain(value = "") {
  return String(value)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

async function shopifyFetch(query, variables = {}) {
  if (!isConfigured) throw new Error("Shopify is not configured.");

  const response = await fetch(`https://${storeDomain}/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": storefrontToken
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join(", ") || `Shopify request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload.data;
}

const PRODUCT_FIELDS = `
  id
  handle
  title
  productType
  tags
  description
  descriptionHtml
  availableForSale
  featuredImage { url altText width height }
  images(first: 10) { nodes { url altText width height } }
  media(first: 50) {
    nodes {
      alt
      mediaContentType
      previewImage { url altText width height }
      ... on MediaImage { image { url altText width height } }
      ... on Video { sources { url mimeType format width height } }
    }
  }
  priceRange { minVariantPrice { amount currencyCode } }
  variants(first: 100) {
    nodes {
      id
      title
      availableForSale
      price { amount currencyCode }
      compareAtPrice { amount currencyCode }
      image { url altText }
      selectedOptions { name value }
    }
  }
`;

const CATALOG_QUERY = `
  query RovCatalog($after: String) {
    products(first: 100, after: $after, sortKey: CREATED_AT, reverse: true) {
      nodes { ${PRODUCT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
    collections(first: 100) {
      nodes {
        title
        handle
        products(first: 100) { nodes { ${PRODUCT_FIELDS} } }
      }
    }
  }
`;

const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount { amount currencyCode }
  }
  lines(first: 100) {
    nodes {
      id
      quantity
      cost { totalAmount { amount currencyCode } }
      merchandise {
        ... on ProductVariant {
          id
          title
          availableForSale
          image { url altText }
          product { title featuredImage { url altText } }
        }
      }
    }
  }
`;

function formatMoney(money) {
  if (!money) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currencyCode
  }).format(Number(money.amount));
}

function escapeHtml(value = "") {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function productCategoryLabel(product) {
  const match = COLLECTIONS.find((collection) =>
    state.products[collection].some((item) => item.id === product.id)
  );
  return match ? match[0].toUpperCase() + match.slice(1) : "Collection";
}

function variantLabel(variant) {
  if (!variant || variant.title === "Default Title") return "Standard";
  return variant.selectedOptions?.map((option) => option.value).join(" / ") || variant.title;
}

function productMedia(product) {
  const media = (product.media?.nodes || []).map((item) => {
    const image = item.image || item.previewImage;
    if (item.mediaContentType === "VIDEO") {
      const source = item.sources?.find((candidate) => candidate.mimeType?.startsWith("video/")) || item.sources?.[0];
      if (source?.url) return { type: "video", url: source.url, preview: image?.url, alt: item.alt || image?.altText || product.title };
    }
    if (image?.url) return { type: "image", url: image.url, preview: image.url, alt: item.alt || image.altText || product.title };
    return null;
  }).filter(Boolean);

  if (media.length) return media;
  return [product.featuredImage, ...(product.images?.nodes || [])]
    .filter(Boolean)
    .filter((image, index, images) => images.findIndex((candidate) => candidate.url === image.url) === index)
    .map((image) => ({ type: "image", url: image.url, preview: image.url, alt: image.altText || product.title }));
}

function renderActiveProductMedia(media, index) {
  const activeMedia = media[index];
  if (!activeMedia) {
    modalMedia.innerHTML = "";
    return;
  }

  modalMedia.innerHTML = activeMedia.type === "video"
    ? `<video autoplay muted loop playsinline preload="metadata" aria-label="${escapeHtml(activeMedia.alt)}"><source src="${escapeHtml(activeMedia.url)}" type="video/mp4"></video>`
    : `<img src="${escapeHtml(activeMedia.url)}" alt="${escapeHtml(activeMedia.alt)}" loading="eager">`;
  modalMedia.querySelector("video")?.play().catch(() => {});
}

function renderProductMediaGallery(product, activeIndex = 0) {
  const media = productMedia(product);
  const selectedIndex = Math.min(Math.max(activeIndex, 0), Math.max(media.length - 1, 0));
  productModal.dataset.activeMediaIndex = String(selectedIndex);
  renderActiveProductMedia(media, selectedIndex);
  modalMediaThumbnails.innerHTML = media.map((item, index) => `
    <button class="product-media-thumbnail ${index === selectedIndex ? "active" : ""}" type="button" data-media-index="${index}" aria-label="View ${item.type === "video" ? "video" : "image"} ${index + 1}" aria-pressed="${index === selectedIndex}">
      ${item.preview ? `<img src="${escapeHtml(item.preview)}" alt="" loading="lazy">` : `<span>${item.type === "video" ? "Video" : "Media"}</span>`}
      ${item.type === "video" ? '<span class="media-play" aria-hidden="true">▶</span>' : ""}
    </button>
  `).join("");
}

function setActiveProductMedia(index) {
  if (!state.selectedProduct) return;
  const media = productMedia(state.selectedProduct);
  if (!media[index]) return;
  productModal.dataset.activeMediaIndex = String(index);
  renderActiveProductMedia(media, index);
  modalMediaThumbnails.querySelectorAll("[data-media-index]").forEach((thumbnail) => {
    const active = Number(thumbnail.dataset.mediaIndex) === index;
    thumbnail.classList.toggle("active", active);
    thumbnail.setAttribute("aria-pressed", String(active));
  });
}

function renderProductCard(product) {
  const availableVariants = product.variants.nodes.filter((variant) => variant.availableForSale);
  const selectedVariant = availableVariants[0] || product.variants.nodes[0];
  const image = product.featuredImage;
  const variantOptions = product.variants.nodes.map((variant) => `
    <option value="${escapeHtml(variant.id)}" ${variant.id === selectedVariant?.id ? "selected" : ""} ${variant.availableForSale ? "" : "disabled"}>
      ${escapeHtml(variantLabel(variant))}${variant.availableForSale ? ` — ${formatMoney(variant.price)}` : " — Sold out"}
    </option>
  `).join("");

  return `
    <article class="product-card reveal visible" data-product-id="${escapeHtml(product.id)}" data-selected-variant-id="${escapeHtml(selectedVariant?.id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(product.title)}">
      <div class="product-image ${image ? "" : "no-image"}">
        ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.altText || product.title)}" loading="lazy">` : ""}
        ${product.availableForSale ? "" : '<span class="product-tag">Sold out</span>'}
      </div>
      <div class="product-info">
        <div><p>${escapeHtml(productCategoryLabel(product))}</p><h3>${escapeHtml(product.title)}</h3></div>
        <span class="product-card-price">${formatMoney(selectedVariant?.price || product.priceRange.minVariantPrice)}</span>
      </div>
      <div class="product-actions">
        <select class="variant-select" aria-label="Choose a variant for ${escapeHtml(product.title)}">${variantOptions}</select>
        <button class="add-to-cart" type="button" ${selectedVariant?.availableForSale ? "" : "disabled"}>
          ${selectedVariant?.availableForSale ? "Add to cart" : "Sold out"}
        </button>
      </div>
    </article>
  `;
}

function customCard() {
  return `
    <article class="product-card custom-card reveal visible" data-category="custom">
      <div>
        <p class="eyebrow">One of one</p>
        <h3>Your vision.<br><em>Our craft.</em></h3>
        <p>Work directly with RovJewelery to bring a piece no one else owns to life.</p>
        <a href="#custom">Begin your project <span>↗</span></a>
      </div>
    </article>
  `;
}

function renderProducts() {
  if (pagination) pagination.innerHTML = "";

  if (state.activeCategory === "custom") {
    productGrid.innerHTML = customCard();
    return;
  }

  const products = state.products[state.activeCategory] || [];
  if (!products.length) {
    if (state.activeCategory === "watches") {
      productGrid.innerHTML = `
        <div class="catalog-message">
          <h3>Coming Soon</h3>
          <p>Luxury watches arriving soon.</p>
        </div>
      `;
      return;
    }
    if (state.activeCategory === "moissanite") {
      productGrid.innerHTML = `
        <div class="catalog-message">
          <h3>No pieces found</h3>
          <p>No moissanite pieces available.</p>
        </div>
      `;
      return;
    }
    productGrid.innerHTML = `
      <div class="catalog-message">
        <h3>No pieces found</h3>
        <p>Add products to the ${escapeHtml(state.activeCategory)} collection in Shopify.</p>
      </div>
    `;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_PAGE));
  state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);
  const start = (state.currentPage - 1) * PRODUCTS_PER_PAGE;
  const visibleProducts = products.slice(start, start + PRODUCTS_PER_PAGE);

  productGrid.innerHTML = visibleProducts.map(renderProductCard).join("") + (state.activeCategory === "all" && state.currentPage === totalPages ? customCard() : "");
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  if (!pagination || totalPages <= 1) {
    if (pagination) pagination.innerHTML = "";
    return;
  }

  const pageButtons = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return `
      <button class="page-number ${page === state.currentPage ? "active" : ""}" type="button" data-page="${page}" aria-label="Go to page ${page}" ${page === state.currentPage ? 'aria-current="page"' : ""}>${page}</button>
    `;
  }).join("");

  pagination.innerHTML = `
    <button class="page-step" type="button" data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? "disabled" : ""}>Previous</button>
    <div class="page-numbers">${pageButtons}</div>
    <button class="page-step" type="button" data-page="${state.currentPage + 1}" ${state.currentPage === totalPages ? "disabled" : ""}>Next</button>
  `;
}

function updateFilterCounts() {
  filters.forEach((filter) => {
    const category = filter.dataset.filter;
    const count = category === "custom" ? 1 : state.products[category].length;
    filter.querySelector("sup").textContent = String(count).padStart(2, "0");
  });
}

function findCollection(collections, expectedName) {
  const normalizedName = expectedName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return collections.find((collection) => {
    const title = collection.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const handle = collection.handle.toLowerCase().replace(/[^a-z0-9]/g, "");
    return title === normalizedName || handle === normalizedName;
  });
}

function productMatchesCategory(product, category) {
  const aliases = {
    chains: ["chain", "chains"],
    necklaces: ["necklace", "necklaces", "pendant", "pendants"],
    bracelets: ["bracelet", "bracelets", "bangle", "bangles"],
    watches: ["watch", "watches", "g-shock", "citizen", "eco-drive", "timepiece"],
    moissanite: ["moissanite"]
  };
  const searchable = [
    product.title,
    product.productType,
    ...(product.tags || []),
    product.description
  ].join(" ").toLowerCase();

  return (aliases[category] || [category]).some((alias) => searchable.includes(alias));
}

async function loadCatalog() {
  if (!isConfigured) {
    productGrid.innerHTML = `
      <div class="catalog-message">
        <h3>Connect your Shopify store</h3>
        <p>Paste your store domain and public Storefront token into <code>shopify-config.js</code>.</p>
      </div>
    `;
    return;
  }

  try {
    let after = null;
    let collections = [];
    const allProducts = [];

    do {
      const data = await shopifyFetch(CATALOG_QUERY, { after });
      allProducts.push(...data.products.nodes);
      collections = data.collections.nodes;
      after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    } while (after);

    state.products.all = allProducts;
    COLLECTIONS.forEach((collection) => {
      const shopifyCollection = findCollection(collections, collection);
      const collectionProducts = shopifyCollection?.products.nodes || [];
      const taggedProducts = state.products.all.filter((product) => productMatchesCategory(product, collection));
      const mergedProducts = new Map();
      [...collectionProducts, ...taggedProducts].forEach((product) => {
        mergedProducts.set(product.id, product);
      });
      state.products[collection] = [...mergedProducts.values()];
    });
    updateFilterCounts();
    renderProducts();
  } catch (error) {
    console.error("Shopify catalog error:", error);
    productGrid.innerHTML = `
      <div class="catalog-message">
        <h3>We couldn't load the collection</h3>
        <p>${escapeHtml(error.message)} Check <code>shopify-config.js</code> and the README.</p>
      </div>
    `;
  }
}

filters.forEach((filter) => {
  filter.addEventListener("click", () => {
    filters.forEach((item) => item.classList.remove("active"));
    filter.classList.add("active");
    state.activeCategory = filter.dataset.filter;
    state.currentPage = 1;
    renderProducts();
  });
});

pagination?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  state.currentPage = Number(button.dataset.page);
  renderProducts();
  document.querySelector("#shop")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

["scroll", "touchstart", "pointerdown"].forEach((eventName) => {
  filterRow?.addEventListener(eventName, () => filterScroll?.classList.add("hint-dismissed"), { once: true, passive: true });
});

document.querySelectorAll("[data-collection-link]").forEach((link) => {
  link.addEventListener("click", () => {
    const category = link.dataset.collectionLink;
    const matchingFilter = [...filters].find((filter) => filter.dataset.filter === category);
    if (matchingFilter) matchingFilter.click();
  });
});

productGrid.addEventListener("click", async (event) => {
  const button = event.target.closest(".add-to-cart");
  if (!button) {
    if (event.target.closest("select, button, a")) return;
    const card = event.target.closest(".product-card[data-product-id]");
    if (card) openProductModal(card.dataset.productId);
    return;
  }
  const card = button.closest(".product-card");
  const variantId = card.querySelector(".variant-select").value;
  const product = state.products.all.find((item) => item.id === card.dataset.productId);
  button.disabled = true;
  button.textContent = "Adding...";

  try {
    await addToCart(variantId);
    showToast(`${product?.title || "Item"} added`);
    openCart();
  } catch (error) {
    console.error("Shopify cart error:", error);
    showToast(error.message);
  } finally {
    const variant = product?.variants.nodes.find((item) => item.id === variantId);
    button.disabled = !variant?.availableForSale;
    button.textContent = variant?.availableForSale ? "Add to cart" : "Sold out";
  }
});

productGrid.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key) || event.target.closest("select, button, a")) return;
  const card = event.target.closest(".product-card[data-product-id]");
  if (!card) return;
  event.preventDefault();
  openProductModal(card.dataset.productId);
});

function openProductModal(productId) {
  const product = state.products.all.find((item) => item.id === productId);
  if (!product) return;
  state.selectedProduct = product;
  document.querySelector("#product-modal-category").textContent = productCategoryLabel(product);
  document.querySelector("#product-modal-title").textContent = product.title;
  document.querySelector("#product-modal-description").innerHTML =
    product.descriptionHtml || `<p>${escapeHtml(product.description || "Details coming soon.")}</p>`;
  renderProductMediaGallery(product);
  const availableVariant = product.variants.nodes.find((variant) => variant.availableForSale);
  state.selectedVariantId = (availableVariant || product.variants.nodes[0])?.id || null;
  modalVariant.innerHTML = product.variants.nodes.map((variant) => `
    <option value="${escapeHtml(variant.id)}" ${variant.id === state.selectedVariantId ? "selected" : ""} ${variant.availableForSale ? "" : "disabled"}>
      ${escapeHtml(variantLabel(variant))}${variant.availableForSale ? ` — ${formatMoney(variant.price)}` : " — Sold out"}
    </option>
  `).join("");
  modalQuantity.value = "1";
  updateProductModalVariant();
  document.body.classList.add("product-open");
  if (window.matchMedia("(max-width: 1023px)").matches) document.body.style.overflow = "hidden";
  productModal.setAttribute("aria-hidden", "false");
  document.querySelector(".product-modal-close").focus();
}

function closeProductModal() {
  document.body.classList.remove("product-open");
  document.body.style.overflow = "";
  productModal.setAttribute("aria-hidden", "true");
}

function openStoryModal() {
  document.body.classList.add("story-open");
  storyModal.setAttribute("aria-hidden", "false");
  storyModal.querySelector(".story-modal-close").focus();
}

function closeStoryModal() {
  document.body.classList.remove("story-open");
  storyModal.setAttribute("aria-hidden", "true");
}

document.querySelectorAll("[data-story-open]").forEach((button) => button.addEventListener("click", openStoryModal));
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-story-close]")) closeStoryModal();
});

function updateProductModalVariant() {
  const variant = state.selectedProduct?.variants.nodes.find((item) => item.id === state.selectedVariantId);
  document.querySelector("#product-modal-price").textContent = formatMoney(variant?.price);
  const showCompareAtPrice = Number(variant?.compareAtPrice?.amount) > Number(variant?.price?.amount);
  modalComparePrice.hidden = !showCompareAtPrice;
  modalComparePrice.textContent = showCompareAtPrice ? formatMoney(variant.compareAtPrice) : "";
  modalAddButton.disabled = !variant?.availableForSale;
  modalAddButton.firstChild.textContent = variant?.availableForSale ? "Add to cart " : "Sold out ";
  if (variant?.image) {
    const mediaIndex = productMedia(state.selectedProduct).findIndex((item) => item.url === variant.image.url);
    if (mediaIndex >= 0) setActiveProductMedia(mediaIndex);
  }
}

productGrid.addEventListener("change", (event) => {
  if (!event.target.matches(".variant-select")) return;
  const card = event.target.closest(".product-card");
  const product = state.products.all.find((item) => item.id === card.dataset.productId);
  const variant = product?.variants.nodes.find((item) => item.id === event.target.value);
  card.querySelector(".product-card-price").textContent = formatMoney(variant?.price);
  if (variant?.image) {
    const image = card.querySelector(".product-image img");
    if (image) {
      image.src = variant.image.url;
      image.alt = variant.image.altText || product.title;
    }
  }
  const button = card.querySelector(".add-to-cart");
  button.disabled = !variant?.availableForSale;
  button.textContent = variant?.availableForSale ? "Add to cart" : "Sold out";
});

modalVariant.addEventListener("change", () => {
  state.selectedVariantId = modalVariant.value;
  updateProductModalVariant();
});
modalMediaThumbnails.addEventListener("click", (event) => {
  const thumbnail = event.target.closest("[data-media-index]");
  if (thumbnail) setActiveProductMedia(Number(thumbnail.dataset.mediaIndex));
});
document.querySelectorAll("[data-modal-quantity]").forEach((button) => {
  button.addEventListener("click", () => {
    const next = Math.max(1, Number(modalQuantity.value || 1) + Number(button.dataset.modalQuantity));
    modalQuantity.value = String(next);
  });
});
modalQuantity.addEventListener("change", () => {
  modalQuantity.value = String(Math.max(1, Math.floor(Number(modalQuantity.value) || 1)));
});
modalAddButton.addEventListener("click", async () => {
  const variant = state.selectedProduct?.variants.nodes.find((item) => item.id === state.selectedVariantId);
  if (!variant?.availableForSale) return;
  const quantity = Math.max(1, Math.floor(Number(modalQuantity.value) || 1));
  modalAddButton.disabled = true;
  modalAddButton.firstChild.textContent = "Adding... ";
  try {
    await addToCart(variant.id, quantity);
    closeProductModal();
    showToast(`${state.selectedProduct.title} added`);
    openCart();
  } catch (error) {
    console.error("Shopify product cart error:", error);
    showToast(error.message);
  } finally {
    updateProductModalVariant();
  }
});
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-product-close]")) closeProductModal();
});

async function createCart(variantId, quantity = 1) {
  const data = await shopifyFetch(`
    mutation CreateCart($input: CartInput!) {
      cartCreate(input: $input) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `, { input: { lines: [{ merchandiseId: variantId, quantity }] } });
  assertNoCartErrors(data.cartCreate.userErrors);
  return data.cartCreate.cart;
}

async function addToCart(variantId, quantity = 1) {
  if (!state.cart?.id) {
    state.cart = await createCart(variantId, quantity);
  } else {
    const data = await shopifyFetch(`
      mutation AddCartLines($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) {
          cart { ${CART_FIELDS} }
          userErrors { field message }
        }
      }
    `, { cartId: state.cart.id, lines: [{ merchandiseId: variantId, quantity }] });
    assertNoCartErrors(data.cartLinesAdd.userErrors);
    state.cart = data.cartLinesAdd.cart;
  }
  saveAndRenderCart();
}

async function updateCartLine(lineId, quantity) {
  const operation = quantity < 1 ? {
    query: `
      mutation RemoveCartLines($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
          cart { ${CART_FIELDS} }
          userErrors { field message }
        }
      }
    `,
    variables: { cartId: state.cart.id, lineIds: [lineId] },
    key: "cartLinesRemove"
  } : {
    query: `
      mutation UpdateCartLines($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) {
          cart { ${CART_FIELDS} }
          userErrors { field message }
        }
      }
    `,
    variables: { cartId: state.cart.id, lines: [{ id: lineId, quantity }] },
    key: "cartLinesUpdate"
  };

  const data = await shopifyFetch(operation.query, operation.variables);
  assertNoCartErrors(data[operation.key].userErrors);
  state.cart = data[operation.key].cart;
  saveAndRenderCart();
}

function assertNoCartErrors(errors = []) {
  if (errors.length) throw new Error(errors.map((error) => error.message).join(", "));
}

async function restoreCart() {
  if (!isConfigured) return;
  const cartId = localStorage.getItem(CART_STORAGE_KEY);
  if (!cartId) return;

  try {
    const data = await shopifyFetch(`
      query RestoreCart($cartId: ID!) {
        cart(id: $cartId) { ${CART_FIELDS} }
      }
    `, { cartId });
    state.cart = data.cart;
    if (!state.cart) localStorage.removeItem(CART_STORAGE_KEY);
    renderCart();
  } catch (error) {
    console.warn("Stored Shopify cart could not be restored:", error);
    localStorage.removeItem(CART_STORAGE_KEY);
  }
}

async function refreshCart() {
  if (!state.cart?.id) return null;
  const data = await shopifyFetch(`
    query RefreshCart($cartId: ID!) {
      cart(id: $cartId) { ${CART_FIELDS} }
    }
  `, { cartId: state.cart.id });
  state.cart = data.cart;
  if (state.cart) saveAndRenderCart();
  return state.cart;
}

function saveAndRenderCart() {
  if (state.cart?.id) localStorage.setItem(CART_STORAGE_KEY, state.cart.id);
  renderCart();
}

function renderCart() {
  const lines = state.cart?.lines.nodes || [];
  bagCount.textContent = state.cart?.totalQuantity || 0;
  cartFooter.hidden = !lines.length;

  if (!lines.length) {
    cartLines.innerHTML = `
      <div class="cart-empty">
        <p>Your bag is currently empty.</p>
        <button class="button button-outline" type="button" data-cart-close>Continue shopping</button>
      </div>
    `;
    return;
  }

  cartLines.innerHTML = lines.map((line) => {
    const variant = line.merchandise;
    const image = variant.image || variant.product.featuredImage;
    const variantTitle = variant.title === "Default Title" ? "" : variant.title;
    return `
      <article class="cart-line" data-line-id="${escapeHtml(line.id)}" data-quantity="${line.quantity}">
        ${image ? `<img class="cart-line-image" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.altText || variant.product.title)}">` : '<div class="cart-line-image"></div>'}
        <div class="cart-line-info">
          <h3>${escapeHtml(variant.product.title)}</h3>
          ${variantTitle ? `<p>${escapeHtml(variantTitle)}</p>` : ""}
          <span class="cart-line-price">${formatMoney(line.cost.totalAmount)}</span>
          <div class="cart-line-controls">
            <div class="quantity-control">
              <button type="button" data-quantity-change="-1" aria-label="Decrease quantity">−</button>
              <span>${line.quantity}</span>
              <button type="button" data-quantity-change="1" aria-label="Increase quantity">+</button>
            </div>
            <button class="remove-line" type="button" data-remove-line>Remove</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  document.querySelector("#cart-subtotal").textContent = formatMoney(state.cart.cost.subtotalAmount);
}

cartLines.addEventListener("click", async (event) => {
  const line = event.target.closest(".cart-line");
  if (!line) return;
  const currentQuantity = Number(line.dataset.quantity);
  const delta = Number(event.target.dataset.quantityChange || 0);
  const nextQuantity = event.target.matches("[data-remove-line]") ? 0 : currentQuantity + delta;
  if (!delta && !event.target.matches("[data-remove-line]")) return;

  cartLines.style.pointerEvents = "none";
  cartLines.style.opacity = ".6";
  try {
    await updateCartLine(line.dataset.lineId, nextQuantity);
  } catch (error) {
    console.error("Shopify cart update error:", error);
    showToast(error.message);
  } finally {
    cartLines.style.pointerEvents = "";
    cartLines.style.opacity = "";
  }
});

function openCart() {
  document.body.classList.add("cart-open");
  cartDrawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  document.body.classList.remove("cart-open");
  cartDrawer.setAttribute("aria-hidden", "true");
}

document.querySelector(".bag-button").addEventListener("click", openCart);
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-cart-close]")) closeCart();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCart();
    closeProductModal();
    closeStoryModal();
  }
});
checkoutButton.addEventListener("click", async () => {
  checkoutButton.disabled = true;
  const originalText = checkoutButton.innerHTML;
  checkoutButton.textContent = "Preparing checkout...";
  try {
    const cart = await refreshCart();
    if (!cart?.checkoutUrl) throw new Error("Shopify checkout is unavailable for this cart.");
    const checkoutUrl = new URL(cart.checkoutUrl);
    if (checkoutUrl.protocol !== "https:") throw new Error("Shopify returned an invalid checkout URL.");
    if (checkoutUrl.hostname === "rovjewelery.com") {
      checkoutUrl.hostname = "rov-12.myshopify.com";
    }
    window.location.assign(checkoutUrl.href);
  } catch (error) {
    console.error("Shopify checkout error:", error);
    showToast(error.message);
    checkoutButton.disabled = false;
    checkoutButton.innerHTML = originalText;
  }
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000);
}

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".main-nav");
menuButton.addEventListener("click", () => {
  const isOpen = menuButton.classList.toggle("open");
  navigation.classList.toggle("open", isOpen);
  menuButton.setAttribute("aria-expanded", String(isOpen));
});
navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navigation.classList.remove("open");
    menuButton.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  });
});

function handleForm(form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.querySelector(".form-success").classList.add("visible");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.style.opacity = ".55";
  });
}
handleForm(document.querySelector("#support-form"));

document.querySelector("#newsletter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = event.currentTarget.querySelector("input");
  input.value = "";
  input.placeholder = "You're on the list";
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach((item) => observer.observe(item));

const sections = document.querySelectorAll("main section[id]");
const navLinks = document.querySelectorAll(".main-nav a");
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
    });
  });
}, { rootMargin: "-35% 0px -60% 0px" });
sections.forEach((section) => sectionObserver.observe(section));

function setupHeroVideo() {
  const video = document.querySelector(".hero-video");
  if (!video) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const savesData = navigator.connection?.saveData;
  if (prefersReducedMotion || savesData) {
    video.removeAttribute("autoplay");
    video.preload = "none";
    video.pause();
    return;
  }

  video.addEventListener("error", () => video.classList.add("video-unavailable"), { once: true });
  video.load();
  video.play().catch(() => {
    video.classList.add("video-unavailable");
  });
}

function setupRovStandardVideos() {
  document.querySelectorAll(".rov-standard video, .story-modal video").forEach((video) => {
    video.addEventListener("playing", () => video.classList.add("is-ready"), { once: true });
    video.muted = true;
    video.play().catch(() => {});
    if (!video.paused) video.classList.add("is-ready");
  });
}

setupHeroVideo();
setupRovStandardVideos();
loadCatalog();
restoreCart();
