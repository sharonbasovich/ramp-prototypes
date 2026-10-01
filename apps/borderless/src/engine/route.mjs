// engine/route.mjs — funding-route preflight for Currency Check.
//
// Scope is deliberately narrow: the only route this sandbox evaluates is the
// simplified, documented Canada Bill Pay rule — Canadian Bill Pay requires
// CAD funding. Everything else is "not evaluated"; a generic parse or a
// successful currency conversion is never a route-support claim.
//
// Country does NOT imply an entity's functional/native accounting currency:
// a Canadian entity may report in USD. The rule is about the FUNDING
// currency only.

import { isCurrency } from './money.mjs';

export const CANADA_BILLPAY_SOURCE =
  'https://support.ramp.com/bill-pay-for-canadian-businesses/';

export const ROUTE_DISCLAIMER =
  'Simplified sandbox route check. Fixture assumes a verified eligible ' +
  'Ontario business, supported accounting and own-entity payment. It is ' +
  'not a complete eligibility verdict and not a Ramp integration.';

/**
 * @param {object} input
 * @param {string} input.entityCountry  e.g. 'CA' (ISO country of the entity)
 * @param {string} input.fundingCurrency ISO code of the funding account
 * @returns {{decision:'preflight-passed'|'blocked'|'not-evaluated', label:string, reason:string, source:string|null}}
 */
export function evaluateFundingRoute({ entityCountry, fundingCurrency }) {
  if (typeof entityCountry !== 'string' || entityCountry.trim() === '') {
    return {
      decision: 'not-evaluated',
      label: 'not evaluated',
      reason: 'no entity country supplied — route preflight needs an entity',
      source: null,
    };
  }
  if (!isCurrency(fundingCurrency)) {
    return {
      decision: 'not-evaluated',
      label: 'not evaluated',
      reason: `funding currency ${fundingCurrency ?? '—'} is outside the sandbox currency set`,
      source: null,
    };
  }
  const country = entityCountry.trim().toUpperCase();
  if (country === 'CA' || country === 'CAN' || country === 'CANADA') {
    if (fundingCurrency === 'CAD') {
      return {
        decision: 'preflight-passed',
        label: 'funding-currency preflight passed',
        reason:
          'CAD funding account satisfies the documented Canadian Bill Pay ' +
          'funding-currency rule for this fixture.',
        source: CANADA_BILLPAY_SOURCE,
      };
    }
    if (fundingCurrency === 'USD') {
      return {
        decision: 'blocked',
        label: 'blocked — CAD funding required',
        reason:
          'Canadian Bill Pay requires CAD funding. A USD invoice does not ' +
          'make a Canadian-domiciled USD account eligible.',
        source: CANADA_BILLPAY_SOURCE,
      };
    }
    return {
      decision: 'blocked',
      label: 'blocked — unsupported sandbox funding route',
      reason:
        `${fundingCurrency} funding is not a supported route in this ` +
        'sandbox. Parsing or converting a currency says nothing about ' +
        'payment-route availability.',
      source: CANADA_BILLPAY_SOURCE,
    };
  }
  return {
    decision: 'not-evaluated',
    label: 'not evaluated',
    reason:
      'Route preflight covers only the simplified documented Canada ' +
      'fixture. No support is inferred for other entities or corridors.',
    source: null,
  };
}
