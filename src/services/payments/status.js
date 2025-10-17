const PAYMENT_FINAL_STATUSES = new Set([
  'succeeded',
  'paid',
  'captured',
  'cancelled',
  'canceled',
  'voided',
  'failed',
  'requires_payment_method',
  'refunded'
]);

const PAYMENT_CAPTURE_STATUSES = new Set(['succeeded', 'paid', 'captured', 'refunded']);
const PAYMENT_CANCEL_STATUSES = new Set(['canceled', 'cancelled', 'voided']);
const PAYMENT_FAILURE_STATUSES = new Set(['failed', 'requires_payment_method']);
const PAYMENT_ACTION_STATUSES = new Set([
  'requires_action',
  'requires_source_action',
  'requires_customer_action',
  'requires_3ds',
  'requires_payment_method'
]);

const PAYMENT_PENDING_HINTS = new Set(['pending', 'processing', 'requires_capture']);

const REFUND_FINAL_STATUSES = new Set(['succeeded', 'completed', 'paid', 'failed', 'canceled', 'cancelled']);
const REFUND_SUCCESS_STATUSES = new Set(['succeeded', 'completed', 'paid']);

function normalizePaymentStatus(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeReconciliationStatus(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isStatusInSet(status, set) {
  return set.has(normalizePaymentStatus(status));
}

function isFinalPaymentStatus(status) {
  return isStatusInSet(status, PAYMENT_FINAL_STATUSES);
}

function isCapturedStatus(status) {
  return isStatusInSet(status, PAYMENT_CAPTURE_STATUSES);
}

function isCancelledStatus(status) {
  return isStatusInSet(status, PAYMENT_CANCEL_STATUSES);
}

function isFailureStatus(status) {
  return isStatusInSet(status, PAYMENT_FAILURE_STATUSES);
}

function isActionRequiredStatus(status) {
  return isStatusInSet(status, PAYMENT_ACTION_STATUSES);
}

function isPendingStatus(status) {
  const normalized = normalizePaymentStatus(status);
  if (!normalized) return true;
  if (isCapturedStatus(normalized)) return false;
  if (isCancelledStatus(normalized)) return false;
  if (isFailureStatus(normalized)) return false;
  if (isActionRequiredStatus(normalized)) return false;
  if (PAYMENT_PENDING_HINTS.has(normalized)) return true;
  return !isFinalPaymentStatus(normalized);
}

function classifyPaymentStatus(status) {
  const normalized = normalizePaymentStatus(status);
  if (!normalized) return 'pending';
  if (isCapturedStatus(normalized)) {
    return normalized === 'refunded' ? 'refunded' : 'captured';
  }
  if (isCancelledStatus(normalized)) return 'cancelled';
  if (isFailureStatus(normalized)) return 'failed';
  if (isActionRequiredStatus(normalized)) return 'action_required';
  if (isPendingStatus(normalized)) return 'pending';
  return 'other';
}

const PAYMENT_STATUS_LABELS = {
  captured: { label: 'Pago', tone: 'success' },
  refunded: { label: 'Reembolsado', tone: 'muted' },
  pending: { label: 'Pendente', tone: 'warning' },
  action_required: { label: 'Ação necessária', tone: 'info' },
  failed: { label: 'Falhou', tone: 'danger' },
  cancelled: { label: 'Cancelado', tone: 'muted' },
  other: { label: 'Estado', tone: 'muted' }
};

function describePaymentStatus(status) {
  const key = classifyPaymentStatus(status);
  const entry = PAYMENT_STATUS_LABELS[key] || PAYMENT_STATUS_LABELS.other;
  return { key, ...entry };
}

function statusToneToBadgeClass(tone) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-100 text-emerald-700';
    case 'warning':
      return 'bg-amber-100 text-amber-700';
    case 'info':
      return 'bg-sky-100 text-sky-700';
    case 'danger':
      return 'bg-rose-100 text-rose-700';
    case 'muted':
    default:
      return 'bg-slate-200 text-slate-700';
  }
}

function isFinalRefundStatus(status) {
  return isStatusInSet(status, REFUND_FINAL_STATUSES);
}

function isSuccessfulRefundStatus(status) {
  return REFUND_SUCCESS_STATUSES.has(normalizePaymentStatus(status));
}

module.exports = {
  normalizePaymentStatus,
  normalizeReconciliationStatus,
  isFinalPaymentStatus,
  isCapturedStatus,
  isCancelledStatus,
  isFailureStatus,
  isActionRequiredStatus,
  isPendingStatus,
  classifyPaymentStatus,
  describePaymentStatus,
  statusToneToBadgeClass,
  isFinalRefundStatus,
  isSuccessfulRefundStatus,
  PAYMENT_FINAL_STATUSES: Object.freeze(Array.from(PAYMENT_FINAL_STATUSES)),
  PAYMENT_CAPTURE_STATUSES: Object.freeze(Array.from(PAYMENT_CAPTURE_STATUSES)),
  PAYMENT_CANCEL_STATUSES: Object.freeze(Array.from(PAYMENT_CANCEL_STATUSES)),
  PAYMENT_FAILURE_STATUSES: Object.freeze(Array.from(PAYMENT_FAILURE_STATUSES)),
  PAYMENT_ACTION_STATUSES: Object.freeze(Array.from(PAYMENT_ACTION_STATUSES)),
  REFUND_FINAL_STATUSES: Object.freeze(Array.from(REFUND_FINAL_STATUSES)),
  REFUND_SUCCESS_STATUSES: Object.freeze(Array.from(REFUND_SUCCESS_STATUSES))
};
