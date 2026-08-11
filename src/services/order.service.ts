import { supabase } from '../config/supabase';

const ORDER_ITEM_SELECT =
  'id, order_id, menu_item_id, quantity, unit_price, total_price, special_instructions, menu_item:menu_items(id, name)';

export const OrderService = {
  async findById(id: string) {
    const { data, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error) throw error;
    return this.attachItems([data]).then((orders) => orders[0]);
  },

  async listForUser(userId: string) {
    const { data, error } = await supabase.from('orders').select('*').eq('user_id', userId);
    if (error) throw error;
    return this.attachItems(data);
  },

  async listForRestaurant(restaurantId: string) {
    const { data, error } = await supabase.from('orders').select('*').eq('restaurant_id', restaurantId);
    if (error) throw error;
    return this.attachItems(data);
  },

  async listForRider(riderId: string) {
    const { data, error } = await supabase.from('orders').select('*').eq('rider_id', riderId);
    if (error) throw error;
    return this.attachItems(data);
  },

  async create(values: Record<string, any>) {
    const { items, ...orderValues } = values;
    if (!orderValues.order_number) {
      orderValues.order_number = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(
        1000 + Math.random() * 9000,
      )}`;
    }
    const { data, error } = await supabase.from('orders').insert(orderValues).select().single();
    if (error) throw error;
    const order = data as { id: string } | null;

    if (Array.isArray(items) && items.length > 0 && order?.id) {
      const orderItems = items.map((item) => ({
        order_id: order.id,
        menu_item_id: item.menu_item_id,
        quantity: item.quantity ?? 1,
        unit_price: item.unit_price ?? 0,
        total_price: item.total_price ?? 0,
        special_instructions: item.special_instructions ?? null,
      }));
      const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
      if (itemsError) throw itemsError;
    }

    if (!order) throw new Error('Failed to create order');
    return this.findById(order.id);
  },

  async updateById(id: string, values: Record<string, any>) {
    const { data, error } = await supabase.from('orders').update(values).eq('id', id).select().single();
    if (error) throw error;
    return this.attachItems([data]).then((orders) => orders[0]);
  },

  async attachItems(orders: any[]) {
    if (!orders || orders.length === 0) return orders ?? [];
    const ids = orders.map((order) => order.id);
    const { data: items, error } = await supabase
      .from('order_items')
      .select(ORDER_ITEM_SELECT)
      .in('order_id', ids);
    if (error) throw error;

    const rows: any[] = items ?? [];

    const menuItemIds = [
      ...new Set(
        rows
          .map((item) => item.menu_item_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let imageMap = new Map<string, any[]>();
    if (menuItemIds.length > 0) {
      const { data: images, error: imagesError } = await supabase
        .from('menu_item_images')
        .select('id, menu_item_id, image_url, alt_text, is_primary, sort_order')
        .in('menu_item_id', menuItemIds)
        .order('sort_order', { ascending: true });
      if (imagesError) throw imagesError;
      (images || []).forEach((image: any) => {
        const list = imageMap.get(image.menu_item_id) ?? [];
        list.push(image);
        imageMap.set(image.menu_item_id, list);
      });
    }

    const byOrder = new Map<string, any[]>();
    rows.forEach((item: any) => {
      const enriched = item.menu_item
        ? {
            ...item,
            menu_item: {
              ...item.menu_item,
              images: imageMap.get(item.menu_item_id) ?? [],
            },
          }
        : item;
      const list = byOrder.get(item.order_id) ?? [];
      list.push(enriched);
      byOrder.set(item.order_id, list);
    });

    const restaurantIds = [
      ...new Set(
        orders
          .map((order) => order.restaurant_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let restaurantMap = new Map<string, any>();
    if (restaurantIds.length > 0) {
      const { data: restaurants, error: restaurantsError } = await supabase
        .from('restaurants')
        .select('id, name, cover_image')
        .in('id', restaurantIds);
      if (restaurantsError) throw restaurantsError;
      restaurantMap = new Map(
        (restaurants ?? []).map((restaurant: any) => [
          String(restaurant.id),
          restaurant,
        ]),
      );
    }

    const withItems = orders.map((order) => ({
      ...order,
      restaurant: order.restaurant_id
        ? restaurantMap.get(String(order.restaurant_id)) ?? null
        : null,
      items: byOrder.get(order.id) ?? [],
    }));
    return this.attachRiders(withItems);
  },

  async attachRiders(orders: any[]) {
    if (!orders || orders.length === 0) return orders ?? [];

    const riderIds = [
      ...new Set(
        orders
          .map((order) => order.rider_id)
          .filter((id): id is string => Boolean(id))
          .map((id) => String(id)),
      ),
    ];
    if (riderIds.length === 0) return orders;

    const { data: riders, error } = await supabase
      .from('riders')
      .select('id, user_id, vehicle_type, vehicle_number, average_rating')
      .in('id', riderIds);
    if (error) throw error;

    const riderMap = new Map<string, any>(
      (riders ?? []).map((rider) => [String(rider.id), rider]),
    );

    const userIds = [
      ...new Set(
        (riders ?? [])
          .map((rider) => rider.user_id)
          .filter((id): id is string => Boolean(id))
          .map((id) => String(id)),
      ),
    ];

    let userMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, name, phone')
        .in('id', userIds);
      if (usersError) throw usersError;
      userMap = new Map((users ?? []).map((user) => [String(user.id), user]));
    }

    return orders.map((order) => {
      if (!order.rider_id) return order;
      const rider = riderMap.get(String(order.rider_id));
      if (!rider) return order;
      const user = rider.user_id ? userMap.get(String(rider.user_id)) : null;
      return {
        ...order,
        rider: {
          id: rider.id,
          user_id: rider.user_id ?? null,
          name: user?.name ?? null,
          phone: user?.phone ?? null,
          vehicle_type: rider.vehicle_type ?? null,
          vehicle_number: rider.vehicle_number ?? null,
          average_rating: rider.average_rating ?? null,
        },
      };
    });
  },

  async enrichForRider(order: any) {
    if (!order) return order;

    let restaurant: any = null;
    if (order.restaurant_id) {
      const { data } = await supabase
        .from('restaurants')
        .select('id, name, address, city, phone, latitude, longitude')
        .eq('id', order.restaurant_id)
        .single();
      restaurant = data;
    }

    let dropoff: any = null;
    if (order.address_id) {
      const { data } = await supabase
        .from('addresses')
        .select('id, full_address, apartment, city, instructions, latitude, longitude')
        .eq('id', order.address_id)
        .single();
      dropoff = data;
    }

    let customer: any = null;
    if (order.user_id) {
      const { data } = await supabase
        .from('users')
        .select('id, name, phone')
        .eq('id', order.user_id)
        .single();
      customer = data;
    }

    return { ...order, restaurant, dropoff, customer };
  },

  async enrichForCustomer(order: any) {
    if (!order) return order;

    let destination: any = null;
    if (order.address_id) {
      const { data } = await supabase
        .from('addresses')
        .select('latitude, longitude')
        .eq('id', order.address_id)
        .single();
      destination = data;
    }

    let riderLocation: any = null;
    if (order.rider_id) {
      const { data } = await supabase
        .from('riders')
        .select('current_latitude, current_longitude')
        .eq('id', order.rider_id)
        .single();
      riderLocation = data;
    }

    return {
      ...order,
      delivery: {
        destination_latitude: destination?.latitude ?? null,
        destination_longitude: destination?.longitude ?? null,
        rider_latitude: riderLocation?.current_latitude ?? null,
        rider_longitude: riderLocation?.current_longitude ?? null,
      },
    };
  },
};
