-- Backfill: mark payments as completed for orders already completed
-- (delivered or picked up) before the runtime update existed.
update payments
set payment_status = 'completed'
where payment_status in ('pending', 'processing')
  and order_id in (
    select id
    from orders
    where status in ('delivered', 'picked_up', 'completed')
  );
