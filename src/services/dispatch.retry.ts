import { supabase } from '../config/supabase';
import { logger } from '../config/logger';
import { OrderService } from './order.service';
import { DispatchService } from './dispatch.service';
import { SocketService } from './socket.service';

const RETRY_INTERVAL_MS = Number(process.env.DISPATCH_RETRY_INTERVAL_MS || 15000);
// 0 (default) means keep retrying until a rider is found or the order leaves
// the 'ready' state. Set to a positive number to cap total attempts.
const MAX_ATTEMPTS = Number(process.env.DISPATCH_MAX_ATTEMPTS || 0);
const BACKOFF_BASE_MS = Number(process.env.DISPATCH_BACKOFF_BASE_MS || 10000);
const BACKOFF_CAP_MS = Number(process.env.DISPATCH_BACKOFF_CAP_MS || 120000);

const inFlight = new Set<string>();
let timer: NodeJS.Timeout | null = null;

function backoffMs(attempts: number): number {
  if (attempts <= 1) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 2), BACKOFF_CAP_MS);
}

export const DispatchRetryService = {
  start() {
    if (timer) return;
    timer = setInterval(() => void this.sweep(), RETRY_INTERVAL_MS);
    timer.unref?.();
    logger.info(
      `[dispatch-retry] sweeper started (interval ${RETRY_INTERVAL_MS}ms, max ${MAX_ATTEMPTS} attempts)`,
    );
  },

  stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  },

  async sweep() {
    let query = supabase
      .from('orders')
      .select('id, dispatch_attempts, last_dispatch_attempt_at')
      .eq('status', 'ready')
      .eq('delivery_type', 'delivery')
      .is('rider_id', null);
    if (MAX_ATTEMPTS > 0) {
      query = query.lt('dispatch_attempts', MAX_ATTEMPTS);
    }
    const { data, error } = await query;
    if (error) {
      logger.error('[dispatch-retry] sweep query failed:', error.message);
      return;
    }

    const now = Date.now();
    for (const order of data ?? []) {
      const attempts = Number(order.dispatch_attempts) || 0;
      const lastAttempt = order.last_dispatch_attempt_at
        ? new Date(order.last_dispatch_attempt_at).getTime()
        : 0;
      // Respect exponential backoff between attempts.
      if (lastAttempt && now - lastAttempt < backoffMs(attempts)) continue;
      void this.retryOrder(String(order.id));
    }
  },

  async retryOrder(orderId: string) {
    if (inFlight.has(orderId)) return;
    inFlight.add(orderId);
    try {
      const order = await OrderService.findById(orderId);
      if (!order) return;
      // Re-check state in case it changed while queued.
      if (
        order.status !== 'ready' ||
        order.delivery_type === 'pickup' ||
        order.rider_id != null
      ) {
        return;
      }

      const result = await DispatchService.dispatchForOrder(order);
      if (result.assigned) {
        logger.info(`[dispatch-retry] order ${orderId} assigned to rider ${result.rider?.id}`);
        SocketService.emitOrderUpdated(result.order);
      } else {
        logger.warn(`[dispatch-retry] order ${orderId} retry failed: ${result.reason}`);
      }
    } catch (err: any) {
      logger.error(`[dispatch-retry] order ${orderId} error:`, err?.message || err);
    } finally {
      inFlight.delete(orderId);
    }
  },
};
