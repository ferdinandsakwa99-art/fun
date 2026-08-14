import { supabase } from '../config/supabase';
import { WalletService } from './wallet.service';

export const PLATFORM_FEE_RATE = 0.16;

const round2 = (value: number) => Math.round(value * 100) / 100;

const isDuplicate = (error: any) => error?.code === '23505';

export const EarningsService = {
  async hasSettled(orderId: string, type: string) {
    const { data, error } = await supabase
      .from('earnings')
      .select('id')
      .eq('order_id', orderId)
      .eq('type', type)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  },

  async settleOrder(order: any) {
    const result: any = { already_settled: false };

    if (order?.restaurant_id) {
      const base = round2(Number(order.subtotal) || 0);
      const platform_fee = round2(base * PLATFORM_FEE_RATE);
      const amount = round2(base - platform_fee);
      const type = 'order_sale';

      if (await this.hasSettled(String(order.id), type)) {
        result.already_settled = true;
      } else {
        const { data, error } = await supabase
          .from('earnings')
          .insert({
            order_id: order.id,
            restaurant_id: order.restaurant_id,
            amount,
            platform_fee,
            type,
            status: 'credited',
            earnings_date: new Date().toISOString(),
            description: `Order ${order.order_number ?? order.id}: ${PLATFORM_FEE_RATE * 100}% platform fee deducted`,
          })
          .select()
          .single();

        if (error) {
          if (!isDuplicate(error)) throw error;
        } else {
          await WalletService.credit({ restaurant_id: String(order.restaurant_id) }, amount);
          if (platform_fee > 0) {
            await WalletService.credit({ platform: true }, platform_fee);
          }
        }
        result.restaurant = { amount, platform_fee };
      }
    }

    if (order?.rider_id) {
      // Rider payout is computed once at order creation (60 + 20/km) and
      // persisted as rider_pay, so settlement reuses the stored value instead
      // of recomputing distance. Fall back to the customer delivery fee for
      // orders created before rider_pay existed.
      const amount = round2(Number(order.rider_pay ?? order.delivery_fee) || 0);
      const type = 'delivery_fee';

      if (amount > 0) {
        if (await this.hasSettled(String(order.id), type)) {
          result.already_settled = true;
        } else {
          const { data, error } = await supabase
            .from('earnings')
            .insert({
              order_id: order.id,
              rider_id: order.rider_id,
              amount,
              platform_fee: 0,
              type,
              status: 'credited',
              earnings_date: new Date().toISOString(),
              description: `Delivery for order ${order.order_number ?? order.id}`,
            })
            .select()
            .single();

          if (error) {
            if (!isDuplicate(error)) throw error;
          } else {
            await WalletService.credit({ rider_id: String(order.rider_id) }, amount);
          }
          result.rider = { amount };
        }
      }

      // Cash-on-delivery: the rider collected the order total from the customer.
      // Record the collection as a wallet debit (allowed to go negative), so the
      // rider's balance shows -(total - delivery_fee). Already-paid orders are
      // unaffected: their delivery fee credit nets against any negative balance.
      if (String(order.payment_method || '').toLowerCase() === 'cash') {
        const collected = round2(Number(order.total) || 0);
        const colType = 'cash_collection';

        if (collected > 0 && !(await this.hasSettled(String(order.id), colType))) {
          const { data, error } = await supabase
            .from('earnings')
            .insert({
              order_id: order.id,
              rider_id: order.rider_id,
              amount: collected,
              platform_fee: 0,
              type: colType,
              status: 'collected',
              earnings_date: new Date().toISOString(),
              description: `Cash collected for order ${order.order_number ?? order.id}`,
            })
            .select()
            .single();

          if (error) {
            if (!isDuplicate(error)) throw error;
          } else {
            await WalletService.debit({ rider_id: String(order.rider_id) }, collected);
          }
          result.rider_cash = { collected };
        }
      }
    }

    return result;
  },

  async attachOrders(rows: any[]) {
    if (!rows || rows.length === 0) return rows ?? [];
    const ids = [...new Set(rows.map((row) => row.order_id).filter(Boolean))];
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, order_number, status, created_at, delivered_at, subtotal, delivery_fee, rider_pay')
      .in('id', ids);
    if (error) throw error;

    const byId = new Map((orders ?? []).map((order: any) => [order.id, order]));
    return rows.map((row) => ({
      ...row,
      order: row.order_id ? byId.get(row.order_id) || null : null,
    }));
  },

  async listForRestaurant(restaurantId: string) {
    const { data, error } = await supabase
      .from('earnings')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return this.attachOrders(data);
  },

  async listForRestaurants(restaurantIds: string[]) {
    if (!restaurantIds || restaurantIds.length === 0) return [];
    const { data, error } = await supabase
      .from('earnings')
      .select('*')
      .in('restaurant_id', restaurantIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return this.attachOrders(data);
  },

  async listForRider(riderId: string) {
    const { data, error } = await supabase
      .from('earnings')
      .select('*')
      .eq('rider_id', riderId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return this.attachOrders(data);
  },

  summarize(rows: any[]) {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    let total_earned = 0;
    let total_platform_fees = 0;
    let this_week = 0;
    let count = 0;

    (rows ?? []).forEach((row) => {
      if (row.status !== 'credited') return;
      total_earned += Number(row.amount) || 0;
      total_platform_fees += Number(row.platform_fee) || 0;
      count += 1;
      const created = row.created_at ? new Date(row.created_at) : null;
      if (created && created >= weekStart) this_week += Number(row.amount) || 0;
    });

    return {
      total_earned: round2(total_earned),
      total_platform_fees: round2(total_platform_fees),
      this_week: round2(this_week),
      count,
    };
  },
};

export default EarningsService;
