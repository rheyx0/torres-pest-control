// What the client pays (Sprint 3, migration 060).
//
// The price is built from the SERVICE, then adjusted:
//
//   service price      FLAT: the service's default price
//                      AREA: area (sqm) × area rate, never below the minimum
//   + extra materials  only for a material the service bills EXTRA_CHARGED,
//                      and only what is used beyond its included quantity,
//                      at the item's customer price
//   + approved extra work
//   − discount, + VAT                                   (see quoteTotals)
//
// An item's internal cost is never billed: it only measures profit.
// The same arithmetic runs on the server (item_customer_price, and the quote
// and invoice functions); this is what the forms show before saving.

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const PRICE_MODES = { FIXED: "FIXED", MARKUP: "MARKUP" };
export const PRICING_MODES = { FLAT: "FLAT", AREA: "AREA" };
export const BILLING_MODES = { INCLUDED: "INCLUDED", EXTRA_CHARGED: "EXTRA_CHARGED" };

/** What the client pays for one unit of an item. */
export function customerPrice(item) {
  if (!item) return 0;
  if (item.priceMode === PRICE_MODES.FIXED) return round2(item.customerPrice);
  return round2((Number(item.cost) || 0) * (1 + (Number(item.markupPercent) || 0) / 100));
}

/** Customer price less internal cost, per unit, and as a % of the price. */
export function itemMargin(item) {
  const price = customerPrice(item);
  const profit = round2(price - (Number(item?.cost) || 0));
  return { price, profit, percent: price > 0 ? Math.round((profit / price) * 1000) / 10 : 0 };
}

/**
 * The service's own price. For an AREA service `areaSqm` is required; the
 * minimum charge applies however small the area. `null` when it cannot be
 * priced yet (an area service with no area entered, or no price set).
 */
export function servicePrice(service, areaSqm = null) {
  if (!service) return null;
  if (service.pricingMode === PRICING_MODES.AREA) {
    const area = Number(areaSqm);
    if (!(area > 0) || service.areaRate === null || service.areaRate === undefined) return null;
    return round2(Math.max(area * Number(service.areaRate), Number(service.minimumCharge) || 0));
  }
  return service.defaultPrice === null || service.defaultPrice === undefined ? null : round2(service.defaultPrice);
}

/**
 * The extra charge for one material on a job: nothing when it is included in
 * the service, otherwise the amount used beyond the included quantity at the
 * item's customer price. `{ extraQuantity, unitPrice, amount }`.
 */
export function materialCharge(rule, usedQuantity, item) {
  if (!rule || rule.billingMode !== BILLING_MODES.EXTRA_CHARGED) return { extraQuantity: 0, unitPrice: 0, amount: 0 };
  const extraQuantity = Math.max(0, round2((Number(usedQuantity) || 0) - (Number(rule.defaultAmount) || 0)));
  const unitPrice = customerPrice(item);
  return { extraQuantity, unitPrice, amount: round2(extraQuantity * unitPrice) };
}

/** A service's down payment on a total, from its default percent. */
export const defaultDeposit = (service, total) => round2(((Number(service?.depositPercent) || 0) / 100) * (Number(total) || 0));

/** "₱50 / sqm, min ₱3,000" or "₱2,500" — how a service is priced, in words. */
export function describeServicePricing(service, formatPeso) {
  if (!service) return "";
  if (service.pricingMode === PRICING_MODES.AREA) {
    const rate = `${formatPeso(service.areaRate, { minDecimals: 0 })} / sqm`;
    return service.minimumCharge ? `${rate}, min ${formatPeso(service.minimumCharge, { minDecimals: 0 })}` : rate;
  }
  return service.defaultPrice === null || service.defaultPrice === undefined ? "No price set" : formatPeso(service.defaultPrice, { minDecimals: 0 });
}
