# RovJewelery Shopify Connection

This website is connected to Shopify through the **Storefront API**. Shopify remains responsible for products, collections, variants, inventory, the cart, checkout, payments, and order processing.

## Information you need from Shopify

You need exactly two values:

1. Your permanent Shopify store domain, such as `rovjewelery.myshopify.com`
2. A **public Storefront API access token**

Do not use an Admin API token or a private Storefront API token in browser code.

## Get a Storefront API token

1. Sign in to your Shopify admin.
2. Install or open the **Headless** sales channel.
3. Select **Create storefront** or **Add storefront**.
4. Open **Storefront API permissions** and enable access to products, product listings, collections, and cart/checkout functionality.
5. Copy the **public Storefront API access token**.

Shopify's current setup guide is available at:
https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/getting-started

## Add your Shopify credentials

Open `shopify-config.js` and replace both placeholder values:

```js
window.SHOPIFY_CONFIG = {
  SHOPIFY_STORE_URL: "rovjewelery.myshopify.com",
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: "your-public-storefront-token"
};
```

Use the `.myshopify.com` domain shown in **Shopify admin → Settings → Domains**, even if customers normally visit a custom domain.

## Required Shopify collections

Create or verify these collections and handles:

| Collection title | Required handle |
| --- | --- |
| Chains | `chains` |
| Necklaces | `necklaces` |
| Bracelets | `bracelets` |

The **All** tab automatically loads all products published to the Headless sales channel. Products must be available to the Headless channel or the Storefront API will not return them.

## Test the connection

Do not test only by double-clicking `index.html`. Run the site through a local web server:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

Confirm the following:

1. Products and collection counts load from Shopify.
2. Each card displays its Shopify image, title, price, and variants.
3. The collection tabs show the correct products.
4. **Add to cart** opens the cart drawer and updates the bag count.
5. Quantity and remove controls update the Shopify cart.
6. **Checkout securely** redirects to Shopify Checkout.

If products do not appear, confirm they are active, available to the Headless sales channel, and assigned to collections with the exact handles above.

## Implementation notes

- Storefront API version: `2026-04`
- Cart IDs are saved in browser `localStorage`, so the cart survives page reloads.
- Checkout uses the `checkoutUrl` returned by Shopify's Cart API.
- The public Storefront token is expected to be visible in browser code. Its permissions should remain limited to storefront operations.
