const {
  normalizePaymentStatus,
  isCapturedStatus,
  isCancelledStatus,
  isActionRequiredStatus,
  isFailureStatus,
  isSuccessfulRefundStatus
} = require('./status');

function toCents(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
}

function groupRefundsByPayment(refunds = []) {
  const map = new Map();
  for (const refund of refunds) {
    const paymentId = refund.payment_id || refund.paymentId;
    if (!paymentId) continue;
    const current = map.get(paymentId);
    if (current) current.push(refund);
    else map.set(paymentId, [refund]);
  }
  return map;
}

function summarizePayment(payment, refundsForPayment = []) {
  const paymentId = payment.id;
  const bookingId = payment.booking_id ?? payment.bookingId ?? null;
  const status = normalizePaymentStatus(payment.status);
  const amountCents = toCents(payment.amount_cents ?? payment.amountCents);

  const refundedCents = refundsForPayment.reduce((acc, refund) => {
    return isSuccessfulRefundStatus(refund.status)
      ? acc + toCents(refund.amount_cents ?? refund.amountCents)
      : acc;
  }, 0);

  let capturedCents = 0;
  let pendingCents = 0;
  let actionCents = 0;
  let failedCents = 0;
  let cancelledCents = 0;

  if (isCapturedStatus(status)) {
    capturedCents = amountCents;
  } else if (isActionRequiredStatus(status)) {
    actionCents = amountCents;
  } else if (isFailureStatus(status)) {
    failedCents = amountCents;
  } else if (isCancelledStatus(status)) {
    cancelledCents = amountCents;
  } else {
    pendingCents = amountCents;
  }

  const netCapturedCents = Math.max(0, capturedCents - refundedCents);

  return {
    paymentId,
    bookingId,
    status,
    amountCents,
    capturedCents,
    refundedCents,
    pendingCents,
    actionCents,
    failedCents,
    cancelledCents,
    netCapturedCents
  };
}

function aggregatePaymentData({ payments = [], refunds = [] } = {}) {
  const refundIndex = groupRefundsByPayment(refunds);
  const bookingSummaries = new Map();
  const paymentSummaries = new Map();

  for (const payment of payments) {
    if (!payment || !payment.id) continue;
    const refundsForPayment = refundIndex.get(payment.id) || [];
    const paymentSummary = summarizePayment(payment, refundsForPayment);
    paymentSummaries.set(payment.id, paymentSummary);

    if (!paymentSummary.bookingId) continue;
    let bookingSummary = bookingSummaries.get(paymentSummary.bookingId);
    if (!bookingSummary) {
      bookingSummary = {
        bookingId: paymentSummary.bookingId,
        capturedCents: 0,
        refundedCents: 0,
        pendingCents: 0,
        actionRequiredCents: 0,
        failedCents: 0,
        cancelledCents: 0,
        netCapturedCents: 0,
        paymentIds: []
      };
      bookingSummaries.set(paymentSummary.bookingId, bookingSummary);
    }

    bookingSummary.capturedCents += paymentSummary.capturedCents;
    bookingSummary.refundedCents += paymentSummary.refundedCents;
    bookingSummary.pendingCents += paymentSummary.pendingCents;
    bookingSummary.actionRequiredCents += paymentSummary.actionCents;
    bookingSummary.failedCents += paymentSummary.failedCents;
    bookingSummary.cancelledCents += paymentSummary.cancelledCents;
    bookingSummary.netCapturedCents += paymentSummary.netCapturedCents;
    bookingSummary.paymentIds.push(paymentSummary.paymentId);
  }

  return { bookingSummaries, paymentSummaries, refundIndex };
}

function computeOutstandingCents(summary, bookingTotalCents) {
  const total = toCents(bookingTotalCents);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const netCaptured = summary ? toCents(summary.netCapturedCents) : 0;
  const outstanding = total - netCaptured;
  return outstanding > 0 ? outstanding : 0;
}

module.exports = {
  aggregatePaymentData,
  computeOutstandingCents
};
